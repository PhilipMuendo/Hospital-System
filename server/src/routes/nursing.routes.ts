import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { ApiError } from '../middleware/errorHandler.js'
import { audit } from '../lib/audit.js'

export const nursingRoutes = Router()

/** Start of the current day in Africa/Nairobi. */
function startOfNairobiDay(now = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return new Date(`${ymd}T00:00:00+03:00`)
}

/**
 * The ward board: every inpatient in one ward with the state a nurse needs at
 * a glance — latest observations, how the drug round stands, unreviewed
 * results and allergies.
 */
nursingRoutes.get(
  '/wards/:id/board',
  requireAuth,
  requireRole('NURSE', 'PHYSICIAN', 'ADMIN'),
  async (req, res, next) => {
    try {
      const dayStart = startOfNairobiDay()

      const patients = await prisma.patient.findMany({
        where: { wardId: req.params.id, status: 'ADMITTED' },
        orderBy: { bed: 'asc' },
        include: {
          primaryPhysician: { select: { name: true } },
          vitals: { orderBy: { recordedAt: 'desc' }, take: 5 },
          labs: { where: { reviewed: false }, select: { id: true, test: true, flag: true } },
          prescriptions: {
            where: { status: { in: ['ACTIVE', 'PARTIALLY_DISPENSED'] } },
            include: {
              items: {
                include: {
                  drug: { select: { genericName: true, strength: true, form: true, controlled: true } },
                  administrations: {
                    where: { administeredAt: { gte: dayStart } },
                    orderBy: { administeredAt: 'desc' },
                  },
                },
              },
            },
          },
        },
      })

      audit(req, { action: 'READ', entity: 'Ward.Board', meta: { wardId: req.params.id } })

      res.json(
        patients.map((p) => {
          const items = p.prescriptions.flatMap((rx) => rx.items)

          // Only scheduled drugs count towards "is the round done" — a PRN
          // has no dosesPerDay and is given on demand, so counting it would
          // make every round look permanently incomplete.
          const scheduled = items.filter((i) => i.dosesPerDay && i.dosesPerDay > 0)
          const dueToday = scheduled.reduce((sum, i) => sum + (i.dosesPerDay ?? 0), 0)
          const givenToday = scheduled.reduce(
            (sum, i) => sum + i.administrations.filter((a) => a.status === 'GIVEN' || a.status === 'GIVEN_LATE').length,
            0,
          )

          return {
            id: p.id,
            name: p.name,
            bed: p.bed,
            ipNumber: p.ipNumber,
            opNumber: p.opNumber,
            dob: p.dob,
            sex: p.sex,
            allergies: p.allergies,
            codeStatus: p.codeStatus,
            physician: p.primaryPhysician?.name ?? null,
            admittedAt: p.admittedAt,
            latestVitals: p.vitals,
            worstVital: p.vitals.some((v) => v.status === 'CRITICAL')
              ? 'CRITICAL'
              : p.vitals.some((v) => v.status === 'WARNING')
                ? 'WARNING'
                : 'HEALTHY',
            unreviewedLabs: p.labs,
            medication: {
              dueToday,
              givenToday,
              outstanding: Math.max(0, dueToday - givenToday),
              items: items.map((i) => ({
                id: i.id,
                drug: `${i.drug.genericName} ${i.drug.strength}`,
                form: i.drug.form,
                controlled: i.drug.controlled,
                dose: i.dose,
                route: i.route,
                frequency: i.frequency,
                dosesPerDay: i.dosesPerDay,
                quantityDispensed: i.quantityDispensed,
                givenToday: i.administrations.filter(
                  (a) => a.status === 'GIVEN' || a.status === 'GIVEN_LATE',
                ).length,
                administrations: i.administrations.map((a) => ({
                  id: a.id,
                  status: a.status,
                  administeredAt: a.administeredAt,
                  reason: a.reason,
                })),
              })),
            },
          }
        }),
      )
    } catch (err) {
      next(err)
    }
  },
)

const administerSchema = z
  .object({
    status: z.enum(['GIVEN', 'OMITTED', 'REFUSED', 'GIVEN_LATE']),
    doseGiven: z.string().optional(),
    route: z.string().optional(),
    reason: z.string().optional(),
    notes: z.string().optional(),
    /** Second signature. Mandatory for controlled drugs. */
    witnessedById: z.string().optional(),
  })
  .refine((d) => d.status === 'GIVEN' || d.status === 'GIVEN_LATE' || !!d.reason, {
    message: 'A reason is required when a dose is omitted or refused',
    path: ['reason'],
  })

/**
 * Record one administration on the drug round.
 *
 * Append-only: a mistake is corrected by a further entry, never by editing
 * this one, because the MAR is the legal record of what was put into a
 * patient. There is deliberately no update or delete endpoint.
 */
nursingRoutes.post(
  '/prescription-items/:id/administer',
  requireAuth,
  requireRole('NURSE', 'PHYSICIAN', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = administerSchema.parse(req.body)

      const item = await prisma.prescriptionItem.findUnique({
        where: { id: req.params.id },
        include: {
          drug: true,
          prescription: { include: { patient: { select: { id: true, name: true, allergies: true } } } },
        },
      })
      if (!item) throw new ApiError(404, 'Prescription item not found')
      if (item.prescription.status === 'CANCELLED') {
        throw new ApiError(409, 'This prescription has been cancelled')
      }

      const given = data.status === 'GIVEN' || data.status === 'GIVEN_LATE'

      // Controlled drugs need two signatures at the trolley. Enforced here
      // rather than trusted to the UI, because this is the control the
      // Pharmacy and Poisons Board actually inspects for.
      if (given && item.drug.controlled && !data.witnessedById) {
        throw new ApiError(400, `${item.drug.genericName} is a controlled drug and needs a witness`)
      }
      if (data.witnessedById && data.witnessedById === req.user!.id) {
        throw new ApiError(400, 'The witness must be a second person')
      }

      // Nothing has reached the ward yet, so there is physically nothing to
      // give — this catches a round being charted ahead of the trolley.
      if (given && item.quantityDispensed === 0) {
        throw new ApiError(409, 'No stock has been dispensed for this item yet')
      }

      const record = await prisma.medicationAdministration.create({
        data: {
          prescriptionItemId: item.id,
          status: data.status,
          doseGiven: data.doseGiven ?? item.dose,
          route: data.route ?? item.route,
          administeredById: req.user!.id,
          reason: data.reason,
          notes: data.notes,
          witnessedById: data.witnessedById,
        },
      })

      audit(req, {
        entity: 'MedicationAdministration',
        entityId: record.id,
        patientId: item.prescription.patient.id,
        meta: {
          drug: item.drug.genericName,
          dose: record.doseGiven,
          status: data.status,
          reason: data.reason,
          controlled: item.drug.controlled,
          witnessedById: data.witnessedById,
        },
      })
      res.status(201).json(record)
    } catch (err) {
      next(err)
    }
  },
)

/** Full administration history for one drug — the MAR chart for that line. */
nursingRoutes.get(
  '/prescription-items/:id/administrations',
  requireAuth,
  async (req, res, next) => {
    try {
      const records = await prisma.medicationAdministration.findMany({
        where: { prescriptionItemId: req.params.id },
        orderBy: { administeredAt: 'desc' },
        include: { administeredBy: { select: { name: true, role: true } } },
        take: 100,
      })
      audit(req, { action: 'READ', entity: 'MedicationAdministration' })
      res.json(records)
    } catch (err) {
      next(err)
    }
  },
)
