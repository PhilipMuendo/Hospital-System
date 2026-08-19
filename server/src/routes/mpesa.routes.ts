import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { ApiError } from '../middleware/errorHandler.js'
import { audit, clientIp, writeAudit } from '../lib/audit.js'
import {
  CALLBACK_ACK,
  assertUsable,
  isMockMode,
  normalisePhone,
  parseStkCallback,
  statusForResultCode,
  stkPush,
  stkQuery,
} from '../lib/mpesa.js'

export const mpesaRoutes = Router()

const stkPushSchema = z.object({
  /** Defaults to the patient's own number when omitted. */
  phone: z.string().min(1).optional(),
  /** Partial settlement is legitimate; defaults to the full outstanding line. */
  amount: z.number().positive().optional(),
})

/**
 * Kick off an STK push against a billing line. The line is not marked paid
 * here — only a confirmed Safaricom callback (or a successful status query)
 * can do that. Anything else would let a cancelled prompt read as revenue.
 */
mpesaRoutes.post(
  '/billing/:id/mpesa/stk-push',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      assertUsable()
      const input = stkPushSchema.parse(req.body)

      const line = await prisma.billingLine.findUnique({
        where: { id: req.params.id },
        include: { patient: { select: { id: true, name: true, ipNumber: true, opNumber: true, phone: true } } },
      })
      if (!line) throw new ApiError(404, 'Billing line not found')
      if (line.status === 'PAID') throw new ApiError(409, 'This line is already settled')

      const rawPhone = input.phone ?? line.patient.phone
      if (!rawPhone) {
        throw new ApiError(400, 'No phone number on file for this patient — supply one with the request')
      }
      const phone = normalisePhone(rawPhone)

      // Daraja works in whole shillings, so a line of KES 2,800.50 is pushed
      // as 2,801. Rounding up rather than down keeps the facility whole; the
      // difference is reconciled against the actual receipt on callback.
      const outstanding = Number(line.amount)
      const amount = Math.ceil(input.amount ?? outstanding)
      if (amount > Math.ceil(outstanding)) {
        throw new ApiError(400, 'Amount exceeds the outstanding balance on this line')
      }

      // Outpatients have no IP number; the OP number identifies them instead.
      const accountReference = line.patient.ipNumber ?? line.patient.opNumber ?? line.patient.id

      const pushed = await stkPush({
        phone,
        amount,
        accountReference,
        description: line.code,
      })

      const txn = await prisma.mpesaTransaction.create({
        data: {
          billingLineId: line.id,
          patientId: line.patientId,
          phone,
          amount,
          accountReference,
          description: line.description,
          merchantRequestId: pushed.merchantRequestId,
          checkoutRequestId: pushed.checkoutRequestId,
          status: 'PENDING',
          requestPayload: pushed.request as Prisma.InputJsonValue,
          initiatedById: req.user!.id,
        },
      })

      audit(req, {
        entity: 'MpesaTransaction',
        entityId: txn.id,
        patientId: line.patientId,
        meta: {
          billingLineId: line.id,
          amount,
          // Only the tail is logged: the full MSISDN is personal data and the
          // last four digits are enough to identify the payer in a dispute.
          phoneTail: phone.slice(-4),
          checkoutRequestId: pushed.checkoutRequestId,
          mocked: pushed.mocked,
        },
      })

      res.status(202).json({
        id: txn.id,
        status: txn.status,
        checkoutRequestId: txn.checkoutRequestId,
        customerMessage: pushed.customerMessage,
        mocked: pushed.mocked,
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * Safaricom posts here. Unauthenticated by necessity — Daraja carries no
 * credentials — so it is written to be safe when hit by anyone:
 *  - the checkoutRequestId must match a transaction we ourselves created;
 *  - it never trusts the posted amount, only the amount we pushed;
 *  - it is idempotent, because Daraja retries until it gets a 200.
 *
 * In production this route must additionally be IP-restricted to Safaricom's
 * published ranges at the proxy — see MPESA_CALLBACK_URL in .env.example.
 */
mpesaRoutes.post('/mpesa/callback', async (req, res) => {
  const summary = parseStkCallback(req.body)

  // Always 200. A non-200 makes Daraja retry a callback we cannot parse,
  // forever; the payload is logged instead so it can be investigated.
  if (!summary?.checkoutRequestId) {
    await writeAudit({
      actorLabel: 'safaricom-daraja',
      action: 'UPDATE',
      entity: 'MpesaTransaction',
      path: '/api/mpesa/callback',
      status: 200,
      ip: clientIp(req),
      meta: { unparseable: true, body: req.body },
    })
    res.json(CALLBACK_ACK)
    return
  }

  try {
    const existing = await prisma.mpesaTransaction.findUnique({
      where: { checkoutRequestId: summary.checkoutRequestId },
    })

    if (!existing) {
      await writeAudit({
        actorLabel: 'safaricom-daraja',
        action: 'DENIED',
        entity: 'MpesaTransaction',
        path: '/api/mpesa/callback',
        status: 200,
        ip: clientIp(req),
        meta: { reason: 'unknown checkoutRequestId', checkoutRequestId: summary.checkoutRequestId },
      })
      res.json(CALLBACK_ACK)
      return
    }

    // Daraja retries on any non-200; a duplicate must not double-settle.
    if (existing.status !== 'PENDING') {
      res.json(CALLBACK_ACK)
      return
    }

    await applyMpesaResult(existing.id, summary.resultCode, summary.resultDesc, {
      mpesaReceiptNumber: summary.mpesaReceiptNumber,
      transactionDate: summary.transactionDate ?? null,
      callbackPayload: req.body,
      paidAmount: summary.amount,
    })
  } catch (err) {
    console.error('[mpesa] callback handling failed', err)
  }

  res.json(CALLBACK_ACK)
})

/**
 * Settle a transaction and, on success, the billing line behind it. Runs in
 * one transaction so a paid line always has a receipt number against it.
 */
async function applyMpesaResult(
  transactionId: string,
  resultCode: string,
  resultDesc: string,
  extra: {
    mpesaReceiptNumber?: string
    transactionDate?: Date | null
    callbackPayload?: unknown
    paidAmount?: number
  },
) {
  const status = statusForResultCode(resultCode)

  await prisma.$transaction(async (tx) => {
    const txn = await tx.mpesaTransaction.update({
      where: { id: transactionId },
      data: {
        status,
        resultCode,
        resultDesc,
        // Only overwritten when the source actually carried them. The status
        // query returns a result code with no receipt, and blanking the
        // receipt there would leave a settled line with no proof of payment.
        ...(extra.mpesaReceiptNumber ? { mpesaReceiptNumber: extra.mpesaReceiptNumber } : {}),
        ...(extra.transactionDate ? { transactionDate: extra.transactionDate } : {}),
        ...(extra.callbackPayload === undefined
          ? {}
          : { callbackPayload: extra.callbackPayload as Prisma.InputJsonValue }),
      },
    })

    if (status === 'SUCCESS' && txn.billingLineId) {
      await tx.billingLine.update({
        where: { id: txn.billingLineId },
        data: {
          status: 'PAID',
          // The M-Pesa receipt is the facility's proof of payment, so it
          // replaces whatever reference was typed in by hand.
          mpesaReference: extra.mpesaReceiptNumber ?? txn.mpesaReceiptNumber,
        },
      })
    }
  })

  await writeAudit({
    actorLabel: 'safaricom-daraja',
    action: 'UPDATE',
    entity: 'MpesaTransaction',
    entityId: transactionId,
    path: '/api/mpesa/callback',
    status: 200,
    meta: {
      result: status,
      resultCode,
      resultDesc,
      receipt: extra.mpesaReceiptNumber,
      // Flagged, not corrected: a mismatch between what we asked for and what
      // the customer actually paid needs a human on it.
      ...(extra.paidAmount !== undefined ? { paidAmount: extra.paidAmount } : {}),
    },
  })
}

/**
 * Poll a transaction. The SPA calls this while the customer has the prompt
 * open; if the callback has not landed yet it asks Safaricom directly, which
 * is what rescues a payment whose webhook was dropped.
 */
mpesaRoutes.get(
  '/mpesa/transactions/:id',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      const txn = await prisma.mpesaTransaction.findUnique({ where: { id: req.params.id } })
      if (!txn) throw new ApiError(404, 'Transaction not found')

      if (txn.status === 'PENDING' && txn.checkoutRequestId) {
        const queried = await stkQuery(txn.checkoutRequestId)
        if (queried) {
          await applyMpesaResult(txn.id, queried.resultCode, queried.resultDesc, {})
          const refreshed = await prisma.mpesaTransaction.findUnique({ where: { id: txn.id } })
          res.json(serialiseTransaction(refreshed!))
          return
        }
      }

      // Reads of a payment record are not PHI-heavy, but they are financial —
      // the middleware logs them via the explicit action below.
      audit(req, { action: 'READ', entity: 'MpesaTransaction', entityId: txn.id, patientId: txn.patientId })
      res.json(serialiseTransaction(txn))
    } catch (err) {
      next(err)
    }
  },
)

mpesaRoutes.get(
  '/mpesa/transactions',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined
      const txns = await prisma.mpesaTransaction.findMany({
        where: status ? { status: status as 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'TIMEOUT' } : {},
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { patient: { select: { id: true, name: true, ipNumber: true } } },
      })
      audit(req, { action: 'READ', entity: 'MpesaTransaction' })
      res.json(txns.map((t) => ({ ...serialiseTransaction(t), patient: t.patient })))
    } catch (err) {
      next(err)
    }
  },
)

/** Tells the SPA whether to offer the M-Pesa button, and whether it is real. */
mpesaRoutes.get('/mpesa/config', requireAuth, (req, res) => {
  const mocked = isMockMode()
  audit(req, { skip: true })
  res.json({ enabled: !(mocked && process.env.NODE_ENV === 'production'), mocked })
})

function serialiseTransaction(txn: {
  id: string
  phone: string
  amount: unknown
  status: string
  resultDesc: string | null
  mpesaReceiptNumber: string | null
  transactionDate: Date | null
  billingLineId: string | null
  createdAt: Date
}) {
  return {
    id: txn.id,
    // Masked on the way out — the full number is on file but does not need to
    // be on every billing screen.
    phone: `${txn.phone.slice(0, 6)}***${txn.phone.slice(-3)}`,
    amount: String(txn.amount),
    status: txn.status,
    resultDesc: txn.resultDesc,
    mpesaReceiptNumber: txn.mpesaReceiptNumber,
    transactionDate: txn.transactionDate,
    billingLineId: txn.billingLineId,
    createdAt: txn.createdAt,
  }
}

/**
 * Development-only: stand in for Safaricom and complete a mocked push, so the
 * whole callback path — including settlement and audit — is exercised without
 * a Daraja account. Disabled unless the module is genuinely in mock mode.
 */
mpesaRoutes.post(
  '/mpesa/mock/complete/:id',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      if (!isMockMode()) throw new ApiError(404, 'Not found')

      const schema = z.object({ resultCode: z.string().default('0') })
      const { resultCode } = schema.parse(req.body ?? {})

      const txn = await prisma.mpesaTransaction.findUnique({ where: { id: req.params.id } })
      if (!txn) throw new ApiError(404, 'Transaction not found')
      if (txn.status !== 'PENDING') throw new ApiError(409, 'Transaction already settled')

      await applyMpesaResult(txn.id, resultCode, resultCode === '0' ? 'The service request is processed successfully.' : 'Request cancelled by user', {
        mpesaReceiptNumber: resultCode === '0' ? `MOCK${Date.now().toString().slice(-8)}` : undefined,
        transactionDate: new Date(),
      })

      const updated = await prisma.mpesaTransaction.findUnique({ where: { id: txn.id } })
      audit(req, { entity: 'MpesaTransaction', entityId: txn.id, meta: { mockCompletion: resultCode } })
      res.json(serialiseTransaction(updated!))
    } catch (err) {
      next(err)
    }
  },
)
