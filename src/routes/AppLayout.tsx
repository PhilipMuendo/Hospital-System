import { useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Sidebar } from '../components/organisms/Sidebar'
import { OfflineIndicator } from '../components/molecules/OfflineIndicator'
import { Dialog } from '../components/ui'
import { GLOBAL_SHORTCUTS, useGoToNavigation, useHotkeys } from '../lib/useHotkeys'

/**
 * Application shell.
 *
 * Deliberately thin: a fixed 56px top bar, a persistent left rail, and the
 * page. There is no decorative page heading here — each screen owns its own
 * `PageHeader`, so vertical space goes to content rather than to a title bar
 * repeating what the navigation already says.
 *
 * The previous shell put a large date-and-hospital-name block above every
 * screen. On a 768px-tall workstation that is roughly 12% of the viewport
 * spent restating something the user knows.
 */
export function AppLayout() {
  const navigate = useNavigate()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useGoToNavigation(navigate)
  useHotkeys([
    { combo: 'shift+?', description: 'Keyboard shortcuts', handler: () => setShortcutsOpen(true) },
    { combo: 'Escape', whileTyping: true, handler: () => setShortcutsOpen(false) },
  ])

  return (
    <div className="flex h-svh flex-col bg-sunken">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas px-4">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
          className="grid h-10 w-10 place-items-center rounded-sm border border-line-strong lg:hidden"
        >
          <svg className="h-5 w-5 text-ink-700" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        <p className="text-sm font-semibold text-ink-900 lg:hidden">Uzima General</p>

        <div className="ml-auto flex items-center gap-3">
          <time className="hidden font-mono text-xs tabular text-ink-600 sm:block">
            {new Date().toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}
          </time>
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="hidden h-9 items-center gap-1.5 rounded-sm border border-line-strong px-2.5 text-xs font-semibold text-ink-700 hover:bg-header sm:inline-flex"
          >
            <kbd className="font-mono text-2xs">?</kbd>
            Shortcuts
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="hidden lg:block">
          <Sidebar />
        </div>

        {/* Off-canvas navigation below lg, rather than a shrunken icon rail
            that removes the labels exactly when the screen is hardest to read. */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileNavOpen(false)}
              className="absolute inset-0 bg-ink-900/45"
            />
            <div className="absolute inset-y-0 left-0">
              <Sidebar onNavigate={() => setMobileNavOpen(false)} />
            </div>
          </div>
        )}

        <main id="main" className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <OfflineIndicator />

      <Dialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Keyboard shortcuts"
        description="Shortcuts do not fire while you are typing in a field."
        width="sm"
      >
        <dl className="divide-y divide-line">
          {GLOBAL_SHORTCUTS.map((s) => (
            <div key={s.combo} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-sm text-ink-700">{s.description}</dt>
              <dd className="flex gap-1">
                {s.combo.split(' then ').map((part, i) => (
                  <kbd
                    key={i}
                    className="rounded-xs border border-line-strong bg-header px-1.5 py-0.5 font-mono text-2xs font-semibold text-ink-800"
                  >
                    {part}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </div>
  )
}
