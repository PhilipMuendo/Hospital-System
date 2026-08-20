import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GlassPanel } from '../atoms/GlassPanel'
import { Avatar } from '../atoms/Avatar'
import { Badge } from '../atoms/Badge'
import { Checkbox } from '../atoms/Checkbox'
import { Skeleton } from '../atoms/Skeleton'
import { TabBar } from '../molecules/TabBar'
import { TableRow } from '../molecules/TableRow'
import { Dropdown } from '../molecules/Dropdown'
import { HeartbeatLine } from '../molecules/HeartbeatLine'
import { MpesaCharge } from '../molecules/MpesaCharge'
import { MedicationsTab } from './MedicationsTab'
import { api } from '../../lib/apiClient'
import { PatientHeader, SearchInput } from '../ui'
import { useAuth } from '../../context/AuthContext'
import { calculateAge, formatDate, formatDateTime, formatKES } from '../../lib/format'
import type {
  BillingLine,
  BillingStatus,
  ImagingStudy,
  LabResult,
  PatientDetail,
  PatientSummary,
  VitalReading,
} from '../../lib/types'

const TABS = ['Summary', 'Labs', 'Imaging', 'Meds', 'Billing']

const flagColor: Record<string, string> = {
  NORMAL: 'var(--color-stable)',
  LOW: 'var(--color-warning)',
  HIGH: 'var(--color-critical)',
}

const billingStatusLabel: Record<BillingStatus, 'healthy' | 'warning' | 'critical'> = {
  PAID: 'healthy',
  PENDING: 'warning',
  DENIED: 'critical',
}

const billingStatusOptions: BillingStatus[] = ['PAID', 'PENDING', 'DENIED']

const sexLabel: Record<string, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  INTERSEX: 'Intersex',
}

const payerLabel: Record<string, string> = {
  SHA: 'SHA',
  IMARA_HEALTH_ASSURANCE: 'Imara Health Assurance',
  SELF_PAY: 'Self-Pay',
}

export function PatientRecordSplitView() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [tab, setTab] = useState('Summary')
  const [billingFilter, setBillingFilter] = useState('All statuses')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 150)
    return () => clearTimeout(t)
  }, [search])

  const pickerQuery = useQuery({
    queryKey: ['patients', debouncedSearch],
    queryFn: () => api.get<PatientSummary[]>(`/patients${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ''}`),
  })

  useEffect(() => {
    if (!selectedPatientId && pickerQuery.data && pickerQuery.data.length > 0) {
      setSelectedPatientId(pickerQuery.data[0].id)
    }
  }, [pickerQuery.data, selectedPatientId])

  const patientQuery = useQuery({
    queryKey: ['patient', selectedPatientId],
    queryFn: () => api.get<PatientDetail>(`/patients/${selectedPatientId}`),
    enabled: !!selectedPatientId,
  })

  const vitalsQuery = useQuery({
    queryKey: ['patient', selectedPatientId, 'vitals'],
    queryFn: () => api.get<VitalReading[]>(`/patients/${selectedPatientId}/vitals`),
    enabled: !!selectedPatientId,
  })

  const labsQuery = useQuery({
    queryKey: ['patient', selectedPatientId, 'labs'],
    queryFn: () => api.get<LabResult[]>(`/patients/${selectedPatientId}/labs`),
    enabled: !!selectedPatientId,
  })

  const imagingQuery = useQuery({
    queryKey: ['patient', selectedPatientId, 'imaging'],
    queryFn: () => api.get<ImagingStudy[]>(`/patients/${selectedPatientId}/imaging`),
    enabled: !!selectedPatientId,
  })

  const billingQuery = useQuery({
    queryKey: ['patient', selectedPatientId, 'billing'],
    queryFn: () => api.get<BillingLine[]>(`/patients/${selectedPatientId}/billing`),
    enabled: !!selectedPatientId,
  })

  const canReviewLabs = user?.role === 'PHYSICIAN' || user?.role === 'NURSE'
  const canEditBilling = user?.role === 'BILLING' || user?.role === 'ADMIN'

  const reviewLab = useMutation({
    mutationFn: ({ id, reviewed }: { id: string; reviewed: boolean }) =>
      api.patch<LabResult>(`/labs/${id}/review`, { reviewed }),
    onMutate: async ({ id, reviewed }) => {
      const key = ['patient', selectedPatientId, 'labs']
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<LabResult[]>(key)
      queryClient.setQueryData<LabResult[]>(key, (old) =>
        old?.map((l) => (l.id === id ? { ...l, reviewed } : l)),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['patient', selectedPatientId, 'labs'], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', selectedPatientId, 'labs'] })
    },
  })

  const updateBillingStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: BillingStatus }) =>
      api.patch<BillingLine>(`/billing/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', selectedPatientId, 'billing'] })
    },
  })

  const patient = patientQuery.data
  const filteredBilling =
    billingFilter === 'All statuses'
      ? (billingQuery.data ?? [])
      : (billingQuery.data ?? []).filter((b) => b.status === billingFilter.toUpperCase())

  return (
    <div className="flex flex-col">
      {/* Identity is never off-screen while a patient-scoped action is
          possible. Wrong-patient error is the commonest serious error in
          hospital software, and this is the structural defence against it. */}
      {patient && (
        <PatientHeader
          patient={{
            id: patient.id,
            name: patient.name,
            dob: patient.dob,
            sex: patient.sex,
            opNumber: (patient as { opNumber?: string | null }).opNumber ?? null,
            ipNumber: patient.ipNumber,
            nationalId: patient.nationalId,
            ward: patient.ward,
            bed: patient.bed,
            allergies: patient.allergies,
            codeStatus: patient.codeStatus,
            status: patient.status,
            physician: patient.primaryPhysician?.name,
            admittedAt: patient.admittedAt,
          }}
        />
      )}

      <GlassPanel className="grid grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,30%)_minmax(0,70%)]">
      {/* Left pane — 30% identity & vitals */}
      <div className="flex flex-col gap-6 border-b border-line p-6 md:border-b-0 md:border-r">
        <div className="relative">
          <SearchInput
            label="Search patients"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPickerOpen(true)
            }}
            onFocus={() => setPickerOpen(true)}
            onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
            onClear={() => setSearch('')}
            placeholder="Name or IP number…"
          />
          <AnimatePresence>
            {pickerOpen && (pickerQuery.data?.length ?? 0) > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto border border-line-strong bg-canvas p-1 shadow-[var(--shadow-overlay)]"
              >
                {pickerQuery.data!.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSelectedPatientId(p.id)
                      setSearch('')
                      setPickerOpen(false)
                    }}
                    className="flex min-h-10 w-full items-center justify-between rounded-xs px-3 py-2 text-left text-sm text-ink-800 hover:bg-primary-50"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="ml-2 shrink-0 font-mono text-2xs tabular text-ink-500">{p.ward.name} · {p.bed}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {patientQuery.isLoading || !patient ? (
          <div className="flex items-center gap-3.5">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3.5">
            <Avatar initials={patient.avatarInitials} />
            <div className="min-w-0">
              <h3 className="truncate text-md">{patient.name}</h3>
              <p className="truncate text-xs text-ink-600">{patient.ipNumber}</p>
            </div>
          </div>
        )}

        {patient && (
          <div className="flex flex-wrap gap-2">
            <Badge status="warning">{patient.ward.name} · {patient.bed}</Badge>
            <Badge status="healthy">{patient.codeStatus.replace('_', ' ')}</Badge>
          </div>
        )}

        <div>
          <p className="text-2xs font-medium uppercase tracking-wide text-ink-600">Live Vitals</p>
          <HeartbeatLine className="mt-2 h-12 w-full" />
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {vitalsQuery.isLoading
              ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[54px] rounded-sm" />)
              : (vitalsQuery.data ?? []).length === 0
                ? <p className="col-span-2 text-xs text-ink-500">No vitals recorded.</p>
                : (vitalsQuery.data ?? []).map((v) => (
                    <div key={v.id} className="rounded-sm border border-line bg-header px-3 py-2.5">
                      <p className="text-2xs text-ink-600">{v.label}</p>
                      <p className="mt-0.5 font-mono text-base tabular text-ink-900">
                        {v.value}
                        <span className="ml-1 text-2xs font-sans text-ink-600">{v.unit}</span>
                      </p>
                    </div>
                  ))}
          </div>
        </div>

        {patient && (
          <div className="flex flex-col gap-3 border-t border-line pt-5 text-sm">
            <Field label="Date of Birth" value={formatDate(patient.dob)} />
            <Field label="Age / Sex" value={`${calculateAge(patient.dob)} · ${sexLabel[patient.sex]}`} />
            <Field label="Blood Type" value={patient.bloodType} />
            <Field label="National ID" value={patient.nationalId ?? '—'} />
            <Field label="Admitted" value={formatDateTime(patient.admittedAt)} />
            <Field label="Physician" value={patient.primaryPhysician.name} />
            <Field label="Allergies" value={patient.allergies.length > 0 ? patient.allergies.join(', ') : 'None known'} />
            <Field label="Next of Kin" value={`${patient.nextOfKinName} (${patient.nextOfKinRelation})`} />
            <Field label="Mobile" value={patient.phone ?? '—'} />
            <Field label="Next of Kin Phone" value={patient.nextOfKinPhone} />
          </div>
        )}
      </div>

      {/* Right pane — 70% tabbed record */}
      <div className="flex min-w-0 flex-col p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabBar tabs={TABS} active={tab} onChange={setTab} />
          {tab === 'Billing' && (
            <Dropdown
              label="Filter"
              value={billingFilter}
              onChange={setBillingFilter}
              options={['All statuses', 'Paid', 'Pending', 'Denied']}
            />
          )}
        </div>

        <div className="mt-5 max-h-[520px] overflow-y-auto pr-1" style={{ scrollBehavior: 'smooth' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.32, ease: [0.22, 1.12, 0.4, 1] }}
            >
              {tab === 'Summary' && <SummaryTab patient={patient} loading={patientQuery.isLoading} />}

              {tab === 'Meds' && <MedicationsTab patientId={selectedPatientId} />}

              {tab === 'Labs' && (
                <div className="flex flex-col">
                  <TableRow columns="24px 2.1fr 1fr 1.3fr 1fr" className="text-2xs font-medium uppercase tracking-wide text-ink-600">
                    <span />
                    <span>Test</span>
                    <span>Result</span>
                    <span>Reference Range</span>
                    <span>Collected</span>
                  </TableRow>
                  {labsQuery.isLoading ? (
                    <Skeleton className="mt-2 h-40 rounded-sm" />
                  ) : (labsQuery.data ?? []).length === 0 ? (
                    <EmptyState message="No lab results on file." />
                  ) : (
                    (labsQuery.data ?? []).map((l) => (
                      <TableRow key={l.id} columns="24px 2.1fr 1fr 1.3fr 1fr">
                        <Checkbox
                          checked={l.reviewed}
                          disabled={!canReviewLabs}
                          onChange={(v) => reviewLab.mutate({ id: l.id, reviewed: v })}
                        />
                        <span className="truncate text-sm text-ink-900">{l.test}</span>
                        <span className="font-mono text-sm tabular" style={{ color: flagColor[l.flag] }}>
                          {l.result}
                        </span>
                        <span className="font-mono text-xs tabular text-ink-600">{l.range}</span>
                        <span className="text-xs text-ink-600">{formatDateTime(l.collectedAt)}</span>
                      </TableRow>
                    ))
                  )}
                </div>
              )}

              {tab === 'Imaging' && (
                <div className="flex flex-col gap-3">
                  {imagingQuery.isLoading ? (
                    <Skeleton className="h-32 rounded-sm" />
                  ) : (imagingQuery.data ?? []).length === 0 ? (
                    <EmptyState message="No imaging studies on file." />
                  ) : (
                    (imagingQuery.data ?? []).map((s) => (
                      <div key={s.id} className="rounded-sm border border-line bg-header px-4 py-3.5">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-ink-900">{s.study}</p>
                          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-2xs tabular text-ink-600">
                            {s.modality}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-ink-600">
                          {formatDate(s.performedAt)} · {s.radiologistName}
                        </p>
                        <p className="mt-2 text-sm text-ink-700">{s.impression}</p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === 'Billing' && (
                <div className="flex flex-col">
                  <TableRow columns="1.8fr 0.8fr 0.8fr 0.7fr" className="text-2xs font-medium uppercase tracking-wide text-ink-600">
                    <span>Description</span>
                    <span>Code</span>
                    <span>Amount</span>
                    <span>Status</span>
                  </TableRow>
                  {billingQuery.isLoading ? (
                    <Skeleton className="mt-2 h-32 rounded-sm" />
                  ) : filteredBilling.length === 0 ? (
                    <EmptyState message="No billing lines match this filter." />
                  ) : (
                    filteredBilling.map((b) => (
                      <TableRow key={b.id} columns="1.8fr 0.8fr 0.8fr 0.7fr">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink-900">{b.description}</p>
                          <p className="truncate text-2xs text-ink-500">
                            {payerLabel[b.payer]}
                            {b.mpesaReference ? ` · M-Pesa ${b.mpesaReference}` : ''}
                          </p>
                          {canEditBilling && (
                            <MpesaCharge
                              line={b}
                              patientPhone={patient?.phone ?? null}
                              onSettled={() =>
                                queryClient.invalidateQueries({
                                  queryKey: ['patient', selectedPatientId, 'billing'],
                                })
                              }
                            />
                          )}
                        </div>
                        <span className="font-mono text-xs tabular text-ink-600">{b.code}</span>
                        <span className="font-mono text-sm tabular text-ink-900">{formatKES(b.amount)}</span>
                        <BillingStatusCell
                          status={b.status}
                          editable={canEditBilling}
                          onChange={(status) => updateBillingStatus.mutate({ id: b.id, status })}
                        />
                      </TableRow>
                    ))
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      </GlassPanel>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className="shrink-0 text-2xs text-ink-600">{label}</p>
      <p className="text-right text-ink-800">{value}</p>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="mt-2 rounded-sm border border-dashed border-line px-4 py-6 text-center text-sm text-ink-500">
      {message}
    </div>
  )
}

function BillingStatusCell({
  status,
  editable,
  onChange,
}: {
  status: BillingStatus
  editable: boolean
  onChange: (status: BillingStatus) => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        {billingStatusOptions.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => {
              onChange(opt)
              setEditing(false)
            }}
            className="rounded-full border border-line px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-ink-700 hover:border-primary-200 hover:text-primary-700"
          >
            {opt.toLowerCase()}
          </button>
        ))}
      </div>
    )
  }

  return (
    <button type="button" disabled={!editable} onClick={() => setEditing(true)} className="w-fit disabled:cursor-default">
      <Badge status={billingStatusLabel[status]}>{status.toLowerCase()}</Badge>
    </button>
  )
}

function SummaryTab({ patient, loading }: { patient: PatientDetail | undefined; loading: boolean }) {
  if (loading || !patient) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 rounded-sm" />
        <Skeleton className="h-24 rounded-sm" />
        <Skeleton className="h-24 rounded-sm" />
      </div>
    )
  }

  if (!patient.chiefComplaint && !patient.assessment && patient.carePlan.length === 0) {
    return <EmptyState message="No clinical summary recorded for this patient." />
  }

  return (
    <div className="flex flex-col gap-4">
      {patient.chiefComplaint && (
        <div className="rounded-sm border border-line bg-header p-4">
          <p className="text-2xs font-medium uppercase tracking-wide text-ink-600">Chief Complaint</p>
          <p className="mt-1.5 text-sm text-ink-800">{patient.chiefComplaint}</p>
        </div>
      )}
      {patient.assessment && (
        <div className="rounded-sm border border-line bg-header p-4">
          <p className="text-2xs font-medium uppercase tracking-wide text-ink-600">Assessment</p>
          <p className="mt-1.5 text-sm text-ink-800">{patient.assessment}</p>
        </div>
      )}
      {patient.carePlan.length > 0 && (
        <div className="rounded-sm border border-line bg-header p-4">
          <p className="text-2xs font-medium uppercase tracking-wide text-ink-600">Care Plan</p>
          <ul className="mt-2 flex flex-col gap-2 text-sm text-ink-800">
            {patient.carePlan.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
