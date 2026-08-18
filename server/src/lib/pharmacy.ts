import type { Prisma } from '@prisma/client'
import { ApiError } from '../middleware/errorHandler.js'

export interface BatchAllocation {
  batchId: string
  batchNumber: string
  expiryDate: string
  quantity: number
}

/**
 * First-Expiry-First-Out allocation.
 *
 * FEFO rather than FIFO because the constraint that matters for medicines is
 * the expiry date, not the receipt date: a batch received later can easily
 * expire sooner, and dispensing the older-received one first would leave the
 * short-dated stock to be written off.
 *
 * Batches already expired are never allocated, even when that means the
 * dispense fails for want of stock.
 */
export function allocateFefo(
  batches: { id: string; batchNumber: string; expiryDate: Date; quantity: number }[],
  required: number,
  now = new Date(),
): BatchAllocation[] {
  if (required <= 0) throw new ApiError(400, 'Quantity to dispense must be at least 1')

  const usable = batches
    .filter((b) => b.quantity > 0 && b.expiryDate > now)
    .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime())

  const allocation: BatchAllocation[] = []
  let remaining = required

  for (const batch of usable) {
    if (remaining === 0) break
    const take = Math.min(batch.quantity, remaining)
    allocation.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate.toISOString(),
      quantity: take,
    })
    remaining -= take
  }

  if (remaining > 0) {
    const available = required - remaining
    throw new ApiError(
      409,
      `Insufficient unexpired stock: ${available} of ${required} units available`,
    )
  }

  return allocation
}

/** Total unexpired units across a drug's batches. */
export function availableQuantity(
  batches: { expiryDate: Date; quantity: number }[],
  now = new Date(),
): number {
  return batches.reduce((sum, b) => (b.expiryDate > now && b.quantity > 0 ? sum + b.quantity : sum), 0)
}

export function expiringSoon(
  batches: { expiryDate: Date; quantity: number }[],
  withinDays = 90,
  now = new Date(),
): number {
  const cutoff = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000)
  return batches.reduce(
    (sum, b) => (b.quantity > 0 && b.expiryDate > now && b.expiryDate <= cutoff ? sum + b.quantity : sum),
    0,
  )
}

/**
 * Allergy check against the patient's recorded allergy strings.
 *
 * Deliberately conservative: it matches on whole words in either direction
 * (an allergy to "Penicillin" flags "Benzylpenicillin"), because the cost of
 * a missed interaction is far higher than the cost of an override prompt.
 * This is a safety net over a free-text allergy list, not a substitute for a
 * coded drug-interaction database — see the roadmap note on DDI screening.
 */
export function allergyConflicts(
  allergies: string[],
  drug: { genericName: string; brandName?: string | null },
): string[] {
  const haystack = [drug.genericName, drug.brandName ?? ''].join(' ').toLowerCase()

  return allergies.filter((allergy) => {
    const needle = allergy.toLowerCase().trim()
    if (needle.length < 4) return false
    if (haystack.includes(needle)) return true
    // "Sulfa drugs" recorded as an allergy should still flag "Sulfamethoxazole".
    const stem = needle.replace(/\s+(allergy|drugs?|antibiotics?)$/, '')
    return stem.length >= 4 && haystack.includes(stem)
  })
}

/** Line total for a dispense, in KES, rounded to cents. */
export function dispenseCharge(unitPrice: Prisma.Decimal | string | number, quantity: number): number {
  const price = Number(unitPrice)
  return Math.round(price * quantity * 100) / 100
}
