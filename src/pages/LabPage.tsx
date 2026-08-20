import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/apiClient'
import { useAuth } from '../context/AuthContext'
import { GlassPanel } from '../components/atoms/GlassPanel'
import { Badge } from '../components/atoms/Badge'
import { Skeleton } from '../components/atoms/Skeleton'
import { TabBar } from '../components/molecules/TabBar'
import { calculateAge, formatDateTime } from '../lib/format'
import { ReasonDialog } from '../components/ui'

interface WorkItem {
  id: string
  status: string
  urgency: 'ROUTINE' | 'URGENT' | 'STAT'
  test: {
    id: string
    code: string
    name: string
    department: string
    specimen: string
    unit: string | null
    refRange: string
    refLow: number | null
    refHigh: number | null
  }
  specimenLabel: string | null
  collectedAt: string | null
  resultValue: string | null
  flag: string | null
  resultedAt: string | null
  rejectionReason: string | null
  orderId: string
  orderedAt: string
  orderedBy: string
  clinicalNotes: string | null
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

const TABS = ['Awaiting collection', 'On the bench', 'Awaiting verification']

const urgencyTone: Record<string, { bg: string; label: string }> = {
  STAT: { bg: '#dc2626', label: 'STAT' },
  URGENT: { bg: '#ea580c', label: 'URGENT' },
  ROUTINE: { bg: '#475569', label: 'ROUTINE' },
}

/**
 * The bench worklist. A technologist works top-down: STAT first, then urgent,
 * oldest first within a band, with rejected specimens surfaced because a ward
 * is waiting on a repeat draw they have not been told about yet.
 */
export function LabPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState(TABS[0])
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const [rejecting, setRejecting] = useState<WorkItem | null>(null)

  const worklist = useQuery({
    queryKey: ['lab-worklist'],
    queryFn: () => api.get<WorkItem[]>('/lab/worklist'),
    refetchInterval: 20_000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['lab-worklist'] })
    queryClient.invalidateQueries({ queryKey: ['patient'] })
  }
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Action failed')

  const collect = useMutation({
    mutationFn: (id: string) => api.post(`/lab/items/${id}/collect`, {}),
    onSuccess: () => { setError(null); invalidate() },
    onError: fail,
  })

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/lab/items/${id}/reject`, { reason }),
    onSuccess: () => { setError(null); invalidate() },
    onError: fail,
  })

  const result = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      api.post(`/lab/items/${id}/result`, { resultValue: value }),
    onSuccess: () => { setError(null); setResults({}); invalidate() },
    onError: fail,
  })

  const verify = useMutation({
    mutationFn: (id: string) => api.post(`/lab/items/${id}/verify`, {}),
    onSuccess: () => { setError(null); invalidate() },
    onError: fail,
  })

  const items = worklist.data ?? []
  const awaitingCollection = items.filter((i) => i.status === 'ORDERED')
  const onBench = items.filter((i) => i.status === 'COLLECTED' || i.status === 'IN_PROGRESS')
  const awaitingVerify = items.filter((i) => i.status === 'RESULTED')

  const shown =
    tab === TABS[0] ? awaitingCollection : tab === TABS[1] ? onBench : awaitingVerify

  const canBench = user?.role === 'LAB_TECH' || user?.role === 'ADMIN'

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Awaiting Collection" value={String(awaitingCollection.length)} />
        <Stat label="On the Bench" value={String(onBench.length)} />
        <Stat label="Awaiting Verification" value={String(awaitingVerify.length)} tone={awaitingVerify.length ? 'warning' : undefined} />
        <Stat
          label="STAT Outstanding"
          value={String(items.filter((i) => i.urgency === 'STAT').length)}
          tone={items.some((i) => i.urgency === 'STAT') ? 'critical' : undefined}
        />
      </div>

      {error && (
        <div className="rounded-sm border border-critical-line bg-critical-bg px-4 py-3 text-sm text-critical">
          {error}
        </div>
      )}

      <GlassPanel className="p-6">
        <TabBar tabs={TABS} active={tab} onChange={setTab} />

        <div className="mt-5 flex max-h-[620px] flex-col gap-2.5 overflow-y-auto pr-1">
          {worklist.isLoading ? (
            <Skeleton className="h-56 rounded-sm" />
          ) : shown.length === 0 ? (
            <p className="rounded-sm border border-dashed border-line px-4 py-10 text-center text-sm text-ink-500">
              Nothing in this queue.
            </p>
          ) : (
            shown.map((i) => (
              <div
                key={i.id}
                className="rounded-sm border border-line bg-header p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-full px-2 py-0.5 text-2xs font-bold uppercase tracking-wide text-white"
                        style={{ background: urgencyTone[i.urgency].bg }}
                      >
                        {urgencyTone[i.urgency].label}
                      </span>
                      <p className="text-sm font-medium text-ink-900">{i.test.name}</p>
                      <span className="font-mono text-2xs text-ink-500">{i.test.code}</span>
                    </div>
                    <p className="mt-1 text-xs text-ink-600">
                      {i.patient.name} · {calculateAge(i.patient.dob)}y {i.patient.sex.toLowerCase()} ·{' '}
                      {i.patient.ipNumber ?? i.patient.opNumber ?? '—'}
                      {i.patient.bed ? ` · ${i.patient.bed}` : ''}
                    </p>
                    <p className="mt-0.5 text-2xs text-ink-500">
                      {i.test.specimen} · ordered {formatDateTime(i.orderedAt)} by {i.orderedBy}
                    </p>
                    {i.clinicalNotes && (
                      <p className="mt-1.5 rounded-xs bg-header px-2.5 py-1.5 text-xs text-ink-700">
                        {i.clinicalNotes}
                      </p>
                    )}
                    {i.rejectionReason && (
                      <p className="mt-1.5 text-xs text-critical">
                        Previous specimen rejected: {i.rejectionReason} — repeat draw needed
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-2xs text-ink-500">Reference</p>
                    <p className="font-mono text-xs text-ink-700">
                      {i.test.refRange}
                      {i.test.unit ? ` ${i.test.unit}` : ''}
                    </p>
                  </div>
                </div>

                {/* --- actions per stage --- */}
                {i.status === 'ORDERED' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={collect.isPending}
                      onClick={() => collect.mutate(i.id)}
                      className="rounded-xs bg-primary-600 px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
                    >
                      Specimen collected
                    </button>
                  </div>
                )}

                {(i.status === 'COLLECTED' || i.status === 'IN_PROGRESS') && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-2xs text-ink-600">
                      {i.specimenLabel} · collected {i.collectedAt ? formatDateTime(i.collectedAt) : '—'}
                    </span>
                    <input
                      value={results[i.id] ?? ''}
                      onChange={(e) => setResults((r) => ({ ...r, [i.id]: e.target.value }))}
                      placeholder={i.test.refLow !== null ? `Value (${i.test.unit ?? ''})` : 'Result'}
                      className="w-40 rounded-xs border border-line bg-header px-3 py-2 font-mono text-sm text-ink-900 outline-none placeholder:text-ink-500 focus:border-primary-600"
                    />
                    <button
                      type="button"
                      disabled={!canBench || !results[i.id] || result.isPending}
                      onClick={() => result.mutate({ id: i.id, value: results[i.id]! })}
                      className="rounded-xs bg-primary-600 px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-35"
                    >
                      Enter result
                    </button>
                    <button
                      type="button"
                      disabled={!canBench || reject.isPending}
                      onClick={() => setRejecting(i)}
                      className="rounded-xs border border-line px-3 py-2 text-xs text-ink-600 hover:border-critical-line hover:text-critical"
                    >
                      Reject specimen
                    </button>
                  </div>
                )}

                {i.status === 'RESULTED' && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span className="font-mono text-md font-bold tabular text-ink-900">
                      {i.resultValue}
                      {i.test.unit ? <span className="ml-1 text-xs text-ink-600">{i.test.unit}</span> : null}
                    </span>
                    {i.flag && i.flag !== 'NORMAL' && (
                      <Badge status={i.flag === 'HIGH' ? 'critical' : 'warning'}>{i.flag}</Badge>
                    )}
                    <span className="text-2xs text-ink-500">
                      entered {i.resultedAt ? formatDateTime(i.resultedAt) : '—'}
                    </span>
                    <button
                      type="button"
                      disabled={!canBench || verify.isPending}
                      onClick={() => verify.mutate(i.id)}
                      className="rounded-xs bg-primary-600 px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-35"
                    >
                      Verify &amp; publish to chart
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {tab === TABS[2] && awaitingVerify.length > 0 && (
          <p className="mt-4 text-xs text-ink-500">
            A result must be verified by someone other than the technologist who ran it. Only verified results
            reach the patient chart.
          </p>
        )}
      </GlassPanel>

      <ReasonDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => {
          if (rejecting) reject.mutate({ id: rejecting.id, reason })
          setRejecting(null)
        }}
        title="Reject specimen"
        description="The order returns to the collection queue so the ward knows a repeat draw is needed."
        label="Why is the specimen unusable?"
        confirmLabel="Reject specimen"
        tone="danger"
        pending={reject.isPending}
        options={[
          { value: 'Haemolysed', label: 'Haemolysed' },
          { value: 'Clotted', label: 'Clotted' },
          { value: 'Insufficient volume', label: 'Insufficient volume' },
          { value: 'Wrong tube type', label: 'Wrong tube / anticoagulant' },
          { value: 'Unlabelled or mislabelled', label: 'Unlabelled or mislabelled' },
          { value: 'Delayed transport', label: 'Delayed transport — sample degraded' },
        ]}
      >
        {rejecting && (
          <div className="border border-line-strong bg-header px-3 py-2.5">
            <p className="text-md font-semibold text-ink-900">{rejecting.test.name}</p>
            <p className="mt-0.5 text-sm text-ink-700">
              {rejecting.patient.name} · {rejecting.test.specimen}
            </p>
          </div>
        )}
      </ReasonDialog>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warning' | 'critical' }) {
  const color =
    tone === 'critical'
      ? 'var(--color-critical)'
      : tone === 'warning'
        ? 'var(--color-warning)'
        : 'var(--color-ink-900)'
  return (
    <GlassPanel className="p-4">
      <p className="text-2xs font-medium uppercase tracking-wide text-ink-600">{label}</p>
      <p className="mt-1.5 font-mono text-lg tabular font-semibold" style={{ color }}>
        {value}
      </p>
    </GlassPanel>
  )
}
