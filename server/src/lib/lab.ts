import type { LabFlag, LabUrgency } from '@prisma/client'

/**
 * Derive the abnormal flag from the catalogue's reference range rather than
 * asking the technologist to type it.
 *
 * Typed flags drift from the printed range — the range says 3.5–5.1, the flag
 * says NORMAL, and the clinician has to decide which to believe. Deriving it
 * means the two can never disagree.
 *
 * Qualitative tests (culture, blood group) have no numeric bounds; those
 * return NORMAL here and the technologist sets the flag explicitly.
 */
export function flagFor(
  value: string,
  test: { refLow: number | null; refHigh: number | null },
): LabFlag {
  if (test.refLow === null && test.refHigh === null) return 'NORMAL'

  // Tolerate "<0.01", "> 200", "12.4 mg/dL" — all shapes a bench produces.
  const match = /-?\d+(\.\d+)?/.exec(value.replace(/,/g, ''))
  if (!match) return 'NORMAL'

  const numeric = Number(match[0])
  if (Number.isNaN(numeric)) return 'NORMAL'

  if (test.refLow !== null && numeric < test.refLow) return 'LOW'
  if (test.refHigh !== null && numeric > test.refHigh) return 'HIGH'
  return 'NORMAL'
}

const URGENCY_RANK: Record<LabUrgency, number> = {
  STAT: 0,
  URGENT: 1,
  ROUTINE: 2,
}

export interface WorklistCandidate {
  urgency: LabUrgency
  orderedAt: Date
  status: string
}

/**
 * Bench worklist order: STAT first, then urgent, then oldest first within a
 * band. Same principle as the patient queue — the technologist works top-down
 * and does not have to decide priority themselves.
 *
 * Rejected specimens float to the top of their band because somebody on a ward
 * is waiting for a repeat draw that has not been asked for yet.
 */
export function orderLabWorklist<T extends WorklistCandidate>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.status === 'REJECTED' !== (b.status === 'REJECTED')) {
      return a.status === 'REJECTED' ? -1 : 1
    }
    const ua = URGENCY_RANK[a.urgency]
    const ub = URGENCY_RANK[b.urgency]
    if (ua !== ub) return ua - ub
    return a.orderedAt.getTime() - b.orderedAt.getTime()
  })
}

/**
 * Doses expected in 24 hours, from the free-text frequency a prescriber wrote.
 *
 * Returns null rather than guessing when the frequency is not recognised —
 * a wrong dose count on a drug round is worse than an absent one, because the
 * eMAR would then show a round as complete when it is not.
 */
export function dosesPerDayFrom(frequency: string): number | null {
  const f = frequency.toLowerCase().trim()

  if (/\b(stat|once only|single dose)\b/.test(f)) return 1
  if (/\b(prn|as required|when required)\b/.test(f)) return null // unscheduled by definition

  // "OD", "BD", "TDS", "QDS" — the abbreviations actually used on Kenyan charts.
  if (/\b(od|daily|once a day|nocte|mane)\b/.test(f)) return 1
  if (/\bbd\b|\btwice\b/.test(f)) return 2
  if (/\btds\b|\btid\b|\bthree times\b/.test(f)) return 3
  if (/\bqds\b|\bqid\b|\bfour times\b/.test(f)) return 4

  // "every 6 hours", "6 hourly", "q8h"
  const hourly = /(?:every\s*)?(\d+)\s*(?:hourly|hours|hrs|h)\b/.exec(f) ?? /\bq(\d+)h\b/.exec(f)
  if (hourly) {
    const hours = Number(hourly[1])
    if (hours > 0 && hours <= 24) return Math.max(1, Math.round(24 / hours))
  }

  return null
}
