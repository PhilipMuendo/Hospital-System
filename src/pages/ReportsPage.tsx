import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/apiClient'
import { useAuth } from '../context/AuthContext'
import { GlassPanel } from '../components/atoms/GlassPanel'
import { Skeleton } from '../components/atoms/Skeleton'
import { Dropdown } from '../components/molecules/Dropdown'
import {
  ControlledRegisterDoc,
  DischargeSummaryDoc,
  InvoiceDoc,
  RevenueDoc,
  StockDoc,
  WardCensusDoc,
} from '../components/print/reports'
import type { PatientSummary, Role } from '../lib/types'

interface ReportDef {
  key: string
  label: string
  description: string
  /** Which roles may generate it — mirrors the API guard. */
  roles?: Role[]
  /** Needs a patient chosen before it can be produced. */
  needsPatient?: boolean
  /** Needs a business date. */
  needsDate?: boolean
  endpoint: (opts: { patientId?: string; date: string }) => string
  render: (data: any) => ReactElement
}

const REPORTS: ReportDef[] = [
  {
    key: 'discharge',
    label: 'Discharge Summary',
    description: 'Clinical letter for continuity of care — diagnoses, procedures, results, discharge medication.',
    needsPatient: true,
    endpoint: ({ patientId }) => `/reports/patients/${patientId}/discharge-summary`,
    render: (d) => <DischargeSummaryDoc data={d} />,
  },
  {
    key: 'invoice',
    label: 'Statement of Account',
    description: 'Itemised tax invoice with payer split, M-Pesa receipts and outstanding balance.',
    needsPatient: true,
    endpoint: ({ patientId }) => `/reports/patients/${patientId}/invoice`,
    render: (d) => <InvoiceDoc data={d} />,
  },
  {
    key: 'census',
    label: 'Daily Ward Census',
    description: 'Bed state by ward with admissions and discharges for the day. Printed at handover.',
    needsDate: true,
    endpoint: ({ date }) => `/reports/ward-census?date=${date}`,
    render: (d) => <WardCensusDoc data={d} />,
  },
  {
    key: 'revenue',
    label: 'Revenue & M-Pesa Reconciliation',
    description: 'Charges by payer and status, with the M-Pesa receipts to reconcile against the Safaricom statement.',
    roles: ['BILLING', 'ADMIN'],
    needsDate: true,
    endpoint: ({ date }) => `/reports/revenue?date=${date}`,
    render: (d) => <RevenueDoc data={d} />,
  },
  {
    key: 'stock',
    label: 'Pharmacy Stock & Expiry',
    description: 'Stock position with reorder flags, expiry exposure and stock value at cost.',
    roles: ['PHARMACIST', 'ADMIN'],
    endpoint: () => '/reports/stock',
    render: (d) => <StockDoc data={d} />,
  },
  {
    key: 'controlled',
    label: 'Controlled Drug Register',
    description: 'Scheduled-substance movements with the responsible officer, for PPB inspection.',
    roles: ['PHARMACIST', 'ADMIN'],
    endpoint: () => '/reports/controlled-register',
    render: (d) => <ControlledRegisterDoc data={d} />,
  },
]

export function ReportsPage() {
  const { user } = useAuth()
  const available = REPORTS.filter((r) => !r.roles || (user && r.roles.includes(user.role)))

  const [selectedKey, setSelectedKey] = useState(available[0]?.key ?? 'census')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [patientId, setPatientId] = useState<string | null>(null)
  const [patientSearch, setPatientSearch] = useState('')

  const report = available.find((r) => r.key === selectedKey) ?? available[0]

  const patientsQuery = useQuery({
    queryKey: ['patients', patientSearch],
    queryFn: () =>
      api.get<PatientSummary[]>(
        `/patients${patientSearch ? `?search=${encodeURIComponent(patientSearch)}` : ''}`,
      ),
    enabled: !!report?.needsPatient,
  })

  const patients = patientsQuery.data ?? []
  const activePatientId = patientId ?? patients[0]?.id ?? null
  const ready = !!report && (!report.needsPatient || !!activePatientId)

  const reportQuery = useQuery({
    queryKey: ['report', report?.key, activePatientId, date],
    queryFn: () => api.get<any>(report!.endpoint({ patientId: activePatientId ?? undefined, date })),
    enabled: ready,
  })

  if (!report) {
    return (
      <GlassPanel className="p-8 text-center text-[13.5px] text-mist-500">
        No reports are available for your role.
      </GlassPanel>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Controls — hidden at print time so only the document reaches paper. */}
      <GlassPanel className="no-print p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-mist-500">
              Report
            </label>
            <Dropdown
              label="Report"
              value={report.label}
              onChange={(label) => {
                const next = available.find((r) => r.label === label)
                if (next) setSelectedKey(next.key)
              }}
              options={available.map((r) => r.label)}
            />
          </div>

          {report.needsDate && (
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-mist-500">
                Business date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-[var(--radius-xs)] border border-white/8 bg-surface-800/60 px-3 py-2 text-[13px] text-mist-100 outline-none focus:border-accent-500"
              />
            </div>
          )}

          {report.needsPatient && (
            <div className="min-w-[260px] flex-1">
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-mist-500">
                Patient
              </label>
              <input
                value={patientSearch}
                onChange={(e) => {
                  setPatientSearch(e.target.value)
                  setPatientId(null)
                }}
                placeholder="Search name or IP number…"
                className="w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-800/60 px-3 py-2 text-[13px] text-mist-100 outline-none placeholder:text-mist-600 focus:border-accent-500"
              />
              {patients.length > 0 && (
                <select
                  value={activePatientId ?? ''}
                  onChange={(e) => setPatientId(e.target.value)}
                  className="mt-2 w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-800/60 px-3 py-2 text-[13px] text-mist-100 outline-none focus:border-accent-500"
                >
                  {patients.slice(0, 50).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.ipNumber}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => window.print()}
            disabled={!reportQuery.data}
            className="rounded-[var(--radius-xs)] bg-accent-500 px-4 py-2.5 text-[13px] font-semibold text-charcoal-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Print / Save as PDF
          </button>
        </div>

        <p className="mt-3 text-[12.5px] text-mist-500">{report.description}</p>
      </GlassPanel>

      {/* The document itself — this is what the printer receives. */}
      <div className="print-surface flex justify-center overflow-x-auto pb-4">
        {!ready ? (
          <GlassPanel className="w-full p-8 text-center text-[13.5px] text-mist-500">
            Choose a patient to generate this report.
          </GlassPanel>
        ) : reportQuery.isLoading ? (
          <Skeleton className="h-[297mm] w-[210mm] rounded-[2px]" />
        ) : reportQuery.isError ? (
          <GlassPanel className="w-full p-8 text-center text-[13.5px] text-status-critical">
            {(reportQuery.error as Error)?.message ?? 'Could not generate this report.'}
          </GlassPanel>
        ) : (
          report.render(reportQuery.data)
        )}
      </div>
    </div>
  )
}
