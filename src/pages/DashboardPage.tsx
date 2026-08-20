import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/apiClient'
import { useAuth } from '../context/AuthContext'
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  LoadingRows,
  PageHeader,
  Panel,
  StatTile,
  StatusChip,
  TBody,
  TD,
  TDPrimary,
  TH,
  THead,
  TR,
  TriageBadge,
} from '../components/ui'
import { formatDateTime } from '../lib/format'
import type { Alert as AlertRow, Ward } from '../lib/types'

/**
 * Shift dashboard.
 *
 * Answers four questions and nothing else:
 *   What needs attention? · What is waiting? · What is breaching? · Where are
 *   the beds?
 *
 * The previous version led with a large animated occupancy ring whose hue
 * shifted with bed pressure. It was the most eye-catching object on the screen
 * and communicated one number that changes slowly — while unresolved critical
 * alerts sat below the fold. Ranked by decision value, occupancy belongs near
 * the bottom, so that is where it now is.
 *
 * No charts. Every figure here is a count someone acts on, and a number is a
 * faster read than a chart of one number.
 */

interface OpenVisit {
  id: string
  visitNumber: string
  acuity: string | null
  arrivedAt: string
  patient: { id: string; name: string; opNumber: string | null }
  currentStation: { id: string; name: string } | null
  tickets: { token: string; status: string }[]
}

export function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const wardsQuery = useQuery({ queryKey: ['wards'], queryFn: () => api.get<Ward[]>('/wards') })
  const alertsQuery = useQuery({
    queryKey: ['alerts'],
    queryFn: () => api.get<AlertRow[]>('/alerts'),
    refetchInterval: 60_000,
  })
  const visitsQuery = useQuery({
    queryKey: ['visits', 'OPEN'],
    queryFn: () => api.get<OpenVisit[]>('/visits?status=OPEN'),
    refetchInterval: 45_000,
  })

  const wards = wardsQuery.data ?? []
  const alerts = (alertsQuery.data ?? []).filter((a) => !a.resolved)
  const visits = visitsQuery.data ?? []

  const critical = alerts.filter((a) => a.severity === 'CRITICAL')
  const warnings = alerts.filter((a) => a.severity === 'WARNING')

  const now = Date.now()
  const waitMinutes = (iso: string) => Math.floor((now - new Date(iso).getTime()) / 60000)
  // SATS targets. A breach is the actionable signal; total waiting is not.
  const TARGETS: Record<string, number> = { RED: 0, ORANGE: 10, YELLOW: 60, GREEN: 240 }
  const breaching = visits.filter(
    (v) => v.acuity && v.acuity !== 'BLUE' && waitMinutes(v.arrivedAt) > (TARGETS[v.acuity] ?? 240),
  )

  const totalBeds = wards.reduce((s, w) => s + w.bedCapacity, 0)
  const occupied = wards.reduce((s, w) => s + w.occupied, 0)
  const occupancyPct = totalBeds ? Math.round((occupied / totalBeds) * 100) : 0

  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${user?.name?.split(' ')[0] ?? ''}`.trim()}
        subtitle="Everything below needs a decision or is safe to ignore."
        meta={
          <>
            <span>
              {new Date().toLocaleDateString('en-KE', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>
            <span aria-hidden="true">·</span>
            <span>Uzima General Hospital, Nairobi</span>
          </>
        }
        actions={
          <Button variant="primary" onClick={() => navigate('/reception')}>
            Check in a patient
          </Button>
        }
      />

      <div className="flex flex-col gap-4 p-4">
        {/* Unresolved critical alerts are the only thing allowed above the
            operational counts. If there are none, this space is not used. */}
        {critical.length > 0 && (
          <Alert
            tone="critical"
            title={`${critical.length} critical alert${critical.length === 1 ? '' : 's'} unresolved`}
            action={
              <Button size="sm" variant="danger" onClick={() => navigate('/ward')}>
                Go to wards
              </Button>
            }
          >
            <ul className="mt-1 space-y-0.5">
              {critical.slice(0, 3).map((a) => (
                <li key={a.id} className="text-sm">
                  {a.message}
                  {a.ward ? ` — ${a.ward.name}` : ''}
                </li>
              ))}
            </ul>
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Waiting now"
            value={visits.length}
            hint="Patients in the building"
            onClick={() => navigate('/triage')}
          />
          <StatTile
            label="Past target time"
            value={breaching.length}
            tone={breaching.length > 0 ? 'warning' : 'neutral'}
            hint="Breaching SATS target"
            onClick={() => navigate('/triage')}
          />
          <StatTile
            label="Open alerts"
            value={alerts.length}
            tone={critical.length > 0 ? 'critical' : warnings.length > 0 ? 'warning' : 'neutral'}
            hint={`${critical.length} critical`}
          />
          <StatTile
            label="Beds occupied"
            value={`${occupied}/${totalBeds}`}
            tone={occupancyPct >= 90 ? 'critical' : occupancyPct >= 85 ? 'warning' : 'neutral'}
            hint={`${occupancyPct}% occupancy`}
            onClick={() => navigate('/ward')}
          />
        </div>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Panel
            title="In the building"
            description="Longest wait first"
            flush
            actions={
              <Link to="/triage" className="text-xs font-semibold text-primary-700 hover:underline">
                Open triage queue
              </Link>
            }
          >
            {visitsQuery.isLoading ? (
              <div className="p-4">
                <LoadingRows rows={5} columns={4} />
              </div>
            ) : visits.length === 0 ? (
              <EmptyState
                title="Nobody is currently checked in"
                description="Patients appear here as soon as reception checks them in."
              />
            ) : (
              <DataTable caption="Patients currently in the building">
                <THead>
                  <TR>
                    <TH width="34%">Patient</TH>
                    <TH>Triage</TH>
                    <TH>Waiting at</TH>
                    <TH align="right">Waited</TH>
                  </TR>
                </THead>
                <TBody>
                  {[...visits]
                    .sort((a, b) => new Date(a.arrivedAt).getTime() - new Date(b.arrivedAt).getTime())
                    .slice(0, 10)
                    .map((v) => {
                      const mins = waitMinutes(v.arrivedAt)
                      const over = v.acuity && v.acuity !== 'BLUE' && mins > (TARGETS[v.acuity] ?? 240)
                      return (
                        <TR key={v.id} tone={over ? 'warning' : undefined}>
                          <TDPrimary secondary={`${v.patient.opNumber ?? '—'} · ${v.tickets[0]?.token ?? ''}`}>
                            {v.patient.name}
                          </TDPrimary>
                          <TD>
                            <TriageBadge acuity={v.acuity} showTarget={false} />
                          </TD>
                          <TD>{v.currentStation?.name ?? '—'}</TD>
                          <TD align="right">
                            <span className="font-mono text-md font-semibold tabular text-ink-900">{mins}m</span>
                            {over && (
                              <span className="ml-1.5 text-2xs font-bold uppercase text-warning">Over</span>
                            )}
                          </TD>
                        </TR>
                      )
                    })}
                </TBody>
              </DataTable>
            )}
          </Panel>

          <div className="flex flex-col gap-4">
            <Panel title="Alerts" description="Unresolved" flush>
              {alertsQuery.isLoading ? (
                <div className="p-4">
                  <LoadingRows rows={3} columns={2} />
                </div>
              ) : alerts.length === 0 ? (
                <EmptyState title="No open alerts" description="Nothing needs attention right now." />
              ) : (
                <ul className="divide-y divide-line">
                  {alerts.slice(0, 6).map((a) => (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                      <StatusChip tone={a.severity === 'CRITICAL' ? 'critical' : a.severity === 'WARNING' ? 'warning' : 'stable'}>
                        {a.severity}
                      </StatusChip>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink-800">{a.message}</p>
                        <p className="mt-0.5 text-xs text-ink-600">
                          {a.ward?.name ? `${a.ward.name} · ` : ''}
                          {formatDateTime(a.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* Occupancy: a table, because the useful question is "which ward
                is full", and a ring cannot answer that. */}
            <Panel title="Bed state by ward" flush>
              {wardsQuery.isLoading ? (
                <div className="p-4">
                  <LoadingRows rows={4} columns={3} />
                </div>
              ) : (
                <DataTable caption="Bed occupancy by ward">
                  <THead>
                    <TR>
                      <TH>Ward</TH>
                      <TH align="right">Used</TH>
                      <TH align="right">Free</TH>
                      <TH align="right">Occupancy</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {wards.map((w) => {
                      const pct = w.bedCapacity ? Math.round((w.occupied / w.bedCapacity) * 100) : 0
                      return (
                        <TR key={w.id} tone={pct >= 90 ? 'critical' : pct >= 85 ? 'warning' : undefined}>
                          <TD className="font-medium text-ink-900">{w.name}</TD>
                          <TD align="right" className="font-mono tabular">
                            {w.occupied}
                          </TD>
                          <TD align="right" className="font-mono tabular">
                            {w.bedCapacity - w.occupied}
                          </TD>
                          <TD align="right">
                            <span
                              className={
                                pct >= 90
                                  ? 'font-mono font-semibold tabular text-critical'
                                  : pct >= 85
                                    ? 'font-mono font-semibold tabular text-warning'
                                    : 'font-mono tabular text-ink-800'
                              }
                            >
                              {pct}%
                            </span>
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </DataTable>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
