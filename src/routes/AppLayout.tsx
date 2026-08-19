import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from '../components/organisms/Sidebar'
import { NAV_ITEMS } from './navigation'

/**
 * Shell shared by every signed-in route: persistent sidebar, page heading and
 * the ambient wash. The heading is derived from the route rather than passed
 * down, so a new page gets a correct header for free.
 */
export function AppLayout() {
  const location = useLocation()
  const current = NAV_ITEMS.find((i) => location.pathname.startsWith(i.to))

  return (
    <div className="grid min-h-svh grid-cols-[auto_1fr] bg-charcoal-950">
      <Sidebar />

      <main className="relative min-w-0">
        <div
          className="no-print pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(60% 50% at 15% 0%, color-mix(in srgb, var(--color-accent-600) 14%, transparent) 0%, transparent 60%)',
          }}
        />

        <div className="relative mx-auto flex max-w-[1600px] flex-col gap-6 px-5 py-6 lg:px-10 lg:py-10">
          <header className="mount-in no-print flex items-center justify-between">
            <div>
              <h1 className="text-[26px] lg:text-[30px]">{current?.label ?? 'Command Centre'}</h1>
              <p className="mt-1 text-[13.5px] text-mist-400">
                {new Date().toLocaleDateString('en-KE', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}{' '}
                &middot; Uzima General Hospital, Nairobi
              </p>
            </div>
          </header>

          <Outlet />

          <footer className="no-print py-6 text-center text-[12px] text-mist-600">
            Uzima General Hospital &middot; Nairobi, Kenya &middot; internal staff portal &middot; synthetic data for
            demonstration
          </footer>
        </div>
      </main>
    </div>
  )
}
