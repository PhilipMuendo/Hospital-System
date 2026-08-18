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

console.log(`\n${passed} checks passed.\n`)
