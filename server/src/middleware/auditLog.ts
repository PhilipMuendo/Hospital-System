import type { NextFunction, Request, Response } from 'express'
import type { AuditAction } from '@prisma/client'
import { audit, clientIp, writeAudit } from '../lib/audit.js'

const METHOD_ACTION: Record<string, AuditAction> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
  GET: 'READ',
}

/**
 * Paths that produce no audit value and would otherwise drown the table —
 * liveness probes and the session-echo the SPA polls on every mount.
 */
const IGNORED = [/^\/api\/health$/, /^\/api\/auth\/me$/]

/**
 * GETs are only logged when they expose patient-level PHI. Dashboard tiles,
 * ward counts and the alert feed are aggregate and are deliberately not
 * recorded — logging them buries the reads that matter.
 */
const PHI_READ = [
  /^\/api\/patients\/[^/]+$/,
  /^\/api\/patients\/[^/]+\/(vitals|labs|imaging|billing|prescriptions)$/,
  /^\/api\/audit/,
]

function entityFromPath(path: string): { entity: string; entityId?: string; patientId?: string } {
  const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean)
  if (parts[0] === 'patients' && parts[1]) {
    return {
      entity: parts[2] ? `Patient.${parts[2]}` : 'Patient',
      entityId: parts[2] ? undefined : parts[1],
      patientId: parts[1],
    }
  }
  return { entity: parts[0] ?? 'unknown', entityId: parts[1] }
}

/**
 * Writes exactly one audit row per auditable request, after the response has
 * been sent, using whatever the route attached to `req.audit` plus what can be
 * inferred from the route shape. Placed before the routers so it observes
 * every request, including the ones that 401 or 403.
 */
export function auditLog(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now()

  res.on('finish', () => {
    void (async () => {
      const draft = req.audit ?? {}
      if (draft.skip) return

      const path = req.originalUrl.split('?')[0] ?? req.path
      if (IGNORED.some((re) => re.test(path))) return

      const isRead = req.method === 'GET'
      if (isRead && !PHI_READ.some((re) => re.test(path)) && !draft.action) return

      // A rejected request is worth more than a successful one — an
      // unauthorised attempt to open a chart is exactly what the log is for.
      const denied = res.statusCode === 401 || res.statusCode === 403
      // Nothing changed, so don't claim it did.
      const failedWrite = !isRead && res.statusCode >= 400

      const inferred = entityFromPath(path)
      const action: AuditAction = denied
        ? 'DENIED'
        : (draft.action ?? METHOD_ACTION[req.method] ?? 'READ')

      await writeAudit({
        actorId: draft.actorId ?? req.user?.id ?? null,
        actorRole: draft.actorRole ?? req.user?.role ?? null,
        actorLabel: draft.actorLabel ?? (req.user ? `${req.user.name} <${req.user.email}>` : 'anonymous'),
        action,
        entity: draft.entity ?? inferred.entity,
        entityId: draft.entityId ?? inferred.entityId ?? null,
        patientId: draft.patientId ?? inferred.patientId ?? null,
        method: req.method,
        path,
        status: res.statusCode,
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
        meta: {
          ...(draft.meta ?? {}),
          durationMs: Date.now() - startedAt,
          ...(failedWrite ? { outcome: 'rejected' } : {}),
          ...(Object.keys(req.query).length > 0 ? { query: req.query } : {}),
        },
      })
    })()
  })

  next()
}

export { audit }
