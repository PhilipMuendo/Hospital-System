import type { Prisma } from '@prisma/client'

/**
 * Allocate the next number in a named sequence, atomically.
 *
 * The obvious implementation — read the current maximum, add one, insert —
 * is a lost-update race. Under PostgreSQL's default READ COMMITTED two
 * concurrent transactions both see the same maximum, both write N+1, and one
 * dies on the unique index. With two clerks on a reception desk that failed
 * roughly half the time.
 *
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING` is a single statement, so the
 * second caller blocks on the row lock the first is holding and then reads the
 * already-incremented value. Concurrent callers queue instead of colliding.
 *
 * Must be called with the transaction client so the number is rolled back
 * alongside the row it was allocated for — otherwise a failed check-in burns a
 * token number and the printed tokens develop gaps.
 */
export async function nextSequence(
  tx: Prisma.TransactionClient,
  key: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value")
    VALUES (${key}, 1)
    ON CONFLICT ("key")
    DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"
  `
  const value = rows[0]?.value
  if (value === undefined) {
    throw new Error(`Sequence "${key}" returned no value`)
  }
  return value
}

/** Per-station, per-service-day token sequence. Resets each day. */
export function ticketSequenceKey(stationId: string, serviceDate: string): string {
  return `ticket:${stationId}:${serviceDate}`
}

/** Per-year outpatient-number sequence, matching the OP/YYYY/NNNNN format. */
export function patientSequenceKey(year: number | string): string {
  return `patient:${year}`
}

/** Per-month attendance sequence, matching the OPD/YYYY/MM/NNNN format. */
export function visitSequenceKey(yearMonth: string): string {
  return `visit:${yearMonth}`
}
