import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/apiClient'
import { useAuth } from '../context/AuthContext'
import { GlassPanel } from '../components/atoms/GlassPanel'
import { Badge } from '../components/atoms/Badge'
import { Skeleton } from '../components/atoms/Skeleton'
import { TabBar } from '../components/molecules/TabBar'
import { calculateAge, formatDateTime } from '../lib/format'

interface Order {
  id: string
  status: string
  urgency: 'ROUTINE' | 'URGENT' | 'STAT'
  clinicalNotes: string | null
  createdAt: string
  performedAt: string | null
  technicalNotes: string | null
  retakeCount: number
  pregnancyStatus: string | null
  requiresPregnancyCheck: boolean
  findings: string | null
  impression: string | null
  procedure: {
    code: string
    name: string
    modality: string
    bodyPart: string
    ionising: boolean
    preparation: string | null
    durationMins: number
  }
  orderedBy: { name: string }
  performedBy: { name: string } | null
  patient: {
    id: string
    name: string
    opNumber: string | null
    ipNumber: string | null
    dob: string
    sex: string
    bed: string | null
  }
}

const TABS = ['To acquire', 'Awaiting report']

const urgencyTone: Record<string, string> = { STAT: '#dc2626', URGENT: '#ea580c', ROUTINE: '#475569' }

export function RadiologyPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState(TABS[0])
  const [error, setError] = useState<string | null>(null)

  const worklist = useQuery({
    queryKey: ['imaging-worklist'],
    queryFn: () => api.get<Order[]>('/imaging/worklist'),
    refetchInterval: 25_000,
  })

  const done = () => {
    setError(null)
    queryClient.invalidateQueries({ queryKey: ['imaging-worklist'] })
    queryClient.invalidateQueries({ queryKey: ['patient'] })
  }
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Action failed')

  const perform = useMutation({
    mutationFn: (body: { id: string } & Record<string, unknown>) => {
      const { id, ...rest } = body
      return api.post(`/imaging/orders/${id}/perform`, rest)
    },
    onSuccess: done,
    onError: fail,
  })

  const report = useMutation({
    mutationFn: (body: { id: string; findings: string; impression: string }) => {
      const { id, ...rest } = body
      return api.post(`/imaging/orders/${id}/report`, rest)
    },
    onSuccess: done,
    onError: fail,
  })

  const orders = worklist.data ?? []
  const toAcquire = orders.filter((o) => o.status === 'ORDERED')
  const toReport = orders.filter((o) => o.status === 'PERFORMED')
  const shown = tab === TABS[0] ? toAcquire : toReport

  const canAcquire = user?.role === 'RADIOGRAPHER' || user?.role === 'ADMIN'
  const canReport = user?.role === 'PHYSICIAN' || user?.role === 'ADMIN'

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="To Acquire" value={String(toAcquire.length)} />
        <Stat label="Awaiting Report" value={String(toReport.length)} tone={toReport.length ? 'warning' : undefined} />
        <Stat
          label="STAT Outstanding"
          value={String(orders.filter((o) => o.urgency === 'STAT').length)}
          tone={orders.some((o) => o.urgency === 'STAT') ? 'critical' : undefined}
        />
        <Stat label="Retakes Today" value={String(orders.reduce((s, o) => s + o.retakeCount, 0))} />
      </div>

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-status-critical/30 bg-status-critical/10 px-4 py-3 text-[13px] text-status-critical">
          {error}
        </div>
      )}

      <GlassPanel className="p-6">
        <TabBar tabs={TABS} active={tab} onChange={setTab} />

        <div className="mt-5 flex max-h-[620px] flex-col gap-3 overflow-y-auto pr-1">
          {worklist.isLoading ? (
            <Skeleton className="h-56 rounded-[var(--radius-sm)]" />
          ) : shown.length === 0 ? (
            <p className="rounded-[var(--radius-sm)] border border-dashed border-white/8 px-4 py-10 text-center text-[13px] text-mist-600">
              Nothing in this queue.
            </p>
          ) : (
            shown.map((o) =>
              tab === TABS[0] ? (
                <AcquireCard
                  key={o.id}
                  order={o}
                  enabled={canAcquire}
                  pending={perform.isPending}
                  onPerform={(body) => perform.mutate({ id: o.id, ...body })}
                />
              ) : (
                <ReportCard
                  key={o.id}
                  order={o}
                  enabled={canReport}
                  pending={report.isPending}
                  onReport={(body) => report.mutate({ id: o.id, ...body })}
                />
              ),
            )
          )}
        </div>
      </GlassPanel>
    </div>
  )
}

function PatientLine({ order }: { order: Order }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
          style={{ background: urgencyTone[order.urgency] }}
        >
          {order.urgency}
        </span>
        <p className="text-[14px] font-medium text-mist-50">{order.procedure.name}</p>
        <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10.5px] text-mist-400">
          {order.procedure.modality}
        </span>
        {order.procedure.ionising && <Badge status="warning">IONISING</Badge>}
      </div>
      <p className="mt-1 text-[12.5px] text-mist-400">
        {order.patient.name} · {calculateAge(order.patient.dob)}y {order.patient.sex.toLowerCase()} ·{' '}
        {order.patient.ipNumber ?? order.patient.opNumber ?? '—'}
        {order.patient.bed ? ` · ${order.patient.bed}` : ''}
      </p>
      <p className="mt-0.5 text-[11.5px] text-mist-600">
        Requested {formatDateTime(order.createdAt)} by {order.orderedBy.name}
      </p>
      {order.clinicalNotes && (
        <p className="mt-1.5 rounded-[var(--radius-xs)] bg-surface-900/60 px-2.5 py-1.5 text-[12px] text-mist-300">
          {order.clinicalNotes}
        </p>
      )}
      {order.procedure.preparation && (
        <p className="mt-1 text-[11.5px] text-accent-400">Prep: {order.procedure.preparation}</p>
      )}
    </>
  )
}

function AcquireCard({
  order,
  enabled,
  pending,
  onPerform,
}: {
  order: Order
  enabled: boolean
  pending: boolean
  onPerform: (body: Record<string, unknown>) => void
}) {
  const [pregnancy, setPregnancy] = useState('')
  const [notes, setNotes] = useState('')
  const [retakes, setRetakes] = useState(0)

  const blocked = order.requiresPregnancyCheck && pregnancy !== 'NOT_PREGNANT'

  return (
    <div className="rounded-[var(--radius-sm)] border border-white/6 bg-surface-800/50 p-4">
      <PatientLine order={order} />

      {order.requiresPregnancyCheck && (
        <div className="mt-3 rounded-[var(--radius-xs)] border border-status-warning/30 bg-status-warning/10 p-3">
          <p className="text-[12px] font-semibold text-status-warning">
            Ionising exposure — pregnancy status required before acquisition
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              ['NOT_PREGNANT', 'Not pregnant'],
              ['PREGNANT', 'Pregnant'],
              ['UNKNOWN', 'Unknown / unsure'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPregnancy(value)}
                className={`rounded-[var(--radius-xs)] border px-3 py-1.5 text-[12px] transition-colors ${
                  pregnancy === value
                    ? 'border-white/30 bg-white/10 text-mist-50'
                    : 'border-white/10 text-mist-400 hover:text-mist-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {pregnancy && pregnancy !== 'NOT_PREGNANT' && (
            <p className="mt-2 text-[12px] text-status-critical">
              Exposure must be withheld. Refer back to the requesting clinician.
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Views taken, exposure factors…"
          className="min-w-[220px] flex-1 rounded-[var(--radius-xs)] border border-white/10 bg-surface-900/70 px-3 py-2 text-[12.5px] text-mist-100 outline-none placeholder:text-mist-700 focus:border-accent-500"
        />
        <label className="flex items-center gap-1.5 text-[11.5px] text-mist-500">
          Retakes
          <input
            type="number"
            min={0}
            max={20}
            value={retakes}
            onChange={(e) => setRetakes(Number(e.target.value))}
            className="w-14 rounded-[var(--radius-xs)] border border-white/10 bg-surface-900/70 px-2 py-2 font-mono text-[12.5px] tabular text-mist-100 outline-none focus:border-accent-500"
          />
        </label>
        <button
          type="button"
          disabled={!enabled || blocked || pending}
          onClick={() =>
            onPerform({
              technicalNotes: notes || undefined,
              retakeCount: retakes,
              pregnancyStatus: order.requiresPregnancyCheck ? pregnancy : 'NOT_APPLICABLE',
            })
          }
          title={blocked ? 'Record a negative pregnancy status before exposure' : undefined}
          className="rounded-[var(--radius-xs)] bg-accent-500 px-4 py-2 text-[12.5px] font-semibold text-charcoal-950 hover:opacity-90 disabled:opacity-35"
        >
          Images acquired
        </button>
      </div>
    </div>
  )
}

function ReportCard({
  order,
  enabled,
  pending,
  onReport,
}: {
  order: Order
  enabled: boolean
  pending: boolean
  onReport: (body: { findings: string; impression: string }) => void
}) {
  const [findings, setFindings] = useState('')
  const [impression, setImpression] = useState('')

  return (
    <div className="rounded-[var(--radius-sm)] border border-white/6 bg-surface-800/50 p-4">
      <PatientLine order={order} />

      <p className="mt-2 text-[11.5px] text-mist-600">
        Acquired {order.performedAt ? formatDateTime(order.performedAt) : '—'}
        {order.performedBy ? ` by ${order.performedBy.name}` : ''}
        {order.retakeCount > 0 ? ` · ${order.retakeCount} retake(s)` : ''}
        {order.pregnancyStatus ? ` · pregnancy: ${order.pregnancyStatus.toLowerCase().replace('_', ' ')}` : ''}
      </p>
      {order.technicalNotes && (
        <p className="mt-1 text-[12px] text-mist-400">Technique: {order.technicalNotes}</p>
      )}

      <div className="mt-3 flex flex-col gap-2">
        <textarea
          value={findings}
          onChange={(e) => setFindings(e.target.value)}
          rows={3}
          placeholder="Findings — what is seen on the images"
          className="w-full resize-y rounded-[var(--radius-xs)] border border-white/10 bg-surface-900/70 px-3 py-2 text-[12.5px] text-mist-100 outline-none placeholder:text-mist-700 focus:border-accent-500"
        />
        <textarea
          value={impression}
          onChange={(e) => setImpression(e.target.value)}
          rows={2}
          placeholder="Impression — the conclusion that answers the clinical question"
          className="w-full resize-y rounded-[var(--radius-xs)] border border-white/10 bg-surface-900/70 px-3 py-2 text-[12.5px] text-mist-100 outline-none placeholder:text-mist-700 focus:border-accent-500"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!enabled || pending || findings.trim().length < 3 || impression.trim().length < 3}
            onClick={() => onReport({ findings: findings.trim(), impression: impression.trim() })}
            className="rounded-[var(--radius-xs)] bg-accent-500 px-4 py-2 text-[12.5px] font-semibold text-charcoal-950 hover:opacity-90 disabled:opacity-35"
          >
            Sign report &amp; publish to chart
          </button>
          {!enabled && (
            <span className="text-[11.5px] text-mist-600">
              Reporting is a radiologist function — a radiographer cannot sign their own images.
            </span>
          )}
        </div>
      </div>
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
