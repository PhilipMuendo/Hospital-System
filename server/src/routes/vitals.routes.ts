import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { idempotent } from '../middleware/idempotency.js'
import { requireRole } from '../middleware/requireRole.js'

export const vitalsRoutes = Router()

vitalsRoutes.get('/patients/:id/vitals', requireAuth, async (req, res, next) => {
  try {
    const vitals = await prisma.vitalReading.findMany({
      where: { patientId: req.params.id },
      orderBy: { recordedAt: 'desc' },
    })
    res.json(vitals)
  } catch (err) {
    next(err)
  }
})

const createVitalSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  unit: z.string().min(1),
  status: z.enum(['HEALTHY', 'WARNING', 'CRITICAL']),
})

vitalsRoutes.post(
  '/patients/:id/vitals',
  requireAuth,
  idempotent,
  requireRole('NURSE', 'PHYSICIAN'),
  async (req, res, next) => {
    try {
      const data = createVitalSchema.parse(req.body)
      const vital = await prisma.vitalReading.create({
        data: { ...data, patientId: req.params.id },
      })
      res.status(201).json(vital)
    } catch (err) {
      next(err)
    }
  },
)
