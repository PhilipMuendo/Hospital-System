import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * Clinical status indicators.
 *
 * The governing rule: **colour never carries meaning alone.** Every state
 * renders an icon, a colour and a word. Roughly 1 in 12 men has a colour
 * vision deficiency, and a red/green distinction on a glare-washed ward
 * monitor fails for everyone eventually.
 *
 * There are four levels and one neutral. Resist adding more — a hierarchy
 * only works if the top of it is rare.
 */

export type StatusTone = 'critical' | 'warning' | 'stable' | 'info' | 'neutral'

const tones: Record<StatusTone, { chip: string; text: string; dot: string }> = {
  critical: {
    chip: 'bg-critical-bg text-critical border-critical-line',
    text: 'text-critical',
    dot: 'bg-critical',
  },
  warning: {
    chip: 'bg-warning-bg text-warning border-warning-line',
    text: 'text-warning',
    dot: 'bg-warning',
  },
  stable: {
    chip: 'bg-stable-bg text-stable border-stable-line',
    text: 'text-stable',
    dot: 'bg-stable',
  },
  info: {
    chip: 'bg-info-bg text-info border-info-line',
    text: 'text-info',
    dot: 'bg-info',
  },
  neutral: {
    chip: 'bg-neutral-bg text-ink-700 border-neutral-line',
    text: 'text-ink-700',
    dot: 'bg-ink-500',
  },
}

function ToneIcon({ tone }: { tone: StatusTone }) {
  const common = { className: 'h-3.5 w-3.5 shrink-0', viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': true } as const

  switch (tone) {
    // Triangle — the universal "act now" shape, distinguishable at a glance
    // from a circle even in monochrome.
    case 'critical':
      return (
        <svg {...common}>
          <path d="M7 1.6 13 12H1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M7 5.4v3M7 10.2v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'warning':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.6" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7 4v3.4M7 9.7v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'stable':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.6" stroke="currentColor" strokeWidth="1.4" />
          <path d="m4.4 7.2 1.9 1.9L9.8 5.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'info':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.6" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7 6.4v3.4M7 4.2v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="3" fill="currentColor" />
        </svg>
      )
  }
}

/**
 * Inline status chip. Always renders its label — there is no icon-only mode,
 * because a chip whose meaning depends on hue is the thing this replaces.
 */
export function StatusChip({
  tone = 'neutral',
  children,
  icon = true,
  className,
}: {
  tone?: StatusTone
  children: ReactNode
  icon?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5',
        'text-2xs font-bold uppercase tracking-wide whitespace-nowrap',
        tones[tone].chip,
        className,
      )}
    >
      {icon && <ToneIcon tone={tone} />}
      {children}
    </span>
  )
}

/**
 * South African Triage Scale badge.
 *
 * The colours are a clinical standard, not a design choice, so they sit
 * outside the neutral palette. The target time is printed alongside because
 * "ORANGE" means nothing to agency staff on their first shift.
 */
const TRIAGE: Record<string, { label: string; target: string; bg: string }> = {
  RED: { label: 'Red', target: 'Immediate', bg: 'var(--color-triage-red)' },
  ORANGE: { label: 'Orange', target: '< 10 min', bg: 'var(--color-triage-orange)' },
  YELLOW: { label: 'Yellow', target: '< 60 min', bg: 'var(--color-triage-yellow)' },
  GREEN: { label: 'Green', target: '< 4 hr', bg: 'var(--color-triage-green)' },
  BLUE: { label: 'Blue', target: '—', bg: 'var(--color-triage-blue)' },
}

export function TriageBadge({ acuity, showTarget = true }: { acuity: string | null; showTarget?: boolean }) {
  if (!acuity) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-xs border border-dashed border-line-strong px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-ink-500">
        Not triaged
      </span>
    )
  }

  const t = TRIAGE[acuity] ?? { label: acuity, target: '', bg: 'var(--color-ink-500)' }

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className="inline-flex items-center rounded-xs px-2 py-0.5 text-2xs font-bold uppercase tracking-wide text-white"
        style={{ background: t.bg }}
      >
        {t.label}
      </span>
      {showTarget && t.target && <span className="text-2xs font-medium text-ink-600">{t.target}</span>}
    </span>
  )
}

/**
 * A clinical value with its unit and reference state.
 *
 * Deliberately large: this is the number someone reads to make a decision,
 * and it outranks every label on the screen.
 */
export function ClinicalValue({
  value,
  unit,
  tone = 'neutral',
  flag,
  size = 'md',
}: {
  value: string
  unit?: string | null
  tone?: StatusTone
  /** e.g. HIGH / LOW — rendered as text, not just colour. */
  flag?: string | null
  size?: 'md' | 'lg'
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span
        className={cn(
          'font-mono font-semibold tabular',
          size === 'lg' ? 'text-2xl' : 'text-md',
          tone === 'neutral' ? 'text-ink-900' : tones[tone].text,
        )}
      >
        {value}
      </span>
      {unit && <span className="text-xs text-ink-600">{unit}</span>}
      {flag && flag !== 'NORMAL' && (
        <span className={cn('text-2xs font-bold uppercase', tones[tone].text)}>{flag}</span>
      )}
    </span>
  )
}
