import type { Request } from 'express'
import type { AuditAction, Prisma, Role } from '@prisma/client'
import { prisma } from './prisma.js'

/**
 * Keys that must never reach the audit table. The log is queryable by
 * administrators, so anything here would be a credential leak with a nice UI
 * on top.
 */
const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'newpassword',
  'currentpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'passkey',
  'consumersecret',
  'consumerkey',
])

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]'
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1))
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1)
    }
    return out
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…[truncated]`
  return value
}

/**
 * Shallow before/after diff, keyed on the fields that actually moved. Keeps
 * the log readable — a status flip records two values, not the whole row.
 */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, { from: unknown; to: unknown }> | undefined {
  if (!before || !after) return undefined
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key]
    const b = after[key]
    const same = a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : JSON.stringify(a) === JSON.stringify(b)
    if (!same) {
      changes[key] = { from: redact(a), to: redact(b) }
    }
  }
  return Object.keys(changes).length > 0 ? changes : undefined
}

export interface AuditDraft {
  action?: AuditAction
  entity?: string
  entityId?: string | null
  patientId?: string | null
  actorId?: string | null
  actorRole?: Role | null
  actorLabel?: string
  meta?: Record<string, unknown>
  /** Set by a route to suppress the automatic row (e.g. health checks). */
  skip?: boolean
}

export function clientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim()
  }
  return req.ip ?? req.socket.remoteAddress ?? undefined
}

/**
 * Enrich the audit row the middleware will write when this request finishes.
 * Routes call this instead of writing rows themselves, so every request
 * produces exactly one row.
 */
export function audit(req: Request, draft: AuditDraft) {
  const existing = req.audit ?? {}
  req.audit = {
    ...existing,
    ...draft,
    meta: { ...(existing.meta ?? {}), ...(draft.meta ?? {}) },
  }
}

/**
 * Write a row directly. Used for events that do not map onto a finished HTTP
 * request from a signed-in user — the M-Pesa callback, background jobs.
 *
 * Never throws: an audit failure must not take down the request that caused
 * it. It is logged loudly instead so the gap is visible in ops.
 */
export async function writeAudit(entry: {
  actorId?: string | null
  actorRole?: Role | null
  actorLabel: string
  action: AuditAction
  entity: string
  entityId?: string | null
  patientId?: string | null
  method?: string | null
  path: string
  status?: number | null
  ip?: string | null
  userAgent?: string | null
  meta?: unknown
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorRole: entry.actorRole ?? null,
        actorLabel: entry.actorLabel,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        patientId: entry.patientId ?? null,
        method: entry.method ?? null,
        path: entry.path,
        status: entry.status ?? null,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
        meta: (entry.meta === undefined ? undefined : (redact(entry.meta) as Prisma.InputJsonValue)),
      },
    })
  } catch (err) {
    console.error('[audit] failed to write audit row', {
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      err,
    })
  }
}
