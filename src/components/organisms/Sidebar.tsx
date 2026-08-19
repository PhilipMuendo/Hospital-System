import { motion } from 'framer-motion'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { NavIcon } from '../atoms/NavIcon'
import { navItemsFor } from '../../routes/navigation'

const roleLabel: Record<string, string> = {
  ADMIN: 'Administrator',
  PHYSICIAN: 'Physician',
  NURSE: 'Nurse',
  BILLING: 'Billing',
  PHARMACIST: 'Pharmacist',
}

function initialsOf(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
}

export function Sidebar() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const items = navItemsFor(user?.role)

  return (
    <aside className="texture-noise no-print sticky top-0 flex h-svh w-[76px] shrink-0 flex-col items-center gap-8 border-r border-white/6 bg-charcoal-950 py-6 lg:w-[220px] lg:items-stretch lg:px-4">
      <NavLink to="/dashboard" className="flex items-center gap-2.5 px-1 lg:px-1">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-gradient-to-b from-accent-400 to-accent-600">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M1.5 8.5h2.5L5.2 5l2 6 1.5-5.5 1 3H14.5"
              stroke="#08090b"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span className="hidden font-display text-[15px] font-semibold tracking-tight text-mist-50 lg:inline">
          Uzima
        </span>
      </NavLink>

      <nav className="flex w-full flex-col gap-1">
        {items.map((item) => {
          const isActive = location.pathname.startsWith(item.to)
          return (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.label}
              className="relative flex items-center gap-3 rounded-[var(--radius-xs)] px-3 py-2.5 text-left"
            >
              {isActive && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-[var(--radius-xs)] bg-surface-800 stroke-elevated"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                />
              )}
              <span
                className={`relative z-10 grid place-items-center ${isActive ? 'text-accent-400' : 'text-mist-500'}`}
              >
                <NavIcon name={item.icon} />
              </span>
              <span
                className={`relative z-10 hidden text-[13.5px] font-medium lg:inline ${
                  isActive ? 'text-mist-50' : 'text-mist-400'
                }`}
              >
                {item.label}
              </span>
            </NavLink>
          )
        })}
      </nav>

      <div className="mt-auto hidden w-full rounded-[var(--radius-sm)] border border-white/6 bg-surface-900/60 p-3 lg:block">
        <p className="text-[11px] font-medium uppercase tracking-wide text-mist-500">Shift</p>
        <p className="mt-1 text-[13px] text-mist-200">{currentShift()}</p>
      </div>

      {user && (
        <div className="hidden w-full items-center gap-2.5 border-t border-white/6 pt-3 lg:flex">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-800 stroke-elevated">
            <span className="font-display text-[11px] font-semibold text-mist-100">{initialsOf(user.name)}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-mist-100">{user.name}</p>
            <p className="truncate text-[11px] text-mist-500">{roleLabel[user.role] ?? user.role}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            title="Sign out"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-mist-500 transition-colors hover:bg-surface-800 hover:text-mist-200"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path
                d="M6 3.2H3.4v8.6H6M9.4 4.9 12 7.5l-2.6 2.6M12 7.5H6"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}
    </aside>
  )
}

/** The two shifts a Kenyan hospital ward actually runs. */
function currentShift() {
  const hour = new Date().getHours()
  return hour >= 7 && hour < 19 ? 'Day · 07:00–19:00' : 'Night · 19:00–07:00'
}
