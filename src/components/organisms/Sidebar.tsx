import { motion } from 'framer-motion'
import { useState } from 'react'

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: RingIcon },
  { key: 'patients', label: 'Patients', icon: PulseIcon },
  { key: 'scheduling', label: 'Scheduling', icon: TimelineIcon },
  { key: 'billing', label: 'Billing', icon: LedgerIcon },
]

function RingIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" strokeDasharray="30 40" />
    </svg>
  )
}
function PulseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M2 9h3l1.6-4.5L9.6 13 12 6l1.2 3H16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function TimelineIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="4" width="14" height="2.4" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="11.6" width="9" height="2.4" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
function LedgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="3" y="2.5" width="12" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 6.5h6M6 9.5h6M6 12.5h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function Sidebar() {
  const [active, setActive] = useState('dashboard')

  return (
    <aside className="texture-noise sticky top-0 flex h-svh w-[76px] shrink-0 flex-col items-center gap-8 border-r border-white/6 bg-charcoal-950 py-6 lg:w-[220px] lg:items-stretch lg:px-4">
      <div className="flex items-center gap-2.5 px-1 lg:px-1">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-gradient-to-b from-accent-400 to-accent-600">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M1.5 8.5h2.5L5.2 5l2 6 1.5-5.5 1 3H14.5" stroke="#08090b" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span className="hidden font-display text-[15px] font-semibold tracking-tight text-mist-50 lg:inline">
          Meridian
        </span>
      </div>

      <nav className="flex w-full flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.key
          return (
            <button
              key={item.key}
              onClick={() => setActive(item.key)}
              className="relative flex items-center gap-3 rounded-[var(--radius-xs)] px-3 py-2.5 text-left"
            >
              {isActive && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-[var(--radius-xs)] bg-surface-800 stroke-elevated"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                />
              )}
              <span className={`relative z-10 grid place-items-center ${isActive ? 'text-accent-400' : 'text-mist-500'}`}>
                <item.icon />
              </span>
              <span className={`relative z-10 hidden text-[13.5px] font-medium lg:inline ${isActive ? 'text-mist-50' : 'text-mist-400'}`}>
                {item.label}
              </span>
            </button>
          )
        })}
      </nav>

      <div className="mt-auto hidden w-full rounded-[var(--radius-sm)] border border-white/6 bg-surface-900/60 p-3 lg:block">
        <p className="text-[11px] font-medium uppercase tracking-wide text-mist-500">Shift</p>
        <p className="mt-1 text-[13px] text-mist-200">Day · 07:00–19:00</p>
      </div>

      <button className="mt-auto grid h-10 w-10 place-items-center rounded-full bg-surface-800 stroke-elevated lg:hidden">
        <span className="font-display text-[13px] font-semibold text-mist-100">AO</span>
      </button>
    </aside>
  )
}
