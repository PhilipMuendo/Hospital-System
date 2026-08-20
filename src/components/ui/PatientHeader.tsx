import type { ReactNode } from 'react'
import { calculateAge, formatDate } from '../../lib/format'
import { StatusChip, TriageBadge } from './Status'
import { cn } from '../../lib/utils'

/**
 * Patient context banner.
 *
 * Wrong-patient error is the commonest serious error in hospital software.
 * The structural defence is that identity is never off-screen while a
 * patient-scoped action is possible — so this is sticky, non-dismissible, and
 * appears on every screen where the user is acting on one person.
 *
 * Order is deliberate and follows what a clinician verifies aloud:
 * name → identifiers → age/sex → location → allergies → status.
 *
 * Allergies are given the most visually aggressive treatment on the screen.
 * "No known allergies" is stated explicitly rather than left blank, because a
 * blank is ambiguous between "none" and "nobody has asked".
 */

export interface PatientContext {
  id: string
  name: string
  dob: string
  sex: string
  opNumber?: string | null
  ipNumber?: string | null
  nationalId?: string | null
  ward?: { name: string } | string | null
  bed?: string | null
  allergies?: string[]
  codeStatus?: string | null
  status?: string | null
  acuity?: string | null
  physician?: string | null
  admittedAt?: string | null
}

const sexLabel: Record<string, string> = { MALE: 'M', FEMALE: 'F', INTERSEX: 'I' }

export function PatientHeader({
  patient,
  actions,
  compact = false,
}: {
  patient: PatientContext
  actions?: ReactNode
  compact?: boolean
}) {
  const allergies = patient.allergies ?? []
  const hasAllergies = allergies.length > 0
  const wardName = typeof patient.ward === 'string' ? patient.ward : patient.ward?.name

  return (
    <section
      aria-label={`Patient in context: ${patient.name}`}
      className={cn(
        'sticky top-0 z-20 border-b-2 border-ink-900 bg-canvas',
        // Red top edge when an allergy exists — visible in peripheral vision
        // before the text is read.
        hasAllergies && 'border-t-[3px] border-t-critical',
      )}
    >
      <div className={cn('flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4', compact ? 'py-2.5' : 'py-3')}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className={cn('font-semibold text-ink-900', compact ? 'text-md' : 'text-lg')}>{patient.name}</h2>

            <span className="font-mono text-sm font-semibold tabular text-ink-700">
              {calculateAge(patient.dob)}
              {sexLabel[patient.sex] ?? patient.sex}
            </span>

            <span className="font-mono text-xs tabular text-ink-600">
              {patient.ipNumber ?? patient.opNumber ?? 'No number'}
            </span>

            {patient.status === 'ADMITTED' && wardName && (
              <span className="text-xs text-ink-600">
                {wardName}
                {patient.bed ? ` · ${patient.bed}` : ''}
              </span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {/* Allergies first: the one thing that must not be missed. */}
            {hasAllergies ? (
              <span className="inline-flex items-center gap-1.5 rounded-xs border border-critical-line bg-critical-bg px-2 py-1">
                <svg className="h-4 w-4 shrink-0 text-critical" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M7 1.6 13 12H1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  <path d="M7 5.4v3M7 10.2v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="text-xs font-bold uppercase tracking-wide text-critical">Allergies</span>
                <span className="text-sm font-semibold text-critical">{allergies.join(', ')}</span>
              </span>
            ) : (
              <span className="text-xs text-ink-600">No known allergies</span>
            )}

            {patient.codeStatus && patient.codeStatus !== 'FULL_CODE' && (
              <StatusChip tone="warning">{patient.codeStatus.replace(/_/g, ' ')}</StatusChip>
            )}

            {patient.acuity && <TriageBadge acuity={patient.acuity} />}

            {patient.physician && (
              <span className="text-xs text-ink-600">
                <span className="text-ink-500">Under</span> {patient.physician}
              </span>
            )}

            {patient.admittedAt && patient.status === 'ADMITTED' && (
              <span className="text-xs text-ink-600">
                <span className="text-ink-500">Admitted</span> {formatDate(patient.admittedAt)}
              </span>
            )}
          </div>
        </div>

        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </section>
  )
}

/**
 * Confirmation line for a patient-scoped destructive or clinically
 * significant action. Restates who it applies to, so confirming is a decision
 * rather than a reflex.
 */
export function PatientConfirmLine({ patient }: { patient: PatientContext }) {
  return (
    <div className="flex items-baseline gap-2 border border-line-strong bg-header px-3 py-2">
      <span className="text-xs text-ink-500">Patient</span>
      <span className="text-md font-semibold text-ink-900">{patient.name}</span>
      <span className="font-mono text-xs tabular text-ink-600">
        {patient.ipNumber ?? patient.opNumber ?? ''}
      </span>
      <span className="font-mono text-xs tabular text-ink-600">
        {calculateAge(patient.dob)}
        {sexLabel[patient.sex] ?? patient.sex}
      </span>
    </div>
  )
}
