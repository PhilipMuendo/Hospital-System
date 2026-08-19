import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { ApiError } from '../middleware/errorHandler.js'
import { audit } from '../lib/audit.js'

export const reportsRoutes = Router()

/** Start/end of a day in Africa/Nairobi, given a YYYY-MM-DD string. */
function nairobiDayRange(dateStr?: string) {
  const base = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : new Date().toISOString().slice(0, 10)
  // Nairobi is UTC+3 year-round, so local midnight is 21:00 UTC the day before.
  const from = new Date(`${base}T00:00:00+03:00`)
  const to = new Date(`${base}T23:59:59.999+03:00`)
  return { base, from, to }
}

/**
 * Bed state by ward, plus the admissions and discharges that moved it today.
 * This is the census a nurse manager reads at handover.
 */
reportsRoutes.get('/reports/ward-census', requireAuth, async (req, res, next) => {
  try {
    const { base, from, to } = nairobiDayRange(req.query.date as string | undefined)

    const wards = await prisma.ward.findMany({
      orderBy: { name: 'asc' },
      include: {
        patients: {
          where: { status: 'ADMITTED' },
          select: { id: true, admittedAt: true },
        },
      },
    })

    const [admissionsToday, dischargesToday] = await Promise.all([
      prisma.patient.groupBy({
        by: ['wardId'],
        where: { admittedAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      prisma.patient.groupBy({
        by: ['wardId'],
        where: { dischargedAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
    ])

    const admitMap = new Map(admissionsToday.map((a) => [a.wardId, a._count._all]))
    const dischMap = new Map(dischargesToday.map((d) => [d.wardId, d._count._all]))

    const rows = wards.map((w) => {
      const occupied = w.patients.length
      return {
        ward: w.name,
        bedCapacity: w.bedCapacity,
        occupied,
        available: w.bedCapacity - occupied,
        occupancyPct: w.bedCapacity === 0 ? 0 : Math.round((occupied / w.bedCapacity) * 1000) / 10,
        admissionsToday: admitMap.get(w.id) ?? 0,
        dischargesToday: dischMap.get(w.id) ?? 0,
      }
    })

    const totals = rows.reduce(
      (acc, r) => ({
        bedCapacity: acc.bedCapacity + r.bedCapacity,
        occupied: acc.occupied + r.occupied,
        available: acc.available + r.available,
        admissionsToday: acc.admissionsToday + r.admissionsToday,
        dischargesToday: acc.dischargesToday + r.dischargesToday,
      }),
      { bedCapacity: 0, occupied: 0, available: 0, admissionsToday: 0, dischargesToday: 0 },
    )

    audit(req, { action: 'EXPORT', entity: 'Report.WardCensus', meta: { date: base } })
    res.json({
      date: base,
      rows,
      totals: {
        ...totals,
        occupancyPct:
          totals.bedCapacity === 0 ? 0 : Math.round((totals.occupied / totals.bedCapacity) * 1000) / 10,
      },
    })
  } catch (err) {
    next(err)
  }
})

/**
 * Daily revenue split by payer and status, with the M-Pesa receipts that
 * settled it. This is the sheet the cashier reconciles against the Safaricom
 * statement at close of business.
 */
reportsRoutes.get(
  '/reports/revenue',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      const { base, from, to } = nairobiDayRange(req.query.date as string | undefined)

      const [byPayer, byStatus, mpesa, lines] = await Promise.all([
        prisma.billingLine.groupBy({
          by: ['payer'],
          where: { createdAt: { gte: from, lte: to } },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        prisma.billingLine.groupBy({
          by: ['status'],
          where: { createdAt: { gte: from, lte: to } },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        prisma.mpesaTransaction.findMany({
          where: { createdAt: { gte: from, lte: to }, status: 'SUCCESS' },
          orderBy: { transactionDate: 'asc' },
          include: { patient: { select: { name: true, ipNumber: true } } },
        }),
        prisma.billingLine.findMany({
          where: { createdAt: { gte: from, lte: to } },
          orderBy: { createdAt: 'asc' },
          include: { patient: { select: { name: true, ipNumber: true } } },
          take: 500,
        }),
      ])

      const mpesaTotal = mpesa.reduce((sum, t) => sum + Number(t.amount), 0)

      audit(req, { action: 'EXPORT', entity: 'Report.Revenue', meta: { date: base } })
      res.json({
        date: base,
        byPayer: byPayer.map((p) => ({
          payer: p.payer,
          count: p._count._all,
          total: String(p._sum.amount ?? 0),
        })),
        byStatus: byStatus.map((s) => ({
          status: s.status,
          count: s._count._all,
          total: String(s._sum.amount ?? 0),
        })),
        mpesa: {
          count: mpesa.length,
          total: mpesaTotal.toFixed(2),
          receipts: mpesa.map((t) => ({
            receipt: t.mpesaReceiptNumber,
            amount: String(t.amount),
            // Masked here too — a printed report leaves the building.
            phone: `${t.phone.slice(0, 6)}***${t.phone.slice(-3)}`,
            patient: t.patient?.name ?? '—',
            ipNumber: t.patient?.ipNumber ?? '—',
            at: t.transactionDate,
          })),
        },
        lines: lines.map((l) => ({
          id: l.id,
          code: l.code,
          description: l.description,
          amount: String(l.amount),
          payer: l.payer,
          status: l.status,
          mpesaReference: l.mpesaReference,
          patient: l.patient.name,
          ipNumber: l.patient.ipNumber,
          createdAt: l.createdAt,
        })),
        grandTotal: lines.reduce((sum, l) => sum + Number(l.amount), 0).toFixed(2),
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * Statement of account for one patient — the document that becomes the
 * invoice handed to the payer, so it carries the facility's KRA PIN and every
 * line with its settlement state.
 */
reportsRoutes.get('/reports/patients/:id/invoice', requireAuth, async (req, res, next) => {
  try {
    const patient = await prisma.patient.findUnique({
      where: { id: req.params.id },
      include: {
        ward: { select: { name: true } },
        primaryPhysician: { select: { name: true } },
        billingLines: { orderBy: { createdAt: 'asc' } },
        mpesaTransactions: {
          where: { status: 'SUCCESS' },
          orderBy: { transactionDate: 'asc' },
        },
      },
    })
    if (!patient) throw new ApiError(404, 'Patient not found')

    const total = patient.billingLines.reduce((s, l) => s + Number(l.amount), 0)
    const paid = patient.billingLines
      .filter((l) => l.status === 'PAID')
      .reduce((s, l) => s + Number(l.amount), 0)
    const denied = patient.billingLines
      .filter((l) => l.status === 'DENIED')
      .reduce((s, l) => s + Number(l.amount), 0)

    audit(req, { action: 'EXPORT', entity: 'Report.Invoice', patientId: patient.id })
    res.json({
      patient: {
        id: patient.id,
        name: patient.name,
        ipNumber: patient.ipNumber,
        nationalId: patient.nationalId,
        ward: patient.ward?.name ?? 'Outpatient',
        bed: patient.bed ?? '—',
        admittedAt: patient.admittedAt,
        dischargedAt: patient.dischargedAt,
        status: patient.status,
        physician: patient.primaryPhysician?.name ?? 'Not assigned',
      },
      lines: patient.billingLines.map((l) => ({
        id: l.id,
        code: l.code,
        description: l.description,
        amount: String(l.amount),
        payer: l.payer,
        status: l.status,
        mpesaReference: l.mpesaReference,
        createdAt: l.createdAt,
      })),
      payments: patient.mpesaTransactions.map((t) => ({
        receipt: t.mpesaReceiptNumber,
        amount: String(t.amount),
        at: t.transactionDate,
      })),
      totals: {
        total: total.toFixed(2),
        paid: paid.toFixed(2),
        denied: denied.toFixed(2),
        outstanding: (total - paid).toFixed(2),
      },
    })
  } catch (err) {
    next(err)
  }
})

/**
 * Everything a discharge summary needs in one call — the letter the patient
 * carries to their next clinician.
 */
reportsRoutes.get('/reports/patients/:id/discharge-summary', requireAuth, async (req, res, next) => {
  try {
    const patient = await prisma.patient.findUnique({
      where: { id: req.params.id },
      include: {
        ward: { select: { name: true } },
        primaryPhysician: { select: { name: true } },
        labs: { orderBy: { collectedAt: 'desc' }, take: 20 },
        imaging: { orderBy: { performedAt: 'desc' }, take: 10 },
        vitals: { orderBy: { recordedAt: 'desc' }, take: 8 },
        surgeries: { orderBy: { startsAt: 'asc' }, include: { surgeon: { select: { name: true } } } },
        prescriptions: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: { createdAt: 'desc' },
          include: {
            prescriber: { select: { name: true } },
            items: { include: { drug: true } },
          },
        },
      },
    })
    if (!patient) throw new ApiError(404, 'Patient not found')

    audit(req, { action: 'EXPORT', entity: 'Report.DischargeSummary', patientId: patient.id })
    res.json({
      patient: {
        id: patient.id,
        name: patient.name,
        ipNumber: patient.ipNumber,
        nationalId: patient.nationalId,
        dob: patient.dob,
        sex: patient.sex,
        bloodType: patient.bloodType,
        phone: patient.phone,
        allergies: patient.allergies,
        codeStatus: patient.codeStatus,
        chiefComplaint: patient.chiefComplaint,
        assessment: patient.assessment,
        carePlan: patient.carePlan,
        ward: patient.ward?.name ?? 'Outpatient',
        bed: patient.bed ?? '—',
        admittedAt: patient.admittedAt,
        dischargedAt: patient.dischargedAt,
        status: patient.status,
        physician: patient.primaryPhysician?.name ?? 'Not assigned',
        nextOfKin: {
          name: patient.nextOfKinName,
          phone: patient.nextOfKinPhone,
          relation: patient.nextOfKinRelation,
        },
      },
      vitals: patient.vitals,
      labs: patient.labs,
      imaging: patient.imaging,
      surgeries: patient.surgeries.map((s) => ({
        procedure: s.procedure,
        surgeon: s.surgeon.name,
        room: s.room,
        startsAt: s.startsAt,
        status: s.status,
      })),
      prescriptions: patient.prescriptions.map((p) => ({
        id: p.id,
        status: p.status,
        createdAt: p.createdAt,
        prescriber: p.prescriber.name,
        notes: p.notes,
        items: p.items.map((i) => ({
          drug: `${i.drug.genericName} ${i.drug.strength}`,
          form: i.drug.form,
          dose: i.dose,
          route: i.route,
          frequency: i.frequency,
          durationDays: i.durationDays,
          quantityPrescribed: i.quantityPrescribed,
          quantityDispensed: i.quantityDispensed,
          instructions: i.instructions,
        })),
      })),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * Stock position with expiry exposure. Pharmacists print this for the monthly
 * count; the expiring-soon column is what drives write-off decisions.
 */
reportsRoutes.get(
  '/reports/stock',
  requireAuth,
  requireRole('PHARMACIST', 'ADMIN'),
  async (req, res, next) => {
    try {
      const now = new Date()
      const soonCutoff = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

      const drugs = await prisma.drug.findMany({
        where: { active: true },
        orderBy: { genericName: 'asc' },
        include: { batches: { orderBy: { expiryDate: 'asc' } } },
      })

      const rows = drugs.map((d) => {
        const inStock = d.batches.reduce((s, b) => (b.expiryDate > now ? s + b.quantity : s), 0)
        const expiring = d.batches.reduce(
          (s, b) => (b.expiryDate > now && b.expiryDate <= soonCutoff ? s + b.quantity : s),
          0,
        )
        const expired = d.batches.reduce((s, b) => (b.expiryDate <= now ? s + b.quantity : s), 0)
        return {
          code: d.code,
          drug: `${d.genericName} ${d.strength}`,
          form: d.form,
          unit: d.unit,
          kemlListed: d.kemlListed,
          controlled: d.controlled,
          unitPrice: String(d.unitPrice),
          inStock,
          reorderLevel: d.reorderLevel,
          belowReorder: inStock < d.reorderLevel,
          expiringSoon: expiring,
          expiredUnits: expired,
          stockValue: (inStock * Number(d.unitPrice)).toFixed(2),
          batches: d.batches.map((b) => ({
            batchNumber: b.batchNumber,
            expiryDate: b.expiryDate,
            quantity: b.quantity,
            supplier: b.supplier,
          })),
        }
      })

      audit(req, { action: 'EXPORT', entity: 'Report.Stock' })
      res.json({
        generatedAt: now,
        rows,
        totals: {
          lines: rows.length,
          belowReorder: rows.filter((r) => r.belowReorder).length,
          expiringSoon: rows.filter((r) => r.expiringSoon > 0).length,
          stockValue: rows.reduce((s, r) => s + Number(r.stockValue), 0).toFixed(2),
        },
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * Controlled-substance movement register. Kenya's Pharmacy and Poisons Board
 * requires a register for scheduled drugs that shows every receipt and issue
 * with the person responsible — this is that register, generated rather than
 * hand-written.
 */
reportsRoutes.get(
  '/reports/controlled-register',
  requireAuth,
  requireRole('PHARMACIST', 'ADMIN'),
  async (req, res, next) => {
    try {
      const from = req.query.from
        ? new Date(`${req.query.from as string}T00:00:00+03:00`)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const to = req.query.to ? new Date(`${req.query.to as string}T23:59:59.999+03:00`) : new Date()

      const movements = await prisma.stockMovement.findMany({
        where: { drug: { controlled: true }, createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'asc' },
        include: {
          drug: true,
          batch: { select: { batchNumber: true, expiryDate: true } },
          performedBy: { select: { name: true, role: true } },
        },
      })

      audit(req, {
        action: 'EXPORT',
        entity: 'Report.ControlledRegister',
        meta: { from: from.toISOString(), to: to.toISOString(), rows: movements.length },
      })
      res.json({
        from,
        to,
        rows: movements.map((m) => ({
          at: m.createdAt,
          drug: `${m.drug.genericName} ${m.drug.strength}`,
          code: m.drug.code,
          batchNumber: m.batch?.batchNumber ?? '—',
          type: m.type,
          quantity: m.quantity,
          balanceAfter: m.balanceAfter,
          reason: m.reason,
          performedBy: m.performedBy?.name ?? 'system',
          performedByRole: m.performedBy?.role ?? null,
        })),
      })
    } catch (err) {
      next(err)
    }
  },
)
