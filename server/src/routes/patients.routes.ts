import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { ApiError } from '../middleware/errorHandler.js'

export const patientsRoutes = Router()

patientsRoutes.get('/patients', requireAuth, async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined
    const wardId = typeof req.query.wardId === 'string' ? req.query.wardId : undefined
    const status = typeof req.query.status === 'string' ? req.query.status : undefined

    const patients = await prisma.patient.findMany({
      where: {
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { ipNumber: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(wardId ? { wardId } : {}),
        ...(status ? { status: status as 'ADMITTED' | 'DISCHARGED' } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 25,
      select: {
        id: true,
        ipNumber: true,
        name: true,
        avatarInitials: true,
        bed: true,
        status: true,
        ward: { select: { id: true, name: true } },
      },
    })
    res.json(patients)
  } catch (err) {
    next(err)
  }
})

patientsRoutes.get('/patients/:id', requireAuth, async (req, res, next) => {
  try {
    const patient = await prisma.patient.findUnique({
      where: { id: req.params.id },
      include: {
        ward: true,
        primaryPhysician: { select: { id: true, name: true } },
      },
    })
    if (!patient) throw new ApiError(404, 'Patient not found')
    res.json(patient)
  } catch (err) {
    next(err)
  }
})

const createPatientSchema = z.object({
  ipNumber: z.string().min(1),
  nationalId: z.string().min(1).optional(),
  name: z.string().min(1),
  dob: z.coerce.date(),
  sex: z.enum(['MALE', 'FEMALE']),
  bloodType: z.string().min(1),
  nextOfKinName: z.string().min(1),
  nextOfKinPhone: z.string().min(1),
  nextOfKinRelation: z.string().min(1),
  allergies: z.array(z.string()).default([]),
  wardId: z.string().min(1),
  bed: z.string().min(1),
  primaryPhysicianId: z.string().min(1),
  avatarInitials: z.string().min(1).max(3),
})

patientsRoutes.post(
  '/patients',
  requireAuth,
  requireRole('ADMIN', 'NURSE', 'PHYSICIAN'),
  async (req, res, next) => {
    try {
      const data = createPatientSchema.parse(req.body)
      const patient = await prisma.patient.create({ data })
      res.status(201).json(patient)
    } catch (err) {
      next(err)
    }
  },
)

const updatePatientSchema = z.object({
  wardId: z.string().min(1).optional(),
  bed: z.string().min(1).optional(),
  codeStatus: z.enum(['FULL_CODE', 'DNR', 'DNI', 'COMFORT_CARE']).optional(),
  status: z.enum(['ADMITTED', 'DISCHARGED']).optional(),
})

patientsRoutes.patch(
  '/patients/:id',
  requireAuth,
  requireRole('ADMIN', 'NURSE', 'PHYSICIAN'),
  async (req, res, next) => {
    try {
      const data = updatePatientSchema.parse(req.body)
      const patient = await prisma.patient.update({
        where: { id: req.params.id },
        data: {
          ...data,
          dischargedAt: data.status === 'DISCHARGED' ? new Date() : undefined,
        },
      })
      res.json(patient)
    } catch (err) {
      next(err)
    }
  },
)
