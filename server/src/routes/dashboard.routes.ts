import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'

export const dashboardRoutes = Router()

dashboardRoutes.get('/dashboard/metrics', requireAuth, async (_req, res, next) => {
  try {
    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)

    const [discharged, admittedPatients, seededMetrics] = await Promise.all([
      prisma.patient.count({
        where: { status: 'DISCHARGED', dischargedAt: { gte: startOfDay } },
      }),
      prisma.patient.findMany({
        where: { status: 'ADMITTED' },
        select: { admittedAt: true, registeredAt: true },
      }),
      prisma.hospitalMetric.findMany(),
    ])

    const now = Date.now()
    const avgStayDays =
      admittedPatients.length === 0
        ? 0
        : admittedPatients.reduce((sum, p) => sum + (now - (p.admittedAt ?? p.registeredAt).getTime()), 0) /
          admittedPatients.length /
          (1000 * 60 * 60 * 24)

    const metrics = [
      {
        key: 'avg_length_of_stay',
        label: 'Avg. Length of Stay',
        value: `${avgStayDays.toFixed(1)} days`,
        delta: 'live',
        trend: 'flat' as const,
      },
      {
        key: 'discharges_today',
        label: 'Discharges Today',
        value: String(discharged),
        delta: 'live',
        trend: 'flat' as const,
      },
      ...seededMetrics.map((m) => ({ key: m.key, label: m.label, value: m.value, delta: m.delta, trend: m.trend })),
    ]

    res.json(metrics)
  } catch (err) {
    next(err)
  }
})
