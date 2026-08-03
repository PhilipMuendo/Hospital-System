import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'

export const billingRoutes = Router()

billingRoutes.get('/patients/:id/billing', requireAuth, async (req, res, next) => {
  try {
    const lines = await prisma.billingLine.findMany({
      where: { patientId: req.params.id },
      orderBy: { createdAt: 'desc' },
    })
    res.json(lines)
  } catch (err) {
    next(err)
  }
})

const createBillingSchema = z.object({
  description: z.string().min(1),
  code: z.string().min(1),
  amount: z.number().positive(),
  payer: z.enum(['SHA', 'IMARA_HEALTH_ASSURANCE', 'SELF_PAY']),
})

billingRoutes.post(
  '/patients/:id/billing',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = createBillingSchema.parse(req.body)
      const line = await prisma.billingLine.create({
        data: { ...data, patientId: req.params.id, createdById: req.user!.id },
      })
      res.status(201).json(line)
    } catch (err) {
      next(err)
    }
  },
)

const updateBillingSchema = z.object({
  status: z.enum(['PAID', 'PENDING', 'DENIED']),
  mpesaReference: z.string().min(1).optional(),
})

billingRoutes.patch(
  '/billing/:id',
  requireAuth,
  requireRole('BILLING', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = updateBillingSchema.parse(req.body)
      const line = await prisma.billingLine.update({
        where: { id: req.params.id },
        data,
      })
      res.json(line)
    } catch (err) {
      next(err)
    }
  },
)

billingRoutes.get('/billing', requireAuth, requireRole('BILLING', 'ADMIN'), async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const payer = typeof req.query.payer === 'string' ? req.query.payer : undefined
    const lines = await prisma.billingLine.findMany({
      where: {
        ...(status ? { status: status as 'PAID' | 'PENDING' | 'DENIED' } : {}),
        ...(payer ? { payer: payer as 'SHA' | 'IMARA_HEALTH_ASSURANCE' | 'SELF_PAY' } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { patient: { select: { id: true, name: true, ipNumber: true } } },
    })
    res.json(lines)
  } catch (err) {
    next(err)
  }
})
