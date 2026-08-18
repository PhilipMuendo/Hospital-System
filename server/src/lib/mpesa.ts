import { ApiError } from '../middleware/errorHandler.js'

/**
 * Safaricom Daraja — Lipa na M-Pesa Online (STK Push).
 *
 * Two things about this API bite people, so they are handled here once:
 *  - the access token is short-lived (~3600s) and Safaricom rate-limits the
 *    token endpoint, so it is cached and refreshed early;
 *  - every timestamp and the request password must be in Africa/Nairobi time,
 *    not the server's local time. A server running in UTC that formats
 *    `new Date()` naively gets "invalid password" for its trouble.
 */

const BASE_URL: Record<string, string> = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
}

export interface MpesaConfig {
  env: 'sandbox' | 'production'
  consumerKey: string
  consumerSecret: string
  shortCode: string
  passkey: string
  callbackUrl: string
  /** Till vs paybill flavour. CustomerPayBillOnline is the paybill default. */
  transactionType: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline'
}

/**
 * With no credentials configured the module runs in mock mode: STK pushes are
 * accepted and answered locally, so the billing flow is exercisable in
 * development and CI without a Safaricom account. Never silently active in
 * production — see assertUsable().
 */
export function isMockMode(): boolean {
  if (process.env.MPESA_MOCK === 'true') return true
  if (process.env.MPESA_MOCK === 'false') return false
  return !process.env.MPESA_CONSUMER_KEY || !process.env.MPESA_CONSUMER_SECRET
}

export function getConfig(): MpesaConfig {
  const env = process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox'
  return {
    env,
    consumerKey: process.env.MPESA_CONSUMER_KEY ?? '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET ?? '',
    shortCode: process.env.MPESA_SHORTCODE ?? '174379',
    passkey: process.env.MPESA_PASSKEY ?? '',
    callbackUrl: process.env.MPESA_CALLBACK_URL ?? '',
    transactionType:
      process.env.MPESA_TRANSACTION_TYPE === 'CustomerBuyGoodsOnline'
        ? 'CustomerBuyGoodsOnline'
        : 'CustomerPayBillOnline',
  }
}

export function assertUsable() {
  if (isMockMode()) {
    if (process.env.NODE_ENV === 'production') {
      throw new ApiError(
        503,
        'M-Pesa is in mock mode but NODE_ENV is production. Refusing to fake a payment.',
      )
    }
    return
  }
  const cfg = getConfig()
  const missing = (['consumerKey', 'consumerSecret', 'shortCode', 'passkey', 'callbackUrl'] as const).filter(
    (k) => !cfg[k],
  )
  if (missing.length > 0) {
    throw new ApiError(503, `M-Pesa is not configured: missing ${missing.join(', ')}`)
  }
}

/**
 * Kenyan MSISDN in the format Daraja wants: 2547XXXXXXXX / 2541XXXXXXXX.
 * Accepts the shapes staff actually type — 07…, +2547…, 7…, with spaces or
 * dashes.
 */
export function normalisePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, '').replace(/^\+/, '')

  if (/^254[17]\d{8}$/.test(digits)) return digits
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`

  throw new ApiError(400, `"${input}" is not a valid Kenyan mobile number`)
}

/** YYYYMMDDHHmmss in Africa/Nairobi (UTC+3, no DST). */
export function nairobiTimestamp(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value
      return acc
    }, {})

  // Some ICU builds render midnight as hour "24".
  const hour = parts.hour === '24' ? '00' : parts.hour
  return `${parts.year}${parts.month}${parts.day}${hour}${parts.minute}${parts.second}`
}

export function stkPassword(shortCode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64')
}

/**
 * Daraja returns the M-Pesa transaction time as the number 20260818153012, in
 * Nairobi local time. Parsed back to a real instant.
 */
export function parseMpesaDate(value: string | number | undefined | null): Date | null {
  if (value === undefined || value === null) return null
  const s = String(value)
  if (!/^\d{14}$/.test(s)) return null

  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}+03:00`
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

let cachedToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(cfg: MpesaConfig): Promise<string> {
  // 60s of headroom so a token never expires mid-flight.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }

  const credentials = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64')
  const res = await fetch(`${BASE_URL[cfg.env]}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    throw new ApiError(502, `M-Pesa auth failed (${res.status})`)
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: string }
  if (!body.access_token) throw new ApiError(502, 'M-Pesa auth returned no token')

  const ttlSeconds = Number(body.expires_in ?? 3599)
  cachedToken = { token: body.access_token, expiresAt: Date.now() + ttlSeconds * 1000 }
  return cachedToken.token
}

/** Exposed for tests and for credential rotation. */
export function clearTokenCache() {
  cachedToken = null
}

export interface StkPushInput {
  phone: string
  /** Whole shillings. Daraja rejects decimals on this product. */
  amount: number
  accountReference: string
  description: string
}

export interface StkPushResult {
  merchantRequestId: string
  checkoutRequestId: string
  responseCode: string
  responseDescription: string
  customerMessage: string
  request: Record<string, unknown>
  mocked: boolean
}

export async function stkPush(input: StkPushInput): Promise<StkPushResult> {
  const cfg = getConfig()
  const timestamp = nairobiTimestamp()
  const phone = normalisePhone(input.phone)
  const amount = Math.round(input.amount)

  if (amount < 1) throw new ApiError(400, 'M-Pesa requires an amount of at least KES 1')

  const payload = {
    BusinessShortCode: cfg.shortCode,
    Password: stkPassword(cfg.shortCode, cfg.passkey, timestamp),
    Timestamp: timestamp,
    TransactionType: cfg.transactionType,
    Amount: amount,
    PartyA: phone,
    PartyB: cfg.shortCode,
    PhoneNumber: phone,
    CallBackURL: cfg.callbackUrl,
    // Safaricom truncates both of these on the handset prompt; keeping them
    // short avoids showing the payer a chopped-off reference.
    AccountReference: input.accountReference.slice(0, 12),
    TransactionDesc: input.description.slice(0, 13),
  }

  if (isMockMode()) {
    const id = `MOCK${Date.now()}`
    return {
      merchantRequestId: `${id}-M`,
      checkoutRequestId: `ws_CO_${id}`,
      responseCode: '0',
      responseDescription: 'Success. Request accepted for processing',
      customerMessage: 'Success. Request accepted for processing (mock)',
      request: { ...payload, Password: '[redacted]' },
      mocked: true,
    }
  }

  const token = await getAccessToken(cfg)
  const res = await fetch(`${BASE_URL[cfg.env]}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  })

  const body = (await res.json().catch(() => ({}))) as Record<string, string>

  if (!res.ok || body.ResponseCode !== '0') {
    throw new ApiError(
      502,
      body.errorMessage ?? body.ResponseDescription ?? `M-Pesa rejected the request (${res.status})`,
    )
  }

  return {
    merchantRequestId: body.MerchantRequestID ?? '',
    checkoutRequestId: body.CheckoutRequestID ?? '',
    responseCode: body.ResponseCode,
    responseDescription: body.ResponseDescription ?? '',
    customerMessage: body.CustomerMessage ?? '',
    request: { ...payload, Password: '[redacted]' },
    mocked: false,
  }
}

/**
 * Ask Safaricom for the state of a push. The callback is the primary signal;
 * this is the fallback for when it never arrives — dropped webhook, customer
 * on a dead network — so a payment is never lost to a missed HTTP call.
 *
 * Returns null while the transaction is still in flight.
 */
export async function stkQuery(
  checkoutRequestId: string,
): Promise<{ resultCode: string; resultDesc: string } | null> {
  if (isMockMode()) return null

  const cfg = getConfig()
  const timestamp = nairobiTimestamp()
  const token = await getAccessToken(cfg)

  const res = await fetch(`${BASE_URL[cfg.env]}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: cfg.shortCode,
      Password: stkPassword(cfg.shortCode, cfg.passkey, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
    signal: AbortSignal.timeout(30_000),
  })

  const body = (await res.json().catch(() => ({}))) as Record<string, string>

  // Daraja answers 500.001.1001 "transaction is being processed" while the
  // customer still has the prompt open — not an error, just early.
  if (!res.ok) return null
  if (body.ResultCode === undefined) return null

  return { resultCode: String(body.ResultCode), resultDesc: body.ResultDesc ?? '' }
}

export interface StkCallbackSummary {
  merchantRequestId?: string
  checkoutRequestId?: string
  resultCode: string
  resultDesc: string
  amount?: number
  mpesaReceiptNumber?: string
  transactionDate?: Date | null
  phone?: string
}

/** Flattens the deeply nested CallbackMetadata array Daraja posts back. */
export function parseStkCallback(body: unknown): StkCallbackSummary | null {
  const stk = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback
  if (!stk) return null

  const items =
    (stk.CallbackMetadata as { Item?: { Name: string; Value?: string | number }[] } | undefined)?.Item ?? []
  const pick = (name: string) => items.find((i) => i.Name === name)?.Value

  const amount = pick('Amount')
  const phone = pick('PhoneNumber')

  return {
    merchantRequestId: stk.MerchantRequestID as string | undefined,
    checkoutRequestId: stk.CheckoutRequestID as string | undefined,
    resultCode: String(stk.ResultCode ?? ''),
    resultDesc: String(stk.ResultDesc ?? ''),
    amount: amount === undefined ? undefined : Number(amount),
    mpesaReceiptNumber: pick('MpesaReceiptNumber') as string | undefined,
    transactionDate: parseMpesaDate(pick('TransactionDate') as string | number | undefined),
    phone: phone === undefined ? undefined : String(phone),
  }
}

/** Daraja treats any 200 as "delivered" and retries anything else. */
export const CALLBACK_ACK = { ResultCode: 0, ResultDesc: 'Accepted' }

/**
 * 0 is success; the rest are terminal failures, distinguished so the UI can
 * say something truthful rather than a flat "failed".
 */
export function statusForResultCode(code: string): 'SUCCESS' | 'CANCELLED' | 'TIMEOUT' | 'FAILED' {
  switch (code) {
    case '0':
      return 'SUCCESS'
    case '1032':
      return 'CANCELLED'
    case '1037':
      return 'TIMEOUT'
    default:
      return 'FAILED'
  }
}
