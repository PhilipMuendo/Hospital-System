import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/apiClient'
import { GlassPanel } from '../components/atoms/GlassPanel'
import { Badge } from '../components/atoms/Badge'
import { Skeleton } from '../components/atoms/Skeleton'
import { calculateAge, formatDateTime } from '../lib/format'
import type { Ward } from '../lib/types'

interface Administration {
  id: string
  status: string
  administeredAt: string
  reason: string | null
}

interface MedItem {
  id: string
  drug: string
  form: string
  controlled: boolean
  dose: string
  route: string
  frequency: string
  dosesPerDay: number | null
  quantityDispensed: number
  givenToday: number
  administrations: Administration[]
}

interface BoardPatient {
  id: string
  name: string
  bed: string | null
  ipNumber: string | null
  dob: string
  sex: string
  allergies: string[]
  codeStatus: string
  physician: string | null
  latestVitals: { id: string; label: string; value: string; unit: string; status: string; recordedAt: string }[]
  worstVital: string
  unreviewedLabs: { id: string; test: string; flag: string }[]
  medication: { dueToday: number; givenToday: number; outstanding: number; items: MedItem[] }
}

interface Staff {
  id: string
  name: string
  role: string
}

export function WardPage() {
  const queryClient = useQueryClient()
  const [wardId, setWardId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const wardsQuery = useQuery({ queryKey: ['wards'], queryFn: () => api.get<Ward[]>('/wards') })
  const staffQuery = useQuery({ queryKey: ['staff'], queryFn: () => api.get<Staff[]>('/auth/staff') })

  useEffect(() => {
    if (!wardId && wardsQuery.data && wardsQuery.data.length > 0) setWardId(wardsQuery.data[0].id)
  }, [wardsQuery.data, wardId])

  const board = useQuery({
    queryKey: ['ward-board', wardId],
    queryFn: () => api.get<BoardPatient[]>(`/wards/${wardId}/board`),
    enabled: !!wardId,
    refetchInterval: 60_000,
  })

  const administer = useMutation({
    mutationFn: (body: { itemId: string } & Record<string, unknown>) => {
      const { itemId, ...rest } = body
      return api.post(`/prescription-items/${itemId}/administer`, rest)
    },
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['ward-board'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not record administration'),
  })

  const patients = board.data ?? []
  const roundOutstanding = patients.reduce((s, p) => s + p.medication.outstanding, 0)
  const criticalCount = patients.filter((p) => p.worstVital === 'CRITICAL').length

  return (
    <div className="flex flex-col gap-6">
      <GlassPanel className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {(wardsQuery.data ?? []).map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setWardId(w.id)}
                className={`rounded-[var(--radius-xs)] border px-3 py-2 text-[13px] transition-colors ${
                  wardId === w.id
                    ? 'border-accent-500/50 bg-accent-500/12 text-mist-50'
                    : 'border-white/8 text-mist-400 hover:text-mist-200'
                }`}
              >
                {w.name}
                <span className="ml-1.5 text-[11px] text-mist-600">
                  {w.occupied}/{w.bedCapacity}
                </span>
              </button>
            ))}
          </div>
          <div className="flex gap-4 text-[12.5px]">
            <span className="text-mist-500">
              Doses outstanding:{' '}
              <span className={roundOutstanding > 0 ? 'text-status-warning' : 'text-mist-300'}>
                {roundOutstanding}
              </span>
            </span>
            <span className="text-mist-500">
              Critical:{' '}
              <span className={criticalCount > 0 ? 'text-status-critical' : 'text-mist-300'}>{criticalCount}</span>
            </span>
          </div>
        </div>
      </GlassPanel>

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-status-critical/30 bg-status-critical/10 px-4 py-3 text-[13px] text-status-critical">
          {error}
        </div>
      )}

      {board.isLoading ? (
        <Skeleton className="h-96 rounded-[var(--radius-sm)]" />
      ) : patients.length === 0 ? (
        <GlassPanel className="p-10 text-center text-[13.5px] text-mist-600">
          No patients admitted to this ward.
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-3">
          {patients.map((p) => (
            <GlassPanel key={p.id} className="p-5">
              <button
                type="button"
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                className="w-full text-left"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-[var(--radius-xs)] bg-surface-800 px-2 py-0.5 font-mono text-[12px] text-mist-200">
                        {p.bed ?? '—'}
                      </span>
                      <p className="text-[15px] font-semibold text-mist-50">{p.name}</p>
                      <span className="text-[12px] text-mist-500">
                        {calculateAge(p.dob)}y {p.sex.toLowerCase()}
                      </span>
                      {p.worstVital === 'CRITICAL' && <Badge status="critical">CRITICAL</Badge>}
                      {p.worstVital === 'WARNING' && <Badge status="warning">WATCH</Badge>}
                      {p.codeStatus !== 'FULL_CODE' && <Badge status="warning">{p.codeStatus}</Badge>}
                    </div>

                    {p.allergies.length > 0 && (
                      <p className="mt-1 text-[12px] text-status-warning">
                        Allergies: {p.allergies.join(', ')}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      {p.latestVitals.slice(0, 5).map((v) => (
                        <span key={v.id} className="text-[12px] text-mist-500">
                          {v.label}{' '}
                          <span
                            className="font-mono tabular"
                            style={{
                              color:
                                v.status === 'CRITICAL'
                                  ? 'var(--color-status-critical)'
                                  : v.status === 'WARNING'
                                    ? 'var(--color-status-warning)'
                                    : 'var(--color-mist-200)',
                            }}
                          >
                            {v.value}
                          </span>{' '}
                          {v.unit}
                        </span>
                      ))}
                      {p.latestVitals.length === 0 && (
                        <span className="text-[12px] text-mist-600">No observations recorded</span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-[11px] uppercase tracking-wide text-mist-600">Drug round</p>
                    <p
                      className="font-mono text-[18px] font-semibold tabular"
                      style={{
                        color:
                          p.medication.outstanding > 0
                            ? 'var(--color-status-warning)'
                            : 'var(--color-status-healthy)',
                      }}
                    >
                      {p.medication.givenToday}/{p.medication.dueToday}
                    </p>
                    {p.unreviewedLabs.length > 0 && (
                      <p className="mt-1 text-[11.5px] text-accent-400">
                        {p.unreviewedLabs.length} new result{p.unreviewedLabs.length === 1 ? '' : 's'}
                      </p>
                    )}
                  </div>
                </div>
              </button>

              {expanded === p.id && (
                <div className="mt-4 border-t border-white/6 pt-4">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-mist-500">
                    Medication administration record
                  </p>

                  {p.medication.items.length === 0 ? (
                    <p className="mt-2 text-[13px] text-mist-600">No active prescriptions.</p>
                  ) : (
                    <div className="mt-2 flex flex-col gap-2">
                      {p.medication.items.map((m) => (
                        <MedRow
                          key={m.id}
                          item={m}
                          staff={(staffQuery.data ?? []).filter((s) => s.id !== undefined)}
                          pending={administer.isPending}
                          onGive={(body) => administer.mutate({ itemId: m.id, ...body })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </GlassPanel>
          ))}
        </div>
      )}
    </div>
  )
}

function MedRow({
  item,
  staff,
  pending,
  onGive,
}: {
  item: MedItem
  staff: Staff[]
  pending: boolean
  onGive: (body: Record<string, unknown>) => void
}) {
  const [witnessId, setWitnessId] = useState('')

  const complete = item.dosesPerDay !== null && item.givenToday >= item.dosesPerDay
  const notDispensed = item.quantityDispensed === 0

  return (
    <div className="rounded-[var(--radius-xs)] border border-white/6 bg-surface-800/50 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13.5px] text-mist-50">{item.drug}</p>
            {item.controlled && <Badge status="critical">CONTROLLED</Badge>}
            {complete && <Badge status="healthy">ROUND COMPLETE</Badge>}
          </div>
          <p className="mt-0.5 text-[11.5px] text-mist-500">
            {item.dose} · {item.route} · {item.frequency}
            {item.dosesPerDay ? ` · ${item.givenToday}/${item.dosesPerDay} today` : ' · as required'}
          </p>
          {notDispensed && (
            <p className="mt-1 text-[11.5px] text-status-warning">
              Not yet dispensed by pharmacy — nothing has reached the ward.
            </p>
          )}
          {item.administrations.length > 0 && (
            <p className="mt-1 text-[11px] text-mist-600">
              Last: {item.administrations[0].status.replace('_', ' ').toLowerCase()} at{' '}
              {formatDateTime(item.administrations[0].administeredAt)}
              {item.administrations[0].reason ? ` — ${item.administrations[0].reason}` : ''}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {item.controlled && (
            <select
              value={witnessId}
              onChange={(e) => setWitnessId(e.target.value)}
              className="rounded-[var(--radius-xs)] border border-white/10 bg-surface-900/70 px-2 py-1.5 text-[11.5px] text-mist-200 outline-none focus:border-accent-500"
            >
              <option value="">Witness…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            disabled={pending || notDispensed || (item.controlled && !witnessId)}
            onClick={() => onGive({ status: 'GIVEN', witnessedById: witnessId || undefined })}
            title={item.controlled && !witnessId ? 'Controlled drugs need a second signature' : undefined}
            className="rounded-[var(--radius-xs)] bg-accent-500 px-3 py-1.5 text-[12px] font-semibold text-charcoal-950 hover:opacity-90 disabled:opacity-35"
          >
            Given
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const reason = window.prompt('Why was this dose not given?')
              if (reason && reason.trim()) onGive({ status: 'OMITTED', reason: reason.trim() })
            }}
            className="rounded-[var(--radius-xs)] border border-white/10 px-3 py-1.5 text-[12px] text-mist-400 hover:text-mist-100"
          >
            Omitted
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const reason = window.prompt('Note the refusal (required)')
              if (reason && reason.trim()) onGive({ status: 'REFUSED', reason: reason.trim() })
            }}
            className="rounded-[var(--radius-xs)] border border-white/10 px-3 py-1.5 text-[12px] text-mist-400 hover:text-mist-100"
          >
            Refused
          </button>
        </div>
      </div>
    </div>
  )
}
