# Meridian — Hospital Command

A design-system-driven Hospital Management System interface. "Soft Industrial"
meets "Calm Clinical": deep charcoal navigation, cool operating-room greys,
one muted teal/cyan accent, glass-morphic surfaces, and spring-physics motion
throughout — built with React, TypeScript, Tailwind CSS v4, and Framer Motion.

## What's here

- **Now Playing Dashboard** — the physician command view. A large bed-occupancy
  ring sits in front of a slow-spinning ambient gradient blob that shifts hue
  (green → teal → red) with occupancy pressure, backed by ward breakdowns,
  live metrics, and an alert feed.
- **Split View Patient Record** — a 30/70 glass-panelled patient chart. Left
  pane: identity, live vitals with an animated ECG trace, demographics. Right
  pane: a Summary / Labs / Imaging / Billing tabbed record with custom
  checkboxes, a frosted dropdown filter, and hover-expanding table rows.
- **Smart Scheduling Grid** — a DAW-style horizontally scrollable surgical
  room timeline with pill-shaped booking blocks that visually merge (blurred,
  blended glow) when two bookings collide.

## Architecture

Components follow atomic design:

```
src/components/
  atoms/       Button, Badge, Avatar, Checkbox, Skeleton, GlassPanel
  molecules/   StatRing, HeartbeatLine, Dropdown, TabBar, TableRow, SurgeryBlock
  organisms/   Sidebar, NowPlayingDashboard, PatientRecordSplitView, SchedulingGrid
```

Design tokens (color, type, radii, motion easing) live in `src/index.css` as
Tailwind v4 `@theme` variables — no default Tailwind palette, no default
system font, no off-the-shelf component library.

## Development

```bash
npm install
npm run dev      # start the dev server
npm run build    # type-check and build for production
npm run preview  # preview the production build
```
