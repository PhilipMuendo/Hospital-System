import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { audit } from '../lib/audit.js'

export const auditRoutes = Router()

const querySchema = z.object({
  patientId: z.string().optional(),
  actorId: z.string().optional(),
  entity: z.string().optional(),
  action: z
    .enum(['LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'READ', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'DENIED'])
    .optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
})

/**
 * Read the audit trail. Administrators only, and reading it is itself audited
 * — "who has been reading the access log" is a question the log has to be
 * able to answer about itself.
 *
 * There is deliberately no write, update or delete endpoint. The table is
 * append-only from the application's point of view; correcting it is a
 * database-level operation with its own paper trail.
 */
auditRoutes.get('/audit', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query)

    const where: Prisma.AuditLogWhereInput = {
      ...(q.patientId ? { patientId: q.patientId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    }

    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: {
        patient: { select: { id: true, name: true, ipNumber: true } },
      },
    })

    const hasMore = rows.length > q.limit
    const page = hasMore ? rows.slice(0, q.limit) : rows

    audit(req, {
      action: 'READ',
      entity: 'AuditLog',
      patientId: q.patientId ?? null,
      meta: { filters: q, returned: page.length },
    })

    res.json({
      rows: page,
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * Everything recorded against one patient, in one place. This is what a
 * subject-access request under the Data Protection Act 2019 is answered with:
 * the data subject is entitled to know who accessed their record.
 */
auditRoutes.get(
  '/patients/:id/access-log',
  requireAuth,
  requireRole('ADMIN'),
  async (req, res, next) => {
    try {
      const rows = await prisma.auditLog.findMany({
        where: { patientId: req.params.id },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })

      audit(req, {
        action: 'EXPORT',
        entity: 'AuditLog',
        patientId: req.params.id,
        meta: { returned: rows.length, purpose: 'patient access log' },
      })

      res.json(rows)
    } catch (err) {
      next(err)
    }
  },
)

/**
 * Counts by action over a window — the shape an administrator scans for
 * anomalies (a spike in DENIED, an account reading hundreds of charts).
 */
auditRoutes.get('/audit/summary', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 7, 90)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const [byAction, topActors] = await Promise.all([
      prisma.auditLog.groupBy({
        by: ['action'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.auditLog.groupBy({
        by: ['actorLabel'],
        where: { createdAt: { gte: since }, action: { in: ['READ', 'EXPORT'] } },
        _count: { _all: true },
        orderBy: { _count: { actorLabel: 'desc' } },
        take: 10,
      }),
    ])

    audit(req, { action: 'READ', entity: 'AuditLog', meta: { summary: true, days } })

    res.json({
      since,
      days,
      byAction: byAction.map((r) => ({ action: r.action, count: r._count._all })),
      topReaders: topActors.map((r) => ({ actor: r.actorLabel, reads: r._count._all })),
    })
  } catch (err) {
    next(err)
  }
})
