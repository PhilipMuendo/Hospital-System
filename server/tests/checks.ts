/**
 * Unit checks for the pure logic behind stock allocation, M-Pesa message
 * handling and audit redaction — the parts where a quiet mistake is expensive
 * and no database is needed to catch it.
 *
 * Run with: npm --prefix server run test
 */
import assert from 'node:assert/strict'
import { allocateFefo, allergyConflicts, availableQuantity, expiringSoon } from '../src/lib/pharmacy.js'
import {
  nairobiTimestamp,
  normalisePhone,
  parseMpesaDate,
  parseStkCallback,
  statusForResultCode,
  stkPassword,
} from '../src/lib/mpesa.js'
import { diff, redact } from '../src/lib/audit.js'
import {
  STARVATION_MINUTES,
  effectivePriority,
  formatToken,
  isBreaching,
  nextInQueue,
  orderQueue,
  priorityFor,
  serviceDate,
} from '../src/lib/queue.js'
import {
  Hl7Message,
  MllpFramer,
  buildAck,
  parseHl7Date,
  parseOru,
  wrapMllp,
} from '../src/lib/hl7.js'

const now = new Date('2026-08-18T09:00:00Z')
const d = (iso: string) => new Date(iso)

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

console.log('\nFEFO allocation')
const batches = [
  { id: 'b-late', batchNumber: 'LATE', expiryDate: d('2027-06-01'), quantity: 100 },
  { id: 'b-soon', batchNumber: 'SOON', expiryDate: d('2026-10-01'), quantity: 30 },
  { id: 'b-dead', batchNumber: 'DEAD', expiryDate: d('2026-01-01'), quantity: 500 },
]

check('draws the earliest-expiring batch first', () => {
  const alloc = allocateFefo(batches, 10, now)
  assert.deepEqual(alloc, [
    { batchId: 'b-soon', batchNumber: 'SOON', expiryDate: d('2026-10-01').toISOString(), quantity: 10 },
  ])
})

check('spills into the next batch once the first is exhausted', () => {
  const alloc = allocateFefo(batches, 45, now)
  assert.equal(alloc.length, 2)
  assert.equal(alloc[0]!.batchNumber, 'SOON')
  assert.equal(alloc[0]!.quantity, 30)
  assert.equal(alloc[1]!.batchNumber, 'LATE')
  assert.equal(alloc[1]!.quantity, 15)
})

check('never allocates expired stock, even to satisfy a request', () => {
  // 500 expired units are on the shelf; only 130 are usable.
  assert.throws(() => allocateFefo(batches, 200, now), /Insufficient unexpired stock: 130 of 200/)
})

check('rejects a non-positive quantity', () => {
  assert.throws(() => allocateFefo(batches, 0, now), /at least 1/)
})

check('availableQuantity excludes expired batches', () => {
  assert.equal(availableQuantity(batches, now), 130)
})

check('expiringSoon counts only the 90-day window', () => {
  assert.equal(expiringSoon(batches, 90, now), 30)
  assert.equal(expiringSoon(batches, 30, now), 0)
})

console.log('\nAllergy screening')
check('flags a substring generic match', () => {
  assert.deepEqual(allergyConflicts(['Penicillin'], { genericName: 'Benzylpenicillin' }), ['Penicillin'])
})
check('flags a brand-name match', () => {
  assert.deepEqual(allergyConflicts(['Lasix'], { genericName: 'Furosemide', brandName: 'Lasix' }), ['Lasix'])
})
check('strips a trailing qualifier before matching', () => {
  assert.deepEqual(allergyConflicts(['Sulfa drugs'], { genericName: 'Sulfamethoxazole' }), ['Sulfa drugs'])
})
check('does not flag an unrelated drug', () => {
  assert.deepEqual(allergyConflicts(['Penicillin', 'Shellfish'], { genericName: 'Furosemide' }), [])
})
check('ignores allergy strings too short to be safe to match on', () => {
  assert.deepEqual(allergyConflicts(['Nut'], { genericName: 'Nutmeg extract' }), [])
})

console.log('\nM-Pesa')
check('normalises every phone shape staff actually type', () => {
  for (const input of ['0722118904', '+254 722 118 904', '254722118904', '722118904', '0722-118-904']) {
    assert.equal(normalisePhone(input), '254722118904', input)
  }
})
check('accepts the 011 Airtel/Faiba range', () => {
  assert.equal(normalisePhone('0110123456'), '254110123456')
})
check('rejects a number that is not a Kenyan mobile', () => {
  assert.throws(() => normalisePhone('0202221000'), /not a valid Kenyan mobile/)
  assert.throws(() => normalisePhone('07221189'), /not a valid Kenyan mobile/)
})
check('timestamps in Nairobi time regardless of server timezone', () => {
  // 09:00 UTC is 12:00 in Nairobi.
  assert.equal(nairobiTimestamp(new Date('2026-08-18T09:00:00Z')), '20260818120000')
  // 23:00 UTC is 02:00 the following day.
  assert.equal(nairobiTimestamp(new Date('2026-08-18T23:00:00Z')), '20260819020000')
})
check('builds the documented base64 password', () => {
  assert.equal(
    stkPassword('174379', 'passkey', '20260818120000'),
    Buffer.from('174379passkey20260818120000').toString('base64'),
  )
})
check('parses the Daraja transaction date as Nairobi local time', () => {
  assert.equal(parseMpesaDate(20260818153012)?.toISOString(), '2026-08-18T12:30:12.000Z')
  assert.equal(parseMpesaDate('not-a-date'), null)
  assert.equal(parseMpesaDate(null), null)
})
check('flattens a successful STK callback', () => {
  const parsed = parseStkCallback({
    Body: {
      stkCallback: {
        MerchantRequestID: '29115-34620561-1',
        CheckoutRequestID: 'ws_CO_191220191020363925',
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 2801 },
            { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
            { Name: 'TransactionDate', Value: 20260818153012 },
            { Name: 'PhoneNumber', Value: 254722118904 },
          ],
        },
      },
    },
  })
  assert.equal(parsed?.resultCode, '0')
  assert.equal(parsed?.mpesaReceiptNumber, 'NLJ7RT61SV')
  assert.equal(parsed?.amount, 2801)
  assert.equal(parsed?.phone, '254722118904')
})
check('flattens a cancelled callback that carries no metadata', () => {
  const parsed = parseStkCallback({
    Body: {
      stkCallback: {
        CheckoutRequestID: 'ws_CO_1',
        ResultCode: 1032,
        ResultDesc: 'Request cancelled by user',
      },
    },
  })
  assert.equal(parsed?.resultCode, '1032')
  assert.equal(parsed?.mpesaReceiptNumber, undefined)
  assert.equal(statusForResultCode(parsed!.resultCode), 'CANCELLED')
})
check('returns null for a payload that is not an STK callback', () => {
  assert.equal(parseStkCallback({ hello: 'world' }), null)
})
check('maps result codes to distinguishable outcomes', () => {
  assert.equal(statusForResultCode('0'), 'SUCCESS')
  assert.equal(statusForResultCode('1032'), 'CANCELLED')
  assert.equal(statusForResultCode('1037'), 'TIMEOUT')
  assert.equal(statusForResultCode('1'), 'FAILED')
})

console.log('\nAudit')
check('redacts credentials at any depth', () => {
  const out = redact({ email: 'a@b.ke', password: 'hunter2', nested: { passwordHash: 'x', ok: 1 } }) as Record<string, unknown>
  assert.equal(out.password, '[redacted]')
  assert.equal((out.nested as Record<string, unknown>).passwordHash, '[redacted]')
  assert.equal((out.nested as Record<string, unknown>).ok, 1)
  assert.equal(out.email, 'a@b.ke')
})
check('diffs only the fields that moved', () => {
  assert.deepEqual(diff({ status: 'PENDING', code: 'X' }, { status: 'PAID', code: 'X' }), {
    status: { from: 'PENDING', to: 'PAID' },
  })
  assert.equal(diff({ a: 1 }, { a: 1 }), undefined)
})

console.log('\nHL7 / MLLP')

const ORU = [
  'MSH|^~\&|PHILIPS_MX450_A|UZIMA|UZIMA_HMS|UZIMA|20260819132500||ORU^R01|MSG42|P|2.5',
  'PID|1||IP/2026/04471^^^UZIMA^PI||Mwangi^Grace^Wanjiru||19790614|F',
  'OBR|1||MX450|VITALS^Vital Signs^MDC|||20260819132500',
  'OBX|1|NM|MDC_PULS^Heart Rate^MDC||96|/min|60-100||||F|||20260819132500',
  'OBX|2|NM|MDC_SAT_O2^SpO2^MDC||91|%|95-100|L|||F|||20260819132500',
  'OBX|3|NM|MDC_TEMP^Temperature^MDC||37.4|Cel|36.1-37.8||||D|||20260819132500',
].join('\r')

check('reads MSH routing fields, offset by the separator', () => {
  const m = new Hl7Message(ORU)
  assert.equal(m.messageType, 'ORU^R01')
  assert.equal(m.controlId, 'MSG42')
  assert.equal(m.sendingApplication, 'PHILIPS_MX450_A')
})
check('accepts newline as a segment separator, which real devices send', () => {
  const m = new Hl7Message(ORU.replace(/\r/g, '\n'))
  assert.equal(m.controlId, 'MSG42')
})
check('rejects anything that is not an HL7 message', () => {
  assert.throws(() => new Hl7Message('{"not":"hl7"}'))
})
check('extracts observations and drops retracted results', () => {
  const oru = parseOru(new Hl7Message(ORU))
  assert.equal(oru.patientIdentifier, 'IP/2026/04471')
  assert.equal(oru.patientName, 'Grace Mwangi')
  // OBX-3 carries result status 'D' (deleted) and must not become a vital sign.
  assert.equal(oru.observations.length, 2)
  assert.equal(oru.observations[1].code, 'MDC_SAT_O2')
  assert.equal(oru.observations[1].value, '91')
  assert.equal(oru.observations[1].abnormalFlag, 'L')
})
check('reads an HL7 timestamp as Nairobi time when no offset is given', () => {
  assert.equal(parseHl7Date('20260819132500')?.toISOString(), '2026-08-19T10:25:00.000Z')
  assert.equal(parseHl7Date('20260819132500+0000')?.toISOString(), '2026-08-19T13:25:00.000Z')
  assert.equal(parseHl7Date('rubbish'), null)
})
check('builds an ACK that echoes the control id', () => {
  const ack = buildAck(new Hl7Message(ORU), 'AA')
  assert.ok(ack.includes('MSA|AA|MSG42'))
  // The ACK must name us as the sender and the device as the receiver.
  assert.ok(ack.startsWith('MSH|'))
  assert.ok(ack.includes('|UZIMA_HMS|UZIMA|PHILIPS_MX450_A|'))
})
check('builds a rejection ACK even with no parseable original', () => {
  assert.ok(buildAck(null, 'AR', 'bad').includes('MSA|AR|UNKNOWN|bad'))
})
check('strips HL7 delimiters out of ACK error text', () => {
  const ack = buildAck(null, 'AE', 'a|b^c&d')
  assert.equal(ack.split('\r')[1], 'MSA|AE|UNKNOWN|a b c d')
})

check('reassembles one MLLP frame split across TCP reads', () => {
  const framer = new MllpFramer()
  const whole = wrapMllp('MSH|^~\&|A')
  assert.deepEqual(framer.push(whole.subarray(0, 6)), [])
  assert.deepEqual(framer.push(whole.subarray(6)), ['MSH|^~\&|A'])
})
check('splits several frames arriving in one read', () => {
  const framer = new MllpFramer()
  const buf = Buffer.concat([wrapMllp('one'), wrapMllp('two'), wrapMllp('three')])
  assert.deepEqual(framer.push(buf), ['one', 'two', 'three'])
})
check('discards leading noise before the start byte', () => {
  const framer = new MllpFramer()
  const buf = Buffer.concat([Buffer.from('garbage'), wrapMllp('clean')])
  assert.deepEqual(framer.push(buf), ['clean'])
})
check('does not hoard unbounded junk from a misbehaving device', () => {
  const framer = new MllpFramer(64)
  assert.deepEqual(framer.push(Buffer.alloc(200, 0x41)), [])
  // Buffer was dropped, so a following good frame still parses.
  assert.deepEqual(framer.push(wrapMllp('ok')), ['ok'])
})

console.log('\nQueue ordering')

const T0 = new Date('2026-08-19T09:00:00+03:00')
const minsAgo = (n: number) => new Date(T0.getTime() - n * 60000)
const tk = (id: string, priority: number, waitedMins: number, callCount = 0) => ({
  id,
  priority,
  issuedAt: minsAgo(waitedMins),
  status: 'WAITING',
  callCount,
})

check('acuity beats arrival order', () => {
  // The bank behaviour would seat "early" first; a hospital must not.
  const q = orderQueue([tk('early', priorityFor('GREEN'), 30), tk('sick', priorityFor('ORANGE'), 1)], T0)
  assert.equal(q[0].id, 'sick')
})
check('arrival order decides within the same acuity', () => {
  const q = orderQueue([tk('later', 2, 5), tk('earlier', 2, 25)], T0)
  assert.equal(q[0].id, 'earlier')
})
check('an untriaged patient is routine, never best-case', () => {
  assert.equal(priorityFor(null), priorityFor('GREEN'))
  assert.ok(priorityFor(null) > priorityFor('YELLOW'))
})
check('waiting promotes one band per starvation interval', () => {
  assert.equal(effectivePriority(tk('a', 3, 0), T0), 3)
  assert.equal(effectivePriority(tk('a', 3, STARVATION_MINUTES), T0), 2)
  assert.equal(effectivePriority(tk('a', 3, STARVATION_MINUTES * 2), T0), 1)
})
check('waiting never promotes anyone into the RED band', () => {
  // RED means physiologically critical, not "here a long time".
  assert.equal(effectivePriority(tk('a', 3, STARVATION_MINUTES * 20), T0), 1)
})
check('a long-waiting routine patient overtakes a fresh urgent one', () => {
  const q = orderQueue([tk('fresh-yellow', 2, 1), tk('stale-green', 3, 100)], T0)
  assert.equal(q[0].id, 'stale-green')
})
check('but a critical arrival still pre-empts everyone', () => {
  const q = orderQueue([tk('stale-green', 3, 600), tk('red', 0, 0)], T0)
  assert.equal(q[0].id, 'red')
})
check('someone already called is re-called before an untouched peer', () => {
  const q = orderQueue([tk('untouched', 2, 20), tk('stepped-out', 2, 10, 1)], T0)
  assert.equal(q[0].id, 'stepped-out')
})
check('tickets not waiting are excluded from the queue', () => {
  const done = { ...tk('done', 0, 5), status: 'COMPLETED' }
  assert.equal(nextInQueue([done], T0), null)
})
check('an empty queue yields nobody rather than throwing', () => {
  assert.equal(nextInQueue([], T0), null)
})

check('flags a patient past their SATS target', () => {
  // ORANGE target is 10 minutes.
  assert.equal(isBreaching({ issuedAt: minsAgo(5) }, 'ORANGE', T0), false)
  assert.equal(isBreaching({ issuedAt: minsAgo(30) }, 'ORANGE', T0), true)
  // GREEN has four hours before it breaches.
  assert.equal(isBreaching({ issuedAt: minsAgo(30) }, 'GREEN', T0), false)
  assert.equal(isBreaching({ issuedAt: minsAgo(600) }, null, T0), false)
})

check('service day is Nairobi-local, not UTC', () => {
  // 22:30 UTC is already the next day in Nairobi.
  assert.equal(serviceDate(new Date('2026-08-19T22:30:00Z')), '2026-08-20')
  assert.equal(serviceDate(new Date('2026-08-19T05:00:00Z')), '2026-08-19')
})
check('pads tokens so they line up on the board', () => {
  assert.equal(formatToken('C', 7), 'C-007')
  assert.equal(formatToken('C', 142), 'C-142')
})

console.log(`\n${passed} checks passed.\n`)
