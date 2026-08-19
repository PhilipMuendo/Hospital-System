import type { TriageAcuity } from '@prisma/client'

/**
 * Queue ordering.
 *
 * A hospital queue is not a bank queue. Arrival order is a tie-breaker, not
 * the rule — a patient in extremis who arrives fortieth must be seen first.
 * Everything here exists to make that true while still guaranteeing that a
 * routine patient eventually gets seen.
 */

/** Lower is seen sooner. */
export const ACUITY_PRIORITY: Record<TriageAcuity, number> = {
  RED: 0,
  ORANGE: 1,
  YELLOW: 2,
  GREEN: 3,
  BLUE: 4,
}

/** SATS target time to be seen, in minutes. BLUE has no meaningful target. */
export const ACUITY_TARGET_MINUTES: Record<TriageAcuity, number> = {
  RED: 0,
  ORANGE: 10,
  YELLOW: 60,
  GREEN: 240,
  BLUE: 0,
}

/**
 * Priority for a visit that has not been triaged yet.
 *
 * Deliberately routine (3) rather than "unknown" or best-case: an untriaged
 * patient must never jump a triaged urgent one, and must never be silently
 * treated as low-risk either — the anti-starvation rule below is what stops
 * them being stranded.
 */
export const UNTRIAGED_PRIORITY = ACUITY_PRIORITY.GREEN

export function priorityFor(acuity: TriageAcuity | null | undefined): number {
  return acuity ? ACUITY_PRIORITY[acuity] : UNTRIAGED_PRIORITY
}

/**
 * How long a patient may wait before being promoted one priority band.
 *
 * Without this, a steady trickle of ORANGE patients starves every GREEN in
 * the room indefinitely — the classic failure of naive priority queues, and
 * the thing that makes people give up and leave (which then shows up as LWBS
 * rather than as a queueing bug).
 */
export const STARVATION_MINUTES = 45

export interface QueueCandidate {
  id: string
  priority: number
  issuedAt: Date
  status: string
  callCount: number
}

export function waitMinutes(ticket: { issuedAt: Date }, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - ticket.issuedAt.getTime()) / 60000))
}

/**
 * Priority after ageing. One band per STARVATION_MINUTES waited, never
 * promoted above 1 — nothing earns its way into the RED band by waiting,
 * because RED means physiologically critical, not "here a long time".
 */
export function effectivePriority(ticket: QueueCandidate, now: Date): number {
  if (ticket.priority === 0) return 0
  const bumps = Math.floor(waitMinutes(ticket, now) / STARVATION_MINUTES)
  return Math.max(1, ticket.priority - bumps)
}

/**
 * Order a station's waiting tickets. Sorted, not just min-picked, so the same
 * function drives both "who is next" and the queue display — the board and
 * the doctor can never disagree about the order.
 */
export function orderQueue<T extends QueueCandidate>(tickets: T[], now: Date): T[] {
  return [...tickets]
    .filter((t) => t.status === 'WAITING' || t.status === 'CALLED')
    .sort((a, b) => {
      const pa = effectivePriority(a, now)
      const pb = effectivePriority(b, now)
      if (pa !== pb) return pa - pb
      // A patient already called once is re-called before an untouched
      // ticket of the same priority, rather than being dropped to the back.
      if (a.callCount !== b.callCount) return b.callCount - a.callCount
      return a.issuedAt.getTime() - b.issuedAt.getTime()
    })
}

export function nextInQueue<T extends QueueCandidate>(tickets: T[], now: Date): T | null {
  return orderQueue(tickets, now)[0] ?? null
}

/** Called this many times without appearing, and the ticket is marked NO_SHOW. */
export const MAX_CALLS = 3

/** Is this patient past their SATS target? Drives the board's breach warning. */
export function isBreaching(
  ticket: { issuedAt: Date },
  acuity: TriageAcuity | null | undefined,
  now: Date,
): boolean {
  if (!acuity || acuity === 'BLUE') return false
  return waitMinutes(ticket, now) > ACUITY_TARGET_MINUTES[acuity]
}

/** YYYY-MM-DD in Africa/Nairobi — the service day a ticket belongs to. */
export function serviceDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Token shown to the patient, e.g. C-042. */
export function formatToken(prefix: string, number: number): string {
  return `${prefix}-${String(number).padStart(3, '0')}`
}

/**
 * Attendance number. Includes the month so the sequence stays short and a
 * clerk reading it aloud can tell recent from old at a glance.
 */
export function formatVisitNumber(sequence: number, now = new Date()): string {
  const ymd = serviceDate(now)
  const [year, month] = ymd.split('-')
  return `OPD/${year}/${month}/${String(sequence).padStart(4, '0')}`
}
