# Uzima HMS — Architecture

Written for whoever picks this up next, human or agent. It explains **why**
things are the way they are. The code says what it does; this says what it is
protecting against.

Read this before changing anything in `server/src/lib/` or any route that
touches money, medication, or the audit trail. Those files encode decisions
that look arbitrary until you know the failure they prevent.

---

## 1. What this is

An HMS for a Kenyan hospital: outpatient and inpatient, from the reception
desk through triage, consultation, laboratory, radiology, pharmacy, the ward
drug round, the cash office, SHA claims and the tax invoice.

**Stack.** React 19 + TypeScript + Tailwind v4 (no component library, no
default palette) · Express + Prisma + PostgreSQL · everything in one repo,
`server/` for the API and `src/` for the SPA.

**Non-goals.** This is not a DICOM archive, not an interface engine, and not
an ERP. Where a real integration engine belongs (HL7 routing at scale), the
code says so rather than growing a bad one.

---

## 2. The three ideas everything else follows from

### 2.1 A machine may not write to the record unattended

Device readings, lab results and imaging all *stage* before they reach the
chart, and a human commits them.

- A patient monitor produces artefact constantly. A lead falls off and it
  reports asystole. `DeviceReading` holds it until a clinician confirms.
- A bench figure is not a result until a **second** technologist verifies it.
  The person who ran the test cannot verify it (`lab.routes.ts`).
- A radiographer cannot report on images they acquired.

If you are tempted to "simplify" by writing straight through, you are removing
a safety control, not a step.

### 2.2 Money only moves on evidence we did not generate

A billing line becomes `PAID` only from a confirmed Safaricom callback, a
cashier action with a receipt number, or a recorded SHA adjudication. Never
from optimism.

The cashier **cannot** settle by M-Pesa at the desk. It looks like a missing
feature; it is deliberate. Accepting "the customer says it went through" on
the clerk's word is how a cancelled prompt becomes revenue.

### 2.3 The audit trail is not logging

`AuditLog` is append-only and there is no update or delete path in the
application. It exists because the Data Protection Act 2019 requires the
facility to answer "who opened this chart, and when". Denials are logged as
loudly as successes — an unauthorised attempt to open a record is precisely
what the log is for.

Clinical staff can read any chart. That is correct for a hospital and is
**controlled by the audit trail, not by blocking access**. Don't "fix" it with
per-patient ACLs; you will break ward cover and night shifts.

### 2.4 Two cashiers must not settle one charge

Anything that changes money or a clinical record is guarded **in the database**,
not by a read-then-write check in application code.

The cash desk originally did `find` → "is it already paid?" → `update`. Six
concurrent payments for one KES 15,500 line produced **two receipts**. The
check passed for both because both read before either wrote.

Every settlement path now uses a conditional update — `updateMany` with the
expected status in the `WHERE` — and treats an affected-row count below
expectation as "someone else won", rolling the transaction back. Verified: 8
concurrent payments now yield 1 receipt and 7 rejections.

If you add a state transition that matters, guard it the same way. A pre-check
is for the error message; the `WHERE` clause is the safety.

---

## 3. Layout

```
server/src/
  lib/          Pure logic + external adapters. Unit-tested, no Express.
    queue.ts        triage-priority ordering, anti-starvation
    pharmacy.ts     FEFO allocation, allergy screening
    lab.ts          reference-range flagging, worklist order, dose frequency
    radiology.ts    pregnancy-check rule
    mpesa.ts        Daraja: signing, STK push, callback parsing
    sha.ts          claims adapter
    etims.ts        tax invoice adapter + VAT arithmetic
    hl7.ts          HL7 v2 reader + MLLP framing
    sequence.ts     atomic number allocation
    audit.ts        redaction, diffing, writer
  middleware/   Cross-cutting: auth, roles, audit, idempotency, security
  routes/       HTTP only. Validate, call lib, persist, audit, respond.
src/
  pages/        One screen per department
  components/
    ui/         THE design system. Everything a screen needs comes from here.
    print/      A4 documents — independent of the app theme, do not restyle
    atoms|molecules|organisms/  legacy; several are now adapters over ui/
  lib/          apiClient, offline outbox, formatting, useHotkeys
  routes/       navigation source of truth, guards, layout
```

**`components/ui` is the design system boundary.** If a screen is hand-rolling
a control, that is a gap to fill in `ui/`, not to style in place. The previous
UI had 341 arbitrary font sizes across 14 values and the same input class
string copy-pasted into eight files.

**The `lib/` boundary matters.** Anything with a rule worth arguing about
belongs there, pure and testable. `server/tests/checks.ts` runs 68 checks with
no database. If you put a clinical rule in a route handler, it becomes
untestable and someone will change it without noticing what it protected.

---

## 4. Decisions that will look wrong without the reason

### 4.1 The queue is not FIFO

`lib/queue.ts`. A bank calls in arrival order. A hospital that does so seats a
collapsing patient behind thirty routine reviews.

- **SATS acuity decides order**, arrival time only breaks ties. South African
  Triage Scale because Kenyan casualty units already use it.
- **Untriaged is treated as routine, never best-case.** Nobody jumps a triaged
  urgent patient by being unassessed.
- **Anti-starvation**: one band promoted per 45 minutes waited, capped so
  nothing ages into RED. Without this a trickle of urgent patients starves
  every routine one — the classic naive-priority-queue failure, and what makes
  people leave (which then shows up as LWBS rather than as a queueing bug).
- **Clinicians cannot cherry-pick.** "Call next" takes who it gives you.
  Letting a doctor choose would quietly undo the triage.

**`serviceDate` resets token numbering. It does not define who is waiting.**
The queue and board filter on ticket *status*. This was a bug once: patients
queueing at 23:55 vanished at midnight while their visits stayed open.

### 4.2 Every sequence goes through `Counter`

`lib/sequence.ts`. Ticket numbers, visit numbers, OP numbers, receipts and
claim references all allocate through a single-statement upsert-and-increment.

The obvious `count() + 1` is a lost-update race. Under READ COMMITTED two
clerks read the same maximum and one dies on the unique index. Measured: three
of five concurrent check-ins failed.

Two things to know:
- Allocate **inside the caller's transaction**, so a failed check-in rolls the
  number back instead of leaving a gap in the printed tokens.
- A migration that introduces a counter **must seed it from existing rows**.
  The first fix for this shipped without that and made things worse — the
  counter handed out 1 and collided with everything already there.

### 4.3 FEFO, not FIFO, for medicines

`lib/pharmacy.ts`. The constraint is the expiry date, not the receipt date. A
batch received later can expire sooner. Expired batches are never allocated
even when that fails the dispense.

### 4.4 Lab flags are derived, never typed

`lib/lab.ts#flagFor`. A typed flag drifts from the printed reference range and
the clinician has to decide which to believe. Qualitative tests have no
numeric bounds and the technologist sets the flag explicitly.

### 4.5 `dosesPerDay` returns `null` rather than guessing

A wrong dose count on a drug round is worse than an absent one: the eMAR shows
a round as complete when it is not. This bit twice — once because the seed
bypassed the parser, and Grace's BD + OD drugs read as "0/0", which a nurse
reads as nothing outstanding.

**If you add a prescribing path, derive `dosesPerDay` on it.**

### 4.6 The pregnancy window is deliberately wide

`lib/radiology.ts`. Ages 10–60, intersex included, unknown DOB errs towards
asking. An unnecessary question costs seconds; a missed one costs a fetal dose
that cannot be taken back. Do not narrow this to look tidier.

### 4.7 VAT is extracted, not added

`lib/etims.ts#splitTax`. Kenyan healthcare prices are quoted **inclusive**:
`taxable = total / 1.16`. Adding 16% to an inclusive price overcharges the
patient by ~16%. Most medical services are exempt, so exempt is the common
path, not the edge case.

---

## 4b. Interface decisions

The clinical screens are light, high-contrast and dense. Wards are brightly
lit; dark UI washes out under fluorescent glare. **Dark is reserved for
`/board`**, the corridor display, which is a 3-metre-viewing-distance product
and is deliberately excluded from every styling sweep.

Load-bearing rules:

- **Type is the safety layer.** Fixed scale, nothing below 12px, and 12px only
  for table meta — never a clinical value. Do not solve density by shrinking
  text; fix the information architecture.
- **Status never relies on colour alone.** Colour + icon + text, always. The
  old palette had `--color-status-warning` set to the same teal as the brand
  accent, so a warning looked like a button.
- **`PatientHeader` is sticky and non-dismissible** on patient-scoped screens.
  Wrong-patient error is the commonest serious error in hospital software.
- **No `window.prompt`.** Anything a regulator or controller reads later —
  dose omission, refusal, specimen rejection, fee waiver — uses `ReasonDialog`
  with coded options, because free text cannot be counted or charted.
- **Errors persist, successes auto-clear.** A toast confirms state; it never
  replaces it. If a row changed, the row shows it too.
- **Keyboard first on high-volume desks.** `/` search, arrows, Enter, Esc,
  `g`+letter route jumps. No Ctrl/Cmd combination is claimed — those belong to
  the browser and the screen reader.

## 5. Payments — read this before touching `mpesa.routes.ts`

### The hole that was there

The callback was unauthenticated "because Daraja carries no credentials". A
clerk starts a genuine push, the response handed the browser the
`CheckoutRequestID`, and an unauthenticated POST with that ID and
`ResultCode: 0` marked a **KES 15,500 bill PAID** while claiming KES 1 was
paid. Reproduced end to end.

### The four controls now in place

1. **Secret path segment.** Daraja has no signature, so the URL *is* the
   authentication: `/api/mpesa/callback/<MPESA_CALLBACK_SECRET>`. A wrong
   secret returns **404, not 403** — do not confirm the endpoint exists.
2. **Source IP allowlist**, enforced in code rather than left to the proxy.
3. **Amount verification.** A callback that reports a different amount than we
   pushed fails the transaction and is logged. Never settle on the amount the
   caller claims.
4. **The `CheckoutRequestID` is never returned to the browser.** It is the one
   secret an attacker needs.

The process **refuses to start** in production without the secret and
allowlist (`middleware/security.ts#assertCallbackSecurity`). A warning in a log
is not read at 2am, and the gap between deploy and discovery is when the money
moves.

### Adapter pattern

M-Pesa, SHA and eTIMS all: run mocked when unconfigured, expose the mock state
to the UI, and **throw rather than pretend under `NODE_ENV=production`**. Keep
that property. A silent mock in production is a system that reports revenue
that does not exist.

---

## 6. Offline

`src/lib/offline.ts`, `public/sw.js`, `server/src/middleware/idempotency.ts`.

**"Works offline" does not mean "queue everything".** An action may be queued
only if it is *additive* and its correctness does not depend on state the
device cannot see.

| Queued | Refused with a reason |
|---|---|
| Observations | Payments — stale balance |
| Triage assessments | Dispensing — needs live stock |
| Drug administrations | Lab verification — needs the live chain |
| | Prescribing, queue calls |

The nurse gave the dose whether or not the link was up; refusing to chart it
makes the record *less* true. Taking money against a balance from three hours
ago does not.

- Flush is **oldest-first and strictly sequential**. Observations are ordered
  clinical events; replaying them out of order produces a chart that reads
  wrong even when every row is right.
- The client generates an `Idempotency-Key` **when the clinician acts** and
  reuses it on every retry. An interrupted sync is safe to replay.
- Cached reads carry `X-From-Cache`. Silent stale data in a clinical system is
  a safety problem. Nothing financial is cached.
- Rejected items are **kept for review**, not dropped.

---

## 7. Devices

`lib/hl7.ts`, `lib/mllp-server.ts`. HL7 v2 over MLLP — what monitors and bench
analysers actually speak.

- MLLP framing is incremental: TCP has no message boundaries, so one read can
  hold half a message or three.
- Every message is **persisted raw before parsing**. When a monitor sends
  something we cannot understand, that row is the only way to find out what it
  said.
- An **ACK is always returned**, including on failure. An un-ACKed device
  retries, then alarms, then stops sending.
- Unregistered senders are refused with `AR` and logged.
- The listener is **off by default** (`HL7_MLLP_ENABLED`). Bind it only where
  the biomedical VLAN reaches.

---

## 7b. Performance

Sized for a facility that accumulates records for years, not for the seed
volume. Every index in `20260820170000_search_and_scale_indexes` came from a
query plan, not a guess.

- **Patient search was a sequential scan.** Reception searches with
  `ILIKE '%term%'`, which no btree index can serve. At 122 rows that is
  invisible; at 200,000 — an ordinary decade for a mid-size hospital — it is a
  full table scan per keystroke, per desk, concurrently. Fixed with `pg_trgm`
  GIN indexes; the plan is now a Bitmap Index Scan.
- **Chart reads are bounded.** A monitored ICU patient generates hundreds of
  observations a day and the chart only renders the recent ones.
- **Partial indexes for worklists**, so the index tracks open work rather than
  the archive.
- **Route-level code splitting.** Initial bundle 590 KB → 292 KB (172 → 88.5 KB
  gzipped). Login and dashboard are eager; nothing else is, because no user
  visits all seventeen screens.

Hospital workstations are old and connections are poor. Treat payload size as
a clinical constraint, not a nicety.

## 8. Migrations — two traps

1. **`ALTER TYPE ... ADD VALUE` needs its own migration.** PostgreSQL refuses
   to use a new enum value in the transaction that adds it. Prisma runs each
   migration in its own transaction, so split it. See
   `20260819135000_patient_status_registered`.
2. **Changing a model default silently breaks the seed.** Moving
   `PatientStatus` default to `REGISTERED` made every seeded patient an
   outpatient and emptied every ward, because the seed set `admittedAt` and
   relied on the old default. Set values explicitly in seeds.

Migrations are generated offline with
`prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel <new> --script`,
which needs no database.

---

## 9. Testing

`npm --prefix server test` — 68 checks, no database, runs in about a second.
Covers the rules where a quiet mistake is expensive: FEFO, allergy matching,
M-Pesa phone/timestamp/callback handling, audit redaction, queue ordering,
HL7 parsing and MLLP framing, lab flagging, dose frequency, radiation safety.

**What is not covered, honestly:** no integration tests, no browser tests, and
nothing has been under concurrent load beyond the manual check-in test. Every
bug in section 10 was found by *running the system*, not by a test. If you add
one kind of test, make it an end-to-end pass over the outpatient journey.

---

## 10. Bugs found by running it — the pattern is worth knowing

None of these were caught by typecheck or unit tests:

| Bug | Why it mattered |
|---|---|
| "Route onward" discharged the patient | Button did the opposite of its label |
| Open visits vanished at midnight | Patients invisible on a 24h casualty floor |
| Concurrent check-ins failed ~50% | Two clerks could not work at once |
| Ticket completable twice | One patient in the next queue twice |
| `dosesPerDay` null in seed | Drug round read "0/0" — nothing outstanding |
| Seed status regression | Every ward read empty |
| Idempotency store threw in `res.json` | Successful writes returned 500 |
| Forged M-Pesa callback | Any bill settleable without payment |
| Two cashiers settling one line | Two receipts for one KES 15,500 charge |
| Patient search seq-scanning | Full table scan per keystroke at scale |

**Run the thing.** Typecheck and unit tests will not find this class of bug.

---

## 11. Known gaps

- **No integration or browser tests.**
- **JWTs cannot be revoked.** 12h expiry, no `jti`, no deny-list. A stolen
  token is valid until it expires.
- **No PHI encryption at rest** beyond whatever the database provides.
- **SHA and eTIMS are unvalidated against real endpoints.** The lifecycle is
  real; the wire format is a best guess behind an adapter.
- **HL7 is untested against physical hardware.** Vendor quirks are certain.
- **No DICOM.** Radiology records reports, not images.
- **Kiswahili TTS** depends on a browser voice most machines lack. The chime
  and on-screen token are the mechanism; speech is a bonus.
- **No backup/restore or DR runbook.**
- **Single Postgres instance**, no read replicas or connection pooler.

---

## 12. If you are an agent picking this up

1. **Run it before changing it.** `npm run dev`, log in, click through the
   journey. Section 10 is why.
2. **Clinical rules live in `server/src/lib/`.** Add tests there.
3. **Never weaken a control to make a flow smoother.** Two-person
   verification, the witness requirement, the pregnancy check and the payment
   evidence rule are all load-bearing. If one is in your way, say so rather
   than removing it.
4. **After `prisma generate`, restart the dev server fully.** `tsx watch`
   reloads source but keeps the old client in memory, and you will chase a
   phantom "property does not exist" for twenty minutes.
5. **Report what you verified and what you did not.** Half this document
   exists because something was assumed to work and wasn't.
