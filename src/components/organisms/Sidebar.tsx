import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { NavIcon } from '../atoms/NavIcon'
import { navItemsFor } from '../../routes/navigation'
import { cn } from '../../lib/utils'

const roleLabel: Record<string, string> = {
  ADMIN: 'Administrator',
  PHYSICIAN: 'Physician',
  NURSE: 'Nurse',
  BILLING: 'Billing',
  PHARMACIST: 'Pharmacist',
  LAB_TECH: 'Lab Technologist',
  RADIOGRAPHER: 'Radiographer',
}

/**
 * Primary navigation.
 *
 * Grouped by what someone is doing rather than by software module, because a
 * nurse thinks "I'm on the ward", not "I need the inpatient subsystem". The
 * order follows the patient's path through the building: arrive, be assessed,
 * be seen, be treated, pay, leave.
 *
 * Labels are always visible — an icon-only rail forces a tired user to decode
 * pictograms, and the icons here are not conventions anyone already knows.
 */
const GROUPS: { heading: string; match: string[] }[] = [
  { heading: 'Front of house', match: ['/dashboard', '/reception', '/triage'] },
  { heading: 'Clinical', match: ['/consultation', '/ward', '/patients', '/scheduling'] },
  { heading: 'Diagnostics & treatment', match: ['/lab', '/radiology', '/pharmacy'] },
  { heading: 'Finance', match: ['/cashier', '/billing'] },
  { heading: 'Administration', match: ['/reports', '/devices', '/audit'] },
]

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth()
  const location = useLocation()
  const items = navItemsFor(user?.role)

  const grouped = GROUPS.map((group) => ({
    heading: group.heading,
    items: items.filter((i) => group.match.includes(i.to)),
  })).filter((g) => g.items.length > 0)

  return (
    <nav
      aria-label="Main navigation"
      className="no-print flex h-full w-60 shrink-0 flex-col border-r border-line bg-canvas"
    >
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-sm bg-primary-600">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M1.5 8.5h2.5L5.2 5l2 6 1.5-5.5 1 3H14.5"
              stroke="#fff"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-900">Uzima General</p>
          <p className="truncate text-2xs text-ink-600">Nairobi</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {grouped.map((group) => (
          <div key={group.heading} className="mb-1">
            <h2 className="px-4 py-1.5 text-2xs font-bold uppercase tracking-wide text-ink-500">
              {group.heading}
            </h2>
            <ul className="mb-1">
              {group.items.map((item) => {
                const active = location.pathname.startsWith(item.to)
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-10 items-center gap-3 border-l-[3px] px-4 text-sm transition-colors',
                        active
                          ? 'border-l-primary-600 bg-primary-50 font-semibold text-primary-700'
                          : 'border-l-transparent text-ink-700 hover:bg-header hover:text-ink-900',
                      )}
                    >
                      <span className={cn('shrink-0', active ? 'text-primary-700' : 'text-ink-500')}>
                        <NavIcon name={item.icon} />
                      </span>
                      {item.label}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      {user && (
        <div className="shrink-0 border-t border-line px-4 py-3">
          <p className="truncate text-sm font-semibold text-ink-900">{user.name}</p>
          <p className="truncate text-xs text-ink-600">{roleLabel[user.role] ?? user.role}</p>
          <p className="mt-1 text-2xs text-ink-500">{currentShift()}</p>
          <button
            type="button"
            onClick={logout}
            className="mt-2 min-h-9 w-full rounded-sm border border-line-strong px-3 text-xs font-semibold text-ink-700 hover:bg-header"
          >
            Sign out
          </button>
        </div>
      )}
    </nav>
  )
}

/** The two shifts a Kenyan hospital ward actually runs. */
function currentShift() {
  const hour = new Date().getHours()
  return hour >= 7 && hour < 19 ? 'Day shift · 07:00–19:00' : 'Night shift · 19:00–07:00'
}
