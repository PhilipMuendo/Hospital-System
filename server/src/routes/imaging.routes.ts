import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'

export const imagingRoutes = Router()

imagingRoutes.get('/patients/:id/imaging', requireAuth, async (req, res, next) => {
  try {
    const studies = await prisma.imagingStudy.findMany({
      where: { patientId: req.params.id },
      orderBy: { performedAt: 'desc' },
      take: 50,
    })
    res.json(studies)
  } catch (err) {
    next(err)
  }
})
