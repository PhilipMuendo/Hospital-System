import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'

export const alertsRoutes = Router()

alertsRoutes.get('/alerts', requireAuth, async (req, res, next) => {
  try {
    const resolved = req.query.resolved === 'true' ? true : req.query.resolved === 'false' ? false : undefined
    const alerts = await prisma.alert.findMany({
      where: resolved === undefined ? {} : { resolved },
      orderBy: { createdAt: 'desc' },
      include: { ward: { select: { id: true, name: true } } },
    })
    res.json(alerts)
  } catch (err) {
    next(err)
  }
})

const createAlertSchema = z.object({
  severity: z.enum(['HEALTHY', 'WARNING', 'CRITICAL']),
  message: z.string().min(1),
  wardId: z.string().min(1).optional(),
})

alertsRoutes.post(
  '/alerts',
  requireAuth,
  requireRole('ADMIN', 'NURSE', 'PHYSICIAN'),
  async (req, res, next) => {
    try {
      const data = createAlertSchema.parse(req.body)
      const alert = await prisma.alert.create({ data })
      res.status(201).json(alert)
    } catch (err) {
      next(err)
    }
  },
)

alertsRoutes.patch(
  '/alerts/:id/resolve',
  requireAuth,
  requireRole('ADMIN', 'NURSE', 'PHYSICIAN'),
  async (req, res, next) => {
    try {
      const alert = await prisma.alert.update({
        where: { id: req.params.id },
        data: { resolved: true, resolvedById: req.user!.id, resolvedAt: new Date() },
      })
      res.json(alert)
    } catch (err) {
      next(err)
    }
  },
)
