import { ApiError } from '../middleware/errorHandler.js'

/**
 * KRA eTIMS electronic tax invoicing.
 *
 * Kenyan law requires an electronic tax invoice carrying a control unit number
 * and a verification QR. In practice the control unit is a device or VSCU on
 * the facility network, not a public cloud API, so the endpoint is
 * site-specific — hence the adapter, mocked by default.
 *
 * The tax arithmetic below is ours and is real. Getting VAT wrong is a
 * revenue-authority problem regardless of which control unit signs the result.
 */

/** Standard Kenyan VAT rate. Overridable because rates change by statute. */
export const VAT_RATE = Number(process.env.KRA_VAT_RATE ?? 0.16)

export function isMockMode(): boolean {
  if (process.env.ETIMS_MOCK === 'true') return true
  if (process.env.ETIMS_MOCK === 'false') return false
  return !process.env.ETIMS_BASE_URL
}

export function assertUsable() {
  if (isMockMode()) {
    if (process.env.NODE_ENV === 'production') {
      throw new ApiError(
        503,
        'eTIMS is in mock mode but NODE_ENV is production. Refusing to issue an unsigned tax invoice.',
      )
    }
    return
  }
  const missing = (['ETIMS_BASE_URL', 'ETIMS_DEVICE_ID', 'KRA_PIN'] as const).filter(
    (k) => !process.env[k],
  )
  if (missing.length > 0) throw new ApiError(503, `eTIMS is not configured: missing ${missing.join(', ')}`)
}

export interface TaxBreakdown {
  /** Gross amount as billed, VAT-inclusive. */
  total: number
  /** Net of VAT. */
  taxable: number
  vat: number
}

/**
 * Split a VAT-inclusive total.
 *
 * Kenyan healthcare prices are quoted inclusive, so VAT is extracted rather
 * than added: taxable = total / (1 + rate). Adding 16% to an inclusive price
 * overcharges the patient by ~16%, which is the single easiest way to get this
 * wrong.
 *
 * Exempt supplies pass through untouched — most core medical services are VAT
 * exempt in Kenya, so this is the common case, not the edge case.
 */
export function splitTax(total: number, exempt = false): TaxBreakdown {
  const round = (n: number) => Math.round(n * 100) / 100

  if (exempt || VAT_RATE <= 0) {
    return { total: round(total), taxable: round(total), vat: 0 }
  }

  const taxable = total / (1 + VAT_RATE)
  const vat = total - taxable
  return { total: round(total), taxable: round(taxable), vat: round(vat) }
}

export interface SignRequest {
  invoiceNumber: string
  buyerName: string
  buyerPin?: string | null
  lines: { code: string; description: string; amount: number; exempt?: boolean }[]
}

export interface SignResult {
  controlUnitNumber: string
  invoiceSignature: string
  qrCodeUrl: string
  mocked: boolean
}

export async function signInvoice(request: SignRequest): Promise<SignResult> {
  if (isMockMode()) {
    const stamp = Date.now().toString().slice(-10)
    return {
      controlUnitNumber: `MOCKCU${stamp}`,
      invoiceSignature: `MOCK-SIG-${stamp}`,
      qrCodeUrl: `https://itax.kra.go.ke/KRA-Portal/invoiceChk.htm?actionCode=loadPage&invoiceNo=MOCK${stamp}`,
      mocked: true,
    }
  }

  const res = await fetch(`${process.env.ETIMS_BASE_URL}/invoices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': process.env.ETIMS_DEVICE_ID ?? '',
      ...(process.env.ETIMS_API_KEY ? { Authorization: `Bearer ${process.env.ETIMS_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      pin: process.env.KRA_PIN,
      invoiceNumber: request.invoiceNumber,
      buyerName: request.buyerName,
      buyerPin: request.buyerPin ?? undefined,
      items: request.lines.map((l) => {
        const tax = splitTax(l.amount, l.exempt)
        return {
          itemCode: l.code,
          description: l.description,
          totalAmount: tax.total,
          taxableAmount: tax.taxable,
          taxAmount: tax.vat,
          // "E" = exempt, "B" = standard rated, in eTIMS tax-category terms.
          taxCategory: l.exempt ? 'E' : 'B',
        }
      }),
    }),
    signal: AbortSignal.timeout(30_000),
  })

  const body = (await res.json().catch(() => ({}))) as Record<string, string>

  if (!res.ok || !body.controlUnitNumber) {
    throw new ApiError(502, body.message ?? `eTIMS signing failed (${res.status})`)
  }

  return {
    controlUnitNumber: body.controlUnitNumber,
    invoiceSignature: body.invoiceSignature ?? '',
    qrCodeUrl: body.qrCodeUrl ?? '',
    mocked: false,
  }
}
