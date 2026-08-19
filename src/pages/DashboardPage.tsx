import { NowPlayingDashboard } from '../components/organisms/NowPlayingDashboard'
import { PatientRecordSplitView } from '../components/organisms/PatientRecordSplitView'

export function DashboardPage() {
  return (
    <section className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <NowPlayingDashboard />
      <PatientRecordSplitView />
    </section>
  )
}
