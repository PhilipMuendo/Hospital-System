import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/apiClient'
import { GlassPanel } from '../components/atoms/GlassPanel'
import { Badge } from '../components/atoms/Badge'
import { Skeleton } from '../components/atoms/Skeleton'
import { TabBar } from '../components/molecules/TabBar'
import { TableRow } from '../components/molecules/TableRow'
import { formatDateTime } from '../lib/format'

interface Device {
  id: string
  assetTag: string
  name: string
  kind: string
  manufacturer: string | null
  model: string | null
  transport: string
  status: string
  ward: { id: string; name: string } | null
  bed: string | null
  ipAddress: string | null
  hl7SendingApplication: string | null
  lastSeenAt: string | null
  stale: boolean
  serviceOverdue: boolean
  calibrationOverdue: boolean
  readingCount: number
  messageCount: number
}

interface Reading {
  id: string
  code: string
  label: string
  value: string
  unit: string
  abnormalFlag: string | null
  measuredAt: string
  device: { id: string; name: string; assetTag: string; kind: string }
  patient: { id: string; name: string; ipNumber: string; bed: string } | null
}

const transportLabel: Record<string, string> = {
  HL7_MLLP: 'HL7 v2 / MLLP',
  REST_PUSH: 'REST push',
  SERIAL_BRIDGE: 'Serial bridge',
  MANUAL: 'Manual entry',
}

const kindLabel: Record<string, string> = {
  PATIENT_MONITOR: 'Patient Monitor',
  INFUSION_PUMP: 'Infusion Pump',
  VENTILATOR: 'Ventilator',
  LAB_ANALYSER: 'Lab Analyser',
  ECG: 'ECG',
  ULTRASOUND: 'Ultrasound',
  XRAY: 'X-Ray',
  DEFIBRILLATOR: 'Defibrillator',
  PULSE_OXIMETER: 'Pulse Oximeter',
  WEIGHING_SCALE: 'Weighing Scale',
  BARCODE_SCANNER: 'Barcode Scanner',
  THERMOMETER: 'Thermometer',
}

const TABS = ['Confirmation Queue', 'Asset Register']

export function DevicesPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState(TABS[0])
  const [error, setError] = useState<string | null>(null)

  const devicesQuery = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.get<Device[]>('/devices'),
    refetchInterval: 20_000,
  })

  const readingsQuery = useQuery({
    queryKey: ['device-readings'],
    queryFn: () => api.get<Reading[]>('/devices/readings'),
    refetchInterval: 10_000,
  })

  const accept = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.post(`/devices/readings/${id}/accept`, { status }),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['device-readings'] })
      queryClient.invalidateQueries({ queryKey: ['patient'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not accept reading'),
  })

  const reject = useMutation({
    mutationFn: (id: string) => api.post(`/devices/readings/${id}/reject`, { reason: 'Artefact — rejected at review' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['device-readings'] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not reject reading'),
  })

  const devices = devicesQuery.data ?? []
  const readings = readingsQuery.data ?? []
  const online = devices.filter((d) => !d.stale && d.transport !== 'MANUAL')
  const needsService = devices.filter((d) => d.serviceOverdue || d.calibrationOverdue)

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Registered Devices" value={String(devices.length)} />
        <Stat label="Reporting" value={`${online.length}/${devices.filter((d) => d.transport !== 'MANUAL').length}`} />
        <Stat label="Awaiting Confirmation" value={String(readings.length)} tone={readings.length ? 'warning' : undefined} />
        <Stat label="Service Overdue" value={String(needsService.length)} tone={needsService.length ? 'critical' : undefined} />
      </div>

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-status-critical/30 bg-status-critical/10 px-4 py-3 text-[13px] text-status-critical">
          {error}
        </div>
      )}

      <GlassPanel className="p-6">
        <TabBar tabs={TABS} active={tab} onChange={setTab} />

        {tab === 'Confirmation Queue' && (
          <>
            <p className="mt-4 text-[12.5px] text-mist-500">
              Device output is staged here, not written straight to the chart. A displaced sensor reports
              nonsense — a clinician confirms each reading before it becomes part of the record.
            </p>

            <div className="mt-4 max-h-[520px] overflow-y-auto pr-1">
              <TableRow
                columns="1.3fr 1.2fr 0.8fr 1fr 1.1fr"
                className="text-[11px] font-medium uppercase tracking-wide text-mist-500"
              >
                <span>Observation</span>
                <span>Patient</span>
                <span>Value</span>
                <span>Source</span>
                <span>Action</span>
              </TableRow>

              {readingsQuery.isLoading ? (
                <Skeleton className="mt-2 h-56 rounded-[var(--radius-sm)]" />
              ) : readings.length === 0 ? (
                <p className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-white/8 px-4 py-8 text-center text-[13px] text-mist-600">
                  No readings awaiting confirmation.
                </p>
              ) : (
                readings.map((r) => (
                  <TableRow key={r.id} columns="1.3fr 1.2fr 0.8fr 1fr 1.1fr">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] text-mist-100">{r.label}</p>
                      <p className="truncate font-mono text-[11px] text-mist-600">{r.code}</p>
                    </div>
                    <div className="min-w-0">
                      {r.patient ? (
                        <>
                          <p className="truncate text-[13px] text-mist-300">{r.patient.name}</p>
                          <p className="truncate text-[11px] text-mist-600">
                            {r.patient.ipNumber} · {r.patient.bed}
                          </p>
                        </>
                      ) : (
                        <Badge status="critical">UNMATCHED</Badge>
                      )}
                    </div>
                    <div>
                      <span className="font-mono text-[14px] tabular text-mist-50">{r.value}</span>
                      <span className="ml-1 text-[11px] text-mist-500">{r.unit}</span>
                      {r.abnormalFlag && (
                        <span className="ml-1.5 text-[11px] text-status-warning">{r.abnormalFlag}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] text-mist-400">{r.device.name}</p>
                      <p className="truncate text-[11px] text-mist-600">{formatDateTime(r.measuredAt)}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        disabled={!r.patient || accept.isPending}
                        onClick={() => accept.mutate({ id: r.id, status: r.abnormalFlag ? 'WARNING' : 'HEALTHY' })}
                        title={r.patient ? undefined : 'Reading is not matched to a patient'}
                        className="rounded-[var(--radius-xs)] bg-accent-500 px-2.5 py-1 text-[11.5px] font-semibold text-charcoal-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        disabled={reject.isPending}
                        onClick={() => reject.mutate(r.id)}
                        className="rounded-[var(--radius-xs)] border border-white/10 px-2.5 py-1 text-[11.5px] text-mist-400 transition-colors hover:border-status-critical/40 hover:text-status-critical"
                      >
                        Artefact
                      </button>
                    </div>
                  </TableRow>
                ))
              )}
            </div>
          </>
        )}

        {tab === 'Asset Register' && (
          <div className="mt-5 max-h-[560px] overflow-y-auto pr-1">
            <TableRow
              columns="1.5fr 1fr 1.1fr 1fr 0.9fr"
              className="text-[11px] font-medium uppercase tracking-wide text-mist-500"
            >
              <span>Device</span>
              <span>Location</span>
              <span>Integration</span>
              <span>Last Seen</span>
              <span>Status</span>
            </TableRow>

            {devicesQuery.isLoading ? (
              <Skeleton className="mt-2 h-64 rounded-[var(--radius-sm)]" />
            ) : devices.length === 0 ? (
              <p className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-white/8 px-4 py-8 text-center text-[13px] text-mist-600">
                No devices registered yet.
              </p>
            ) : (
              devices.map((d) => (
                <TableRow key={d.id} columns="1.5fr 1fr 1.1fr 1fr 0.9fr">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] text-mist-100">{d.name}</p>
                    <p className="truncate text-[11px] text-mist-600">
                      {d.assetTag} · {kindLabel[d.kind] ?? d.kind}
                      {d.manufacturer ? ` · ${d.manufacturer}` : ''}
                    </p>
                  </div>
                  <span className="text-[12.5px] text-mist-400">
                    {d.ward?.name ?? '—'}
                    {d.bed ? ` · ${d.bed}` : ''}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] text-mist-300">
                      {transportLabel[d.transport] ?? d.transport}
                    </p>
                    {d.hl7SendingApplication && (
                      <p className="truncate font-mono text-[10.5px] text-mist-600">
                        {d.hl7SendingApplication}
                        {d.ipAddress ? ` @ ${d.ipAddress}` : ''}
                      </p>
                    )}
                  </div>
                  <span className="text-[12px] text-mist-500">
                    {d.lastSeenAt ? formatDateTime(d.lastSeenAt) : 'Never'}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {d.transport === 'MANUAL' ? (
                      <Badge status="neutral">MANUAL</Badge>
                    ) : d.stale ? (
                      <Badge status="critical">NO SIGNAL</Badge>
                    ) : (
                      <Badge status="healthy">ONLINE</Badge>
                    )}
                    {(d.serviceOverdue || d.calibrationOverdue) && <Badge status="warning">SERVICE</Badge>}
                  </div>
                </TableRow>
              ))
            )}
          </div>
        )}
      </GlassPanel>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warning' | 'critical' }) {
  const color =
    tone === 'critical'
      ? 'var(--color-status-critical)'
      : tone === 'warning'
        ? 'var(--color-status-warning)'
        : 'var(--color-mist-50)'
  return (
    <GlassPanel className="p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-mist-500">{label}</p>
      <p className="mt-1.5 font-mono text-[19px] tabular font-semibold" style={{ color }}>
        {value}
      </p>
    </GlassPanel>
  )
}
