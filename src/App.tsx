import { Sidebar } from './components/organisms/Sidebar'
import { NowPlayingDashboard } from './components/organisms/NowPlayingDashboard'
import { PatientRecordSplitView } from './components/organisms/PatientRecordSplitView'
import { SchedulingGrid } from './components/organisms/SchedulingGrid'

function App() {
  return (
    <div className="grid min-h-svh grid-cols-[auto_1fr] bg-charcoal-950">
      <Sidebar />

      <main className="relative min-w-0">
        {/* Faint ambient wash behind the whole workspace */}
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(60% 50% at 15% 0%, color-mix(in srgb, var(--color-accent-600) 14%, transparent) 0%, transparent 60%)',
          }}
        />

        <div className="relative mx-auto flex max-w-[1600px] flex-col gap-6 px-5 py-6 lg:px-10 lg:py-10">
          <header className="mount-in flex items-center justify-between">
            <div>
              <h1 className="text-[26px] lg:text-[30px]">Command Centre</h1>
              <p className="mt-1 text-[13.5px] text-mist-400">
                {new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                {' '}&middot; Uzima General Hospital, Nairobi
              </p>
            </div>
          </header>

          {/* Output requirement: dashboard + split-view record side-by-side,
              collapsing to a stacked layout below the xl breakpoint. */}
          <section className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <NowPlayingDashboard />
            <PatientRecordSplitView />
          </section>

          <SchedulingGrid />

          <footer className="py-6 text-center text-[12px] text-mist-600">
            Uzima General Hospital &middot; Nairobi, Kenya &middot; internal staff portal &middot; synthetic data for demonstration
          </footer>
        </div>
      </main>
    </div>
  )
}

export default App
