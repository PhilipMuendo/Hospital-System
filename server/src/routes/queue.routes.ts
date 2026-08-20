import { Router } from 'express'
import { z } from 'zod'
import type { TriageAcuity } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { idempotent } from '../middleware/idempotency.js'
import { requireRole } from '../middleware/requireRole.js'
import { ApiError } from '../middleware/errorHandler.js'
import { audit } from '../lib/audit.js'
import { publish, subscribe } from '../lib/queue-events.js'
import { nextSequence, patientSequenceKey, ticketSequenceKey, visitSequenceKey } from '../lib/sequence.js'
import {
  MAX_CALLS,
  formatToken,
  formatVisitNumber,
  isBreaching,
  orderQueue,
  priorityFor,
  serviceDate,
  waitMinutes,
} from '../lib/queue.js'

export const queueRoutes = Router()

/* ------------------------------------------------------------------ */
/* Stations                                                            */
/* ------------------------------------------------------------------ */

queueRoutes.get('/stations', requireAuth, async (req, res, next) => {
  try {
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined
    const stations = await prisma.station.findMany({
      where: { active: true, ...(kind ? { kind: kind as never } : {}) },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    })
    audit(req, { skip: true })
    res.json(stations)
  } catch (err) {
    next(err)
  }
})

/* ------------------------------------------------------------------ */
/* Reception — find or register, then open a visit                     */
/* ------------------------------------------------------------------ */

/**
 * One search box for the three identifiers a returning patient can produce at
 * a Kenyan reception desk: their OP number, their National ID, or the phone
 * number the facility already has. Reception queues are long; this has to be
 * one query, not three screens.
 */
queueRoutes.get('/reception/search', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q as string | undefined)?.trim()
    if (!q || q.length < 3) {
      res.json([])
      return
    }

    const digits = q.replace(/\D/g, '')
    const patients = await prisma.patient.findMany({
      where: {
        OR: [
          { opNumber: { equals: q, mode: 'insensitive' } },
          { ipNumber: { equals: q, mode: 'insensitive' } },
          { nationalId: q },
          { name: { contains: q, mode: 'insensitive' } },
          ...(digits.length >= 6 ? [{ phone: { contains: digits.slice(-9) } }] : []),
        ],
      },
      select: {
        id: true,
        opNumber: true,
        ipNumber: true,
        name: true,
        dob: true,
        sex: true,
        phone: true,
        nationalId: true,
        status: true,
        visits: { orderBy: { arrivedAt: 'desc' }, take: 1, select: { arrivedAt: true, status: true } },
      },
      take: 15,
    })

    audit(req, { action: 'READ', entity: 'Patient', meta: { search: 'reception' } })
    res.json(
      patients.map((p) => ({
        ...p,
        lastVisitAt: p.visits[0]?.arrivedAt ?? null,
        hasOpenVisit: p.visits[0]?.status === 'OPEN',
        visits: undefined,
      })),
    )
  } catch (err) {
    next(err)
  }
})

const registerSchema = z.object({
  name: z.string().min(2),
  dob: z.string(),
  sex: z.enum(['MALE', 'FEMALE', 'INTERSEX']),
  phone: z.string().optional(),
  nationalId: z.string().optional(),
  bloodType: z.string().default('Unknown'),
  nextOfKinName: z.string().min(1),
  nextOfKinPhone: z.string().min(1),
  nextOfKinRelation: z.string().min(1),
  allergies: z.array(z.string()).default([]),
})

/** Register a person who has never attended before. Issues an OP number. */
queueRoutes.post(
  '/reception/patients',
  requireAuth,
  requireRole('ADMIN', 'NURSE', 'BILLING'),
  async (req, res, next) => {
    try {
      const data = registerSchema.parse(req.body)

      const patient = await prisma.$transaction(async (tx) => {
        // Same lost-update race as the ticket and visit numbers: count() then
        // insert lets two concurrent registrations mint the same OP number.
        const year = new Date().getFullYear()
        const sequence = await nextSequence(tx, patientSequenceKey(year))
        const opNumber = `OP/${year}/${String(sequence).padStart(5, '0')}`

        return tx.patient.create({
          data: {
            ...data,
            dob: new Date(data.dob),
            opNumber,
            status: 'REGISTERED',
            avatarInitials: data.name
              .split(' ')
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]!.toUpperCase())
              .join(''),
          },
        })
      })

      audit(req, {
        entity: 'Patient',
        entityId: patient.id,
        patientId: patient.id,
        meta: { registered: patient.opNumber },
      })
      res.status(201).json(patient)
    } catch (err) {
      next(err)
    }
  },
)

const checkInSchema = z.object({
  patientId: z.string(),
  type: z.enum(['NEW', 'REVISIT', 'FOLLOW_UP', 'EMERGENCY']).default('REVISIT'),
  chiefComplaint: z.string().optional(),
  payer: z.enum(['SHA', 'IMARA_HEALTH_ASSURANCE', 'SELF_PAY']).default('SELF_PAY'),
  shaNumber: z.string().optional(),
  /** Station to queue at first — normally triage. */
  stationId: z.string(),
})

/**
 * Check a patient in: open a visit and issue their first token.
 *
 * An EMERGENCY walk-in is given RED immediately rather than waiting for a
 * triage assessment, because the person carrying them in has already made the
 * only judgement that matters at that moment.
 */
queueRoutes.post(
  '/reception/check-in',
  requireAuth,
  requireRole('ADMIN', 'NURSE', 'BILLING'),
  async (req, res, next) => {
    try {
      const data = checkInSchema.parse(req.body)

      const existing = await prisma.visit.findFirst({
        where: { patientId: data.patientId, status: 'OPEN' },
      })
      if (existing) {
        throw new ApiError(409, `This patient already has an open visit (${existing.visitNumber})`)
      }

      const station = await prisma.station.findUnique({ where: { id: data.stationId } })
      if (!station || !station.active) throw new ApiError(400, 'Unknown or inactive station')

      const acuity: TriageAcuity | null = data.type === 'EMERGENCY' ? 'RED' : null
      const today = serviceDate()

      const { visit, ticket } = await prisma.$transaction(async (tx) => {
        const sequence = await nextSequence(tx, visitSequenceKey(today.slice(0, 7)))
        const visit = await tx.visit.create({
          data: {
            visitNumber: formatVisitNumber(sequence),
            patientId: data.patientId,
            type: data.type,
            chiefComplaint: data.chiefComplaint,
            payer: data.payer,
            shaNumber: data.shaNumber,
            acuity,
            currentStationId: station.id,
            registeredById: req.user!.id,
          },
        })

        const number = await nextSequence(tx, ticketSequenceKey(station.id, today))

        const ticket = await tx.queueTicket.create({
          data: {
            visitId: visit.id,
            stationId: station.id,
            number,
            token: formatToken(station.tokenPrefix, number),
            serviceDate: today,
            priority: priorityFor(acuity),
          },
        })

        return { visit, ticket }
      })

      publish({ type: 'ticket.issued', stationId: station.id, token: ticket.token })
      publish({ type: 'queue.changed', stationId: station.id })

      audit(req, {
        entity: 'Visit',
        entityId: visit.id,
        patientId: data.patientId,
        meta: { visitNumber: visit.visitNumber, token: ticket.token, type: data.type },
      })
      res.status(201).json({ visit, ticket })
    } catch (err) {
      next(err)
    }
  },
)

/* ------------------------------------------------------------------ */
/* Triage                                                              */
/* ------------------------------------------------------------------ */

const triageSchema = z.object({
  acuity: z.enum(['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE']),
  temperature: z.string().optional(),
  pulse: z.string().optional(),
  respiratory: z.string().optional(),
  bloodPressure: z.string().optional(),
  spo2: z.string().optional(),
  weightKg: z.string().optional(),
  heightCm: z.string().optional(),
  notes: z.string().optional(),
  /** Where the patient goes next — normally a consultation room. */
  nextStationId: z.string(),
})

/**
 * Record a triage assessment and move the patient into the clinical queue.
 *
 * Completing triage re-prioritises the onward ticket, which is the whole
 * point: this is the moment arrival order stops governing.
 */
queueRoutes.post(
  '/visits/:id/triage',
  requireAuth,
  idempotent,
  requireRole('NURSE', 'PHYSICIAN', 'ADMIN'),
  async (req, res, next) => {
    try {
      const data = triageSchema.parse(req.body)

      const visit = await prisma.visit.findUnique({ where: { id: req.params.id } })
      if (!visit) throw new ApiError(404, 'Visit not found')
      if (visit.status !== 'OPEN') throw new ApiError(409, 'Visit is closed')

      const station = await prisma.station.findUnique({ where: { id: data.nextStationId } })
      if (!station || !station.active) throw new ApiError(400, 'Unknown or inactive station')

      const today = serviceDate()
      const { ticket } = await prisma.$transaction(async (tx) => {
        const { nextStationId, ...assessment } = data

        await tx.triageAssessment.upsert({
          where: { visitId: visit.id },
          create: { ...assessment, visitId: visit.id, performedById: req.user!.id },
          update: { ...assessment, performedById: req.user!.id, performedAt: new Date() },
        })

        await tx.visit.update({
          where: { id: visit.id },
          data: { acuity: data.acuity, currentStationId: station.id },
        })

        // Close out the triage ticket if one is still open.
        await tx.queueTicket.updateMany({
          where: { visitId: visit.id, status: { in: ['WAITING', 'CALLED', 'IN_SERVICE'] } },
          data: { status: 'COMPLETED', completedAt: new Date() },
        })

        const number = await nextSequence(tx, ticketSequenceKey(station.id, today))

        const ticket = await tx.queueTicket.create({
          data: {
            visitId: visit.id,
            stationId: station.id,
            number,
            token: formatToken(station.tokenPrefix, number),
            serviceDate: today,
            priority: priorityFor(data.acuity),
          },
        })

        // The triage vitals belong on the chart too, not only in the
        // assessment record.
        const vitals: { label: string; value: string; unit: string }[] = []
        if (data.temperature) vitals.push({ label: 'Temperature', value: data.temperature, unit: '°C' })
        if (data.pulse) vitals.push({ label: 'Heart Rate', value: data.pulse, unit: 'bpm' })
        if (data.bloodPressure) vitals.push({ label: 'Blood Pressure', value: data.bloodPressure, unit: 'mmHg' })
        if (data.spo2) vitals.push({ label: 'SpO2', value: data.spo2, unit: '%' })
        if (data.respiratory) vitals.push({ label: 'Respiration Rate', value: data.respiratory, unit: '/min' })

        if (vitals.length > 0) {
          await tx.vitalReading.createMany({
            data: vitals.map((v) => ({
              ...v,
              patientId: visit.patientId,
              status:
                data.acuity === 'RED' || data.acuity === 'ORANGE'
                  ? ('CRITICAL' as const)
                  : data.acuity === 'YELLOW'
                    ? ('WARNING' as const)
                    : ('HEALTHY' as const),
            })),
          })
        }

        return { ticket }
      })

      publish({ type: 'queue.changed', stationId: station.id })
      publish({ type: 'ticket.issued', stationId: station.id, token: ticket.token })

      audit(req, {
        entity: 'TriageAssessment',
        entityId: visit.id,
        patientId: visit.patientId,
        meta: { acuity: data.acuity, token: ticket.token },
      })
      res.status(201).json(ticket)
    } catch (err) {
      next(err)
    }
  },
)

/* ------------------------------------------------------------------ */
/* The queue itself                                                    */
/* ------------------------------------------------------------------ */

async function loadQueue(stationId: string) {
  // Deliberately NOT filtered by serviceDate. serviceDate exists to reset the
  // token numbering each morning, not to define who is still waiting — a
  // patient queueing at 23:55 must not vanish from the room at midnight, and
  // casualty runs through the night.
  const tickets = await prisma.queueTicket.findMany({
    where: { stationId, status: { in: ['WAITING', 'CALLED', 'IN_SERVICE'] } },
    include: {
      visit: {
        include: {
          patient: { select: { id: true, name: true, opNumber: true, dob: true, sex: true } },
        },
      },
    },
  })
  return tickets
}

/** Ordered queue for a station, as both the board and the clinician see it. */
queueRoutes.get('/stations/:id/queue', requireAuth, async (req, res, next) => {
  try {
    const now = new Date()
    const tickets = await loadQueue(req.params.id)
    const ordered = orderQueue(
      tickets.map((t) => ({ ...t, issuedAt: t.issuedAt })),
      now,
    )

    audit(req, { skip: true })
    res.json(
      ordered.map((t, index) => ({
        id: t.id,
        token: t.token,
        position: index + 1,
        status: t.status,
        priority: t.priority,
        acuity: t.visit.acuity,
        callCount: t.callCount,
        counter: t.counter,
        issuedAt: t.issuedAt,
        waitMinutes: waitMinutes(t, now),
        breaching: isBreaching(t, t.visit.acuity, now),
        visitId: t.visit.id,
        visitNumber: t.visit.visitNumber,
        chiefComplaint: t.visit.chiefComplaint,
        patient: t.visit.patient,
      })),
    )
  } catch (err) {
    next(err)
  }
})

const callSchema = z.object({ counter: z.string().optional() })

/**
 * Call the next patient. The station's own ordering decides who — a clinician
 * cannot cherry-pick, which is what keeps the triage priority meaningful.
 */
queueRoutes.post(
  '/stations/:id/call-next',
  requireAuth,
  requireRole('PHYSICIAN', 'NURSE', 'ADMIN', 'PHARMACIST', 'BILLING'),
  async (req, res, next) => {
    try {
      const { counter } = callSchema.parse(req.body ?? {})
      const station = await prisma.station.findUnique({ where: { id: req.params.id } })
      if (!station) throw new ApiError(404, 'Station not found')

      const now = new Date()
      const tickets = await loadQueue(station.id)

      // Anyone already with this clinician is finished first.
      const inService = tickets.find((t) => t.status === 'IN_SERVICE' && t.servedById === req.user!.id)
      if (inService) {
        throw new ApiError(409, `Complete ${inService.token} before calling the next patient`)
      }

      // Claiming the next patient must be atomic. Two clinicians pressing
      // "call next" at the same moment previously both read the same head of
      // the queue and were handed the SAME patient — one walks out and calls a
      // name that another doctor is already seeing, and a slot is lost.
      //
      // The guarded update makes the database decide who claimed the ticket.
      // A loser does not error: they take the next patient instead, which is
      // what they wanted anyway.
      const ordered = orderQueue(
        tickets.filter((t) => t.status !== 'IN_SERVICE'),
        now,
      )
      if (ordered.length === 0) throw new ApiError(404, 'Queue is empty')

      let claimed: (typeof ordered)[number] | null = null
      let callCount = 0

      for (const candidate of ordered) {
        const result = await prisma.queueTicket.updateMany({
          // Only claimable while it is still in the state we read it in.
          where: { id: candidate.id, status: candidate.status },
          data: {
            status: 'CALLED',
            calledAt: now,
            callCount: candidate.callCount + 1,
            calledById: req.user!.id,
            counter: counter ?? station.room ?? station.name,
          },
        })
        if (result.count === 1) {
          claimed = candidate
          callCount = candidate.callCount + 1
          break
        }
        // Someone else claimed this one in the last few milliseconds; try the
        // next patient down the queue.
      }

      if (!claimed) throw new ApiError(409, 'Another clinician just called the last waiting patient')

      const updated = await prisma.queueTicket.findUniqueOrThrow({
        where: { id: claimed.id },
        include: { visit: { include: { patient: { select: { name: true } } } } },
      })

      // Private clinics never put a name on a public screen.
      const firstName = updated.visit.patient.name.split(' ')[0] ?? ''
      const patientLabel = station.privateClinic ? '' : firstName

      publish({
        type: 'ticket.called',
        stationId: station.id,
        token: updated.token,
        counter: updated.counter,
        patientLabel,
      })
      publish({ type: 'queue.changed', stationId: station.id })

      audit(req, {
        entity: 'QueueTicket',
        entityId: updated.id,
        patientId: updated.visit.patientId,
        meta: { called: updated.token, callCount, counter: updated.counter },
      })
      res.json({ ...updated, callCount, maxCalls: MAX_CALLS })
    } catch (err) {
      next(err)
    }
  },
)

/** Patient presented — they are now with the clinician. */
queueRoutes.post('/tickets/:id/start', requireAuth, async (req, res, next) => {
  try {
    const ticket = await prisma.queueTicket.update({
      where: { id: req.params.id },
      data: { status: 'IN_SERVICE', servedAt: new Date(), servedById: req.user!.id },
      include: { visit: true },
    })
    publish({ type: 'queue.changed', stationId: ticket.stationId })
    audit(req, { entity: 'QueueTicket', entityId: ticket.id, patientId: ticket.visit.patientId })
    res.json(ticket)
  } catch (err) {
    next(err)
  }
})

const completeSchema = z.object({
  /** Where they go next; omit to end the visit here. */
  nextStationId: z.string().optional(),
  outcome: z.string().optional(),
  closeVisit: z.boolean().default(false),
})

/**
 * Finish with this patient and either route them onward or close the visit.
 *
 * Routing onward reuses the same visit, which is what makes the lab
 * round-trip work: the patient comes back to the same doctor holding their
 * original attendance, not a fresh ticket from the back of the queue.
 */
queueRoutes.post('/tickets/:id/complete', requireAuth, async (req, res, next) => {
  try {
    const data = completeSchema.parse(req.body ?? {})
    const now = new Date()

    const ticket = await prisma.queueTicket.findUnique({
      where: { id: req.params.id },
      include: { visit: true },
    })
    if (!ticket) throw new ApiError(404, 'Ticket not found')
    // Without this a double-click completes twice and issues two onward
    // tickets, putting the same patient in the next queue in two places.
    if (ticket.status === 'COMPLETED' || ticket.status === 'NO_SHOW' || ticket.status === 'CANCELLED') {
      throw new ApiError(409, `${ticket.token} is already ${ticket.status.toLowerCase()}`)
    }
    // "Route onward" with nowhere to go used to fall through to the close
    // branch, silently discharging a patient who was meant to go to the lab.
    if (!data.closeVisit && !data.nextStationId) {
      throw new ApiError(400, 'Choose where the patient goes next, or close the visit explicitly')
    }

    const today = serviceDate()
    const result = await prisma.$transaction(async (tx) => {
      await tx.queueTicket.update({
        where: { id: ticket.id },
        data: { status: 'COMPLETED', completedAt: now },
      })

      if (data.closeVisit) {
        await tx.visit.update({
          where: { id: ticket.visitId },
          data: {
            status: 'COMPLETED',
            closedAt: now,
            outcome: data.outcome,
            currentStationId: null,
          },
        })
        return null
      }

      const station = await tx.station.findUnique({ where: { id: data.nextStationId } })
      if (!station) throw new ApiError(400, 'Unknown station')

      const number = await nextSequence(tx, ticketSequenceKey(station.id, today))

      const onward = await tx.queueTicket.create({
        data: {
          visitId: ticket.visitId,
          stationId: station.id,
          number,
          token: formatToken(station.tokenPrefix, number),
          serviceDate: today,
          // Acuity travels with the patient down the whole circuit.
          priority: priorityFor(ticket.visit.acuity),
        },
      })

      await tx.visit.update({
        where: { id: ticket.visitId },
        data: { currentStationId: station.id, outcome: data.outcome },
      })

      return onward
    })

    publish({ type: 'ticket.completed', stationId: ticket.stationId, token: ticket.token })
    publish({ type: 'queue.changed', stationId: ticket.stationId })
    if (result) publish({ type: 'queue.changed', stationId: result.stationId })

    audit(req, {
      entity: 'QueueTicket',
      entityId: ticket.id,
      patientId: ticket.visit.patientId,
      meta: { completed: ticket.token, routedTo: result?.token ?? null, closed: !result },
    })
    res.json({ completed: ticket.token, next: result })
  } catch (err) {
    next(err)
  }
})

/** Patient did not appear. Three calls before they lose the slot. */
queueRoutes.post('/tickets/:id/no-show', requireAuth, async (req, res, next) => {
  try {
    const ticket = await prisma.queueTicket.findUnique({
      where: { id: req.params.id },
      include: { visit: true },
    })
    if (!ticket) throw new ApiError(404, 'Ticket not found')

    const exhausted = ticket.callCount >= MAX_CALLS
    const updated = await prisma.queueTicket.update({
      where: { id: ticket.id },
      // Below the limit they go back into the queue rather than being lost;
      // people step out to the toilet or to pay.
      data: exhausted
        ? { status: 'NO_SHOW', completedAt: new Date() }
        : { status: 'WAITING' },
    })

    if (exhausted) {
      await prisma.visit.update({
        where: { id: ticket.visitId },
        data: { status: 'LWBS', closedAt: new Date() },
      })
      publish({ type: 'ticket.noshow', stationId: ticket.stationId, token: ticket.token })
    }
    publish({ type: 'queue.changed', stationId: ticket.stationId })

    audit(req, {
      entity: 'QueueTicket',
      entityId: ticket.id,
      patientId: ticket.visit.patientId,
      meta: { noShow: ticket.token, callCount: ticket.callCount, finalised: exhausted },
    })
    res.json({ ...updated, finalised: exhausted })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------------------------------------------ */
/* Public display board                                                */
/* ------------------------------------------------------------------ */

/**
 * Unauthenticated on purpose: this drives a television in a corridor, and
 * there is no one to log it in. It therefore exposes only what is safe to
 * project at a waiting room — a token, a room, and at most a first name.
 * Never a surname, a diagnosis, or the name of a clinic that would disclose
 * one.
 */
queueRoutes.get('/public/board', async (_req, res, next) => {
  try {
    const stations = await prisma.station.findMany({
      where: { active: true, kind: { in: ['CONSULTATION', 'TRIAGE', 'PHARMACY', 'CASHIER'] } },
      orderBy: { name: 'asc' },
    })

    const tickets = await prisma.queueTicket.findMany({
      // Same reasoning as loadQueue: still-waiting means still waiting, even
      // if the token was issued before midnight.
      where: { status: { in: ['WAITING', 'CALLED'] } },
      include: { visit: { include: { patient: { select: { name: true } } } } },
      orderBy: { calledAt: 'desc' },
    })

    const now = new Date()
    res.json({
      serverTime: now,
      stations: stations.map((s) => {
        const own = tickets.filter((t) => t.stationId === s.id)
        const called = own
          .filter((t) => t.status === 'CALLED')
          .sort((a, b) => (b.calledAt?.getTime() ?? 0) - (a.calledAt?.getTime() ?? 0))

        const nowServing = called[0]

        return {
          id: s.id,
          name: s.privateClinic ? 'Consultation' : s.name,
          room: s.room,
          nowServing: nowServing
            ? {
                token: nowServing.token,
                counter: nowServing.counter,
                firstName: s.privateClinic ? null : (nowServing.visit.patient.name.split(' ')[0] ?? null),
              }
            : null,
          waiting: own.filter((t) => t.status === 'WAITING').length,
          // Tokens only — the upcoming list never carries a name.
          upcoming: orderQueue(
            own.filter((t) => t.status === 'WAITING'),
            now,
          )
            .slice(0, 5)
            .map((t) => t.token),
        }
      }),
    })
  } catch (err) {
    next(err)
  }
})

/** Live event stream. Also public, for the same reason as the board. */
queueRoutes.get('/public/board/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const stationId = typeof req.query.station === 'string' ? req.query.station : null
  const unsubscribe = subscribe(res, stationId)
  req.on('close', unsubscribe)
})

/* ------------------------------------------------------------------ */
/* Visits                                                              */
/* ------------------------------------------------------------------ */

queueRoutes.get('/visits', requireAuth, async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'OPEN'
    const visits = await prisma.visit.findMany({
      where: { status: status as never },
      orderBy: { arrivedAt: 'desc' },
      take: 100,
      include: {
        patient: { select: { id: true, name: true, opNumber: true } },
        currentStation: { select: { id: true, name: true } },
        tickets: { orderBy: { issuedAt: 'desc' }, take: 1 },
      },
    })
    audit(req, { action: 'READ', entity: 'Visit' })
    res.json(visits)
  } catch (err) {
    next(err)
  }
})
