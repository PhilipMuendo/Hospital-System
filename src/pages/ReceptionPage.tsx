import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/apiClient'
import { GlassPanel } from '../components/atoms/GlassPanel'
import { Badge } from '../components/atoms/Badge'
import { Skeleton } from '../components/atoms/Skeleton'
import { TableRow } from '../components/molecules/TableRow'
import { calculateAge, formatDate, formatDateTime } from '../lib/format'
import { useQueueStream } from '../lib/useQueueStream'

interface Match {
  id: string
  opNumber: string | null
  ipNumber: string | null
  name: string
  dob: string
  sex: string
  phone: string | null
  nationalId: string | null
  status: string
  lastVisitAt: string | null
  hasOpenVisit: boolean
}

interface Station {
  id: string
  code: string
  name: string
  kind: string
  room: string | null
}

interface OpenVisit {
  id: string
  visitNumber: string
  type: string
  acuity: string | null
  arrivedAt: string
  patient: { id: string; name: string; opNumber: string | null }
  currentStation: { id: string; name: string } | null
  tickets: { token: string; status: string }[]
}

const VISIT_TYPES = ['REVISIT', 'NEW', 'FOLLOW_UP', 'EMERGENCY'] as const

export function ReceptionPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [selected, setSelected] = useState<Match | null>(null)
  const [showRegister, setShowRegister] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ token: string; visitNumber: string } | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200)
    return () => clearTimeout(t)
  }, [search])

  const stationsQuery = useQuery({ queryKey: ['stations'], queryFn: () => api.get<Station[]>('/stations') })
  const triageStation = stationsQuery.data?.find((s) => s.kind === 'TRIAGE')

  const results = useQuery({
    queryKey: ['reception-search', debounced],
    queryFn: () => api.get<Match[]>(`/reception/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.trim().length >= 3,
  })

  const openVisits = useQuery({
    queryKey: ['visits', 'OPEN'],
    queryFn: () => api.get<OpenVisit[]>('/visits?status=OPEN'),
    refetchInterval: 30_000,
  })

  useQueueStream({
    onChange: () => queryClient.invalidateQueries({ queryKey: ['visits'] }),
  })

  const checkIn = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<any>('/reception/check-in', body),
    onSuccess: (data) => {
      setError(null)
      setIssued({ token: data.ticket.token, visitNumber: data.visit.visitNumber })
      setSelected(null)
      setSearch('')
      queryClient.invalidateQueries({ queryKey: ['visits'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Check-in failed'),
  })

  return (
    <div className="flex flex-col gap-6">
      {issued && (
        <GlassPanel className="border border-accent-500/30 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-mist-500">Token issued</p>
              <p className="mt-1 font-mono text-[38px] font-bold leading-none text-accent-400">{issued.token}</p>
              <p className="mt-1.5 text-[12.5px] text-mist-500">
                Visit {issued.visitNumber} · direct the patient to the triage waiting area
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-[var(--radius-xs)] bg-accent-500 px-4 py-2.5 text-[13px] font-semibold text-charcoal-950 hover:opacity-90"
              >
                Print token
              </button>
              <button
                type="button"
                onClick={() => setIssued(null)}
                className="rounded-[var(--radius-xs)] border border-white/10 px-4 py-2.5 text-[13px] text-mist-300 hover:text-mist-100"
              >
                Next patient
              </button>
            </div>
          </div>
        </GlassPanel>
      )}

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-status-critical/30 bg-status-critical/10 px-4 py-3 text-[13px] text-status-critical">
          {error}
        </div>
      )}

      <GlassPanel className="p-6">
        <h2 className="text-[17px] font-semibold text-mist-50">Check in a patient</h2>
        <p className="mt-1 text-[12.5px] text-mist-500">
          Search by OP number, National ID, phone or name. Register only if there is genuinely no match.
        </p>

        <input
          autoFocus
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setSelected(null)
          }}
          placeholder="OP/2026/00123 · 27650312 · 0722118904 · Otieno"
          className="mt-4 w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-800/60 px-4 py-3 text-[15px] text-mist-100 outline-none placeholder:text-mist-600 focus:border-accent-500"
        />

        {debounced.length >= 3 && (
          <div className="mt-4">
            {results.isLoading ? (
              <Skeleton className="h-28 rounded-[var(--radius-sm)]" />
            ) : (results.data ?? []).length === 0 ? (
              <div className="rounded-[var(--radius-sm)] border border-dashed border-white/8 px-4 py-6 text-center">
                <p className="text-[13px] text-mist-500">No patient matches “{debounced}”.</p>
                <button
                  type="button"
                  onClick={() => setShowRegister(true)}
                  className="mt-3 rounded-[var(--radius-xs)] bg-accent-500 px-4 py-2 text-[13px] font-semibold text-charcoal-950 hover:opacity-90"
                >
                  Register as a new patient
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {(results.data ?? []).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelected(m)}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-xs)] border px-4 py-3 text-left transition-colors ${
                      selected?.id === m.id
                        ? 'border-accent-500/50 bg-accent-500/10'
                        : 'border-white/6 bg-surface-800/50 hover:border-white/12'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[14px] text-mist-50">{m.name}</p>
                      <p className="truncate text-[11.5px] text-mist-500">
                        {m.opNumber ?? 'No OP number'} · {calculateAge(m.dob)}y {m.sex.toLowerCase()}
                        {m.phone ? ` · ${m.phone}` : ''}
                        {m.lastVisitAt ? ` · last seen ${formatDate(m.lastVisitAt)}` : ' · never attended'}
                      </p>
                    </div>
                    {m.hasOpenVisit && <Badge status="warning">ALREADY CHECKED IN</Badge>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {selected && !selected.hasOpenVisit && triageStation && (
          <CheckInForm
            patient={selected}
            stationId={triageStation.id}
            pending={checkIn.isPending}
            onSubmit={(body) => checkIn.mutate({ ...body, patientId: selected.id })}
          />
        )}
        {selected?.hasOpenVisit && (
          <p className="mt-4 rounded-[var(--radius-sm)] border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-[13px] text-status-warning">
            {selected.name} already has an open visit today. Close it before checking them in again.
          </p>
        )}
      </GlassPanel>

      {showRegister && (
        <RegisterForm
          onClose={() => setShowRegister(false)}
          onRegistered={(patient) => {
            setShowRegister(false)
            setSelected({ ...patient, hasOpenVisit: false, lastVisitAt: null } as Match)
            setSearch(patient.name)
          }}
        />
      )}

      <GlassPanel className="p-6">
        <h2 className="text-[17px] font-semibold text-mist-50">Currently in the building</h2>
        <div className="mt-4 max-h-[380px] overflow-y-auto pr-1">
          <TableRow
            columns="1.3fr 1fr 1fr 0.8fr 0.8fr"
            className="text-[11px] font-medium uppercase tracking-wide text-mist-500"
          >
            <span>Patient</span>
            <span>Visit</span>
            <span>Waiting at</span>
            <span>Token</span>
            <span>Arrived</span>
          </TableRow>
          {openVisits.isLoading ? (
            <Skeleton className="mt-2 h-40 rounded-[var(--radius-sm)]" />
          ) : (openVisits.data ?? []).length === 0 ? (
            <p className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-white/8 px-4 py-6 text-center text-[13px] text-mist-600">
              Nobody is currently checked in.
            </p>
          ) : (
            (openVisits.data ?? []).map((v) => (
              <TableRow key={v.id} columns="1.3fr 1fr 1fr 0.8fr 0.8fr">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] text-mist-100">{v.patient.name}</p>
                  <p className="truncate text-[11px] text-mist-600">{v.patient.opNumber ?? '—'}</p>
                </div>
                <div className="min-w-0">
                  <p className="truncate font-mono text-[11.5px] text-mist-400">{v.visitNumber}</p>
                  {v.acuity && <AcuityChip acuity={v.acuity} />}
                </div>
                <span className="truncate text-[12.5px] text-mist-400">{v.currentStation?.name ?? '—'}</span>
                <span className="font-mono text-[13px] tabular text-mist-100">{v.tickets[0]?.token ?? '—'}</span>
                <span className="text-[12px] text-mist-500">{formatDateTime(v.arrivedAt)}</span>
              </TableRow>
            ))
          )}
        </div>
      </GlassPanel>
    </div>
  )
}

export function AcuityChip({ acuity }: { acuity: string }) {
  const map: Record<string, { bg: string; label: string }> = {
    RED: { bg: '#dc2626', label: 'RED · immediate' },
    ORANGE: { bg: '#ea580c', label: 'ORANGE · <10 min' },
    YELLOW: { bg: '#ca8a04', label: 'YELLOW · <60 min' },
    GREEN: { bg: '#16a34a', label: 'GREEN · routine' },
    BLUE: { bg: '#2563eb', label: 'BLUE' },
  }
  const tone = map[acuity] ?? { bg: '#525252', label: acuity }
  return (
    <span
      className="mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
      style={{ background: tone.bg }}
    >
      {tone.label}
    </span>
  )
}

function CheckInForm({
  patient,
  stationId,
  pending,
  onSubmit,
}: {
  patient: Match
  stationId: string
  pending: boolean
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const [type, setType] = useState<(typeof VISIT_TYPES)[number]>(patient.opNumber ? 'REVISIT' : 'NEW')
  const [complaint, setComplaint] = useState('')
  const [payer, setPayer] = useState('SELF_PAY')
  const [shaNumber, setShaNumber] = useState('')

  return (
    <div className="mt-5 rounded-[var(--radius-sm)] border border-white/8 bg-surface-800/40 p-5">
      <p className="text-[13.5px] font-medium text-mist-50">Check in {patient.name}</p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Visit type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className="w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-900/70 px-3 py-2 text-[13px] text-mist-100 outline-none focus:border-accent-500"
          >
            {VISIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === 'EMERGENCY' ? 'EMERGENCY — triage as RED immediately' : t.replace('_', ' ')}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Payer">
          <select
            value={payer}
            onChange={(e) => setPayer(e.target.value)}
            className="w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-900/70 px-3 py-2 text-[13px] text-mist-100 outline-none focus:border-accent-500"
          >
            <option value="SELF_PAY">Self-Pay</option>
            <option value="SHA">SHA</option>
            <option value="IMARA_HEALTH_ASSURANCE">Imara Health Assurance</option>
          </select>
        </Field>

        {payer === 'SHA' && (
          <Field label="SHA number">
            <input
              value={shaNumber}
              onChange={(e) => setShaNumber(e.target.value)}
              placeholder="SHA membership number"
              className="w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-900/70 px-3 py-2 text-[13px] text-mist-100 outline-none placeholder:text-mist-600 focus:border-accent-500"
            />
          </Field>
        )}

        <Field label="Presenting complaint">
          <input
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            placeholder="In the patient's own words"
            className="w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-900/70 px-3 py-2 text-[13px] text-mist-100 outline-none placeholder:text-mist-600 focus:border-accent-500"
          />
        </Field>
      </div>

      {type === 'EMERGENCY' && (
        <p className="mt-3 rounded-[var(--radius-xs)] border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-[12.5px] text-status-critical">
          This patient will be placed at the front of every queue immediately, ahead of formal triage.
        </p>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          onSubmit({
            type,
            chiefComplaint: complaint || undefined,
            payer,
            shaNumber: payer === 'SHA' ? shaNumber || undefined : undefined,
            stationId,
          })
        }
        className="mt-4 rounded-[var(--radius-xs)] bg-accent-500 px-5 py-2.5 text-[13px] font-semibold text-charcoal-950 hover:opacity-90 disabled:opacity-40"
      >
        {pending ? 'Issuing token…' : 'Check in & issue token'}
      </button>
    </div>
  )
}

function RegisterForm({
  onClose,
  onRegistered,
}: {
  onClose: () => void
  onRegistered: (patient: any) => void
}) {
  const [form, setForm] = useState({
    name: '',
    dob: '',
    sex: 'FEMALE',
    phone: '',
    nationalId: '',
    nextOfKinName: '',
    nextOfKinPhone: '',
    nextOfKinRelation: 'Spouse',
  })
  const [error, setError] = useState<string | null>(null)

  const register = useMutation({
    mutationFn: () =>
      api.post<any>('/reception/patients', {
        ...form,
        phone: form.phone || undefined,
        nationalId: form.nationalId || undefined,
      }),
    onSuccess: onRegistered,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Registration failed'),
  })

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <GlassPanel className="p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold text-mist-50">Register a new patient</h2>
        <button type="button" onClick={onClose} className="text-[13px] text-mist-500 hover:text-mist-200">
          Cancel
        </button>
      </div>

      {error && <p className="mt-3 text-[13px] text-status-critical">{error}</p>}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Full name *">
          <Input value={form.name} onChange={set('name')} placeholder="Three names as on the ID" />
        </Field>
        <Field label="Date of birth *">
          <Input type="date" value={form.dob} onChange={set('dob')} />
        </Field>
        <Field label="Sex *">
          <select
            value={form.sex}
            onChange={set('sex')}
            className="w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-900/70 px-3 py-2 text-[13px] text-mist-100 outline-none focus:border-accent-500"
          >
            <option value="FEMALE">Female</option>
            <option value="MALE">Male</option>
            <option value="INTERSEX">Intersex</option>
          </select>
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={set('phone')} placeholder="0722 118 904" />
        </Field>
        <Field label="National ID">
          <Input value={form.nationalId} onChange={set('nationalId')} placeholder="Leave blank for minors" />
        </Field>
        <Field label="Next of kin name *">
          <Input value={form.nextOfKinName} onChange={set('nextOfKinName')} />
        </Field>
        <Field label="Next of kin phone *">
          <Input value={form.nextOfKinPhone} onChange={set('nextOfKinPhone')} />
        </Field>
        <Field label="Relationship *">
          <Input value={form.nextOfKinRelation} onChange={set('nextOfKinRelation')} />
        </Field>
      </div>

      <button
        type="button"
        disabled={register.isPending || !form.name || !form.dob || !form.nextOfKinName || !form.nextOfKinPhone}
        onClick={() => register.mutate()}
        className="mt-5 rounded-[var(--radius-xs)] bg-accent-500 px-5 py-2.5 text-[13px] font-semibold text-charcoal-950 hover:opacity-90 disabled:opacity-40"
      >
        {register.isPending ? 'Registering…' : 'Register & issue OP number'}
      </button>
    </GlassPanel>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-mist-500">{label}</label>
      {children}
    </div>
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-900/70 px-3 py-2 text-[13px] text-mist-100 outline-none placeholder:text-mist-600 focus:border-accent-500"
    />
  )
}
