import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { ApiError } from '../middleware/errorHandler.js'
import { audit } from '../lib/audit.js'
import { orderLabWorklist } from '../lib/lab.js'
import { needsPregnancyCheck } from '../lib/radiology.js'

export const imagingOrdersRoutes = Router()

imagingOrdersRoutes.get('/imaging/procedures', requireAuth, async (req, res, next) => {
  try {
    const procedures = await prisma.imagingProcedure.findMany({
      where: { active: true },
      orderBy: [{ modality: 'asc' }, { name: 'asc' }],
    })
    audit(req, { skip: true })
    res.json(procedures)
  } catch (err) {
    next(err)
  }
})

const createSchema = z.object({
  patientId: z.string(),
  visitId: z.string().optional(),
  procedureId: z.string(),
  urgency: z.enum(['ROUTINE', 'URGENT', 'STAT']).default('ROUTINE'),
  clinicalNotes: z.string().min(3),
})

/** Request a study. Raises the charge in the same transaction, as lab does. */
imagingOrdersRoutes.post(
  '/imaging/orders',
  requireAuth,
  requireRole('PHYSICIAN', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = createSchema.parse(req.body)

      const procedure = await prisma.imagingProcedure.findUnique({ where: { id: data.procedureId } })
      if (!procedure || !procedure.active) throw new ApiError(400, 'Unknown or inactive procedure')

      const patient = await prisma.patient.findUnique({ where: { id: data.patientId } })
      if (!patient) throw new ApiError(404, 'Patient not found')

      const order = await prisma.$transaction(async (tx) => {
        const created = await tx.imagingOrder.create({
          data: {
            patientId: data.patientId,
            visitId: data.visitId,
            procedureId: procedure.id,
            orderedById: req.user!.id,
            urgency: data.urgency,
            clinicalNotes: data.clinicalNotes,
          },
          include: { procedure: true },
        })

        await tx.billingLine.create({
          data: {
            patientId: data.patientId,
            description: procedure.name,
            code: procedure.code,
            amount: procedure.price,
            payer: 'SELF_PAY',
            createdById: req.user!.id,
          },
        })

        return created
      })

      audit(req, {
        entity: 'ImagingOrder',
        entityId: order.id,
        patientId: data.patientId,
        meta: { procedure: procedure.code, urgency: data.urgency },
      })
      res.status(201).json(order)
    } catch (err) {
      next(err)
    }
  },
)

/** The radiography worklist — same ordering discipline as the lab bench. */
imagingOrdersRoutes.get(
  '/imaging/worklist',
  requireAuth,
  requireRole('RADIOGRAPHER', 'ADMIN', 'PHYSICIAN'),
  async (req, res, next) => {
    try {
      const orders = await prisma.imagingOrder.findMany({
        where: { status: { in: ['ORDERED', 'PERFORMED', 'REPORTED'] } },
        include: {
          procedure: true,
          orderedBy: { select: { name: true } },
          performedBy: { select: { name: true } },
          patient: {
            select: { id: true, name: true, opNumber: true, ipNumber: true, dob: true, sex: true, bed: true },
          },
        },
        take: 200,
      })

      const ordered = orderLabWorklist(
        orders.map((o) => ({ ...o, orderedAt: o.createdAt })),
      )

      audit(req, { action: 'READ', entity: 'ImagingOrder' })
      res.json(
        ordered.map((o) => ({
          ...o,
          requiresPregnancyCheck: needsPregnancyCheck(o.procedure, o.patient),
        })),
      )
    } catch (err) {
      next(err)
    }
  },
)

const performSchema = z.object({
  technicalNotes: z.string().optional(),
  retakeCount: z.number().int().min(0).max(20).default(0),
  pregnancyStatus: z.enum(['NOT_APPLICABLE', 'NOT_PREGNANT', 'PREGNANT', 'UNKNOWN']).optional(),
  lmpDate: z.string().optional(),
})

/**
 * Record that the images were acquired.
 *
 * For an ionising study on a person of childbearing potential the pregnancy
 * question must be answered first, and a positive or unknown answer stops the
 * exposure here. An unrecorded pregnancy is the one radiography mistake that
 * cannot be undone afterwards.
 */
imagingOrdersRoutes.post(
  '/imaging/orders/:id/perform',
  requireAuth,
  requireRole('RADIOGRAPHER', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = performSchema.parse(req.body ?? {})

      const order = await prisma.imagingOrder.findUnique({
        where: { id: req.params.id },
        include: { procedure: true, patient: true },
      })
      if (!order) throw new ApiError(404, 'Imaging order not found')
      if (order.status !== 'ORDERED') throw new ApiError(409, `Already ${order.status.toLowerCase()}`)

      const required = needsPregnancyCheck(order.procedure, order.patient)
      if (required) {
        if (!data.pregnancyStatus || data.pregnancyStatus === 'NOT_APPLICABLE') {
          throw new ApiError(
            400,
            `${order.procedure.name} uses ionising radiation — record the pregnancy status before exposure`,
          )
        }
        if (data.pregnancyStatus !== 'NOT_PREGNANT') {
          throw new ApiError(
            409,
            `Exposure withheld: pregnancy status is ${data.pregnancyStatus.toLowerCase()}. Refer back to the requesting clinician.`,
          )
        }
      }

      const updated = await prisma.imagingOrder.update({
        where: { id: order.id },
        data: {
          status: 'PERFORMED',
          performedAt: new Date(),
          performedById: req.user!.id,
          technicalNotes: data.technicalNotes,
          retakeCount: data.retakeCount,
          pregnancyChecked: required,
          pregnancyStatus: data.pregnancyStatus,
          lmpDate: data.lmpDate ? new Date(data.lmpDate) : null,
        },
      })

      audit(req, {
        entity: 'ImagingOrder',
        entityId: order.id,
        patientId: order.patientId,
        meta: {
          performed: order.procedure.code,
          retakes: data.retakeCount,
          pregnancyChecked: required,
          pregnancyStatus: data.pregnancyStatus,
        },
      })
      res.json(updated)
    } catch (err) {
      next(err)
    }
  },
)

const reportSchema = z.object({
  findings: z.string().min(3),
  impression: z.string().min(3),
})

/**
 * Report and publish to the chart.
 *
 * Reporting is a radiologist function, so the radiographer who acquired the
 * images cannot sign the report on them.
 */
imagingOrdersRoutes.post(
  '/imaging/orders/:id/report',
  requireAuth,
  requireRole('PHYSICIAN', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = reportSchema.parse(req.body)

      const order = await prisma.imagingOrder.findUnique({
        where: { id: req.params.id },
        include: { procedure: true },
      })
      if (!order) throw new ApiError(404, 'Imaging order not found')
      if (order.status !== 'PERFORMED') {
        throw new ApiError(409, 'Images must be acquired before a report can be written')
      }
      if (order.performedById === req.user!.id) {
        throw new ApiError(403, 'The radiographer who acquired the images cannot report on them')
      }

      const study = await prisma.$transaction(async (tx) => {
        const created = await tx.imagingStudy.create({
          data: {
            patientId: order.patientId,
            study: order.procedure.name,
            modality: order.procedure.modality,
            performedAt: order.performedAt ?? new Date(),
            radiologistName: req.user!.name,
            impression: data.impression,
          },
        })

        await tx.imagingOrder.update({
          where: { id: order.id },
          data: {
            status: 'VERIFIED',
            reportedAt: new Date(),
            reportedById: req.user!.id,
            findings: data.findings,
            impression: data.impression,
            imagingStudyId: created.id,
          },
        })

        return created
      })

      audit(req, {
        entity: 'ImagingStudy',
        entityId: study.id,
        patientId: order.patientId,
        meta: { reported: order.procedure.code },
      })
      res.status(201).json(study)
    } catch (err) {
      next(err)
    }
  },
)
