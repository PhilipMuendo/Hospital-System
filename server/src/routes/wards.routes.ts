import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'

export const wardsRoutes = Router()

wardsRoutes.get('/wards', requireAuth, async (_req, res, next) => {
  try {
    const wards = await prisma.ward.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { patients: { where: { status: 'ADMITTED' } } } } },
    })
    res.json(
      wards.map((w) => ({
        id: w.id,
        name: w.name,
        bedCapacity: w.bedCapacity,
        occupied: w._count.patients,
      })),
    )
  } catch (err) {
    next(err)
  }
})
