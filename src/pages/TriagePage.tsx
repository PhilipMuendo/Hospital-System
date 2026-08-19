import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/apiClient'
import { GlassPanel } from '../components/atoms/GlassPanel'
import { Skeleton } from '../components/atoms/Skeleton'
import { calculateAge } from '../lib/format'
import { useQueueStream } from '../lib/useQueueStream'
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
  visitId: string
  visitNumber: string
  chiefComplaint: string | null
  patient: { id: string; name: string; opNumber: string | null; dob: string; sex: string }
}

/**
 * SATS bands with the wording a triage nurse actually applies. The discriminator
 * text matters — an acuity picker with only colours invites guessing.
 */
const ACUITIES = [
  { value: 'RED', label: 'Red', hint: 'Airway/breathing/circulation compromise. See now.', color: '#dc2626' },
  { value: 'ORANGE', label: 'Orange', hint: 'Very urgent. Target under 10 minutes.', color: '#ea580c' },
  { value: 'YELLOW', label: 'Yellow', hint: 'Urgent. Target under 1 hour.', color: '#ca8a04' },
  { value: 'GREEN', label: 'Green', hint: 'Routine. Target under 4 hours.', color: '#16a34a' },
  { value: 'BLUE', label: 'Blue', hint: 'Dead on arrival.', color: '#2563eb' },
] as const

export function TriagePage() {
  const queryClient = useQueryClient()
  const [active, setActive] = useState<QueueEntry | null>(null)
  const [error, setError] = useState<string | null>(null)

  const stationsQuery = useQuery({ queryKey: ['stations'], queryFn: () => api.get<Station[]>('/stations') })
  const triage = stationsQuery.data?.find((s) => s.kind === 'TRIAGE')
  const consultRooms = (stationsQuery.data ?? []).filter((s) => s.kind === 'CONSULTATION')

  const queue = useQuery({
    queryKey: ['queue', triage?.id],
    queryFn: () => api.get<QueueEntry[]>(`/stations/${triage!.id}/queue`),
    enabled: !!triage,
    refetchInterval: 30_000,
  })

  useQueueStream({
    stationId: triage?.id ?? null,
    onChange: () => queryClient.invalidateQueries({ queryKey: ['queue'] }),
  })

  const callNext = useMutation({
    mutationFn: () => api.post<any>(`/stations/${triage!.id}/call-next`, {}),
    onSuccess: (t) => {
      setError(null)
      const entry = (queue.data ?? []).find((q) => q.id === t.id)
      if (entry) setActive(entry)
      queryClient.invalidateQueries({ queryKey: ['queue'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nobody waiting'),
  })

  if (!triage) {
    return <GlassPanel className="p-8 text-center text-[13.5px] text-mist-500">No triage station configured.</GlassPanel>
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <GlassPanel className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[17px] font-semibold text-mist-50">Triage queue</h2>
            <p className="mt-1 text-[12.5px] text-mist-500">
              {(queue.data ?? []).length} waiting · ordered by arrival until assessed
            </p>
          </div>
          <button
            type="button"
            onClick={() => callNext.mutate()}
            disabled={callNext.isPending || (queue.data ?? []).length === 0}
            className="rounded-[var(--radius-xs)] bg-accent-500 px-4 py-2.5 text-[13px] font-semibold text-charcoal-950 hover:opacity-90 disabled:opacity-35"
          >
            Call next
          </button>
        </div>

        <div className="mt-5 flex max-h-[560px] flex-col gap-2 overflow-y-auto pr-1">
          {queue.isLoading ? (
            <Skeleton className="h-52 rounded-[var(--radius-sm)]" />
          ) : (queue.data ?? []).length === 0 ? (
            <p className="rounded-[var(--radius-sm)] border border-dashed border-white/8 px-4 py-8 text-center text-[13px] text-mist-600">
              Nobody waiting for triage.
            </p>
          ) : (
            (queue.data ?? []).map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => setActive(q)}
                className={`flex items-center gap-3 rounded-[var(--radius-xs)] border px-4 py-3 text-left transition-colors ${
                  active?.id === q.id
                    ? 'border-accent-500/50 bg-accent-500/10'
                    : 'border-white/6 bg-surface-800/50 hover:border-white/12'
                }`}
              >
                <span className="font-mono text-[16px] font-bold tabular text-accent-400">{q.token}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] text-mist-50">{q.patient.name}</p>
                  <p className="truncate text-[11.5px] text-mist-500">
                    {calculateAge(q.patient.dob)}y {q.patient.sex.toLowerCase()}
                    {q.chiefComplaint ? ` · ${q.chiefComplaint}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-[12px] ${q.breaching ? 'text-status-critical' : 'text-mist-500'}`}>
                    {q.waitMinutes}m
                  </p>
                  {q.status === 'CALLED' && <p className="text-[10.5px] text-status-warning">called ×{q.callCount}</p>}
                </div>
              </button>
            ))
          )}
        </div>
      </GlassPanel>

      <GlassPanel className="p-6">
        {!active ? (
          <p className="py-16 text-center text-[13.5px] text-mist-600">
            Select a patient, or press <span className="text-mist-300">Call next</span>.
          </p>
        ) : (
          <TriageForm
            entry={active}
            consultRooms={consultRooms}
            onError={setError}
            onDone={() => {
              setActive(null)
              queryClient.invalidateQueries({ queryKey: ['queue'] })
            }}
          />
        )}
        {error && <p className="mt-3 text-[13px] text-status-critical">{error}</p>}
      </GlassPanel>
    </div>
  )
}

function TriageForm({
  entry,
  consultRooms,
  onDone,
  onError,
}: {
  entry: QueueEntry
  consultRooms: Station[]
  onDone: () => void
  onError: (m: string) => void
}) {
  const [acuity, setAcuity] = useState<string>('GREEN')
  const [vitals, setVitals] = useState({
    temperature: '',
    pulse: '',
    bloodPressure: '',
    spo2: '',
    respiratory: '',
    weightKg: '',
  })
  const [notes, setNotes] = useState('')
  const [nextStationId, setNextStationId] = useState(consultRooms[0]?.id ?? '')

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/visits/${entry.visitId}/triage`, {
        acuity,
        ...Object.fromEntries(Object.entries(vitals).filter(([, v]) => v !== '')),
        notes: notes || undefined,
        nextStationId,
      }),
    onSuccess: onDone,
    onError: (e) => onError(e instanceof ApiError ? e.message : 'Could not save triage'),
  })

  const set = (k: keyof typeof vitals) => (e: { target: { value: string } }) =>
    setVitals((v) => ({ ...v, [k]: e.target.value }))

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold text-mist-50">{entry.patient.name}</h2>
          <p className="mt-0.5 text-[12.5px] text-mist-500">
            {entry.token} · {entry.visitNumber} · {calculateAge(entry.patient.dob)}y{' '}
            {entry.patient.sex.toLowerCase()}
          </p>
        </div>
        {entry.acuity && <AcuityChip acuity={entry.acuity} />}
      </div>

      {entry.chiefComplaint && (
        <p className="mt-3 rounded-[var(--radius-xs)] bg-surface-800/60 px-3 py-2 text-[13px] text-mist-300">
          “{entry.chiefComplaint}”
        </p>
      )}

      <p className="mt-5 text-[11px] font-medium uppercase tracking-wide text-mist-500">Observations</p>
      <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3">
        <VitalInput label="Temp °C" value={vitals.temperature} onChange={set('temperature')} placeholder="37.0" />
        <VitalInput label="Pulse bpm" value={vitals.pulse} onChange={set('pulse')} placeholder="78" />
        <VitalInput label="BP mmHg" value={vitals.bloodPressure} onChange={set('bloodPressure')} placeholder="120/80" />
        <VitalInput label="SpO2 %" value={vitals.spo2} onChange={set('spo2')} placeholder="98" />
        <VitalInput label="Resp /min" value={vitals.respiratory} onChange={set('respiratory')} placeholder="16" />
        <VitalInput label="Weight kg" value={vitals.weightKg} onChange={set('weightKg')} placeholder="68" />
      </div>

      <p className="mt-5 text-[11px] font-medium uppercase tracking-wide text-mist-500">
        Triage category (SATS)
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {ACUITIES.map((a) => (
          <button
            key={a.value}
            type="button"
            onClick={() => setAcuity(a.value)}
            className={`flex items-center gap-3 rounded-[var(--radius-xs)] border px-3 py-2.5 text-left transition-colors ${
              acuity === a.value ? 'border-white/25 bg-white/8' : 'border-white/6 hover:border-white/12'
            }`}
          >
            <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: a.color }} />
            <span className="text-[13px] font-semibold text-mist-50">{a.label}</span>
            <span className="text-[11.5px] text-mist-500">{a.hint}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-mist-500">
            Send to
          </label>
          <select
            value={nextStationId}
            onChange={(e) => setNextStationId(e.target.value)}
            className="w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-900/70 px-3 py-2 text-[13px] text-mist-100 outline-none focus:border-accent-500"
          >
            {consultRooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-mist-500">
            Triage note
          </label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the clinician must know first"
            className="w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-900/70 px-3 py-2 text-[13px] text-mist-100 outline-none placeholder:text-mist-600 focus:border-accent-500"
          />
        </div>
      </div>

      <button
        type="button"
        disabled={submit.isPending || !nextStationId}
        onClick={() => submit.mutate()}
        className="mt-5 w-full rounded-[var(--radius-xs)] bg-accent-500 px-5 py-3 text-[13.5px] font-semibold text-charcoal-950 hover:opacity-90 disabled:opacity-40"
      >
        {submit.isPending ? 'Saving…' : 'Save triage & send to consultation'}
      </button>
    </>
  )
}

function VitalInput({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="mb-1 block text-[10.5px] text-mist-600">{label}</label>
      <input
        {...props}
        className="w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-900/70 px-2.5 py-2 font-mono text-[13px] tabular text-mist-100 outline-none placeholder:text-mist-700 focus:border-accent-500"
      />
    </div>
  )
}
