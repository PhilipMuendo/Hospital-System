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
- **Staff login** — four roles (Admin, Physician, Nurse, Billing), JWT session
  in an `httpOnly` cookie, no public self-registration.

## Architecture

```
src/
  components/
    atoms/       Button, Badge, Avatar, Checkbox, Skeleton, GlassPanel
    molecules/   StatRing, HeartbeatLine, Dropdown, TabBar, TableRow, SurgeryBlock
    organisms/   Sidebar, NowPlayingDashboard, PatientRecordSplitView, SchedulingGrid
  context/       AuthContext (React Query-backed session)
  pages/         LoginPage
  routes/        RequireAuth route guard
  lib/           apiClient, format (KES/date), occupancy, types

server/
  src/
    routes/      auth, patients, vitals, labs, imaging, billing, surgeries, wards, dashboard, alerts
    middleware/  requireAuth, requireRole, errorHandler
    lib/         prisma client, auth (bcrypt + JWT)
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
```

### Demo accounts

Seeded by `server/prisma/seed.ts`, password `Passw0rd!` for all:

| Role | Email |
| --- | --- |
| Admin | `admin@uzimageneral.ke` |
| Physician | `a.njeri@uzimageneral.ke` |
| Nurse | `achieng.otieno@uzimageneral.ke` |
| Billing | `b.nyambura@uzimageneral.ke` |
