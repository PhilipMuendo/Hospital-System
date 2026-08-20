import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { ApiError } from '../middleware/errorHandler.js'
import { audit } from '../lib/audit.js'
import { nextSequence } from '../lib/sequence.js'
import { serviceDate } from '../lib/queue.js'
import * as sha from '../lib/sha.js'
import * as etims from '../lib/etims.js'

export const claimsRoutes = Router()

/* ------------------------------------------------------------------ */
/* Eligibility                                                         */
/* ------------------------------------------------------------------ */

/**
 * Check a member before the visit, not at discharge. Finding out at the cash
 * desk that a member is inactive — after three days of inpatient care — is how
 * facilities end up writing off large balances.
 */
claimsRoutes.get(
  '/sha/eligibility/:memberNumber',
  requireAuth,
  requireRole('BILLING', 'ADMIN', 'NURSE'),
  async (req, res, next) => {
    try {
      sha.assertUsable()
      const result = await sha.verifyMember(req.params.memberNumber)
      audit(req, {
        action: 'READ',
        entity: 'ShaClaim.Eligibility',
        meta: { member: req.params.memberNumber.slice(-4), active: result.active },
      })
      res.json(result)
    } catch (err) {
      next(err)
    }
  },
)

/* ------------------------------------------------------------------ */
/* Claim assembly                                                      */
/* ------------------------------------------------------------------ */

const buildSchema = z.object({
  patientId: z.string(),
  visitId: z.string().optional(),
  memberNumber: z.string().min(3),
  /** Omit to include every unclaimed SHA-payable line. */
  billingLineIds: z.array(z.string()).optional(),
})

/**
 * Assemble a draft claim from the patient's SHA-payable charges.
 *
 * Member details are copied onto the claim rather than referenced, so a later
 * correction to the patient record cannot silently rewrite what was claimed —
 * the claim has to stay a faithful record of what was sent.
 */
claimsRoutes.post(
  '/sha/claims',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = buildSchema.parse(req.body)

      const patient = await prisma.patient.findUnique({ where: { id: data.patientId } })
      if (!patient) throw new ApiError(404, 'Patient not found')

      const lines = await prisma.billingLine.findMany({
        where: {
          patientId: data.patientId,
          payer: 'SHA',
          status: 'PENDING',
          ...(data.billingLineIds ? { id: { in: data.billingLineIds } } : {}),
          // Never claim the same charge twice.
          claimLines: { none: {} },
        },
      })
      if (lines.length === 0) {
        throw new ApiError(400, 'No unclaimed SHA-payable charges for this patient')
      }

      const total = lines.reduce((s, l) => s + Number(l.amount), 0)

      const claim = await prisma.$transaction(async (tx) => {
        const seq = await nextSequence(tx, `claim:${serviceDate().slice(0, 7)}`)
        const internalRef = `CLM/${serviceDate().slice(0, 7).replace('-', '/')}/${String(seq).padStart(5, '0')}`

        return tx.shaClaim.create({
          data: {
            patientId: patient.id,
            visitId: data.visitId,
            internalRef,
            memberNumber: data.memberNumber,
            memberName: patient.name,
            nationalId: patient.nationalId,
            amountClaimed: total,
            lines: {
              create: lines.map((l) => ({
                billingLineId: l.id,
                code: l.code,
                description: l.description,
                amount: l.amount,
              })),
            },
          },
          include: { lines: true },
        })
      })

      audit(req, {
        entity: 'ShaClaim',
        entityId: claim.id,
        patientId: patient.id,
        meta: { internalRef: claim.internalRef, lines: lines.length, total: total.toFixed(2) },
      })
      res.status(201).json(claim)
    } catch (err) {
      next(err)
    }
  },
)

claimsRoutes.get(
  '/sha/claims',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined
      const claims = await prisma.shaClaim.findMany({
        where: status ? { status: status as never } : {},
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          lines: true,
          patient: { select: { id: true, name: true, opNumber: true, ipNumber: true } },
        },
      })
      audit(req, { action: 'READ', entity: 'ShaClaim' })
      res.json(claims)
    } catch (err) {
      next(err)
    }
  },
)

/** Send a draft. Only a DRAFT may be submitted, and only once. */
claimsRoutes.post(
  '/sha/claims/:id/submit',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      sha.assertUsable()

      const claim = await prisma.shaClaim.findUnique({
        where: { id: req.params.id },
        include: { lines: true },
      })
      if (!claim) throw new ApiError(404, 'Claim not found')
      if (claim.status !== 'DRAFT' && claim.status !== 'REJECTED') {
        throw new ApiError(409, `Claim is ${claim.status.toLowerCase()} and cannot be submitted again`)
      }

      const payload: sha.ClaimPayload = {
        internalRef: claim.internalRef,
        facilityCode: process.env.SHA_FACILITY_CODE ?? 'MFL-13742',
        memberNumber: claim.memberNumber,
        memberName: claim.memberName,
        nationalId: claim.nationalId,
        totalAmount: Number(claim.amountClaimed),
        lines: claim.lines.map((l) => ({
          code: l.code,
          description: l.description,
          amount: Number(l.amount),
        })),
      }

      const result = await sha.submitClaim(payload)

      const updated = await prisma.shaClaim.update({
        where: { id: claim.id },
        data: {
          status: result.accepted ? (claim.status === 'REJECTED' ? 'APPEALED' : 'SUBMITTED') : 'DRAFT',
          claimNumber: result.claimNumber ?? claim.claimNumber,
          submittedAt: new Date(),
          submittedById: req.user!.id,
          acknowledgedAt: result.claimNumber ? new Date() : null,
          requestPayload: payload as unknown as Prisma.InputJsonValue,
          responsePayload: result.raw as Prisma.InputJsonValue,
          adjudicationNotes: result.accepted ? null : result.message,
        },
      })

      audit(req, {
        entity: 'ShaClaim',
        entityId: claim.id,
        patientId: claim.patientId,
        meta: {
          submitted: claim.internalRef,
          accepted: result.accepted,
          claimNumber: result.claimNumber,
          mocked: result.mocked,
        },
      })
      res.json({ ...updated, message: result.message, mocked: result.mocked })
    } catch (err) {
      next(err)
    }
  },
)

const adjudicateSchema = z.object({
  status: z.enum(['APPROVED', 'PART_APPROVED', 'REJECTED', 'PAID']),
  amountApproved: z.number().min(0).optional(),
  rejectionCode: z.string().optional(),
  notes: z.string().optional(),
  /** Per-line outcome; SHA commonly approves some lines and not others. */
  lines: z
    .array(z.object({ id: z.string(), approvedAmount: z.number().min(0), rejectionCode: z.string().optional() }))
    .optional(),
})

/**
 * Record SHA's decision, from the remittance advice.
 *
 * A shortfall does not vanish: any line SHA declines is flipped back to
 * self-pay so it reappears at the cashier as patient liability. Leaving it
 * marked SHA would quietly write the money off.
 */
claimsRoutes.post(
  '/sha/claims/:id/adjudicate',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = adjudicateSchema.parse(req.body)

      const claim = await prisma.shaClaim.findUnique({
        where: { id: req.params.id },
        include: { lines: true },
      })
      if (!claim) throw new ApiError(404, 'Claim not found')
      if (claim.status === 'DRAFT') throw new ApiError(409, 'Claim has not been submitted')

      const updated = await prisma.$transaction(async (tx) => {
        for (const line of data.lines ?? []) {
          const existing = claim.lines.find((l) => l.id === line.id)
          if (!existing) continue

          await tx.shaClaimLine.update({
            where: { id: line.id },
            data: { approvedAmount: line.approvedAmount, rejectionCode: line.rejectionCode },
          })

          if (existing.billingLineId) {
            const declined = line.approvedAmount < Number(existing.amount)
            await tx.billingLine.update({
              where: { id: existing.billingLineId },
              data: declined
                ? { payer: 'SELF_PAY', status: 'PENDING' }
                : { status: 'PAID', paymentMethod: 'INSURANCE', paidAt: new Date() },
            })
          }
        }

        return tx.shaClaim.update({
          where: { id: claim.id },
          data: {
            status: data.status,
            amountApproved: data.amountApproved,
            rejectionCode: data.rejectionCode,
            adjudicationNotes: data.notes,
            adjudicatedAt: new Date(),
            paidAt: data.status === 'PAID' ? new Date() : null,
          },
          include: { lines: true },
        })
      })

      audit(req, {
        entity: 'ShaClaim',
        entityId: claim.id,
        patientId: claim.patientId,
        meta: {
          adjudicated: data.status,
          claimed: String(claim.amountClaimed),
          approved: data.amountApproved,
          rejectionCode: data.rejectionCode,
        },
      })
      res.json(updated)
    } catch (err) {
      next(err)
    }
  },
)

/* ------------------------------------------------------------------ */
/* eTIMS                                                               */
/* ------------------------------------------------------------------ */

const signSchema = z.object({
  invoiceNumber: z.string().min(3),
  patientId: z.string(),
  lineIds: z.array(z.string()).min(1),
  /** Most core medical services are VAT exempt in Kenya. */
  exempt: z.boolean().default(true),
})

/**
 * Sign a receipt through eTIMS so it is a valid tax invoice.
 *
 * The signature is stored, not regenerated per print: reprinting a receipt
 * must reproduce the same control unit number, otherwise the facility appears
 * to have issued two invoices for one sale.
 */
claimsRoutes.post(
  '/etims/sign',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      etims.assertUsable()
      const data = signSchema.parse(req.body)

      const existing = await prisma.etimsInvoice.findUnique({
        where: { invoiceNumber: data.invoiceNumber },
      })
      if (existing?.status === 'SIGNED') {
        res.json(existing)
        return
      }

      const lines = await prisma.billingLine.findMany({ where: { id: { in: data.lineIds } } })
      if (lines.length === 0) throw new ApiError(400, 'No lines to invoice')

      const total = lines.reduce((s, l) => s + Number(l.amount), 0)
      const tax = etims.splitTax(total, data.exempt)

      try {
        const signed = await etims.signInvoice({
          invoiceNumber: data.invoiceNumber,
          buyerName: (await prisma.patient.findUnique({ where: { id: data.patientId } }))?.name ?? 'Walk-in',
          lines: lines.map((l) => ({
            code: l.code,
            description: l.description,
            amount: Number(l.amount),
            exempt: data.exempt,
          })),
        })

        const invoice = await prisma.etimsInvoice.upsert({
          where: { invoiceNumber: data.invoiceNumber },
          create: {
            patientId: data.patientId,
            invoiceNumber: data.invoiceNumber,
            status: 'SIGNED',
            totalAmount: tax.total,
            taxableAmount: tax.taxable,
            vatAmount: tax.vat,
            controlUnitNumber: signed.controlUnitNumber,
            invoiceSignature: signed.invoiceSignature,
            qrCodeUrl: signed.qrCodeUrl,
            signedAt: new Date(),
            attempts: 1,
          },
          update: {
            status: 'SIGNED',
            controlUnitNumber: signed.controlUnitNumber,
            invoiceSignature: signed.invoiceSignature,
            qrCodeUrl: signed.qrCodeUrl,
            signedAt: new Date(),
            failureReason: null,
            attempts: { increment: 1 },
          },
        })

        audit(req, {
          entity: 'EtimsInvoice',
          entityId: invoice.id,
          patientId: data.patientId,
          meta: { invoiceNumber: data.invoiceNumber, cu: signed.controlUnitNumber, mocked: signed.mocked },
        })
        res.status(201).json(invoice)
      } catch (signError) {
        // A signing failure must not lose the sale. The invoice is recorded as
        // PENDING so it can be retried; the cash is already in the drawer.
        const message = signError instanceof Error ? signError.message : 'eTIMS signing failed'
        await prisma.etimsInvoice.upsert({
          where: { invoiceNumber: data.invoiceNumber },
          create: {
            patientId: data.patientId,
            invoiceNumber: data.invoiceNumber,
            status: 'FAILED',
            totalAmount: tax.total,
            taxableAmount: tax.taxable,
            vatAmount: tax.vat,
            failureReason: message,
            attempts: 1,
          },
          update: { status: 'FAILED', failureReason: message, attempts: { increment: 1 } },
        })
        throw signError
      }
    } catch (err) {
      next(err)
    }
  },
)

/** Unsigned invoices needing a retry — a compliance queue, not a nice-to-have. */
claimsRoutes.get(
  '/etims/pending',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      const invoices = await prisma.etimsInvoice.findMany({
        where: { status: { in: ['PENDING', 'FAILED'] } },
        orderBy: { createdAt: 'asc' },
        take: 100,
      })
      audit(req, { action: 'READ', entity: 'EtimsInvoice' })
      res.json(invoices)
    } catch (err) {
      next(err)
    }
  },
)
