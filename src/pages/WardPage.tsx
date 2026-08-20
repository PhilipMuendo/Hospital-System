import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/apiClient'
import {
  Alert,
  Button,
  ChoiceGroup,
  ClinicalValue,
  DataTable,
  Dialog,
  EmptyState,
  LoadingRows,
  PageHeader,
  Panel,
  PatientConfirmLine,
  Select,
  StatTile,
  StatusChip,
  TBody,
  TD,
  TDPrimary,
  TH,
  THead,
  TR,
  TextArea,
  useToast,
} from '../components/ui'
import { calculateAge, formatDateTime } from '../lib/format'
import type { Ward } from '../lib/types'

/**
 * Ward board and drug round.
 *
 * A nurse arriving at handover needs four things in one look: who is here, who
 * is deteriorating, whose drugs are outstanding, and what results have landed.
 * The board is a table because that is a list to scan, not a set of objects to
 * click.
 *
 * The administration dialogs replace `window.prompt()`. Omitting or refusing a
 * dose is a legally significant entry that a regulator reads — capturing it in
 * an unstyleable browser prompt that a stray tap dismisses, with no validation
 * and no screen-reader support, was indefensible.
 */

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

const OMISSION_REASONS = [
  { value: 'Patient asleep', label: 'Patient asleep' },
  { value: 'Nil by mouth', label: 'Nil by mouth' },
  { value: 'Held per parameters', label: 'Held per parameters (BP/HR)' },
  { value: 'Patient off ward', label: 'Patient off ward' },
  { value: 'Drug unavailable', label: 'Drug unavailable' },
  { value: 'Vomiting', label: 'Vomiting / unable to tolerate' },
  { value: 'Clinical decision', label: 'Clinical decision — see notes' },
]

export function WardPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [wardId, setWardId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{
    item: MedItem
    patient: BoardPatient
    intent: 'GIVEN' | 'OMITTED' | 'REFUSED'
  } | null>(null)

  const wardsQuery = useQuery({ queryKey: ['wards'], queryFn: () => api.get<Ward[]>('/wards') })
  const staffQuery = useQuery({ queryKey: ['staff'], queryFn: () => api.get<Staff[]>('/auth/staff') })

  useEffect(() => {
    if (!wardId && wardsQuery.data?.length) setWardId(wardsQuery.data[0].id)
  }, [wardsQuery.data, wardId])

  const board = useQuery({
    queryKey: ['ward-board', wardId],
    queryFn: () => api.get<BoardPatient[]>(`/wards/${wardId}/board`),
    enabled: !!wardId,
    refetchInterval: 60_000,
  })

  const administer = useMutation({
    mutationFn: ({ itemId, ...body }: { itemId: string } & Record<string, unknown>) =>
      api.post(`/prescription-items/${itemId}/administer`, body),
    onSuccess: (_data, variables) => {
      setError(null)
      const intent = String(variables.status ?? 'GIVEN')
      toast.success(
        intent === 'GIVEN' ? 'Dose recorded as given' : `Dose recorded as ${intent.toLowerCase()}`,
        confirming ? `${confirming.item.drug} · ${confirming.patient.name}` : undefined,
      )
      setConfirming(null)
      queryClient.invalidateQueries({ queryKey: ['ward-board'] })
    },
    onError: (e) => {
      const message =
        e instanceof ApiError
          ? e.message
          : 'Unable to record this administration. Check your connection and try again.'
      setError(message)
      // Errors persist until dismissed — a failed drug entry must not scroll
      // away unread.
      toast.error('Administration not recorded', message)
    },
  })

  const patients = board.data ?? []
  const outstanding = patients.reduce((s, p) => s + p.medication.outstanding, 0)
  const criticalCount = patients.filter((p) => p.worstVital === 'CRITICAL').length
  const newResults = patients.reduce((s, p) => s + p.unreviewedLabs.length, 0)

  return (
    <>
      <PageHeader
        title="Ward"
        subtitle="Handover board and medication round."
        actions={
          <Select
            label="Ward"
            containerClassName="min-w-52"
            value={wardId ?? ''}
            onChange={(e) => setWardId(e.target.value)}
            options={(wardsQuery.data ?? []).map((w) => ({
              value: w.id,
              label: `${w.name} — ${w.occupied}/${w.bedCapacity}`,
            }))}
          />
        }
      />

      <div className="flex flex-col gap-4 p-4">
        {error && (
          <Alert tone="critical" title="Could not record administration" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Patients" value={patients.length} />
          <StatTile
            label="Doses outstanding"
            value={outstanding}
            tone={outstanding > 0 ? 'warning' : 'stable'}
            hint="Scheduled, not yet given"
          />
          <StatTile
            label="Deteriorating"
            value={criticalCount}
            tone={criticalCount > 0 ? 'critical' : 'neutral'}
            hint="Critical observations"
          />
          <StatTile label="New results" value={newResults} tone={newResults > 0 ? 'info' : 'neutral'} hint="Unreviewed" />
        </div>

        <Panel title="Handover board" description="Select a patient to open their medication record" flush>
          {board.isLoading ? (
            <div className="p-4">
              <LoadingRows rows={6} columns={5} />
            </div>
          ) : patients.length === 0 ? (
            <EmptyState title="No patients admitted to this ward" />
          ) : (
            <DataTable caption="Ward handover board">
              <THead>
                <TR>
                  <TH width="8%">Bed</TH>
                  <TH width="26%">Patient</TH>
                  <TH>Latest observations</TH>
                  <TH align="center" width="12%">Drug round</TH>
                  <TH align="right" width="14%">Status</TH>
                </TR>
              </THead>
              <TBody>
                {patients.map((p) => {
                  const open = expanded === p.id
                  return (
                    <>
                      <TR
                        key={p.id}
                        onClick={() => setExpanded(open ? null : p.id)}
                        selected={open}
                        tone={
                          p.worstVital === 'CRITICAL'
                            ? 'critical'
                            : p.medication.outstanding > 0 || p.worstVital === 'WARNING'
                              ? 'warning'
                              : undefined
                        }
                      >
                        <TD className="font-mono text-md font-semibold tabular text-ink-900">{p.bed ?? '—'}</TD>
                        <TDPrimary
                          secondary={
                            <>
                              {calculateAge(p.dob)}
                              {p.sex === 'MALE' ? 'M' : p.sex === 'FEMALE' ? 'F' : 'I'} · {p.ipNumber ?? '—'}
                              {p.allergies.length > 0 && (
                                <span className="ml-2 font-semibold text-critical">
                                  Allergies: {p.allergies.join(', ')}
                                </span>
                              )}
                            </>
                          }
                        >
                          {p.name}
                        </TDPrimary>
                        <TD>
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {p.latestVitals.length === 0 ? (
                              <span className="text-sm text-ink-600">No observations recorded</span>
                            ) : (
                              p.latestVitals.slice(0, 4).map((v) => (
                                <span key={v.id} className="whitespace-nowrap">
                                  <span className="text-xs text-ink-600">{v.label} </span>
                                  <ClinicalValue
                                    value={v.value}
                                    unit={v.unit}
                                    tone={
                                      v.status === 'CRITICAL'
                                        ? 'critical'
                                        : v.status === 'WARNING'
                                          ? 'warning'
                                          : 'neutral'
                                    }
                                  />
                                </span>
                              ))
                            )}
                          </div>
                        </TD>
                        <TD align="center">
                          <span
                            className={
                              p.medication.outstanding > 0
                                ? 'font-mono text-md font-semibold tabular text-warning'
                                : 'font-mono text-md tabular text-stable'
                            }
                          >
                            {p.medication.givenToday}/{p.medication.dueToday}
                          </span>
                        </TD>
                        <TD align="right">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {p.worstVital === 'CRITICAL' && <StatusChip tone="critical">Critical</StatusChip>}
                            {p.worstVital === 'WARNING' && <StatusChip tone="warning">Watch</StatusChip>}
                            {p.unreviewedLabs.length > 0 && (
                              <StatusChip tone="info">{p.unreviewedLabs.length} results</StatusChip>
                            )}
                            {p.codeStatus !== 'FULL_CODE' && (
                              <StatusChip tone="warning">{p.codeStatus.replace(/_/g, ' ')}</StatusChip>
                            )}
                          </div>
                        </TD>
                      </TR>

                      {open && (
                        <tr key={`${p.id}-mar`}>
                          <td colSpan={5} className="border-b border-line bg-header p-0">
                            <MedicationRecord
                              patient={p}
                              onAct={(item, intent) => setConfirming({ item, patient: p, intent })}
                            />
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </TBody>
            </DataTable>
          )}
        </Panel>
      </div>

      {confirming && (
        <AdministrationDialog
          key={`${confirming.item.id}-${confirming.intent}`}
          record={confirming}
          staff={(staffQuery.data ?? []).filter((s) => s.role === 'NURSE' || s.role === 'PHYSICIAN')}
          pending={administer.isPending}
          onClose={() => setConfirming(null)}
          onConfirm={(body) => administer.mutate({ itemId: confirming.item.id, ...body })}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

function MedicationRecord({
  patient,
  onAct,
}: {
  patient: BoardPatient
  onAct: (item: MedItem, intent: 'GIVEN' | 'OMITTED' | 'REFUSED') => void
}) {
  if (patient.medication.items.length === 0) {
    return <p className="px-4 py-6 text-sm text-ink-600">No active prescriptions for this patient.</p>
  }

  return (
    <div className="px-4 py-3">
      <h3 className="mb-2 text-2xs font-bold uppercase tracking-wide text-ink-600">
        Medication administration record — {patient.name}
      </h3>

      <div className="border border-line bg-canvas">
        <DataTable caption={`Medication record for ${patient.name}`}>
          <THead sticky={false}>
            <TR>
              <TH width="34%">Drug</TH>
              <TH>Dose &amp; route</TH>
              <TH align="center">Today</TH>
              <TH>Last given</TH>
              <TH align="right" width="24%">Record</TH>
            </TR>
          </THead>
          <TBody>
            {patient.medication.items.map((m) => {
              const complete = m.dosesPerDay !== null && m.givenToday >= m.dosesPerDay
              const notDispensed = m.quantityDispensed === 0
              const last = m.administrations[0]

              return (
                <TR key={m.id}>
                  <TDPrimary
                    secondary={
                      <span className="flex flex-wrap items-center gap-1.5">
                        {m.controlled && <StatusChip tone="critical">Controlled</StatusChip>}
                        {complete && <StatusChip tone="stable">Round complete</StatusChip>}
                        {notDispensed && <StatusChip tone="warning">Not dispensed</StatusChip>}
                      </span>
                    }
                  >
                    {m.drug}
                  </TDPrimary>
                  <TD>
                    <span className="font-semibold text-ink-900">{m.dose}</span>
                    <span className="text-ink-600">
                      {' '}
                      · {m.route} · {m.frequency}
                    </span>
                  </TD>
                  <TD align="center" className="font-mono text-md tabular">
                    {m.dosesPerDay ? `${m.givenToday}/${m.dosesPerDay}` : 'PRN'}
                  </TD>
                  <TD className="text-xs">
                    {last ? (
                      <>
                        <span className="font-medium text-ink-800">{last.status.replace(/_/g, ' ').toLowerCase()}</span>
                        <br />
                        {formatDateTime(last.administeredAt)}
                        {last.reason && <span className="block text-ink-600">{last.reason}</span>}
                      </>
                    ) : (
                      <span className="text-ink-600">Not given today</span>
                    )}
                  </TD>
                  <TD align="right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={notDispensed}
                        title={notDispensed ? 'Pharmacy has not dispensed this yet' : undefined}
                        onClick={() => onAct(m, 'GIVEN')}
                      >
                        Given
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => onAct(m, 'OMITTED')}>
                        Omitted
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => onAct(m, 'REFUSED')}>
                        Refused
                      </Button>
                    </div>
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </DataTable>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Administration confirmation.
 *
 * Restates the patient and the drug before committing, because a dose charted
 * against the wrong person is the error this whole screen exists to prevent.
 * Omission and refusal require a coded reason — free text alone is unusable
 * for audit, and a required field beats a hopeful placeholder.
 */
function AdministrationDialog({
  record,
  staff,
  pending,
  onClose,
  onConfirm,
}: {
  record: { item: MedItem; patient: BoardPatient; intent: 'GIVEN' | 'OMITTED' | 'REFUSED' }
  staff: Staff[]
  pending: boolean
  onClose: () => void
  onConfirm: (body: Record<string, unknown>) => void
}) {
  const { item, patient, intent } = record
  const needsReason = intent !== 'GIVEN'
  const needsWitness = intent === 'GIVEN' && item.controlled

  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [witness, setWitness] = useState('')
  const [touched, setTouched] = useState(false)

  const valid = (!needsReason || reason) && (!needsWitness || witness)

  const titles = {
    GIVEN: 'Record dose as given',
    OMITTED: 'Record dose as omitted',
    REFUSED: 'Record refusal',
  }

  function submit() {
    setTouched(true)
    if (!valid) return
    onConfirm({
      status: intent,
      reason: needsReason ? [reason, notes].filter(Boolean).join(' — ') : undefined,
      notes: notes || undefined,
      witnessedById: needsWitness ? witness : undefined,
    })
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={titles[intent]}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={intent === 'GIVEN' ? 'primary' : 'secondary'}
            onClick={submit}
            loading={pending}
            loadingText="Recording…"
          >
            {intent === 'GIVEN' ? 'Confirm given' : intent === 'OMITTED' ? 'Confirm omitted' : 'Confirm refusal'}
          </Button>
        </>
      }
    >
      <PatientConfirmLine patient={patient} />

      <div className="mt-3 border border-line-strong bg-header px-3 py-2.5">
        <p className="text-md font-semibold text-ink-900">{item.drug}</p>
        <p className="mt-0.5 text-sm text-ink-700">
          {item.dose} · {item.route} · {item.frequency}
        </p>
      </div>

      {patient.allergies.length > 0 && (
        <div className="mt-3">
          <Alert tone="critical" title="Recorded allergies">
            {patient.allergies.join(', ')}
          </Alert>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-4">
        {needsWitness && (
          <Select
            label="Witness (second signature)"
            required
            placeholder="Select the witnessing clinician"
            value={witness}
            onChange={(e) => setWitness(e.target.value)}
            options={staff.map((s) => ({ value: s.id, label: s.name }))}
            error={touched && !witness ? 'A controlled drug needs a second signature' : undefined}
            hint="Required for controlled drugs and checked by the Pharmacy and Poisons Board."
          />
        )}

        {needsReason && (
          <ChoiceGroup
            label={intent === 'OMITTED' ? 'Reason the dose was not given' : 'Reason for refusal'}
            name="reason"
            required
            value={reason}
            onChange={setReason}
            options={OMISSION_REASONS}
            error={touched && !reason ? 'Select a reason' : undefined}
            columns={2}
          />
        )}

        <TextArea
          label="Notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          hint="Optional. Added to the permanent record; entries cannot be edited afterwards."
        />
      </div>
    </Dialog>
  )
}
