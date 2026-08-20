import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { ApiError } from '../middleware/errorHandler.js'
import { audit } from '../lib/audit.js'
import { nextSequence } from '../lib/sequence.js'
import { serviceDate } from '../lib/queue.js'

export const cashierRoutes = Router()

/**
 * The cashier's view of one patient: every outstanding line, split by who is
 * actually expected to pay it.
 *
 * The split matters. A SHA-payable line is not the patient's problem at the
 * window — billing it to them at the desk is the commonest way a facility
 * double-charges. Only self-pay lines are collectable here.
 */
cashierRoutes.get(
  '/cashier/patients/:id',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      const patient = await prisma.patient.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          name: true,
          opNumber: true,
          ipNumber: true,
          phone: true,
          dob: true,
          sex: true,
        },
      })
      if (!patient) throw new ApiError(404, 'Patient not found')

      const lines = await prisma.billingLine.findMany({
        where: { patientId: patient.id },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })

      const outstanding = lines.filter((l) => l.status === 'PENDING')
      const dueNow = outstanding.filter((l) => l.payer === 'SELF_PAY')
      const onInsurer = outstanding.filter((l) => l.payer !== 'SELF_PAY')

      const sum = (rows: typeof lines) => rows.reduce((s, l) => s + Number(l.amount), 0)

      const openVisit = await prisma.visit.findFirst({
        where: { patientId: patient.id, status: 'OPEN' },
        include: { currentStation: { select: { id: true, name: true } } },
      })

      audit(req, { action: 'READ', entity: 'BillingLine', patientId: patient.id })
      res.json({
        patient,
        visit: openVisit,
        lines: lines.map((l) => ({
          id: l.id,
          description: l.description,
          code: l.code,
          amount: String(l.amount),
          payer: l.payer,
          status: l.status,
          paymentMethod: l.paymentMethod,
          receiptNumber: l.receiptNumber,
          mpesaReference: l.mpesaReference,
          paidAt: l.paidAt,
          createdAt: l.createdAt,
        })),
        totals: {
          dueNow: sum(dueNow).toFixed(2),
          dueNowCount: dueNow.length,
          onInsurer: sum(onInsurer).toFixed(2),
          onInsurerCount: onInsurer.length,
          settled: sum(lines.filter((l) => l.status === 'PAID')).toFixed(2),
        },
      })
    } catch (err) {
      next(err)
    }
  },
)

const paySchema = z.object({
  lineIds: z.array(z.string()).min(1),
  method: z.enum(['CASH', 'MPESA', 'CARD', 'INSURANCE', 'WAIVER']),
  /** Cash tendered, so the drawer can be reconciled and change computed. */
  amountTendered: z.number().optional(),
  /** Mandatory for a waiver — a write-off must be explainable. */
  reason: z.string().optional(),
  reference: z.string().optional(),
})

/**
 * Settle one or more lines at the window and issue a receipt number.
 *
 * M-Pesa is deliberately NOT settled here — that goes through the STK push and
 * only a confirmed Safaricom callback marks a line paid. Accepting "MPESA" at
 * the desk on the cashier's word would let a cancelled prompt read as revenue,
 * which is the exact hole the payment flow was built to close.
 */
cashierRoutes.post(
  '/cashier/pay',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = paySchema.parse(req.body)

      if (data.method === 'MPESA') {
        throw new ApiError(
          400,
          'Use the M-Pesa STK push — a line is only settled by a confirmed Safaricom callback',
        )
      }
      if (data.method === 'WAIVER' && !data.reason) {
        throw new ApiError(400, 'A waiver needs a reason')
      }

      const lines = await prisma.billingLine.findMany({ where: { id: { in: data.lineIds } } })
      if (lines.length !== data.lineIds.length) throw new ApiError(404, 'One or more lines not found')

      const alreadyPaid = lines.find((l) => l.status === 'PAID')
      if (alreadyPaid) throw new ApiError(409, `"${alreadyPaid.description}" is already settled`)

      const total = lines.reduce((s, l) => s + Number(l.amount), 0)
      if (data.method === 'CASH' && data.amountTendered !== undefined && data.amountTendered < total) {
        throw new ApiError(400, `Tendered ${data.amountTendered} is less than the ${total} due`)
      }

      const today = serviceDate()
      const { receiptNumber } = await prisma.$transaction(async (tx) => {
        const sequence = await nextSequence(tx, `receipt:${today}`)
        const receiptNumber = `RCT/${today.replace(/-/g, '')}/${String(sequence).padStart(4, '0')}`

        await tx.billingLine.updateMany({
          where: { id: { in: data.lineIds } },
          data: {
            // A waiver is not revenue. It closes the line without pretending
            // money changed hands, so it can be reported on separately.
            status: 'PAID',
            paymentMethod: data.method,
            paidAt: new Date(),
            receiptNumber,
            receivedById: req.user!.id,
            ...(data.reference ? { mpesaReference: data.reference } : {}),
          },
        })

        return { receiptNumber }
      })

      audit(req, {
        entity: 'BillingLine',
        patientId: lines[0]?.patientId,
        meta: {
          settled: data.lineIds.length,
          method: data.method,
          total: total.toFixed(2),
          receiptNumber,
          reason: data.reason,
        },
      })

      res.status(201).json({
        receiptNumber,
        method: data.method,
        total: total.toFixed(2),
        change:
          data.method === 'CASH' && data.amountTendered !== undefined
            ? (data.amountTendered - total).toFixed(2)
            : null,
        lines: data.lineIds.length,
      })
    } catch (err) {
      next(err)
    }
  },
)

/** Cash drawer position for the current service day — what the cashier hands over. */
cashierRoutes.get(
  '/cashier/shift-summary',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      const today = serviceDate()
      const from = new Date(`${today}T00:00:00+03:00`)
      const to = new Date(`${today}T23:59:59.999+03:00`)

      const byMethod = await prisma.billingLine.groupBy({
        by: ['paymentMethod'],
        where: { paidAt: { gte: from, lte: to }, status: 'PAID' },
        _sum: { amount: true },
        _count: { _all: true },
      })

      audit(req, { action: 'READ', entity: 'Report.CashierShift', meta: { date: today } })
      res.json({
        date: today,
        byMethod: byMethod.map((m) => ({
          method: m.paymentMethod ?? 'UNRECORDED',
          count: m._count._all,
          total: String(m._sum.amount ?? 0),
        })),
        cashTotal: String(byMethod.find((m) => m.paymentMethod === 'CASH')?._sum.amount ?? 0),
      })
    } catch (err) {
      next(err)
    }
  },
)
