/**
 * End-to-end tests over the real HTTP API.
 *
 * These exist because every serious bug in this system was found by running
 * it, not by typechecking it: a button that discharged patients instead of
 * routing them, open visits vanishing at midnight, concurrent check-ins
 * failing half the time, a forged callback settling a bill, two cashiers
 * settling one charge. None were catchable by unit tests.
 *
 * So the suite covers the journey a patient actually takes and, more
 * importantly, the safety controls that must hold at each step.
 *
 * Run with: npm --prefix server run test:e2e
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ACCOUNTS, call, login, unique, waitForApi, type Session } from './harness.js'

let admin: Session
let physician: Session
let nurse: Session
let billing: Session
let pharmacist: Session
let labTech: Session
let labTech2: Session

before(async () => {
  await waitForApi()
  ;[admin, physician, nurse, billing, pharmacist, labTech, labTech2] = await Promise.all([
    login(ACCOUNTS.admin),
    login(ACCOUNTS.physician),
    login(ACCOUNTS.nurse),
    login(ACCOUNTS.billing),
    login(ACCOUNTS.pharmacist),
    login(ACCOUNTS.labTech),
    login(ACCOUNTS.labTech2),
  ])
})

/* ================================================================== */

describe('Authentication', () => {
  it('rejects a wrong password', async () => {
    const res = await call('/auth/login', {
      method: 'POST',
      body: { email: ACCOUNTS.admin, password: 'wrong' },
      raw: true,
    })
    assert.equal(res.status, 401)
  })

  it('rejects an unauthenticated request to a protected route', async () => {
    const res = await call('/patients', { raw: true })
    assert.equal(res.status, 401)
  })

  it('does not leak whether an email exists', async () => {
    const unknown = await call('/auth/login', {
      method: 'POST',
      body: { email: 'nobody@nowhere.ke', password: 'x' },
      raw: true,
    })
    const known = await call('/auth/login', {
      method: 'POST',
      body: { email: ACCOUNTS.admin, password: 'wrong' },
      raw: true,
    })
    assert.equal(unknown.body.error, known.body.error)
  })
})

describe('Role boundaries', () => {
  it('keeps a lab technologist out of billing, audit and cashier', async () => {
    for (const path of ['/billing', '/audit', '/cashier/shift-summary', '/auth/users']) {
      const res = await call(path, { session: labTech, raw: true })
      assert.equal(res.status, 403, `${path} should be forbidden for LAB_TECH`)
    }
  })

  it('lets clinical staff read any chart — deliberate, and audited', async () => {
    const patients = await call('/patients?search=Grace', { session: labTech })
    assert.ok(patients.body.length > 0)
    const chart = await call(`/patients/${patients.body[0].id}`, { session: labTech, raw: true })
    assert.equal(chart.status, 200)
  })
})

/* ================================================================== */

describe('Outpatient journey', () => {
  let patientId: string
  let visitId: string
  let triageStationId: string
  let consultStationId: string
  let pharmacyStationId: string

  before(async () => {
    const stations = await call('/stations', { session: admin })
    triageStationId = stations.body.find((s: any) => s.kind === 'TRIAGE').id
    consultStationId = stations.body.find((s: any) => s.kind === 'CONSULTATION').id
    pharmacyStationId = stations.body.find((s: any) => s.kind === 'PHARMACY').id
  })

  it('registers a new patient and issues an OP number', async () => {
    const res = await call('/reception/patients', {
      method: 'POST',
      session: nurse,
      body: {
        name: unique('E2E Patient'),
        dob: '1991-04-12',
        sex: 'FEMALE',
        phone: '0722118904',
        nextOfKinName: 'Kin',
        nextOfKinPhone: '0733000111',
        nextOfKinRelation: 'Sibling',
      },
    })
    assert.equal(res.status, 201)
    assert.match(res.body.opNumber, /^OP\/\d{4}\/\d{5}$/)
    // Registration is not admission.
    assert.equal(res.body.status, 'REGISTERED')
    assert.equal(res.body.ipNumber, null)
    patientId = res.body.id
  })

  it('checks the patient in and issues a queue token', async () => {
    const res = await call('/reception/check-in', {
      method: 'POST',
      session: nurse,
      body: { patientId, stationId: triageStationId, chiefComplaint: 'Headache for two days' },
    })
    assert.equal(res.status, 201)
    assert.match(res.body.ticket.token, /^T-\d{3}$/)
    assert.match(res.body.visit.visitNumber, /^OPD\/\d{4}\/\d{2}\/\d{4}$/)
    visitId = res.body.visit.id
  })

  it('refuses a second open visit for the same patient', async () => {
    const res = await call('/reception/check-in', {
      method: 'POST',
      session: nurse,
      body: { patientId, stationId: triageStationId },
      raw: true,
    })
    assert.equal(res.status, 409)
  })

  it('records triage and moves the patient to a consultation queue', async () => {
    const res = await call(`/visits/${visitId}/triage`, {
      method: 'POST',
      session: nurse,
      body: {
        acuity: 'YELLOW',
        temperature: '37.4',
        pulse: '92',
        bloodPressure: '128/82',
        spo2: '97',
        nextStationId: consultStationId,
      },
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.priority, 2, 'YELLOW must map to priority 2')
  })

  it('writes triage observations onto the chart', async () => {
    const vitals = await call(`/patients/${patientId}/vitals`, { session: nurse })
    const labels = vitals.body.map((v: any) => v.label)
    assert.ok(labels.includes('Temperature'))
    assert.ok(labels.includes('SpO2'))
  })

  it('calls the patient through and completes the consultation onward', async () => {
    const called = await call(`/stations/${consultStationId}/call-next`, {
      method: 'POST',
      session: physician,
      body: {},
    })
    assert.equal(called.body.status, 'CALLED')

    // The CheckoutRequestID equivalent for payments — the token — is fine to
    // expose, but the call must name a room.
    assert.ok(called.body.counter)

    await call(`/tickets/${called.body.id}/start`, { method: 'POST', session: physician })

    const done = await call(`/tickets/${called.body.id}/complete`, {
      method: 'POST',
      session: physician,
      body: { closeVisit: false, nextStationId: pharmacyStationId },
    })
    assert.ok(done.body.next, 'routing onward must issue a new ticket')
    assert.match(done.body.next.token, /^D-\d{3}$/)
  })

  it('refuses "route onward" with no destination rather than discharging', async () => {
    // The bug this replaced silently closed the visit.
    const queue = await call(`/stations/${pharmacyStationId}/queue`, { session: pharmacist })
    const ticket = queue.body.find((t: any) => t.visitId === visitId)
    assert.ok(ticket, 'patient should be queued at pharmacy')

    const res = await call(`/tickets/${ticket.id}/complete`, {
      method: 'POST',
      session: pharmacist,
      body: { closeVisit: false },
      raw: true,
    })
    assert.equal(res.status, 400)

    const visits = await call('/visits?status=OPEN', { session: admin })
    assert.ok(
      visits.body.some((v: any) => v.id === visitId),
      'visit must still be open after a refused completion',
    )
  })

  it('closes the visit explicitly', async () => {
    const queue = await call(`/stations/${pharmacyStationId}/queue`, { session: pharmacist })
    const ticket = queue.body.find((t: any) => t.visitId === visitId)
    await call(`/tickets/${ticket.id}/complete`, {
      method: 'POST',
      session: pharmacist,
      body: { closeVisit: true, outcome: 'Dispensed and discharged' },
    })

    const visits = await call('/visits?status=OPEN', { session: admin })
    assert.ok(!visits.body.some((v: any) => v.id === visitId))
  })
})

/* ================================================================== */

describe('Triage priority overrides arrival order', () => {
  it('orders the queue by acuity, not by who arrived first', async () => {
    const stations = await call('/stations', { session: admin })
    const triage = stations.body.find((s: any) => s.kind === 'TRIAGE').id
    // A room nobody else is using, so the assertion is not disturbed.
    const room = stations.body.filter((s: any) => s.kind === 'CONSULTATION').at(-1).id

    const acuities = ['GREEN', 'ORANGE', 'YELLOW'] as const
    const tokens: string[] = []

    for (const acuity of acuities) {
      const patient = await call('/reception/patients', {
        method: 'POST',
        session: nurse,
        body: {
          name: unique(`Acuity ${acuity}`),
          dob: '1990-01-01',
          sex: 'MALE',
          nextOfKinName: 'K',
          nextOfKinPhone: '0700000000',
          nextOfKinRelation: 'S',
        },
      })
      const checkIn = await call('/reception/check-in', {
        method: 'POST',
        session: nurse,
        body: { patientId: patient.body.id, stationId: triage },
      })
      const triaged = await call(`/visits/${checkIn.body.visit.id}/triage`, {
        method: 'POST',
        session: nurse,
        body: { acuity, nextStationId: room },
      })
      tokens.push(triaged.body.token)
    }

    const queue = await call(`/stations/${room}/queue`, { session: physician })
    const ours = queue.body.filter((q: any) => tokens.includes(q.token))

    assert.equal(ours[0].acuity, 'ORANGE', 'ORANGE arrived second but must be first')
    assert.equal(ours[1].acuity, 'YELLOW')
    assert.equal(ours[2].acuity, 'GREEN', 'GREEN arrived first but must be last')
  })
})

/* ================================================================== */

describe('Laboratory safety controls', () => {
  let itemId: string
  let patientId: string

  before(async () => {
    const patients = await call('/patients?search=Grace', { session: physician })
    patientId = patients.body[0].id
  })

  it('raises a charge at the moment the test is ordered', async () => {
    const tests = await call('/lab/tests', { session: physician })
    const potassium = tests.body.find((t: any) => t.code === 'CHEM-020')

    const before = await call(`/patients/${patientId}/billing`, { session: billing })
    const order = await call('/lab/orders', {
      method: 'POST',
      session: physician,
      body: {
        patientId,
        testIds: [potassium.id],
        urgency: 'STAT',
        clinicalNotes: 'On IV furosemide, checking for hypokalaemia',
      },
    })
    assert.equal(order.status, 201)
    itemId = order.body.items[0].id

    const after = await call(`/patients/${patientId}/billing`, { session: billing })
    assert.equal(after.body.length, before.body.length + 1, 'an order must bill')
  })

  it('refuses a result before the specimen is collected', async () => {
    const res = await call(`/lab/items/${itemId}/result`, {
      method: 'POST',
      session: labTech,
      body: { resultValue: '2.8' },
      raw: true,
    })
    assert.equal(res.status, 409)
  })

  it('derives the abnormal flag from the reference range', async () => {
    await call(`/lab/items/${itemId}/collect`, { method: 'POST', session: labTech, body: {} })
    const res = await call(`/lab/items/${itemId}/result`, {
      method: 'POST',
      session: labTech,
      body: { resultValue: '2.8' },
    })
    // 2.8 against a 3.5–5.1 range.
    assert.equal(res.body.flag, 'LOW')
  })

  it('refuses self-verification by the technologist who ran the test', async () => {
    const res = await call(`/lab/items/${itemId}/verify`, { method: 'POST', session: labTech, raw: true })
    assert.equal(res.status, 403)
  })

  it('publishes to the chart only after a second technologist verifies', async () => {
    const before = await call(`/patients/${patientId}/labs`, { session: physician })
    const res = await call(`/lab/items/${itemId}/verify`, { method: 'POST', session: labTech2 })
    assert.equal(res.status, 201)

    const after = await call(`/patients/${patientId}/labs`, { session: physician })
    assert.equal(after.body.length, before.body.length + 1)
    assert.equal(after.body[0].flag, 'LOW')
  })
})

/* ================================================================== */

describe('Medication administration', () => {
  let controlledItemId: string
  let patientId: string

  before(async () => {
    const patients = await call('/patients?search=Grace', { session: physician })
    patientId = patients.body[0].id

    const drugs = await call('/drugs', { session: physician })
    const controlled = drugs.body.find((d: any) => d.controlled && d.inStock > 0)

    const rx = await call(`/patients/${patientId}/prescriptions`, {
      method: 'POST',
      session: physician,
      body: {
        notes: 'E2E analgesia',
        items: [{ drugId: controlled.id, dose: '5mg', route: 'IV', frequency: 'QDS', quantityPrescribed: 4 }],
      },
    })
    controlledItemId = rx.body.items[0].id
  })

  it('refuses to chart a dose pharmacy has not dispensed', async () => {
    const res = await call(`/prescription-items/${controlledItemId}/administer`, {
      method: 'POST',
      session: nurse,
      body: { status: 'GIVEN' },
      raw: true,
    })
    assert.equal(res.status, 409)
  })

  it('requires a witness for a controlled drug', async () => {
    await call(`/prescription-items/${controlledItemId}/dispense`, {
      method: 'POST',
      session: pharmacist,
      body: { quantity: 4 },
    })

    const res = await call(`/prescription-items/${controlledItemId}/administer`, {
      method: 'POST',
      session: nurse,
      body: { status: 'GIVEN' },
      raw: true,
    })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /witness/i)
  })

  it('refuses the nurse as their own witness', async () => {
    const res = await call(`/prescription-items/${controlledItemId}/administer`, {
      method: 'POST',
      session: nurse,
      body: { status: 'GIVEN', witnessedById: nurse.user.id },
      raw: true,
    })
    assert.equal(res.status, 400)
  })

  it('requires a reason to omit a dose', async () => {
    const res = await call(`/prescription-items/${controlledItemId}/administer`, {
      method: 'POST',
      session: nurse,
      body: { status: 'OMITTED' },
      raw: true,
    })
    assert.equal(res.status, 400)
  })

  it('accepts a valid second signature and records it', async () => {
    const nurse2 = await login(ACCOUNTS.nurse2)
    const res = await call(`/prescription-items/${controlledItemId}/administer`, {
      method: 'POST',
      session: nurse,
      body: { status: 'GIVEN', witnessedById: nurse2.user.id },
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.status, 'GIVEN')
  })
})

/* ================================================================== */

describe('Radiation safety', () => {
  it('withholds an ionising exposure until pregnancy status is recorded', async () => {
    const radiographer = await login(ACCOUNTS.radiographer)
    const patients = await call('/patients?search=Amina', { session: physician })
    const patient = patients.body[0]

    const procedures = await call('/imaging/procedures', { session: physician })
    const ct = procedures.body.find((p: any) => p.code === 'RAD-018')

    const order = await call('/imaging/orders', {
      method: 'POST',
      session: physician,
      body: { patientId: patient.id, procedureId: ct.id, clinicalNotes: 'Headache, rule out bleed' },
    })

    const worklist = await call('/imaging/worklist', { session: radiographer })
    const entry = worklist.body.find((o: any) => o.id === order.body.id)
    assert.equal(entry.requiresPregnancyCheck, true)

    const unanswered = await call(`/imaging/orders/${order.body.id}/perform`, {
      method: 'POST',
      session: radiographer,
      body: {},
      raw: true,
    })
    assert.equal(unanswered.status, 400)

    for (const status of ['PREGNANT', 'UNKNOWN']) {
      const blocked = await call(`/imaging/orders/${order.body.id}/perform`, {
        method: 'POST',
        session: radiographer,
        body: { pregnancyStatus: status },
        raw: true,
      })
      assert.equal(blocked.status, 409, `${status} must withhold the exposure`)
    }
  })
})

/* ================================================================== */

describe('Payments', () => {
  it('refuses to settle M-Pesa at the cash desk', async () => {
    const lines = await call('/billing?status=PENDING&payer=SELF_PAY', { session: billing })
    const res = await call('/cashier/pay', {
      method: 'POST',
      session: billing,
      body: { lineIds: [lines.body[0].id], method: 'MPESA' },
      raw: true,
    })
    assert.equal(res.status, 400)
  })

  it('refuses cash short of the amount due', async () => {
    const lines = await call('/billing?status=PENDING&payer=SELF_PAY', { session: billing })
    const line = lines.body[0]
    const res = await call('/cashier/pay', {
      method: 'POST',
      session: billing,
      body: { lineIds: [line.id], method: 'CASH', amountTendered: 1 },
      raw: true,
    })
    assert.equal(res.status, 400)
  })

  it('refuses a waiver with no reason', async () => {
    const lines = await call('/billing?status=PENDING&payer=SELF_PAY', { session: billing })
    const res = await call('/cashier/pay', {
      method: 'POST',
      session: billing,
      body: { lineIds: [lines.body[0].id], method: 'WAIVER' },
      raw: true,
    })
    assert.equal(res.status, 400)
  })

  it('rejects a forged callback on the unsecured path', async () => {
    const res = await call('/mpesa/callback', {
      method: 'POST',
      body: {
        Body: {
          stkCallback: { CheckoutRequestID: 'ws_CO_forged', ResultCode: 0, ResultDesc: 'ok' },
        },
      },
      raw: true,
    })
    assert.equal(res.status, 404)
  })
})

/* ================================================================== */

describe('Offline replay protection', () => {
  it('applies a queued observation exactly once however many times it is delivered', async () => {
    const patients = await call('/patients?search=Grace', { session: nurse })
    const patientId = patients.body[0].id
    const key = unique('idem')

    const before = await call(`/patients/${patientId}/vitals`, { session: nurse })

    for (let i = 0; i < 3; i++) {
      const res = await call(`/patients/${patientId}/vitals`, {
        method: 'POST',
        session: nurse,
        headers: { 'Idempotency-Key': key },
        body: { label: 'Heart Rate', value: '74', unit: 'bpm', status: 'HEALTHY' },
      })
      assert.equal(res.status, 201)
      if (i > 0) assert.equal(res.headers.get('idempotent-replay'), 'true')
    }

    const after = await call(`/patients/${patientId}/vitals`, { session: nurse })
    assert.equal(after.body.length, before.body.length + 1, 'three deliveries, one row')
  })
})

/* ================================================================== */

describe('Audit trail', () => {
  it('records a denial as loudly as a success', async () => {
    await call('/audit', { session: labTech, raw: true })
    const audit = await call('/audit?action=DENIED', { session: admin })
    const rows = Array.isArray(audit.body) ? audit.body : (audit.body.rows ?? [])
    assert.ok(rows.length > 0, 'denied attempts must be logged')
  })

  it('never stores a password attempt', async () => {
    await call('/auth/login', {
      method: 'POST',
      body: { email: ACCOUNTS.admin, password: 'SuperSecretAttempt123' },
      raw: true,
    })
    const audit = await call('/audit?action=LOGIN_FAILED', { session: admin })
    const rows = Array.isArray(audit.body) ? audit.body : (audit.body.rows ?? [])
    const serialised = JSON.stringify(rows)
    assert.ok(!serialised.includes('SuperSecretAttempt123'), 'password attempt leaked into the audit log')
  })
})

after(() => {
  // Nothing to tear down: the suite runs against a disposable database that
  // the runner re-seeds on every invocation.
})
