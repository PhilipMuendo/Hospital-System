import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'

export const labsRoutes = Router()

labsRoutes.get('/patients/:id/labs', requireAuth, async (req, res, next) => {
  try {
    const labs = await prisma.labResult.findMany({
      where: { patientId: req.params.id },
      orderBy: { collectedAt: 'desc' },
    })
    res.json(labs)
  } catch (err) {
    next(err)
  }
})

const reviewSchema = z.object({ reviewed: z.boolean() })

labsRoutes.patch(
  '/labs/:id/review',
  requireAuth,
  requireRole('PHYSICIAN', 'NURSE'),
  async (req, res, next) => {
    try {
      const { reviewed } = reviewSchema.parse(req.body)
      const lab = await prisma.labResult.update({
        where: { id: req.params.id },
        data: reviewed
          ? { reviewed: true, reviewedById: req.user!.id, reviewedAt: new Date() }
          : { reviewed: false, reviewedById: null, reviewedAt: null },
      })
      res.json(lab)
    } catch (err) {
      next(err)
    }
  },
)
