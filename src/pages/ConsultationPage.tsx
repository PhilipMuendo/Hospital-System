import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/apiClient'
import { GlassPanel } from '../components/atoms/GlassPanel'
import { Skeleton } from '../components/atoms/Skeleton'
import { calculateAge } from '../lib/format'
import { useAnnouncer, useQueueStream } from '../lib/useQueueStream'
import { AcuityChip } from './ReceptionPage'

interface Station {
  id: string
  name: string
  kind: string
  room: string | null
}

interface QueueEntry {
  id: string
  token: string
  position: number
  status: string
  acuity: string | null
  waitMinutes: number
  breaching: boolean
  callCount: number
  counter: string | null
  visitId: string
  visitNumber: string
  chiefComplaint: string | null
  patient: { id: string; name: string; opNumber: string | null; dob: string; sex: string }
}

/**
 * The clinician's calling panel.
 *
 * There is deliberately no way to pick a specific patient out of the queue —
 * "Call next" takes whoever the triage-priority ordering says is next. Letting
 * a clinician cherry-pick would quietly undo the triage.
 */
export function ConsultationPage() {
  const queryClient = useQueryClient()
  const announcer = useAnnouncer()
  const [stationId, setStationId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const stationsQuery = useQuery({ queryKey: ['stations'], queryFn: () => api.get<Station[]>('/stations') })
  const rooms = (stationsQuery.data ?? []).filter((s) => s.kind === 'CONSULTATION')

  useEffect(() => {
    if (!stationId && rooms.length > 0) setStationId(rooms[0].id)
  }, [rooms, stationId])

  const queue = useQuery({
    queryKey: ['queue', stationId],
    queryFn: () => api.get<QueueEntry[]>(`/stations/${stationId}/queue`),
    enabled: !!stationId,
    refetchInterval: 30_000,
  })

  useQueueStream({
    stationId,
    onChange: () => queryClient.invalidateQueries({ queryKey: ['queue'] }),
  })

  const entries = queue.data ?? []
  const inService = entries.find((e) => e.status === 'IN_SERVICE')
  const called = entries.find((e) => e.status === 'CALLED')
  const waiting = entries.filter((e) => e.status === 'WAITING')
  const current = inService ?? called

  const callNext = useMutation({
    mutationFn: () => api.post<any>(`/stations/${stationId}/call-next`, {}),
    onSuccess: (t) => {
      setError(null)
      announcer.announce(t.token, t.counter)
      queryClient.invalidateQueries({ queryKey: ['queue'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Queue is empty'),
  })

  const start = useMutation({
    mutationFn: (id: string) => api.post(`/tickets/${id}/start`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queue'] }),
  })

  const complete = useMutation({
    mutationFn: ({ id, closeVisit }: { id: string; closeVisit: boolean }) =>
      api.post(`/tickets/${id}/complete`, { closeVisit, outcome: closeVisit ? 'Consultation complete' : undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queue'] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not complete'),
  })

  const noShow = useMutation({
    mutationFn: (id: string) => api.post<any>(`/tickets/${id}/no-show`),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['queue'] })
      if (!r.finalised) setError('Returned to the queue — they will be called again.')
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <GlassPanel className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {rooms.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setStationId(r.id)}
                className={`rounded-[var(--radius-xs)] border px-3 py-2 text-[13px] transition-colors ${
                  stationId === r.id
                    ? 'border-accent-500/50 bg-accent-500/12 text-mist-50'
                    : 'border-white/8 text-mist-400 hover:text-mist-200'
                }`}
              >
                {r.name}
              </button>
            ))}
          </div>
          <p className="text-[12.5px] text-mist-500">{waiting.length} waiting</p>
        </div>
      </GlassPanel>

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-[13px] text-status-warning">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <GlassPanel className="p-6">
          {!current ? (
            <div className="py-12 text-center">
              <p className="text-[13.5px] text-mist-500">No patient in the room.</p>
              <button
                type="button"
                onClick={() => callNext.mutate()}
                disabled={callNext.isPending || waiting.length === 0}
                className="mt-4 rounded-[var(--radius-xs)] bg-accent-500 px-6 py-3 text-[14px] font-semibold text-charcoal-950 hover:opacity-90 disabled:opacity-35"
              >
                {waiting.length === 0 ? 'Queue empty' : 'Call next patient'}
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[40px] font-bold leading-none text-accent-400">{current.token}</p>
                  <h2 className="mt-2 text-[19px] font-semibold text-mist-50">{current.patient.name}</h2>
                  <p className="mt-0.5 text-[12.5px] text-mist-500">
                    {current.patient.opNumber ?? '—'} · {calculateAge(current.patient.dob)}y{' '}
                    {current.patient.sex.toLowerCase()} · waited {current.waitMinutes}m
                  </p>
                </div>
                {current.acuity && <AcuityChip acuity={current.acuity} />}
              </div>

              {current.chiefComplaint && (
                <p className="mt-4 rounded-[var(--radius-xs)] bg-surface-800/60 px-4 py-3 text-[13.5px] text-mist-300">
                  “{current.chiefComplaint}”
                </p>
              )}

              <div className="mt-6 flex flex-wrap gap-2">
                {current.status === 'CALLED' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => start.mutate(current.id)}
                      className="rounded-[var(--radius-xs)] bg-accent-500 px-5 py-2.5 text-[13px] font-semibold text-charcoal-950 hover:opacity-90"
                    >
                      Patient present — start
                    </button>
                    <button
                      type="button"
                      onClick={() => announcer.announce(current.token, current.counter)}
                      className="rounded-[var(--radius-xs)] border border-white/10 px-4 py-2.5 text-[13px] text-mist-300 hover:text-mist-100"
                    >
                      Announce again
                    </button>
                    <button
                      type="button"
                      onClick={() => noShow.mutate(current.id)}
                      className="rounded-[var(--radius-xs)] border border-white/10 px-4 py-2.5 text-[13px] text-mist-400 hover:border-status-critical/40 hover:text-status-critical"
                    >
                      No show ({current.callCount}/3)
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => complete.mutate({ id: current.id, closeVisit: true })}
                      className="rounded-[var(--radius-xs)] bg-accent-500 px-5 py-2.5 text-[13px] font-semibold text-charcoal-950 hover:opacity-90"
                    >
                      Complete & close visit
                    </button>
                    <button
                      type="button"
                      onClick={() => complete.mutate({ id: current.id, closeVisit: false })}
                      className="rounded-[var(--radius-xs)] border border-white/10 px-4 py-2.5 text-[13px] text-mist-300 hover:text-mist-100"
                    >
                      Complete (route onward)
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </GlassPanel>

        <GlassPanel className="p-6">
          <h2 className="text-[15px] font-semibold text-mist-50">Waiting</h2>
          <p className="mt-1 text-[12px] text-mist-500">
            Ordered by triage priority, not arrival. Long waits are promoted automatically.
          </p>

          <div className="mt-4 flex max-h-[460px] flex-col gap-1.5 overflow-y-auto pr-1">
            {queue.isLoading ? (
              <Skeleton className="h-40 rounded-[var(--radius-sm)]" />
            ) : waiting.length === 0 ? (
              <p className="rounded-[var(--radius-sm)] border border-dashed border-white/8 px-4 py-8 text-center text-[13px] text-mist-600">
                Nobody waiting.
              </p>
            ) : (
              waiting.map((q, i) => (
                <div
                  key={q.id}
                  className="flex items-center gap-3 rounded-[var(--radius-xs)] border border-white/6 bg-surface-800/50 px-3 py-2.5"
                >
                  <span className="w-5 shrink-0 text-center text-[12px] text-mist-600">{i + 1}</span>
                  <span className="font-mono text-[14px] font-bold tabular text-mist-100">{q.token}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-mist-200">{q.patient.name}</p>
                    {q.acuity && <AcuityChip acuity={q.acuity} />}
                  </div>
                  <span className={`shrink-0 text-[12px] ${q.breaching ? 'text-status-critical' : 'text-mist-500'}`}>
                    {q.waitMinutes}m{q.breaching ? ' ⚠' : ''}
                  </span>
                </div>
              ))
            )}
          </div>
        </GlassPanel>
      </div>
    </div>
  )
}
