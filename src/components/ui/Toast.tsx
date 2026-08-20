import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import type { StatusTone } from './Status'

/**
 * Transient feedback.
 *
 * Rules, because a clinical system is not a consumer app:
 *
 *  - Success toasts auto-dismiss. Errors do NOT — an error that vanishes
 *    after four seconds is an error the user will not act on, and in this
 *    system "failed to record the dose" must stay on screen until read.
 *  - Toasts confirm; they never *replace* state on the page. If a drug round
 *    updates, the row updates too. Someone who missed the toast must still be
 *    able to see what happened.
 *  - Bottom-left, away from the offline indicator, and never over the primary
 *    action of the page.
 *  - Rendered into an `aria-live` region so screen readers announce them
 *    without stealing focus.
 */

export interface Toast {
  id: string
  tone: StatusTone
  title: string
  description?: string
  /** ms; null means it stays until dismissed. Errors default to null. */
  duration?: number | null
  action?: { label: string; onClick: () => void }
}

interface ToastContextValue {
  notify: (toast: Omit<Toast, 'id'>) => string
  success: (title: string, description?: string) => string
  error: (title: string, description?: string) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const MAX_VISIBLE = 4

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, number>())

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const notify = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = crypto.randomUUID()
      // Errors persist by default; everything else clears itself.
      const duration = toast.duration === undefined ? (toast.tone === 'critical' ? null : 5000) : toast.duration

      setToasts((current) => [...current.slice(-(MAX_VISIBLE - 1)), { ...toast, id }])

      if (duration !== null) {
        timers.current.set(id, window.setTimeout(() => dismiss(id), duration))
      }
      return id
    },
    [dismiss],
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      map.forEach((t) => window.clearTimeout(t))
      map.clear()
    }
  }, [])

  const value = useMemo<ToastContextValue>(
    () => ({
      notify,
      success: (title, description) => notify({ tone: 'stable', title, description }),
      error: (title, description) => notify({ tone: 'critical', title, description }),
      dismiss,
    }),
    [notify, dismiss],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}

const toneStyles: Record<StatusTone, string> = {
  critical: 'border-l-critical bg-canvas',
  warning: 'border-l-warning bg-canvas',
  stable: 'border-l-stable bg-canvas',
  info: 'border-l-info bg-canvas',
  neutral: 'border-l-ink-500 bg-canvas',
}

const toneText: Record<StatusTone, string> = {
  critical: 'text-critical',
  warning: 'text-warning',
  stable: 'text-stable',
  info: 'text-info',
  neutral: 'text-ink-700',
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      // `polite` rather than `assertive`: a toast should not interrupt a
      // screen reader mid-sentence while someone is reading a drug chart.
      aria-live="polite"
      aria-relevant="additions"
      className="no-print pointer-events-none fixed bottom-4 left-4 z-50 flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'critical' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex items-start gap-3 border border-l-[3px] border-line-strong px-4 py-3 shadow-[var(--shadow-overlay)]',
            toneStyles[t.tone],
          )}
        >
          <div className="min-w-0 flex-1">
            <p className={cn('text-sm font-bold', toneText[t.tone])}>{t.title}</p>
            {t.description && <p className="mt-0.5 text-sm text-ink-700">{t.description}</p>}
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.onClick()
                  onDismiss(t.id)
                }}
                className="mt-2 text-xs font-semibold text-primary-700 underline underline-offset-2"
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss notification"
            className="-m-1 shrink-0 rounded-xs p-1 text-ink-500 hover:bg-neutral-bg hover:text-ink-800"
          >
            <svg className="h-4 w-4" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="m3.5 3.5 7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Loading indicators.
 *
 * Preference order, because a spinner is the weakest of the three:
 *   1. Skeleton rows, where the shape of what is coming is known.
 *   2. Inline button state, where one action is in flight.
 *   3. A spinner, only when neither applies.
 *
 * A spinner with no context tells the user something is happening but not
 * what, and on a slow hospital connection that is indistinguishable from a
 * hang.
 */
export function Spinner({ size = 'md', label }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const dims = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' }[size]
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <svg className={cn('animate-spin text-primary-600', dims)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
        <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      {label ? <span className="text-sm text-ink-600">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  )
}

/** Full-region loading state that says what is being fetched. */
export function LoadingPanel({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 border border-line bg-canvas px-6 py-12">
      <Spinner label={`${label}…`} />
    </div>
  )
}
