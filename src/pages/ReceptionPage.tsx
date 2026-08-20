import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/apiClient'
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  LoadingRows,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  StatusChip,
  TBody,
  TD,
  TDPrimary,
  TH,
  THead,
  TR,
  TextInput,
  TriageBadge,
  useToast,
} from '../components/ui'
import { calculateAge, formatDate, formatDateTime } from '../lib/format'
import { useHotkeys } from '../lib/useHotkeys'
import { useQueueStream } from '../lib/useQueueStream'

/**
 * Reception.
 *
 * The busiest keyboard workflow in the building. A clerk doing 200 check-ins a
 * day should never need the mouse:
 *
 *   /            focus the search box
 *   ↑ ↓          move through results
 *   Enter        select the highlighted patient, then confirm the check-in
 *   Esc          clear the search / close the dialog
 *
 * The search covers the three identifiers a returning patient actually
 * produces at the desk — OP number, National ID, phone — plus name, in one
 * field, because asking a clerk to pick a search *type* first is a step that
 * exists for the database's benefit, not theirs.
 */

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
  name: string
  kind: string
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

const VISIT_TYPES = [
  { value: 'REVISIT', label: 'Revisit — has attended before' },
  { value: 'NEW', label: 'New patient' },
  { value: 'FOLLOW_UP', label: 'Follow-up appointment' },
  { value: 'EMERGENCY', label: 'Emergency — triage as Red immediately' },
]

const PAYERS = [
  { value: 'SELF_PAY', label: 'Self-pay' },
  { value: 'SHA', label: 'SHA' },
  { value: 'IMARA_HEALTH_ASSURANCE', label: 'Imara Health Assurance' },
]

export function ReceptionPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const searchRef = useRef<HTMLInputElement>(null)

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [selected, setSelected] = useState<Match | null>(null)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ token: string; visitNumber: string; name: string } | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 180)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => setHighlight(0), [debounced])

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

  useQueueStream({ onChange: () => queryClient.invalidateQueries({ queryKey: ['visits'] }) })

  const matches = results.data ?? []

  useHotkeys([
    { combo: '/', description: 'Focus search', handler: () => searchRef.current?.focus() },
    {
      combo: 'ArrowDown',
      whileTyping: true,
      handler: () => setHighlight((h) => Math.min(h + 1, matches.length - 1)),
      enabled: matches.length > 0 && !selected,
    },
    {
      combo: 'ArrowUp',
      whileTyping: true,
      handler: () => setHighlight((h) => Math.max(h - 1, 0)),
      enabled: matches.length > 0 && !selected,
    },
    {
      combo: 'Enter',
      whileTyping: true,
      handler: () => {
        const match = matches[highlight]
        if (match && !match.hasOpenVisit) setSelected(match)
      },
      enabled: matches.length > 0 && !selected,
    },
    {
      combo: 'Escape',
      whileTyping: true,
      handler: () => {
        if (selected) setSelected(null)
        else {
          setSearch('')
          setDebounced('')
        }
      },
    },
  ])

  const checkIn = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<any>('/reception/check-in', body),
    onSuccess: (data) => {
      setError(null)
      setIssued({
        token: data.ticket.token,
        visitNumber: data.visit.visitNumber,
        name: selected?.name ?? '',
      })
      setSelected(null)
      setSearch('')
      setDebounced('')
      queryClient.invalidateQueries({ queryKey: ['visits'] })
      toast.success(`Token ${data.ticket.token} issued`, selected?.name)
      searchRef.current?.focus()
    },
    onError: (e) => {
      const message =
        e instanceof ApiError
          ? e.message
          : 'Could not check this patient in. Check your connection and try again.'
      setError(message)
      toast.error('Check-in failed', message)
    },
  })

  return (
    <>
      <PageHeader
        title="Reception"
        subtitle="Find the patient, confirm their details, issue a token."
        meta={
          <>
            <span>
              <kbd className="rounded-xs border border-line-strong bg-header px-1 font-mono text-2xs">/</kbd> search
            </span>
            <span>
              <kbd className="rounded-xs border border-line-strong bg-header px-1 font-mono text-2xs">↑↓</kbd> move
            </span>
            <span>
              <kbd className="rounded-xs border border-line-strong bg-header px-1 font-mono text-2xs">Enter</kbd> select
            </span>
          </>
        }
        actions={
          <Button variant="secondary" onClick={() => setRegisterOpen(true)}>
            Register new patient
          </Button>
        }
      />

      <div className="flex flex-col gap-4 p-4">
        {issued && (
          <Alert
            tone="stable"
            title={`Token ${issued.token} issued to ${issued.name}`}
            onDismiss={() => setIssued(null)}
            action={
              <Button size="sm" variant="secondary" onClick={() => window.print()}>
                Print token
              </Button>
            }
          >
            Visit {issued.visitNumber}. Direct the patient to the triage waiting area.
          </Alert>
        )}

        {error && (
          <Alert tone="critical" title="Check-in failed" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel title="Find patient" description="OP number, National ID, phone or name">
            <SearchInput
              ref={searchRef}
              label="Search for a patient"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setSelected(null)
              }}
              onClear={() => {
                setSearch('')
                setDebounced('')
              }}
              placeholder="OP/2026/00123 · 27650312 · 0722118904 · Otieno"
              autoFocus
              className="text-md"
            />

            <div className="mt-3">
              {debounced.trim().length < 3 ? (
                <p className="px-1 py-6 text-center text-sm text-ink-600">
                  Type at least 3 characters to search.
                </p>
              ) : results.isLoading ? (
                <LoadingRows rows={3} columns={2} />
              ) : matches.length === 0 ? (
                <EmptyState
                  title={`No patient matches “${debounced}”`}
                  description="Check the spelling, or register them as a new patient."
                  action={
                    <Button variant="primary" onClick={() => setRegisterOpen(true)}>
                      Register new patient
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y divide-line border border-line">
                  {matches.map((m, i) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => !m.hasOpenVisit && setSelected(m)}
                        onMouseEnter={() => setHighlight(i)}
                        disabled={m.hasOpenVisit}
                        aria-current={selected?.id === m.id ? 'true' : undefined}
                        className={[
                          'flex w-full items-center gap-3 px-3 py-3 text-left transition-colors',
                          m.hasOpenVisit ? 'cursor-not-allowed bg-neutral-bg' : 'hover:bg-primary-50',
                          i === highlight && !m.hasOpenVisit ? 'bg-primary-50 ring-1 ring-inset ring-primary-600' : '',
                          selected?.id === m.id ? 'bg-primary-50' : '',
                        ].join(' ')}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-md font-semibold text-ink-900">{m.name}</span>
                          <span className="mt-0.5 block text-xs text-ink-600">
                            {m.opNumber ?? 'No OP number'} · {calculateAge(m.dob)}
                            {m.sex === 'MALE' ? 'M' : m.sex === 'FEMALE' ? 'F' : 'I'}
                            {m.phone ? ` · ${m.phone}` : ''}
                            {m.lastVisitAt ? ` · last seen ${formatDate(m.lastVisitAt)}` : ' · never attended'}
                          </span>
                        </span>
                        {m.hasOpenVisit && <StatusChip tone="warning">Already checked in</StatusChip>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          <Panel
            title={selected ? 'Confirm check-in' : 'Check-in'}
            description={selected ? undefined : 'Select a patient from the search results.'}
          >
            {!selected ? (
              <p className="py-12 text-center text-sm text-ink-600">
                No patient selected.
              </p>
            ) : !triageStation ? (
              <Alert tone="critical" title="No triage station configured">
                Ask an administrator to add a triage station before checking patients in.
              </Alert>
            ) : (
              <CheckInForm
                patient={selected}
                stationId={triageStation.id}
                pending={checkIn.isPending}
                onCancel={() => setSelected(null)}
                onSubmit={(body) => checkIn.mutate({ ...body, patientId: selected.id })}
              />
            )}
          </Panel>
        </div>

        <Panel title="Currently in the building" description={`${openVisits.data?.length ?? 0} open visits`} flush>
          {openVisits.isLoading ? (
            <div className="p-4">
              <LoadingRows rows={4} columns={5} />
            </div>
          ) : (openVisits.data ?? []).length === 0 ? (
            <EmptyState title="Nobody is currently checked in" />
          ) : (
            <DataTable caption="Patients currently checked in">
              <THead>
                <TR>
                  <TH width="28%">Patient</TH>
                  <TH>Visit</TH>
                  <TH>Triage</TH>
                  <TH>Waiting at</TH>
                  <TH>Token</TH>
                  <TH align="right">Arrived</TH>
                </TR>
              </THead>
              <TBody>
                {(openVisits.data ?? []).map((v) => (
                  <TR key={v.id}>
                    <TDPrimary secondary={v.patient.opNumber ?? '—'}>{v.patient.name}</TDPrimary>
                    <TD className="font-mono text-xs tabular">{v.visitNumber}</TD>
                    <TD>
                      <TriageBadge acuity={v.acuity} showTarget={false} />
                    </TD>
                    <TD>{v.currentStation?.name ?? '—'}</TD>
                    <TD className="font-mono text-md font-semibold tabular text-ink-900">
                      {v.tickets[0]?.token ?? '—'}
                    </TD>
                    <TD align="right" className="text-xs">
                      {formatDateTime(v.arrivedAt)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </DataTable>
          )}
        </Panel>
      </div>

      <RegisterDialog
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onRegistered={(patient) => {
          setRegisterOpen(false)
          setSelected({ ...patient, hasOpenVisit: false, lastVisitAt: null } as Match)
        }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */

function CheckInForm({
  patient,
  stationId,
  pending,
  onSubmit,
  onCancel,
}: {
  patient: Match
  stationId: string
  pending: boolean
  onSubmit: (body: Record<string, unknown>) => void
  onCancel: () => void
}) {
  const [type, setType] = useState(patient.opNumber ? 'REVISIT' : 'NEW')
  const [complaint, setComplaint] = useState('')
  const [payer, setPayer] = useState('SELF_PAY')
  const [shaNumber, setShaNumber] = useState('')

  function submit(e?: React.FormEvent) {
    e?.preventDefault()
    onSubmit({
      type,
      chiefComplaint: complaint || undefined,
      payer,
      shaNumber: payer === 'SHA' ? shaNumber || undefined : undefined,
      stationId,
    })
  }

  return (
    <form onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      {/* Identity restated before the action, so confirming is a decision
          rather than a reflex. */}
      <div className="border border-line-strong bg-header px-3 py-2.5">
        <p className="text-lg font-semibold text-ink-900">{patient.name}</p>
        <p className="mt-0.5 text-xs text-ink-600">
          {patient.opNumber ?? 'New patient'} · {calculateAge(patient.dob)}
          {patient.sex === 'MALE' ? 'M' : patient.sex === 'FEMALE' ? 'F' : 'I'}
          {patient.nationalId ? ` · ID ${patient.nationalId}` : ''}
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <Select
          label="Visit type"
          required
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={VISIT_TYPES}
        />

        {type === 'EMERGENCY' && (
          <Alert tone="critical" title="This places the patient ahead of every queue">
            They will be seen before all other patients, ahead of formal triage.
          </Alert>
        )}

        <Select
          label="Payer"
          required
          value={payer}
          onChange={(e) => setPayer(e.target.value)}
          options={PAYERS}
        />

        {payer === 'SHA' && (
          <TextInput
            label="SHA membership number"
            value={shaNumber}
            onChange={(e) => setShaNumber(e.target.value)}
            hint="Checked against SHA before the visit, so a shortfall is not discovered at discharge."
          />
        )}

        <TextInput
          label="Presenting complaint"
          value={complaint}
          onChange={(e) => setComplaint(e.target.value)}
          placeholder="In the patient's own words"
          hint="Optional. The triage nurse will confirm it."
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="lg" loading={pending} loadingText="Issuing token…">
          Check in &amp; issue token
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ */

function RegisterDialog({
  open,
  onClose,
  onRegistered,
}: {
  open: boolean
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
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const register = useMutation({
    mutationFn: () =>
      api.post<any>('/reception/patients', {
        ...form,
        phone: form.phone || undefined,
        nationalId: form.nationalId || undefined,
      }),
    onSuccess: (patient) => {
      setForm({
        name: '',
        dob: '',
        sex: 'FEMALE',
        phone: '',
        nationalId: '',
        nextOfKinName: '',
        nextOfKinPhone: '',
        nextOfKinRelation: 'Spouse',
      })
      setTouched(false)
      onRegistered(patient)
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'Could not register this patient. Try again.'),
  })

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const required = ['name', 'dob', 'nextOfKinName', 'nextOfKinPhone'] as const
  const valid = required.every((k) => form[k].trim().length > 0)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (valid) register.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Register new patient"
      description="Only register someone with no existing record. Search first."
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setTouched(true)
              if (valid) register.mutate()
            }}
            loading={register.isPending}
            loadingText="Registering…"
          >
            Register &amp; issue OP number
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        {error && (
          <div className="mb-4">
            <Alert tone="critical" title="Registration failed" onDismiss={() => setError(null)}>
              {error}
            </Alert>
          </div>
        )}

        <fieldset className="border-0 p-0">
          <legend className="mb-2 text-2xs font-bold uppercase tracking-wide text-ink-600">
            Patient details
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              autoFocus
              label="Full name"
              required
              value={form.name}
              onChange={set('name')}
              placeholder="Three names, as on the ID"
              error={touched && !form.name ? 'Enter the full name' : undefined}
              containerClassName="sm:col-span-2"
            />
            <TextInput
              label="Date of birth"
              type="date"
              required
              value={form.dob}
              onChange={set('dob')}
              error={touched && !form.dob ? 'Enter the date of birth' : undefined}
            />
            <Select
              label="Sex"
              required
              value={form.sex}
              onChange={set('sex')}
              options={[
                { value: 'FEMALE', label: 'Female' },
                { value: 'MALE', label: 'Male' },
                { value: 'INTERSEX', label: 'Intersex' },
              ]}
            />
            <TextInput
              label="Phone number"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={set('phone')}
              placeholder="0722 118 904"
              hint="Used for M-Pesa prompts and results."
            />
            <TextInput
              label="National ID"
              value={form.nationalId}
              onChange={set('nationalId')}
              hint="Leave blank for minors."
            />
          </div>
        </fieldset>

        <fieldset className="mt-5 border-0 p-0">
          <legend className="mb-2 text-2xs font-bold uppercase tracking-wide text-ink-600">
            Next of kin
          </legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextInput
              label="Name"
              required
              value={form.nextOfKinName}
              onChange={set('nextOfKinName')}
              error={touched && !form.nextOfKinName ? 'Required' : undefined}
            />
            <TextInput
              label="Phone"
              type="tel"
              inputMode="tel"
              required
              value={form.nextOfKinPhone}
              onChange={set('nextOfKinPhone')}
              error={touched && !form.nextOfKinPhone ? 'Required' : undefined}
            />
            <TextInput label="Relationship" value={form.nextOfKinRelation} onChange={set('nextOfKinRelation')} />
          </div>
        </fieldset>

        <button type="submit" className="sr-only">
          Register
        </button>
      </form>
    </Dialog>
  )
}

/** Re-exported for screens that show an acuity next to a patient. */
export { TriageBadge as AcuityChip }
