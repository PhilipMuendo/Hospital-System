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
  const [onwardId, setOnwardId] = useState('')

  const stationsQuery = useQuery({ queryKey: ['stations'], queryFn: () => api.get<Station[]>('/stations') })
  const rooms = (stationsQuery.data ?? []).filter((s) => s.kind === 'CONSULTATION')
  // Where a patient can be sent after the consultation. Excludes reception,
  // which is where they came from.
  const onwardStations = (stationsQuery.data ?? []).filter(
    (s) => s.kind !== 'RECEPTION' && s.id !== stationId,
  )

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
    mutationFn: ({ id, nextStationId }: { id: string; nextStationId?: string }) =>
      api.post(`/tickets/${id}/complete`, {
        // Exactly one of these is meaningful: either the patient is routed
        // onward or the visit is closed. The server rejects the ambiguous case.
        closeVisit: !nextStationId,
        nextStationId,
        outcome: nextStationId ? undefined : 'Consultation complete',
      }),
    onSuccess: (r: any) => {
      setError(null)
      setOnwardId('')
      if (r?.next) setError(`Sent onward — new token ${r.next.token}`)
      queryClient.invalidateQueries({ queryKey: ['queue'] })
    },
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
                className={`rounded-xs border px-3 py-2 text-sm transition-colors ${
                  stationId === r.id
                    ? 'border-primary-200 bg-primary-600/12 text-ink-900'
                    : 'border-line text-ink-600 hover:text-ink-800'
                }`}
              >
                {r.name}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-600">{waiting.length} waiting</p>
        </div>
      </GlassPanel>

      {error && (
        <div className="rounded-sm border border-warning-line bg-warning-bg px-4 py-3 text-sm text-warning">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <GlassPanel className="p-6">
          {!current ? (
            <div className="py-12 text-center">
              <p className="text-sm text-ink-600">No patient in the room.</p>
              <button
                type="button"
                onClick={() => callNext.mutate()}
                disabled={callNext.isPending || waiting.length === 0}
                className="mt-4 rounded-xs bg-primary-600 px-6 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-35"
              >
                {waiting.length === 0 ? 'Queue empty' : 'Call next patient'}
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-3xl font-bold leading-none text-primary-700">{current.token}</p>
                  <h2 className="mt-2 text-lg font-semibold text-ink-900">{current.patient.name}</h2>
                  <p className="mt-0.5 text-xs text-ink-600">
                    {current.patient.opNumber ?? '—'} · {calculateAge(current.patient.dob)}y{' '}
                    {current.patient.sex.toLowerCase()} · waited {current.waitMinutes}m
                  </p>
                </div>
                {current.acuity && <AcuityChip acuity={current.acuity} />}
              </div>

              {current.chiefComplaint && (
                <p className="mt-4 rounded-xs bg-header px-4 py-3 text-sm text-ink-700">
                  “{current.chiefComplaint}”
                </p>
              )}

              <div className="mt-6 flex flex-wrap gap-2">
                {current.status === 'CALLED' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => start.mutate(current.id)}
                      className="rounded-xs bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
                    >
                      Patient present — start
                    </button>
                    <button
                      type="button"
                      onClick={() => announcer.announce(current.token, current.counter)}
                      className="rounded-xs border border-line px-4 py-2.5 text-sm text-ink-700 hover:text-ink-900"
                    >
                      Announce again
                    </button>
                    <button
                      type="button"
                      onClick={() => noShow.mutate(current.id)}
                      className="rounded-xs border border-line px-4 py-2.5 text-sm text-ink-600 hover:border-critical-line hover:text-critical"
                    >
                      No show ({current.callCount}/3)
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={complete.isPending}
                      onClick={() => complete.mutate({ id: current.id })}
                      className="rounded-xs bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
                    >
                      Complete &amp; discharge
                    </button>

                    <div className="flex items-center gap-2">
                      <select
                        value={onwardId}
                        onChange={(e) => setOnwardId(e.target.value)}
                        className="rounded-xs border border-line bg-header px-3 py-2.5 text-sm text-ink-900 outline-none focus:border-primary-600"
                      >
                        <option value="">Send to…</option>
                        {onwardStations.map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!onwardId || complete.isPending}
                        onClick={() => complete.mutate({ id: current.id, nextStationId: onwardId })}
                        className="rounded-xs border border-line px-4 py-2.5 text-sm text-ink-700 hover:text-ink-900 disabled:opacity-35"
                      >
                        Send onward
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </GlassPanel>

        <GlassPanel className="p-6">
          <h2 className="text-base font-semibold text-ink-900">Waiting</h2>
          <p className="mt-1 text-xs text-ink-600">
            Ordered by triage priority, not arrival. Long waits are promoted automatically.
          </p>

          <div className="mt-4 flex max-h-[460px] flex-col gap-1.5 overflow-y-auto pr-1">
            {queue.isLoading ? (
              <Skeleton className="h-40 rounded-sm" />
            ) : waiting.length === 0 ? (
              <p className="rounded-sm border border-dashed border-line px-4 py-8 text-center text-sm text-ink-500">
                Nobody waiting.
              </p>
            ) : (
              waiting.map((q, i) => (
                <div
                  key={q.id}
                  className="flex items-center gap-3 rounded-xs border border-line bg-header px-3 py-2.5"
                >
                  <span className="w-5 shrink-0 text-center text-xs text-ink-500">{i + 1}</span>
                  <span className="font-mono text-sm font-bold tabular text-ink-900">{q.token}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink-800">{q.patient.name}</p>
                    {q.acuity && <AcuityChip acuity={q.acuity} />}
                  </div>
                  <span className={`shrink-0 text-xs ${q.breaching ? 'text-critical' : 'text-ink-600'}`}>
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
