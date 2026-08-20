import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { ApiError } from '../middleware/errorHandler.js'
import { audit } from '../lib/audit.js'
import { dosesPerDayFrom } from '../lib/lab.js'
import {
  allergyConflicts,
  allocateFefo,
  availableQuantity,
  dispenseCharge,
  expiringSoon,
} from '../lib/pharmacy.js'

export const pharmacyRoutes = Router()

const DRUG_FORMS = [
  'TABLET',
  'CAPSULE',
  'SYRUP',
  'SUSPENSION',
  'INJECTION',
  'INFUSION',
  'SUPPOSITORY',
  'TOPICAL',
  'INHALER',
  'DROPS',
] as const

// ---------------------------------------------------------------------------
// Formulary
// ---------------------------------------------------------------------------

/**
 * The formulary with live stock positions folded in. Any clinical user can
 * read it — a physician needs to know a drug is out of stock *before* writing
 * the prescription, not when the patient reaches the pharmacy window.
 */
pharmacyRoutes.get('/drugs', requireAuth, async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
    const lowStockOnly = req.query.lowStock === 'true'

    const drugs = await prisma.drug.findMany({
      where: {
        active: true,
        ...(search
          ? {
              OR: [
                { genericName: { contains: search, mode: 'insensitive' } },
                { brandName: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { batches: { orderBy: { expiryDate: 'asc' } } },
      orderBy: { genericName: 'asc' },
      take: 200,
    })

    const now = new Date()
    const rows = drugs.map((d) => {
      const inStock = availableQuantity(d.batches, now)
      return {
        id: d.id,
        code: d.code,
        genericName: d.genericName,
        brandName: d.brandName,
        form: d.form,
        strength: d.strength,
        unit: d.unit,
        kemlListed: d.kemlListed,
        controlled: d.controlled,
        unitPrice: String(d.unitPrice),
        currency: d.currency,
        reorderLevel: d.reorderLevel,
        inStock,
        belowReorderLevel: inStock <= d.reorderLevel,
        expiringSoon: expiringSoon(d.batches, 90, now),
        // Expired-but-unwritten-off stock is surfaced rather than hidden: it
        // is still physically on the shelf and needs disposing of.
        expiredUnits: d.batches.reduce((s, b) => (b.expiryDate <= now ? s + b.quantity : s), 0),
        earliestExpiry: d.batches.find((b) => b.quantity > 0 && b.expiryDate > now)?.expiryDate ?? null,
      }
    })

    res.json(lowStockOnly ? rows.filter((r) => r.belowReorderLevel) : rows)
  } catch (err) {
    next(err)
  }
})

const createDrugSchema = z.object({
  code: z.string().min(1),
  genericName: z.string().min(1),
  brandName: z.string().min(1).optional(),
  form: z.enum(DRUG_FORMS),
  strength: z.string().min(1),
  unit: z.string().min(1).default('unit'),
  kemlListed: z.boolean().default(false),
  controlled: z.boolean().default(false),
  unitPrice: z.number().nonnegative(),
  reorderLevel: z.number().int().nonnegative().default(0),
})

pharmacyRoutes.post(
  '/drugs',
  requireAuth,
  requireRole('PHARMACIST', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = createDrugSchema.parse(req.body)
      const drug = await prisma.drug.create({ data })
      audit(req, { entity: 'Drug', entityId: drug.id, meta: { created: data } })
      res.status(201).json(drug)
    } catch (err) {
      next(err)
    }
  },
)

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

const receiveStockSchema = z.object({
  batchNumber: z.string().min(1),
  expiryDate: z.string().datetime(),
  quantity: z.number().int().positive(),
  supplier: z.string().min(1).optional(),
})

/**
 * Goods-received. Upserts onto the batch so a second delivery of the same
 * batch number adds to it rather than colliding, and writes a movement row
 * either way so the ledger stays complete.
 */
pharmacyRoutes.post(
  '/drugs/:id/batches',
  requireAuth,
  requireRole('PHARMACIST', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = receiveStockSchema.parse(req.body)
      const expiryDate = new Date(data.expiryDate)
      if (expiryDate <= new Date()) {
        throw new ApiError(400, 'Cannot receive stock that has already expired')
      }

      const drug = await prisma.drug.findUnique({ where: { id: req.params.id } })
      if (!drug) throw new ApiError(404, 'Drug not found')

      const result = await prisma.$transaction(async (tx) => {
        const batch = await tx.drugBatch.upsert({
          where: { drugId_batchNumber: { drugId: drug.id, batchNumber: data.batchNumber } },
          create: {
            drugId: drug.id,
            batchNumber: data.batchNumber,
            expiryDate,
            quantity: data.quantity,
            supplier: data.supplier,
          },
          update: { quantity: { increment: data.quantity } },
        })

        await tx.stockMovement.create({
          data: {
            drugId: drug.id,
            batchId: batch.id,
            type: 'RECEIPT',
            quantity: data.quantity,
            balanceAfter: batch.quantity,
            reason: data.supplier ? `Received from ${data.supplier}` : 'Stock received',
            performedById: req.user!.id,
          },
        })

        return batch
      })

      audit(req, {
        entity: 'DrugBatch',
        entityId: result.id,
        meta: { drug: drug.code, batchNumber: data.batchNumber, received: data.quantity },
      })
      res.status(201).json(result)
    } catch (err) {
      next(err)
    }
  },
)

const adjustStockSchema = z.object({
  batchId: z.string().min(1),
  /** Signed. Negative for breakage, expiry write-off, or a stock-take shortfall. */
  quantity: z.number().int().refine((n) => n !== 0, 'Adjustment cannot be zero'),
  type: z.enum(['ADJUSTMENT', 'EXPIRY_WRITE_OFF', 'RETURN']).default('ADJUSTMENT'),
  reason: z.string().min(3),
})

pharmacyRoutes.post(
  '/stock/adjustments',
  requireAuth,
  requireRole('PHARMACIST', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = adjustStockSchema.parse(req.body)

      const movement = await prisma.$transaction(async (tx) => {
        const batch = await tx.drugBatch.findUnique({ where: { id: data.batchId } })
        if (!batch) throw new ApiError(404, 'Batch not found')

        const newQuantity = batch.quantity + data.quantity
        if (newQuantity < 0) {
          throw new ApiError(409, `Adjustment would take batch below zero (has ${batch.quantity})`)
        }

        await tx.drugBatch.update({ where: { id: batch.id }, data: { quantity: newQuantity } })

        return tx.stockMovement.create({
          data: {
            drugId: batch.drugId,
            batchId: batch.id,
            type: data.type,
            quantity: data.quantity,
            balanceAfter: newQuantity,
            reason: data.reason,
            performedById: req.user!.id,
          },
        })
      })

      audit(req, { entity: 'StockMovement', entityId: movement.id, meta: { ...data } })
      res.status(201).json(movement)
    } catch (err) {
      next(err)
    }
  },
)

pharmacyRoutes.get(
  '/drugs/:id/movements',
  requireAuth,
  requireRole('PHARMACIST', 'ADMIN'),
  async (req, res, next) => {
    try {
      const movements = await prisma.stockMovement.findMany({
        where: { drugId: req.params.id },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          batch: { select: { batchNumber: true, expiryDate: true } },
          performedBy: { select: { id: true, name: true } },
        },
      })
      res.json(movements)
    } catch (err) {
      next(err)
    }
  },
)

// ---------------------------------------------------------------------------
// Prescribing
// ---------------------------------------------------------------------------

const prescribeSchema = z.object({
  notes: z.string().optional(),
  allergyOverrideReason: z.string().min(5).optional(),
  items: z
    .array(
      z.object({
        drugId: z.string().min(1),
        dose: z.string().min(1),
        route: z.string().min(1),
        frequency: z.string().min(1),
        durationDays: z.number().int().positive().optional(),
        quantityPrescribed: z.number().int().positive(),
        instructions: z.string().optional(),
      }),
    )
    .min(1, 'A prescription needs at least one item'),
})

/**
 * Write a prescription. Physicians only — nurses administer and pharmacists
 * dispense, but neither prescribes.
 *
 * A recorded allergy against any item blocks the write with 409 and the
 * matched allergens, unless the prescriber supplies an explicit override
 * reason, which is stored on the prescription and mirrored into the audit
 * log. Silently allowing the override would defeat the check; silently
 * blocking it would be clinically wrong, since prescribing through a known
 * allergy is sometimes the right call.
 */
pharmacyRoutes.post(
  '/patients/:id/prescriptions',
  requireAuth,
  requireRole('PHYSICIAN', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = prescribeSchema.parse(req.body)

      const patient = await prisma.patient.findUnique({
        where: { id: req.params.id },
        select: { id: true, allergies: true, status: true },
      })
      if (!patient) throw new ApiError(404, 'Patient not found')
      if (patient.status === 'DISCHARGED') {
        throw new ApiError(409, 'Cannot prescribe against a discharged admission')
      }

      const drugs = await prisma.drug.findMany({
        where: { id: { in: data.items.map((i) => i.drugId) } },
      })
      if (drugs.length !== new Set(data.items.map((i) => i.drugId)).size) {
        throw new ApiError(400, 'One or more drugs on this prescription do not exist')
      }
      const inactive = drugs.filter((d) => !d.active)
      if (inactive.length > 0) {
        throw new ApiError(400, `Not on the active formulary: ${inactive.map((d) => d.genericName).join(', ')}`)
      }

      const conflicts = drugs
        .map((d) => ({ drug: d.genericName, matched: allergyConflicts(patient.allergies, d) }))
        .filter((c) => c.matched.length > 0)

      if (conflicts.length > 0 && !data.allergyOverrideReason) {
        audit(req, {
          action: 'DENIED',
          entity: 'Prescription',
          patientId: patient.id,
          meta: { blockedBy: 'allergy check', conflicts },
        })
        throw new ApiError(409, `Allergy conflict: ${conflicts.map((c) => `${c.drug} vs ${c.matched.join('/')}`).join('; ')}`)
      }

      const prescription = await prisma.prescription.create({
        data: {
          patientId: patient.id,
          prescriberId: req.user!.id,
          notes: data.notes,
          allergyOverrideReason: conflicts.length > 0 ? data.allergyOverrideReason : null,
          items: {
            // Derived once, at prescribing time, so the drug round can tell a
            // complete round from an incomplete one. Null for PRN.
            create: data.items.map((i) => ({ ...i, dosesPerDay: dosesPerDayFrom(i.frequency) })),
          },
        },
        include: { items: { include: { drug: true } } },
      })

      audit(req, {
        entity: 'Prescription',
        entityId: prescription.id,
        patientId: patient.id,
        meta: {
          items: data.items.map((i) => ({ drugId: i.drugId, qty: i.quantityPrescribed, dose: i.dose })),
          ...(conflicts.length > 0
            ? { allergyOverride: { conflicts, reason: data.allergyOverrideReason } }
            : {}),
        },
      })

      res.status(201).json(prescription)
    } catch (err) {
      next(err)
    }
  },
)

pharmacyRoutes.get('/patients/:id/prescriptions', requireAuth, async (req, res, next) => {
  try {
    const prescriptions = await prisma.prescription.findMany({
      where: { patientId: req.params.id },
      orderBy: { createdAt: 'desc' },
      include: {
        prescriber: { select: { id: true, name: true } },
        items: {
          include: {
            drug: { select: { id: true, code: true, genericName: true, brandName: true, form: true, strength: true, unit: true, unitPrice: true } },
            dispenseEvents: {
              orderBy: { createdAt: 'desc' },
              include: { dispensedBy: { select: { id: true, name: true } } },
            },
          },
        },
      },
    })

    res.json(
      prescriptions.map((p) => ({
        ...p,
        items: p.items.map((i) => ({
          ...i,
          drug: { ...i.drug, unitPrice: String(i.drug.unitPrice) },
          quantityRemaining: i.quantityPrescribed - i.quantityDispensed,
        })),
      })),
    )
  } catch (err) {
    next(err)
  }
})

pharmacyRoutes.patch(
  '/prescriptions/:id/cancel',
  requireAuth,
  requireRole('PHYSICIAN', 'ADMIN'),
  async (req, res, next) => {
    try {
      const existing = await prisma.prescription.findUnique({ where: { id: req.params.id } })
      if (!existing) throw new ApiError(404, 'Prescription not found')
      if (existing.status === 'DISPENSED') {
        throw new ApiError(409, 'Cannot cancel a fully dispensed prescription')
      }

      const updated = await prisma.prescription.update({
        where: { id: req.params.id },
        data: { status: 'CANCELLED' },
      })

      audit(req, {
        entity: 'Prescription',
        entityId: updated.id,
        patientId: updated.patientId,
        meta: { statusChange: { from: existing.status, to: 'CANCELLED' } },
      })
      res.json(updated)
    } catch (err) {
      next(err)
    }
  },
)

// ---------------------------------------------------------------------------
// Dispensing
// ---------------------------------------------------------------------------

const dispenseSchema = z.object({
  /** Defaults to everything still outstanding on the item. */
  quantity: z.number().int().positive().optional(),
  payer: z.enum(['SHA', 'IMARA_HEALTH_ASSURANCE', 'SELF_PAY']).default('SELF_PAY'),
})

/**
 * Dispense against a prescription item.
 *
 * Everything below happens in one database transaction — batch drawdown,
 * movement ledger, the item's dispensed counter, the parent prescription's
 * status, and the charge. Splitting any of it out is how a pharmacy ends up
 * with stock that left the shelf but was never billed, or a charge for
 * medicine the patient never received.
 */
pharmacyRoutes.post(
  '/prescription-items/:id/dispense',
  requireAuth,
  requireRole('PHARMACIST', 'ADMIN'),
  async (req, res, next) => {
    try {
      const input = dispenseSchema.parse(req.body ?? {})

      const result = await prisma.$transaction(async (tx) => {
        const item = await tx.prescriptionItem.findUnique({
          where: { id: req.params.id },
          include: {
            drug: true,
            prescription: { select: { id: true, patientId: true, status: true } },
          },
        })
        if (!item) throw new ApiError(404, 'Prescription item not found')

        if (item.prescription.status === 'CANCELLED') {
          throw new ApiError(409, 'This prescription has been cancelled')
        }

        const outstanding = item.quantityPrescribed - item.quantityDispensed
        if (outstanding <= 0) throw new ApiError(409, 'This item has already been fully dispensed')

        const quantity = input.quantity ?? outstanding
        if (quantity > outstanding) {
          throw new ApiError(400, `Only ${outstanding} units remain on this item`)
        }

        // Read inside the transaction so two pharmacists dispensing the last
        // pack at once cannot both succeed.
        const batches = await tx.drugBatch.findMany({
          where: { drugId: item.drugId },
          orderBy: { expiryDate: 'asc' },
        })
        const allocation = allocateFefo(batches, quantity)

        for (const alloc of allocation) {
          const batch = batches.find((b) => b.id === alloc.batchId)!
          const balanceAfter = batch.quantity - alloc.quantity

          // Guarded update: the WHERE clause fails the row if another
          // transaction drew the batch down in the meantime.
          const updated = await tx.drugBatch.updateMany({
            where: { id: alloc.batchId, quantity: { gte: alloc.quantity } },
            data: { quantity: { decrement: alloc.quantity } },
          })
          if (updated.count === 0) {
            throw new ApiError(409, `Batch ${alloc.batchNumber} was drawn down concurrently — retry the dispense`)
          }

          await tx.stockMovement.create({
            data: {
              drugId: item.drugId,
              batchId: alloc.batchId,
              type: 'DISPENSE',
              quantity: -alloc.quantity,
              balanceAfter,
              reason: `Dispensed against prescription ${item.prescriptionId}`,
              performedById: req.user!.id,
            },
          })
        }

        const charge = dispenseCharge(item.drug.unitPrice, quantity)
        const billingLine = await tx.billingLine.create({
          data: {
            patientId: item.prescription.patientId,
            description: `${item.drug.genericName} ${item.drug.strength} — ${quantity} ${item.drug.unit}`,
            code: item.drug.code,
            amount: charge,
            payer: input.payer,
            status: 'PENDING',
            createdById: req.user!.id,
          },
        })

        const dispenseEvent = await tx.dispenseEvent.create({
          data: {
            prescriptionItemId: item.id,
            batchBreakdown: allocation as unknown as Prisma.InputJsonValue,
            quantity,
            dispensedById: req.user!.id,
            billingLineId: billingLine.id,
          },
        })

        await tx.prescriptionItem.update({
          where: { id: item.id },
          data: { quantityDispensed: { increment: quantity } },
        })

        // Recompute the parent status from all its items, not just this one.
        const siblings = await tx.prescriptionItem.findMany({
          where: { prescriptionId: item.prescriptionId },
          select: { quantityPrescribed: true, quantityDispensed: true },
        })
        const fullyDispensed = siblings.every((s) => s.quantityDispensed >= s.quantityPrescribed)
        const anyDispensed = siblings.some((s) => s.quantityDispensed > 0)

        await tx.prescription.update({
          where: { id: item.prescriptionId },
          data: {
            status: fullyDispensed ? 'DISPENSED' : anyDispensed ? 'PARTIALLY_DISPENSED' : 'ACTIVE',
          },
        })

        return {
          dispenseEvent,
          billingLine,
          allocation,
          quantity,
          patientId: item.prescription.patientId,
          drug: item.drug.genericName,
        }
      })

      audit(req, {
        entity: 'DispenseEvent',
        entityId: result.dispenseEvent.id,
        patientId: result.patientId,
        meta: {
          drug: result.drug,
          quantity: result.quantity,
          batches: result.allocation,
          billingLineId: result.billingLine.id,
          amount: String(result.billingLine.amount),
        },
      })

      res.status(201).json({
        id: result.dispenseEvent.id,
        quantity: result.quantity,
        batchBreakdown: result.allocation,
        billingLine: { ...result.billingLine, amount: String(result.billingLine.amount) },
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * The pharmacy work queue: everything prescribed and not yet fully dispensed,
 * oldest first, with the stock position for each item so the pharmacist can
 * see what they can actually fill.
 */
pharmacyRoutes.get(
  '/pharmacy/queue',
  requireAuth,
  requireRole('PHARMACIST', 'ADMIN'),
  async (_req, res, next) => {
    try {
      const prescriptions = await prisma.prescription.findMany({
        where: { status: { in: ['ACTIVE', 'PARTIALLY_DISPENSED'] } },
        orderBy: { createdAt: 'asc' },
        take: 100,
        include: {
          patient: { select: { id: true, name: true, ipNumber: true, bed: true, ward: { select: { name: true } } } },
          prescriber: { select: { id: true, name: true } },
          items: { include: { drug: { include: { batches: true } } } },
        },
      })

      const now = new Date()
      res.json(
        prescriptions.map((p) => ({
          id: p.id,
          status: p.status,
          notes: p.notes,
          allergyOverrideReason: p.allergyOverrideReason,
          createdAt: p.createdAt,
          patient: p.patient,
          prescriber: p.prescriber,
          items: p.items
            .filter((i) => i.quantityDispensed < i.quantityPrescribed)
            .map((i) => {
              const inStock = availableQuantity(i.drug.batches, now)
              const remaining = i.quantityPrescribed - i.quantityDispensed
              return {
                id: i.id,
                dose: i.dose,
                route: i.route,
                frequency: i.frequency,
                instructions: i.instructions,
                quantityPrescribed: i.quantityPrescribed,
                quantityDispensed: i.quantityDispensed,
                quantityRemaining: remaining,
                canFill: inStock >= remaining,
                inStock,
                drug: {
                  id: i.drug.id,
                  code: i.drug.code,
                  genericName: i.drug.genericName,
                  brandName: i.drug.brandName,
                  form: i.drug.form,
                  strength: i.drug.strength,
                  unit: i.drug.unit,
                  unitPrice: String(i.drug.unitPrice),
                  controlled: i.drug.controlled,
                },
              }
            }),
        })).filter((p) => p.items.length > 0),
      )
    } catch (err) {
      next(err)
    }
  },
)
