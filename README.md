# Uzima General Hospital — Staff Portal

A functioning Hospital Management System for a fictional Nairobi private
hospital: real PostgreSQL persistence, a Node/Express API, staff login with
role-based access, and a "Soft Industrial" meets "Calm Clinical" design
system — deep charcoal navigation, cool operating-room greys, one muted
teal/cyan accent, glass-morphic surfaces, spring-physics motion — built with
React, TypeScript, Tailwind CSS v4, Framer Motion, Express, and Prisma.

## What's here

- **Now Playing Dashboard** — the physician command view. A large bed-occupancy
  ring, computed live from real ward/patient data, sits in front of a
  slow-spinning ambient gradient blob that shifts hue with occupancy
  pressure, backed by ward breakdowns, computed metrics, and a resolvable
  live alert feed.
- **Split View Patient Record** — a 30/70 glass-panelled patient chart with a
  live patient search/select. Left pane: identity, live vitals, National ID,
  Next of Kin. Right pane: a Summary / Labs / Imaging / Billing tabbed record
  — lab review and billing status (KES, SHA / Imara Health Assurance /
  M-Pesa) are real, persisted mutations, role-gated to Physicians/Nurses and
  Billing staff respectively.
- **Smart Scheduling Grid** — a DAW-style horizontally scrollable surgical
  room timeline. Bookings are created and deleted for real against the API,
  with a server-side transactional overlap check — pill blocks visually merge
  (blurred, blended glow) when two bookings collide, and a "Schedule anyway"
  path forces an intentional double-booking.
- **Pharmacy** — a Kenyan formulary (KEML-flagged, KES unit prices) with
  batch-level stock. Physicians prescribe, pharmacists dispense; dispensing
  draws stock down **FEFO** (first-expiry-first-out), refuses expired batches,
  writes a signed stock-movement ledger and raises the billing line, all in one
  database transaction. Prescribing against a recorded allergy is refused
  unless the prescriber supplies an override reason, which is stored on the
  chart and in the audit log.
- **M-Pesa** — real Safaricom Daraja STK Push against a billing line, with a
  persisted transaction record, an idempotent callback endpoint, and a status
  query that recovers a payment whose callback was dropped. A line is only
  marked paid on a confirmed Safaricom result. With no credentials configured
  it runs in mock mode so the whole flow works offline.
- **Audit trail** — every mutation, every login (including failures), and every
  read of patient-level PHI is recorded append-only, with actor, IP, route and
  a field-level before/after diff. Credentials are redacted before they reach
  the table. Admin-only read API, including a per-patient access log for
  answering subject-access requests under the Data Protection Act 2019.
- **Staff login** — five roles (Admin, Physician, Nurse, Billing, Pharmacist),
  JWT session in an `httpOnly` cookie, no public self-registration.

## Architecture

```
src/
  components/
    atoms/       Button, Badge, Avatar, Checkbox, Skeleton, GlassPanel
    molecules/   StatRing, HeartbeatLine, Dropdown, TabBar, TableRow, SurgeryBlock,
                 MpesaCharge
    organisms/   Sidebar, NowPlayingDashboard, PatientRecordSplitView, SchedulingGrid,
                 MedicationsTab
  context/       AuthContext (React Query-backed session)
  pages/         LoginPage
  routes/        RequireAuth route guard
  lib/           apiClient, format (KES/date), occupancy, types

server/
  src/
    routes/      auth, patients, vitals, labs, imaging, billing, surgeries, wards,
                 dashboard, alerts, audit, mpesa, pharmacy
    middleware/  requireAuth, requireRole, auditLog, errorHandler
    lib/         prisma client, auth (bcrypt + JWT), audit, mpesa (Daraja), pharmacy (FEFO)
  tests/         checks.ts — unit checks for FEFO, M-Pesa and audit redaction
  prisma/        schema.prisma, seed.ts
```

Design tokens (color, type, radii, motion easing) live in `src/index.css` as
Tailwind v4 `@theme` variables — no default Tailwind palette, no default
system font, no off-the-shelf component library.

## Development

Requires a running PostgreSQL instance.

```bash
# one-time setup
createdb uzima_hms                     # or: see server/.env.example for the expected DATABASE_URL
npm install
npm --prefix server install
cp server/.env.example server/.env     # fill in DATABASE_URL / JWT_SECRET
npm --prefix server run prisma:migrate
npm --prefix server run seed

# day to day
npm run dev       # runs the Vite frontend (5173) and Express API (4000) together
npm run build     # type-check and build the frontend for production
npm run preview   # preview the production frontend build

npm --prefix server run test   # unit checks (no database required)
```

### M-Pesa

With `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` unset the server runs
M-Pesa in **mock mode**: an STK push is accepted and recorded, and the Billing
tab offers "Simulate paid" / "Simulate cancelled" controls that drive the same
settlement and audit path a real Safaricom callback would. Mock mode refuses to
start under `NODE_ENV=production`.

For real payments, create an app at
[developer.safaricom.co.ke](https://developer.safaricom.co.ke) and fill in the
`MPESA_*` values in `server/.env`. `MPESA_CALLBACK_URL` must be publicly
reachable over HTTPS; because Daraja carries no credentials, that path should
also be IP-restricted to Safaricom's published ranges at the reverse proxy.

### Audit trail

`GET /api/audit` (admin only) reads the log, `GET /api/audit/summary` gives
counts by action and the heaviest readers over a window, and
`GET /api/patients/:id/access-log` returns everything recorded against one
patient. There is deliberately no write, update or delete endpoint — the table
is append-only from the application's point of view.

### Demo accounts

Seeded by `server/prisma/seed.ts`, password `Passw0rd!` for all:

| Role | Email |
| --- | --- |
| Admin | `admin@uzimageneral.ke` |
| Physician | `a.njeri@uzimageneral.ke` |
| Nurse | `achieng.otieno@uzimageneral.ke` |
| Billing | `b.nyambura@uzimageneral.ke` |
| Pharmacist | `j.kariuki@uzimageneral.ke` |

Roles are enforced server-side: only physicians prescribe, only pharmacists
(and admins) dispense or move stock, only billing staff and admins raise
charges or send an M-Pesa request, and only admins read the audit log.
