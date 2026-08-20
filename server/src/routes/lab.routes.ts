import { Router } from 'express'
import { z } from 'zod'
import type { LabFlag } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { ApiError } from '../middleware/errorHandler.js'
import { audit } from '../lib/audit.js'
import { flagFor, orderLabWorklist } from '../lib/lab.js'

export const labRoutes = Router()

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

labRoutes.get('/lab/tests', requireAuth, async (req, res, next) => {
  try {
    const tests = await prisma.labTest.findMany({
      where: { active: true },
      orderBy: [{ department: 'asc' }, { name: 'asc' }],
    })
    audit(req, { skip: true })
    res.json(tests)
  } catch (err) {
    next(err)
  }
})

/* ------------------------------------------------------------------ */
/* Ordering — physicians                                               */
/* ------------------------------------------------------------------ */

const createOrderSchema = z.object({
  patientId: z.string(),
  visitId: z.string().optional(),
  testIds: z.array(z.string()).min(1),
  urgency: z.enum(['ROUTINE', 'URGENT', 'STAT']).default('ROUTINE'),
  // Required: a bench result is far less useful without the question it was
  // meant to answer, and the technologist uses it to judge plausibility.
  clinicalNotes: z.string().min(3),
})

/**
 * Place a lab order. Raises the charge at the same time, in one transaction —
 * an order that exists without a bill is revenue the facility silently loses,
 * and this is the most commonly leaked charge in a Kenyan outpatient department.
 */
labRoutes.post(
  '/lab/orders',
  requireAuth,
  requireRole('PHYSICIAN', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = createOrderSchema.parse(req.body)

      const tests = await prisma.labTest.findMany({
        where: { id: { in: data.testIds }, active: true },
      })
      if (tests.length !== data.testIds.length) {
        throw new ApiError(400, 'One or more tests are unknown or inactive')
      }

      const patient = await prisma.patient.findUnique({ where: { id: data.patientId } })
      if (!patient) throw new ApiError(404, 'Patient not found')

      const order = await prisma.$transaction(async (tx) => {
        const created = await tx.labOrder.create({
          data: {
            patientId: data.patientId,
            visitId: data.visitId,
            orderedById: req.user!.id,
            urgency: data.urgency,
            clinicalNotes: data.clinicalNotes,
            items: { create: tests.map((t) => ({ labTestId: t.id })) },
          },
          include: { items: { include: { labTest: true } } },
        })

        await tx.billingLine.createMany({
          data: tests.map((t) => ({
            patientId: data.patientId,
            description: t.name,
            code: t.code,
            amount: t.price,
            payer: 'SELF_PAY' as const,
            createdById: req.user!.id,
          })),
        })

        return created
      })

      audit(req, {
        entity: 'LabOrder',
        entityId: order.id,
        patientId: data.patientId,
        meta: { tests: tests.map((t) => t.code), urgency: data.urgency },
      })
      res.status(201).json(order)
    } catch (err) {
      next(err)
    }
  },
)

labRoutes.get('/patients/:id/lab-orders', requireAuth, async (req, res, next) => {
  try {
    const orders = await prisma.labOrder.findMany({
      where: { patientId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        orderedBy: { select: { name: true } },
        items: { include: { labTest: true } },
      },
    })
    audit(req, { action: 'READ', entity: 'LabOrder', patientId: req.params.id })
    res.json(orders)
  } catch (err) {
    next(err)
  }
})

/* ------------------------------------------------------------------ */
/* The bench worklist                                                  */
/* ------------------------------------------------------------------ */

/**
 * Everything the lab still has to act on, ordered STAT first then oldest
 * first. A technologist works top-down from this without deciding priority
 * themselves.
 */
labRoutes.get(
  '/lab/worklist',
  requireAuth,
  requireRole('LAB_TECH', 'ADMIN', 'PHYSICIAN'),
  async (req, res, next) => {
    try {
      const items = await prisma.labOrderItem.findMany({
        where: { status: { in: ['ORDERED', 'COLLECTED', 'IN_PROGRESS', 'RESULTED', 'REJECTED'] } },
        include: {
          labTest: true,
          order: {
            include: {
              patient: {
                select: { id: true, name: true, opNumber: true, ipNumber: true, dob: true, sex: true, bed: true },
              },
              orderedBy: { select: { name: true } },
            },
          },
        },
        take: 300,
      })

      const ordered = orderLabWorklist(
        items.map((i) => ({ ...i, urgency: i.order.urgency, orderedAt: i.order.createdAt })),
      )

      audit(req, { action: 'READ', entity: 'LabOrderItem' })
      res.json(
        ordered.map((i) => ({
          id: i.id,
          status: i.status,
          urgency: i.order.urgency,
          test: i.labTest,
          specimenLabel: i.specimenLabel,
          collectedAt: i.collectedAt,
          resultValue: i.resultValue,
          flag: i.flag,
          resultedAt: i.resultedAt,
          rejectionReason: i.rejectionReason,
          orderId: i.order.id,
          orderedAt: i.order.createdAt,
          orderedBy: i.order.orderedBy.name,
          clinicalNotes: i.order.clinicalNotes,
          patient: i.order.patient,
        })),
      )
    } catch (err) {
      next(err)
    }
  },
)

const collectSchema = z.object({ specimenLabel: z.string().min(1).optional() })

/** Specimen taken. This is when the turnaround clock starts. */
labRoutes.post(
  '/lab/items/:id/collect',
  requireAuth,
  requireRole('LAB_TECH', 'NURSE', 'ADMIN'),
  async (req, res, next) => {
    try {
      const { specimenLabel } = collectSchema.parse(req.body ?? {})

      const item = await prisma.labOrderItem.findUnique({
        where: { id: req.params.id },
        include: { order: true },
      })
      if (!item) throw new ApiError(404, 'Lab item not found')
      if (item.status !== 'ORDERED' && item.status !== 'REJECTED') {
        throw new ApiError(409, `Specimen already collected (${item.status})`)
      }

      const updated = await prisma.labOrderItem.update({
        where: { id: item.id },
        data: {
          status: 'COLLECTED',
          collectedAt: new Date(),
          collectedById: req.user!.id,
          specimenLabel: specimenLabel ?? `${item.orderId.slice(-6).toUpperCase()}`,
          // Clear any previous rejection so a repeat draw starts clean.
          rejectionReason: null,
        },
      })

      audit(req, {
        entity: 'LabOrderItem',
        entityId: item.id,
        patientId: item.order.patientId,
        meta: { collected: updated.specimenLabel },
      })
      res.json(updated)
    } catch (err) {
      next(err)
    }
  },
)

const rejectSchema = z.object({ reason: z.string().min(3) })

/**
 * Reject a specimen. The item goes back to ORDERED rather than dying, because
 * the ward needs to know a repeat draw is required — a rejected sample that
 * silently disappears is a result everybody waits for forever.
 */
labRoutes.post(
  '/lab/items/:id/reject',
  requireAuth,
  requireRole('LAB_TECH', 'ADMIN'),
  async (req, res, next) => {
    try {
      const { reason } = rejectSchema.parse(req.body)
      const item = await prisma.labOrderItem.findUnique({
        where: { id: req.params.id },
        include: { order: true },
      })
      if (!item) throw new ApiError(404, 'Lab item not found')

      const updated = await prisma.labOrderItem.update({
        where: { id: item.id },
        data: {
          status: 'ORDERED',
          rejectionReason: reason,
          collectedAt: null,
          collectedById: null,
          specimenLabel: null,
        },
      })

      audit(req, {
        entity: 'LabOrderItem',
        entityId: item.id,
        patientId: item.order.patientId,
        meta: { specimenRejected: reason },
      })
      res.json(updated)
    } catch (err) {
      next(err)
    }
  },
)

const resultSchema = z.object({
  resultValue: z.string().min(1),
  /** Overrides the automatic flag for qualitative tests. */
  flag: z.enum(['NORMAL', 'LOW', 'HIGH']).optional(),
})

/**
 * Enter a bench result. The abnormal flag is derived from the catalogue's
 * reference range rather than typed, so it cannot disagree with the range
 * printed next to it on the report.
 */
labRoutes.post(
  '/lab/items/:id/result',
  requireAuth,
  requireRole('LAB_TECH', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = resultSchema.parse(req.body)

      const item = await prisma.labOrderItem.findUnique({
        where: { id: req.params.id },
        include: { order: true, labTest: true },
      })
      if (!item) throw new ApiError(404, 'Lab item not found')
      if (!item.collectedAt) throw new ApiError(409, 'Collect the specimen before entering a result')
      if (item.status === 'VERIFIED') throw new ApiError(409, 'Result already verified')

      const flag: LabFlag = data.flag ?? flagFor(data.resultValue, item.labTest)

      const updated = await prisma.labOrderItem.update({
        where: { id: item.id },
        data: {
          status: 'RESULTED',
          resultValue: data.resultValue,
          flag,
          resultedAt: new Date(),
          resultedById: req.user!.id,
        },
      })

      audit(req, {
        entity: 'LabOrderItem',
        entityId: item.id,
        patientId: item.order.patientId,
        meta: { test: item.labTest.code, result: data.resultValue, flag },
      })
      res.json(updated)
    } catch (err) {
      next(err)
    }
  },
)

/**
 * Verify and publish to the chart.
 *
 * Two rules that matter clinically:
 *  - only a verified result becomes a LabResult, because an unverified bench
 *    figure must never drive a prescribing decision;
 *  - the person who ran the test cannot verify their own result. A second pair
 *    of eyes is the entire point of the step.
 */
labRoutes.post(
  '/lab/items/:id/verify',
  requireAuth,
  requireRole('LAB_TECH', 'ADMIN'),
  async (req, res, next) => {
    try {
      const item = await prisma.labOrderItem.findUnique({
        where: { id: req.params.id },
        include: { order: true, labTest: true },
      })
      if (!item) throw new ApiError(404, 'Lab item not found')
      if (item.status !== 'RESULTED') throw new ApiError(409, 'Nothing to verify on this item')
      if (item.resultedById === req.user!.id && req.user!.role !== 'ADMIN') {
        throw new ApiError(403, 'A result must be verified by someone other than the person who ran it')
      }

      const published = await prisma.$transaction(async (tx) => {
        const labResult = await tx.labResult.create({
          data: {
            patientId: item.order.patientId,
            test: item.labTest.name,
            result: `${item.resultValue}${item.labTest.unit ? ` ${item.labTest.unit}` : ''}`,
            range: item.labTest.refRange,
            flag: item.flag ?? 'NORMAL',
            collectedAt: item.collectedAt ?? new Date(),
          },
        })

        await tx.labOrderItem.update({
          where: { id: item.id },
          data: {
            status: 'VERIFIED',
            verifiedAt: new Date(),
            verifiedById: req.user!.id,
            labResultId: labResult.id,
          },
        })

        // The parent order closes only when every test on it is finished.
        const siblings = await tx.labOrderItem.findMany({ where: { orderId: item.orderId } })
        const allDone = siblings.every((s) => s.id === item.id || s.status === 'VERIFIED' || s.status === 'CANCELLED')
        if (allDone) {
          await tx.labOrder.update({ where: { id: item.orderId }, data: { status: 'VERIFIED' } })
        }

        return labResult
      })

      audit(req, {
        entity: 'LabResult',
        entityId: published.id,
        patientId: item.order.patientId,
        meta: { verified: item.labTest.code, flag: item.flag },
      })
      res.status(201).json(published)
    } catch (err) {
      next(err)
    }
  },
)
