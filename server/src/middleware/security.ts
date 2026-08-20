import type { NextFunction, Request, Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { ApiError } from './errorHandler.js'
import { clientIp, writeAudit } from '../lib/audit.js'

/**
 * Rate limits.
 *
 * Sized for a hospital, not a public API: a busy reception desk behind one NAT
 * address makes many legitimate requests, so the general limit is generous and
 * the tight limit is reserved for authentication, where the threat is
 * credential stuffing rather than volume.
 */

export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Health checks come from monitoring, not users.
  skip: (req) => req.path === '/api/health',
  message: { error: 'Too many requests — slow down' },
})

/**
 * Login attempts, keyed on IP *and* the email being tried, so one attacker
 * cannot lock out every user from a shared clinic IP, and spraying one
 * password across many accounts is still counted.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : 'unknown'
    // ipKeyGenerator normalises IPv6 to a /64 so a single host cannot rotate
    // through addresses in its own subnet to reset the counter.
    return `${ipKeyGenerator(req.ip ?? '')}:${email}`
  },
  handler: async (req, res) => {
    await writeAudit({
      actorLabel: typeof req.body?.email === 'string' ? req.body.email : 'unknown',
      action: 'DENIED',
      entity: 'User',
      path: '/api/auth/login',
      status: 429,
      ip: clientIp(req),
      meta: { reason: 'login rate limit exceeded' },
    })
    res.status(429).json({ error: 'Too many failed sign-in attempts. Try again in 15 minutes.' })
  },
})

/**
 * Guards the M-Pesa callback.
 *
 * Daraja does not sign its callbacks — there is no HMAC, no mutual TLS, no
 * bearer token. The only controls available are therefore:
 *
 *  1. a secret embedded in the callback URL, which only Safaricom is told; and
 *  2. an allowlist of Safaricom's published source addresses.
 *
 * Without these, anyone who can reach the endpoint and knows a
 * CheckoutRequestID can post a forged success and settle a bill that was never
 * paid. That is not theoretical: the ID is handed to the browser when a push
 * is started, so any clerk who can start a payment could also forge its
 * confirmation.
 *
 * Both controls are enforced here. In production the process refuses to start
 * without the secret — see assertCallbackSecurity().
 */
export function mpesaCallbackGuard(req: Request, _res: Response, next: NextFunction) {
  const expected = process.env.MPESA_CALLBACK_SECRET
  const provided = req.params.secret

  if (expected) {
    // Length-independent compare is unnecessary here (the secret is in the
    // URL, not derived from user input timing), but a mismatch must never
    // fall through.
    if (provided !== expected) {
      void writeAudit({
        actorLabel: 'unknown-caller',
        action: 'DENIED',
        entity: 'MpesaTransaction',
        path: '/api/mpesa/callback',
        status: 404,
        ip: clientIp(req),
        meta: { reason: 'bad callback secret' },
      })
      // 404 rather than 403: do not confirm the endpoint exists.
      return next(new ApiError(404, 'Not found'))
    }
  }

  const allowed = (process.env.MPESA_ALLOWED_IPS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (allowed.length > 0) {
    const ip = (clientIp(req) ?? '').replace(/^::ffff:/, '')
    if (!allowed.includes(ip)) {
      void writeAudit({
        actorLabel: 'unknown-caller',
        action: 'DENIED',
        entity: 'MpesaTransaction',
        path: '/api/mpesa/callback',
        status: 404,
        ip,
        meta: { reason: 'source IP not in MPESA_ALLOWED_IPS' },
      })
      return next(new ApiError(404, 'Not found'))
    }
  }

  next()
}

/**
 * Refuse to boot a production process that would accept forged payment
 * confirmations. Failing at startup is the only safe behaviour: a warning in a
 * log is not read at 2am, and the window between deploy and discovery is
 * exactly when the money moves.
 */
export function assertCallbackSecurity() {
  if (process.env.NODE_ENV !== 'production') return

  const problems: string[] = []
  if (!process.env.MPESA_CALLBACK_SECRET) problems.push('MPESA_CALLBACK_SECRET is not set')
  if ((process.env.MPESA_CALLBACK_SECRET ?? '').length < 24) {
    problems.push('MPESA_CALLBACK_SECRET must be at least 24 characters')
  }
  if (!process.env.MPESA_ALLOWED_IPS) {
    problems.push('MPESA_ALLOWED_IPS is not set (Safaricom source addresses)')
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start: the M-Pesa callback would accept forged payments.\n  - ${problems.join('\n  - ')}`,
    )
  }
}
