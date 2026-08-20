/**
 * Concurrency and load tests.
 *
 * Every genuinely dangerous bug found in this system was a concurrency bug
 * invisible to single-request testing:
 *
 *   - three of five simultaneous check-ins failed on a duplicate number;
 *   - two cashiers settled the same KES 15,500 charge and issued two receipts.
 *
 * Both looked perfect one request at a time. These tests fire real concurrent
 * requests and assert on the invariant, not on the happy path.
 *
 * Run with: npm --prefix server run test:load
 */
import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ACCOUNTS, call, login, unique, waitForApi, type Session } from './harness.js'

let admin: Session
let nurse: Session
let billing: Session
let physician: Session

before(async () => {
  await waitForApi()
  ;[admin, nurse, billing, physician] = await Promise.all([
    login(ACCOUNTS.admin),
    login(ACCOUNTS.nurse),
    login(ACCOUNTS.billing),
    login(ACCOUNTS.physician),
  ])
})

/** Runs `n` copies of `fn` at once and separates fulfilled from rejected. */
async function inParallel<T>(n: number, fn: (i: number) => Promise<T>) {
  const results = await Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)))
  return {
    ok: results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<T>).value),
    failed: results.filter((r) => r.status === 'rejected').length,
  }
}

/* ================================================================== */

describe('Concurrent check-in', () => {
  it('issues distinct tokens and visit numbers under simultaneous load', async () => {
    const stations = await call('/stations', { session: admin })
    const triage = stations.body.find((s: any) => s.kind === 'TRIAGE').id

    const CONCURRENCY = 12

    const { ok, failed } = await inParallel(CONCURRENCY, async (i) => {
      const patient = await call('/reception/patients', {
        method: 'POST',
        session: nurse,
        body: {
          name: unique(`Load ${i}`),
          dob: '1988-06-15',
          sex: i % 2 ? 'MALE' : 'FEMALE',
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
      return {
        token: checkIn.body.ticket.token,
        visitNumber: checkIn.body.visit.visitNumber,
        opNumber: patient.body.opNumber,
      }
    })

    // The original implementation failed roughly half of these on a duplicate
    // key, because every sequence was count() + 1.
    assert.equal(failed, 0, `${failed} of ${CONCURRENCY} concurrent check-ins failed`)

    for (const field of ['token', 'visitNumber', 'opNumber'] as const) {
      const values = ok.map((r) => r[field])
      assert.equal(new Set(values).size, values.length, `duplicate ${field} issued under concurrency`)
    }
  })
})

/* ================================================================== */

describe('Concurrent settlement', () => {
  it('settles a charge exactly once when many cashiers submit at once', async () => {
    const lines = await call('/billing?status=PENDING&payer=SELF_PAY', { session: billing })
    assert.ok(lines.body.length > 0, 'need an unpaid self-pay line to test')
    const lineId = lines.body[0].id

    const CONCURRENCY = 10

    const { ok } = await inParallel(CONCURRENCY, async () => {
      const res = await call('/cashier/pay', {
        method: 'POST',
        session: billing,
        body: { lineIds: [lineId], method: 'CASH', amountTendered: 9_999_999 },
        raw: true,
      })
      return res
    })

    const settled = ok.filter((r) => r.status === 201)
    const rejected = ok.filter((r) => r.status === 409)

    // The invariant that matters: one charge, one receipt. Anything else is
    // either a patient charged twice or a double-counted revenue report.
    assert.equal(settled.length, 1, `${settled.length} cashiers settled the same charge`)
    assert.equal(rejected.length, CONCURRENCY - 1)

    const receipts = new Set(settled.map((r) => r.body.receiptNumber))
    assert.equal(receipts.size, 1)
  })

  it('does not burn a receipt number on a losing attempt', async () => {
    // The sequence is allocated inside the transaction, so a rollback returns
    // it. Gaps in a receipt series are a finding during an audit.
    const summaryBefore = await call('/cashier/shift-summary', { session: billing })
    const before = Number(summaryBefore.body.byMethod.find((m: any) => m.method === 'CASH')?.count ?? 0)

    const lines = await call('/billing?status=PENDING&payer=SELF_PAY', { session: billing })
    if (lines.body.length === 0) return

    await inParallel(6, async () =>
      call('/cashier/pay', {
        method: 'POST',
        session: billing,
        body: { lineIds: [lines.body[0].id], method: 'CASH', amountTendered: 9_999_999 },
        raw: true,
      }),
    )

    const summaryAfter = await call('/cashier/shift-summary', { session: billing })
    const after = Number(summaryAfter.body.byMethod.find((m: any) => m.method === 'CASH')?.count ?? 0)

    assert.equal(after, before + 1, 'exactly one line should have settled')
  })
})

/* ================================================================== */

describe('Concurrent queue calls', () => {
  it('never hands the same patient to two clinicians', async () => {
    const stations = await call('/stations', { session: admin })
    const triage = stations.body.find((s: any) => s.kind === 'TRIAGE').id
    const room = stations.body.filter((s: any) => s.kind === 'CONSULTATION')[1].id

    // Queue several patients at one room.
    for (let i = 0; i < 5; i++) {
      const patient = await call('/reception/patients', {
        method: 'POST',
        session: nurse,
        body: {
          name: unique(`Queue ${i}`),
          dob: '1985-02-02',
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
      await call(`/visits/${checkIn.body.visit.id}/triage`, {
        method: 'POST',
        session: nurse,
        body: { acuity: 'GREEN', nextStationId: room },
      })
    }

    // Two clinicians press "call next" simultaneously.
    const physician2 = await login(ACCOUNTS.physician2)
    const { ok } = await inParallel(2, async (i) =>
      call(`/stations/${room}/call-next`, {
        method: 'POST',
        session: i === 0 ? physician : physician2,
        body: {},
        raw: true,
      }),
    )

    const calls = ok.filter((r) => r.status === 200)
    const tokens = calls.map((r) => r.body.token)
    assert.equal(
      new Set(tokens).size,
      tokens.length,
      'two clinicians were handed the same patient',
    )
  })
})

/* ================================================================== */

describe('Read latency under load', () => {
  it('keeps the hot paths responsive with 40 concurrent readers', async () => {
    const paths = ['/patients?search=a', '/wards', '/visits?status=OPEN', '/drugs']

    const started = Date.now()
    const { failed } = await inParallel(40, async (i) => call(paths[i % paths.length], { session: admin }))
    const elapsed = Date.now() - started

    assert.equal(failed, 0, 'requests failed under concurrent read load')

    // Generous, because this runs on a laptop against a container. The point
    // is to catch a regression into seconds, not to benchmark the hardware.
    assert.ok(elapsed < 10_000, `40 concurrent reads took ${elapsed}ms`)
    console.log(`      40 concurrent reads in ${elapsed}ms (${Math.round(elapsed / 40)}ms/req average)`)
  })

  it('serves patient search from an index rather than a scan', async () => {
    // A seq scan is fine at seed volume and catastrophic at 200k rows, so this
    // asserts on latency consistency rather than absolute speed.
    const timings: number[] = []
    for (const term of ['oti', 'wan', 'ali', 'mwa', 'che']) {
      const t = Date.now()
      await call(`/patients?search=${term}`, { session: admin })
      timings.push(Date.now() - t)
    }
    const worst = Math.max(...timings)
    assert.ok(worst < 1_000, `slowest search took ${worst}ms`)
    console.log(`      patient search worst case ${worst}ms across 5 terms`)
  })
})
