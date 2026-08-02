import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { GlassPanel } from '../atoms/GlassPanel'
import { Avatar } from '../atoms/Avatar'
import { Badge } from '../atoms/Badge'
import { Checkbox } from '../atoms/Checkbox'
import { TabBar } from '../molecules/TabBar'
import { TableRow } from '../molecules/TableRow'
import { Dropdown } from '../molecules/Dropdown'
import { HeartbeatLine } from '../molecules/HeartbeatLine'
import {
  billingLines,
  imagingStudies,
  labResults,
  patient,
  vitals,
} from '../../data/mockData'

const TABS = ['Summary', 'Labs', 'Imaging', 'Billing']

const flagColor: Record<string, string> = {
  normal: 'var(--color-status-healthy)',
  low: 'var(--color-status-warning)',
  high: 'var(--color-status-critical)',
}

const billingStatusLabel: Record<string, 'healthy' | 'warning' | 'critical'> = {
  paid: 'healthy',
  pending: 'warning',
  denied: 'critical',
}

export function PatientRecordSplitView() {
  const [tab, setTab] = useState('Summary')
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({})
  const [billingFilter, setBillingFilter] = useState('All statuses')

  const filteredBilling =
    billingFilter === 'All statuses'
      ? billingLines
      : billingLines.filter((b) => b.status === billingFilter.toLowerCase())

  return (
    <GlassPanel className="grid grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,30%)_minmax(0,70%)]" delay={0.15}>
      {/* Left pane — 30% identity & vitals */}
      <div className="flex flex-col gap-6 border-b border-white/6 p-6 md:border-b-0 md:border-r">
        <div className="flex items-center gap-3.5">
          <Avatar initials={patient.avatarInitials} />
          <div className="min-w-0">
            <h3 className="truncate text-[17px]">{patient.name}</h3>
            <p className="truncate text-[12.5px] text-mist-500">{patient.mrn}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge status="warning">{patient.room}</Badge>
          <Badge status="healthy">{patient.code}</Badge>
        </div>

        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-mist-500">Live Vitals</p>
          <HeartbeatLine className="mt-2 h-12 w-full" />
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {vitals.map((v) => (
              <div key={v.label} className="rounded-[var(--radius-sm)] border border-white/6 bg-surface-800/50 px-3 py-2.5">
                <p className="text-[11px] text-mist-500">{v.label}</p>
                <p className="mt-0.5 font-mono text-[15px] tabular text-mist-50">
                  {v.value}
                  <span className="ml-1 text-[11px] font-sans text-mist-500">{v.unit}</span>
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-white/6 pt-5 text-[13px]">
          <Field label="Date of Birth" value={patient.dob} />
          <Field label="Age / Sex" value={`${patient.age} · ${patient.sex}`} />
          <Field label="Blood Type" value={patient.bloodType} />
          <Field label="Admitted" value={patient.admitted} />
          <Field label="Physician" value={patient.primaryPhysician} />
          <Field label="Allergies" value={patient.allergies.join(', ')} />
        </div>
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
              {tab === 'Summary' && <SummaryTab />}

              {tab === 'Labs' && (
                <div className="flex flex-col">
                  <TableRow columns="24px 2.1fr 1fr 1.3fr 1fr" className="text-[11px] font-medium uppercase tracking-wide text-mist-500">
                    <span />
                    <span>Test</span>
                    <span>Result</span>
                    <span>Reference Range</span>
                    <span>Collected</span>
                  </TableRow>
                  {labResults.map((l) => (
                    <TableRow key={l.id} columns="24px 2.1fr 1fr 1.3fr 1fr">
                      <Checkbox checked={!!reviewed[l.id]} onChange={(v) => setReviewed((r) => ({ ...r, [l.id]: v }))} />
                      <span className="truncate text-[13.5px] text-mist-100">{l.test}</span>
                      <span className="font-mono text-[13px] tabular" style={{ color: flagColor[l.flag] }}>
                        {l.result}
                      </span>
                      <span className="font-mono text-[12.5px] tabular text-mist-500">{l.range}</span>
                      <span className="text-[12.5px] text-mist-500">{l.collected}</span>
                    </TableRow>
                  ))}
                </div>
              )}

              {tab === 'Imaging' && (
                <div className="flex flex-col gap-3">
                  {imagingStudies.map((s) => (
                    <div key={s.id} className="rounded-[var(--radius-sm)] border border-white/6 bg-surface-800/50 px-4 py-3.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[13.5px] font-medium text-mist-50">{s.study}</p>
                        <span className="rounded-full border border-white/8 px-2 py-0.5 font-mono text-[10.5px] tabular text-mist-400">
                          {s.modality}
                        </span>
                      </div>
                      <p className="mt-1 text-[12.5px] text-mist-500">
                        {s.date} · {s.radiologist}
                      </p>
                      <p className="mt-2 text-[13px] text-mist-300">{s.impression}</p>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'Billing' && (
                <div className="flex flex-col">
                  <TableRow columns="1.8fr 0.8fr 0.8fr 0.7fr" className="text-[11px] font-medium uppercase tracking-wide text-mist-500">
                    <span>Description</span>
                    <span>Code</span>
                    <span>Amount</span>
                    <span>Status</span>
                  </TableRow>
                  {filteredBilling.map((b) => (
                    <TableRow key={b.id} columns="1.8fr 0.8fr 0.8fr 0.7fr">
                      <span className="truncate text-[13.5px] text-mist-100">{b.description}</span>
                      <span className="font-mono text-[12.5px] tabular text-mist-500">{b.code}</span>
                      <span className="font-mono text-[13px] tabular text-mist-100">{b.amount}</span>
                      <Badge status={billingStatusLabel[b.status]}>{b.status}</Badge>
                    </TableRow>
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </GlassPanel>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className="shrink-0 text-[11px] text-mist-500">{label}</p>
      <p className="text-right text-mist-200">{value}</p>
    </div>
  )
}

function SummaryTab() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[var(--radius-sm)] border border-white/6 bg-surface-800/50 p-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-mist-500">Chief Complaint</p>
        <p className="mt-1.5 text-[13.5px] text-mist-200">
          Progressive dyspnea on exertion and lower-extremity edema over 5 days, with one episode of orthopnea.
        </p>
      </div>
      <div className="rounded-[var(--radius-sm)] border border-white/6 bg-surface-800/50 p-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-mist-500">Assessment</p>
        <p className="mt-1.5 text-[13.5px] text-mist-200">
          Acute decompensated heart failure, preserved ejection fraction, on background of Type 2 diabetes and
          hypertension. Responding to IV diuresis; potassium trending low, monitor with repletion.
        </p>
      </div>
      <div className="rounded-[var(--radius-sm)] border border-white/6 bg-surface-800/50 p-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-mist-500">Care Plan</p>
        <ul className="mt-2 flex flex-col gap-2 text-[13.5px] text-mist-200">
          <li>Continue IV furosemide, reassess weight and I/O every shift</li>
          <li>Repeat BNP and BMP in AM</li>
          <li>Cardiology follow-up echo in 48 hours</li>
          <li>Diabetic diet, continue home metformin</li>
        </ul>
      </div>
    </div>
  )
}
