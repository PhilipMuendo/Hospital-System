import { ApiError } from '../middleware/errorHandler.js'

/**
 * SHA (Social Health Authority) claim submission.
 *
 * Honest scope: SHA does not publish a stable public API contract that can be
 * implemented and tested from here. What this module owns is the transport
 * boundary — build the payload, send it, interpret the reply — so that
 * swapping in the real endpoint is a change to one function rather than a
 * change to the claim lifecycle.
 *
 * Everything else (claim state, per-line adjudication, appeal history) lives
 * in our database and is real. That is the part a facility needs regardless of
 * whose wire format is on the other side.
 */

export function isMockMode(): boolean {
  if (process.env.SHA_MOCK === 'true') return true
  if (process.env.SHA_MOCK === 'false') return false
  return !process.env.SHA_API_KEY || !process.env.SHA_BASE_URL
}

export function assertUsable() {
  if (isMockMode()) {
    if (process.env.NODE_ENV === 'production') {
      throw new ApiError(
        503,
        'SHA is in mock mode but NODE_ENV is production. Refusing to fake a claim submission.',
      )
    }
    return
  }
  const missing = (['SHA_BASE_URL', 'SHA_API_KEY', 'SHA_FACILITY_CODE'] as const).filter(
    (k) => !process.env[k],
  )
  if (missing.length > 0) {
    throw new ApiError(503, `SHA is not configured: missing ${missing.join(', ')}`)
  }
}

export interface ClaimPayload {
  internalRef: string
  facilityCode: string
  memberNumber: string
  memberName: string
  nationalId?: string | null
  visitNumber?: string | null
  totalAmount: number
  lines: { code: string; description: string; amount: number }[]
}

export interface SubmitResult {
  accepted: boolean
  claimNumber?: string
  message: string
  raw: unknown
  mocked: boolean
}

/**
 * Member eligibility check.
 *
 * Run before the visit rather than at discharge: discovering at the cash desk
 * that a member is inactive, after three days of inpatient care, is how
 * facilities end up writing off large balances.
 */
export async function verifyMember(memberNumber: string): Promise<{
  active: boolean
  memberName?: string
  scheme?: string
  message: string
  mocked: boolean
}> {
  if (isMockMode()) {
    // Deterministic on the number so tests and demos are repeatable: numbers
    // ending in 0 model an inactive member.
    const active = !memberNumber.trim().endsWith('0')
    return {
      active,
      memberName: active ? 'Mock Member' : undefined,
      scheme: active ? 'SHIF' : undefined,
      message: active ? 'Member active (mock)' : 'Member not active (mock)',
      mocked: true,
    }
  }

  const res = await fetch(
    `${process.env.SHA_BASE_URL}/members/${encodeURIComponent(memberNumber)}/eligibility`,
    {
      headers: {
        Authorization: `Bearer ${process.env.SHA_API_KEY}`,
        'X-Facility-Code': process.env.SHA_FACILITY_CODE ?? '',
      },
      signal: AbortSignal.timeout(20_000),
    },
  )

  if (!res.ok) throw new ApiError(502, `SHA eligibility check failed (${res.status})`)

  const body = (await res.json()) as Record<string, unknown>
  return {
    active: body.active === true,
    memberName: body.memberName as string | undefined,
    scheme: body.scheme as string | undefined,
    message: (body.message as string) ?? 'Checked',
    mocked: false,
  }
}

export async function submitClaim(payload: ClaimPayload): Promise<SubmitResult> {
  if (isMockMode()) {
    return {
      accepted: true,
      claimNumber: `SHA-MOCK-${Date.now().toString().slice(-9)}`,
      message: 'Claim accepted for adjudication (mock)',
      raw: { mocked: true, payload },
      mocked: true,
    }
  }

  const res = await fetch(`${process.env.SHA_BASE_URL}/claims`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SHA_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Facility-Code': process.env.SHA_FACILITY_CODE ?? '',
      // Lets SHA collapse a retry rather than opening a duplicate claim.
      'Idempotency-Key': payload.internalRef,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45_000),
  })

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>

  if (!res.ok) {
    return {
      accepted: false,
      message: (body.message as string) ?? `SHA rejected the submission (${res.status})`,
      raw: body,
      mocked: false,
    }
  }

  return {
    accepted: true,
    claimNumber: body.claimNumber as string | undefined,
    message: (body.message as string) ?? 'Submitted',
    raw: body,
    mocked: false,
  }
}
