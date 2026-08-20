import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Button } from './Button'
import type { StatusTone } from './Status'

/**
 * Structural components: panels, page headers, alerts, dialogs.
 *
 * "Panel" not "card". A card implies a clickable object; most of these are
 * regions of a page. They are separated by 1px rules rather than shadow and
 * radius, which keeps a dense screen legible instead of turning it into a
 * field of floating tiles.
 */

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  /** Removes body padding — use when the panel contains a full-bleed table. */
  flush = false,
}: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  flush?: boolean
}) {
  return (
    <section className={cn('border border-line bg-canvas', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-header px-4 py-2.5">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-ink-900">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-ink-600">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(flush ? '' : 'p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

/**
 * Page header. One `<h1>` per page, with the primary action on the right at a
 * consistent position so it is always where the hand expects it.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  meta,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  /** Small status facts — counts, dates. Not a place for controls. */
  meta?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line bg-canvas px-4 py-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-600">{subtitle}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-600">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/**
 * A single operational number.
 *
 * Deliberately plain — a bordered figure with a label, not a gradient tile.
 * `tone` is only set when the number itself means something is wrong; a
 * count that is merely informational stays neutral, so colour on this row
 * always signals "look here".
 */
export function StatTile({
  label,
  value,
  tone = 'neutral',
  hint,
  onClick,
}: {
  label: string
  value: string | number
  tone?: StatusTone
  hint?: string
  onClick?: () => void
}) {
  const toneText =
    tone === 'critical'
      ? 'text-critical'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'stable'
          ? 'text-stable'
          : 'text-ink-900'

  const Wrapper = onClick ? 'button' : 'div'

  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'flex flex-col gap-1 border border-line bg-canvas px-4 py-3 text-left',
        onClick && 'hover:border-ink-400 hover:bg-header',
        tone === 'critical' && 'border-l-[3px] border-l-critical',
        tone === 'warning' && 'border-l-[3px] border-l-warning',
      )}
    >
      <span className="text-2xs font-bold uppercase tracking-wide text-ink-600">{label}</span>
      <span className={cn('font-mono text-2xl font-semibold tabular leading-none', toneText)}>{value}</span>
      {hint && <span className="text-xs text-ink-600">{hint}</span>}
    </Wrapper>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Inline alert.
 *
 * `role="alert"` for errors so it is announced immediately — an error a
 * screen-reader user has to go hunting for is an error they will miss.
 */
export function Alert({
  tone = 'info',
  title,
  children,
  onDismiss,
  action,
}: {
  tone?: StatusTone
  title?: string
  children?: ReactNode
  onDismiss?: () => void
  action?: ReactNode
}) {
  const styles: Record<StatusTone, string> = {
    critical: 'border-critical-line bg-critical-bg text-critical',
    warning: 'border-warning-line bg-warning-bg text-warning',
    stable: 'border-stable-line bg-stable-bg text-stable',
    info: 'border-info-line bg-info-bg text-info',
    neutral: 'border-line-strong bg-neutral-bg text-ink-800',
  }

  return (
    <div
      role={tone === 'critical' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 border-l-[3px] border px-4 py-3', styles[tone])}
    >
      <div className="min-w-0 flex-1">
        {title && <p className="text-sm font-bold">{title}</p>}
        {children && <div className={cn('text-sm', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-1 shrink-0 rounded-xs p-1 hover:bg-black/5"
        >
          <svg className="h-4 w-4" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="m3.5 3.5 7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Modal dialog.
 *
 * Used only where an action needs a decision the user cannot take from the
 * page — confirmations and structured reasons. Routine workflows stay inline.
 *
 * Escape closes, focus moves in on open and returns on close, and the
 * background is inert. This replaces `window.prompt()`, which was unstyleable,
 * unvalidated, invisible to screen readers, and dismissible with a stray tap
 * on a tablet — while being used to capture legally significant text such as
 * why a dose was withheld.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  width?: 'sm' | 'md' | 'lg'
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    restoreTo.current = document.activeElement as HTMLElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Focus the first control rather than the container, so a keyboard user
    // starts where the work is.
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, [tabindex]:not([tabindex="-1"])',
    )
    focusable?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      // Focus trap: a dialog the user can tab out of is not modal.
      if (e.key === 'Tab' && panelRef.current) {
        const nodes = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        )
        if (nodes.length === 0) return
        const first = nodes[0]
        const last = nodes[nodes.length - 1]

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      restoreTo.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/45 p-4 sm:items-center">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={description ? 'dialog-description' : undefined}
        className={cn('w-full border border-line-strong bg-canvas shadow-[var(--shadow-overlay)]', widths[width])}
      >
        <header className="border-b border-line px-5 py-3.5">
          <h2 id="dialog-title" className="text-lg font-semibold text-ink-900">
            {title}
          </h2>
          {description && (
            <p id="dialog-description" className="mt-1 text-sm text-ink-600">
              {description}
            </p>
          )}
        </header>

        <div className="px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-header px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

/**
 * Confirmation for a consequential action.
 *
 * States the consequence in the body rather than asking "Are you sure?", and
 * labels the button with the verb — "Discharge patient", not "OK" — so the
 * last thing read before committing describes what will happen.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  consequence,
  confirmLabel,
  tone = 'primary',
  loading,
  children,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  consequence: string
  confirmLabel: string
  tone?: 'primary' | 'danger'
  loading?: boolean
  children?: ReactNode
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-md text-ink-800">{consequence}</p>
      {children && <div className="mt-4">{children}</div>}
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Tabs. Roving focus with arrow keys, matching the WAI-ARIA tabs pattern, so
 * the whole set is one tab stop rather than one per tab.
 */
export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { id: string; label: string; count?: number; tone?: StatusTone }[]
  active: string
  onChange: (id: string) => void
  className?: string
}) {
  return (
    <div role="tablist" className={cn('flex gap-0 overflow-x-auto border-b border-line-strong', className)}>
      {tabs.map((tab, index) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
              e.preventDefault()
              const next = e.key === 'ArrowRight' ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length
              onChange(tabs[next].id)
              document.getElementById(`tab-${tabs[next].id}`)?.focus()
            }}
            className={cn(
              'relative flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-semibold transition-colors',
              selected
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-ink-600 hover:border-line-strong hover:text-ink-900',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'rounded-xs px-1.5 py-0.5 font-mono text-2xs font-bold tabular',
                  tab.tone === 'critical'
                    ? 'bg-critical text-white'
                    : tab.tone === 'warning'
                      ? 'bg-warning text-white'
                      : selected
                        ? 'bg-primary-100 text-primary-700'
                        : 'bg-neutral-bg text-ink-700',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
