import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireRole.js'
import { ApiError } from '../middleware/errorHandler.js'
import { audit } from '../lib/audit.js'
import { handleMessage } from '../lib/mllp-server.js'

export const devicesRoutes = Router()

/** Asset register with live connection state. */
devicesRoutes.get('/devices', requireAuth, async (req, res, next) => {
  try {
    const devices = await prisma.device.findMany({
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: {
        ward: { select: { id: true, name: true } },
        _count: { select: { readings: true, messages: true } },
      },
    })

    const now = Date.now()
    audit(req, { action: 'READ', entity: 'Device' })
    res.json(
      devices.map((d) => ({
        id: d.id,
        assetTag: d.assetTag,
        name: d.name,
        kind: d.kind,
        manufacturer: d.manufacturer,
        model: d.model,
        serialNumber: d.serialNumber,
        transport: d.transport,
        status: d.status,
        ward: d.ward,
        bed: d.bed,
        ipAddress: d.ipAddress,
        hl7SendingApplication: d.hl7SendingApplication,
        lastSeenAt: d.lastSeenAt,
        // A device that speaks to us but has gone quiet for 15 minutes is
        // treated as stale regardless of its stored status.
        stale:
          d.transport !== 'MANUAL' &&
          (!d.lastSeenAt || now - d.lastSeenAt.getTime() > 15 * 60 * 1000),
        serviceDueAt: d.serviceDueAt,
        calibrationDueAt: d.calibrationDueAt,
        serviceOverdue: !!d.serviceDueAt && d.serviceDueAt.getTime() < now,
        calibrationOverdue: !!d.calibrationDueAt && d.calibrationDueAt.getTime() < now,
        readingCount: d._count.readings,
        messageCount: d._count.messages,
      })),
    )
  } catch (err) {
    next(err)
  }
})

/**
 * Readings staged by devices and not yet accepted into the chart. This is the
 * nurse's confirmation queue.
 */
devicesRoutes.get('/devices/readings', requireAuth, async (req, res, next) => {
  try {
    const pendingOnly = req.query.pending !== 'false'
    const readings = await prisma.deviceReading.findMany({
      where: pendingOnly ? { accepted: false, rejectedReason: null } : {},
      orderBy: { measuredAt: 'desc' },
      take: 200,
      include: { device: { select: { id: true, name: true, assetTag: true, kind: true } } },
    })

    const patientIds = [...new Set(readings.map((r) => r.patientId).filter(Boolean))] as string[]
    const patients = await prisma.patient.findMany({
      where: { id: { in: patientIds } },
      select: { id: true, name: true, ipNumber: true, bed: true },
    })
    const byId = new Map(patients.map((p) => [p.id, p]))

    audit(req, { action: 'READ', entity: 'DeviceReading' })
    res.json(
      readings.map((r) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        value: r.value,
        unit: r.unit,
        abnormalFlag: r.abnormalFlag,
        measuredAt: r.measuredAt,
        receivedAt: r.receivedAt,
        accepted: r.accepted,
        device: r.device,
        patient: r.patientId ? (byId.get(r.patientId) ?? null) : null,
      })),
    )
  } catch (err) {
    next(err)
  }
})

const acceptSchema = z.object({
  /** Severity the clinician assigns when promoting it to the chart. */
  status: z.enum(['HEALTHY', 'WARNING', 'CRITICAL']).default('HEALTHY'),
})

/**
 * Promote a staged device reading into the patient's chart.
 *
 * Only a clinician may do this. The whole point of staging is that a machine
 * cannot write an observation into a legal medical record unattended — a
 * displaced sensor would otherwise chart a false arrest.
 */
devicesRoutes.post(
  '/devices/readings/:id/accept',
  requireAuth,
  requireRole('NURSE', 'PHYSICIAN', 'ADMIN'),
  async (req, res, next) => {
    try {
      const { status } = acceptSchema.parse(req.body ?? {})

      const reading = await prisma.deviceReading.findUnique({ where: { id: req.params.id } })
      if (!reading) throw new ApiError(404, 'Reading not found')
      if (reading.accepted) throw new ApiError(409, 'Reading already accepted')
      if (!reading.patientId) {
        throw new ApiError(400, 'Reading is not matched to a patient — assign it to a bed first')
      }

      const vital = await prisma.$transaction(async (tx) => {
        const created = await tx.vitalReading.create({
          data: {
            patientId: reading.patientId!,
            label: reading.label,
            value: reading.value,
            unit: reading.unit,
            status,
            recordedAt: reading.measuredAt,
          },
        })
        await tx.deviceReading.update({
          where: { id: reading.id },
          data: { accepted: true, acceptedById: req.user!.id, acceptedAt: new Date() },
        })
        return created
      })

      audit(req, {
        entity: 'VitalReading',
        entityId: vital.id,
        patientId: reading.patientId,
        meta: { fromDeviceReading: reading.id, code: reading.code, value: reading.value, status },
      })
      res.status(201).json(vital)
    } catch (err) {
      next(err)
    }
  },
)

const rejectSchema = z.object({ reason: z.string().min(3) })

devicesRoutes.post(
  '/devices/readings/:id/reject',
  requireAuth,
  requireRole('NURSE', 'PHYSICIAN', 'ADMIN'),
  async (req, res, next) => {
    try {
      const { reason } = rejectSchema.parse(req.body)
      const reading = await prisma.deviceReading.update({
        where: { id: req.params.id },
        data: { rejectedReason: reason, acceptedById: req.user!.id, acceptedAt: new Date() },
      })
      audit(req, {
        entity: 'DeviceReading',
        entityId: reading.id,
        patientId: reading.patientId,
        meta: { rejected: reason },
      })
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  },
)

/** Recent raw traffic — the biomedical engineer's diagnostic view. */
devicesRoutes.get(
  '/devices/messages',
  requireAuth,
  requireRole('ADMIN'),
  async (req, res, next) => {
    try {
      const messages = await prisma.deviceMessage.findMany({
        orderBy: { receivedAt: 'desc' },
        take: 50,
        include: { device: { select: { name: true, assetTag: true } } },
      })
      audit(req, { action: 'READ', entity: 'DeviceMessage' })
      res.json(messages)
    } catch (err) {
      next(err)
    }
  },
)

const createDeviceSchema = z.object({
  assetTag: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum([
    'PATIENT_MONITOR',
    'INFUSION_PUMP',
    'VENTILATOR',
    'LAB_ANALYSER',
    'ECG',
    'ULTRASOUND',
    'XRAY',
    'DEFIBRILLATOR',
    'PULSE_OXIMETER',
    'WEIGHING_SCALE',
    'BARCODE_SCANNER',
    'THERMOMETER',
  ]),
  transport: z.enum(['HL7_MLLP', 'REST_PUSH', 'SERIAL_BRIDGE', 'MANUAL']).default('MANUAL'),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  wardId: z.string().optional(),
  bed: z.string().optional(),
  ipAddress: z.string().optional(),
  hl7SendingApplication: z.string().optional(),
})

devicesRoutes.post('/devices', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const data = createDeviceSchema.parse(req.body)
    const device = await prisma.device.create({ data })
    audit(req, { entity: 'Device', entityId: device.id, meta: { assetTag: device.assetTag } })
    res.status(201).json(device)
  } catch (err) {
    next(err)
  }
})

/**
 * Simulate an inbound HL7 message without a physical device on the network.
 *
 * This is how the integration is exercised in development and how a
 * biomedical engineer can prove the pipeline works before a monitor is
 * plugged in. It runs the identical handler the TCP listener uses, so a pass
 * here means the real path works.
 */
devicesRoutes.post(
  '/devices/simulate-hl7',
  requireAuth,
  requireRole('ADMIN'),
  async (req, res, next) => {
    try {
      const { message } = z.object({ message: z.string().min(8) }).parse(req.body)
      const ack = await handleMessage(message, 'simulated')
      audit(req, { entity: 'DeviceMessage', meta: { simulated: true } })
      res.json({ ack })
    } catch (err) {
      next(err)
    }
  },
)
