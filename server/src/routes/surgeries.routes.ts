import { Router } from 'express'
import { z } from 'zod'
import type { Surgery } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { ApiError } from '../middleware/errorHandler.js'

export const surgeriesRoutes = Router()

class SurgeryConflictError extends Error {
  conflicts: (Surgery & { patient: { name: string } })[]

  constructor(conflicts: (Surgery & { patient: { name: string } })[]) {
    super('Booking overlaps an existing surgery in this room')
    this.conflicts = conflicts
  }
}

// Nairobi (Africa/Nairobi) is a fixed UTC+3 offset year-round — no DST to
// account for, so the day boundary is a plain 3-hour shift.
function nairobiDayRange(dateStr: string) {
  const start = new Date(`${dateStr}T00:00:00+03:00`)
  const end = new Date(`${dateStr}T00:00:00+03:00`)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start, end }
}

function todayNairobi() {
  const now = new Date()
  const nairobiMs = now.getTime() + 3 * 60 * 60 * 1000
  return new Date(nairobiMs).toISOString().slice(0, 10)
}

surgeriesRoutes.get('/surgeries', requireAuth, async (req, res, next) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : todayNairobi()
    const { start, end } = nairobiDayRange(date)
    const surgeries = await prisma.surgery.findMany({
      where: { startsAt: { gte: start, lt: end } },
      orderBy: { startsAt: 'asc' },
      include: {
        patient: { select: { id: true, name: true, ipNumber: true } },
        surgeon: { select: { id: true, name: true } },
      },
    })
    res.json(surgeries)
  } catch (err) {
    next(err)
  }
})

const createSurgerySchema = z.object({
  patientId: z.string().min(1),
  procedure: z.string().min(1),
  surgeonId: z.string().min(1),
  room: z.enum(['OR_1', 'OR_2', 'OR_3', 'OR_4']),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
})

surgeriesRoutes.post(
  '/surgeries',
  requireAuth,
  requireRole('ADMIN', 'PHYSICIAN'),
  async (req, res, next) => {
    try {
      const data = createSurgerySchema.parse(req.body)
      if (data.endsAt <= data.startsAt) {
        throw new ApiError(400, 'endsAt must be after startsAt')
      }
      const force = req.query.force === 'true'

      const surgery = await prisma.$transaction(async (tx) => {
        const conflicts = await tx.surgery.findMany({
          where: {
            room: data.room,
            status: { not: 'CANCELLED' },
            startsAt: { lt: data.endsAt },
            endsAt: { gt: data.startsAt },
          },
          include: { patient: { select: { name: true } } },
        })

        if (conflicts.length > 0 && !force) {
          throw new SurgeryConflictError(conflicts)
        }

        return tx.surgery.create({
          data,
          include: {
            patient: { select: { id: true, name: true, ipNumber: true } },
            surgeon: { select: { id: true, name: true } },
          },
        })
      })

      res.status(201).json(surgery)
    } catch (err) {
      if (err instanceof SurgeryConflictError) {
        res.status(409).json({ error: err.message, conflicts: err.conflicts })
        return
      }
      next(err)
    }
  },
)

surgeriesRoutes.delete(
  '/surgeries/:id',
  requireAuth,
  requireRole('ADMIN', 'PHYSICIAN'),
  async (req, res, next) => {
    try {
      await prisma.surgery.delete({ where: { id: req.params.id } })
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
)
