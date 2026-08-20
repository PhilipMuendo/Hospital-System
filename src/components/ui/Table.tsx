import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

/**
 * Data table.
 *
 * Real `<table>` markup, not a grid of divs: screen readers announce row and
 * column position, and the browser handles column sizing. Healthcare staff
 * live in lists — this is the most important component in the system.
 *
 * Row height is 48px so a row is a comfortable touch target and the eye can
 * track across it without losing the line.
 */

export function DataTable({
  children,
  caption,
  className,
  stickyHeader = true,
}: {
  children: ReactNode
  /** Announced to screen readers; visually hidden. */
  caption: string
  className?: string
  stickyHeader?: boolean
}) {
  return (
    // Horizontal scroll is contained here so the page body never scrolls
    // sideways on a narrow ward tablet.
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        {stickyHeader ? <colgroup /> : null}
        {children}
      </table>
    </div>
  )
}

export function THead({ children, sticky = true }: { children: ReactNode; sticky?: boolean }) {
  return (
    <thead
      className={cn(
        'bg-header',
        // Keeps column meaning visible when a long worklist is scrolled.
        sticky && 'sticky top-0 z-10',
      )}
    >
      {children}
    </thead>
  )
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>
}

export function TR({
  children,
  onClick,
  selected,
  tone,
  className,
}: {
  children: ReactNode
  onClick?: () => void
  selected?: boolean
  /** Left edge marker for rows needing attention. */
  tone?: 'critical' | 'warning'
  className?: string
}) {
  const interactive = !!onClick

  return (
    <tr
      onClick={onClick}
      // A clickable row is reachable and activatable from the keyboard.
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? 'button' : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'border-b border-line last:border-b-0',
        interactive && 'cursor-pointer hover:bg-primary-50 focus-visible:bg-primary-50',
        selected && 'bg-primary-50',
        // 3px bar, not a tinted row: a full-row wash makes the text harder to
        // read at exactly the moment it matters most.
        tone === 'critical' && 'border-l-[3px] border-l-critical',
        tone === 'warning' && 'border-l-[3px] border-l-warning',
        className,
      )}
    >
      {children}
    </tr>
  )
}

export function TH({
  children,
  align = 'left',
  width,
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & {
  children: ReactNode
  align?: 'left' | 'right' | 'center'
  width?: string
}) {
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={cn(
        'border-b border-line-strong px-3 py-2.5',
        'text-2xs font-bold uppercase tracking-wide text-ink-600 whitespace-nowrap',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  )
}

export function TD({
  children,
  align = 'left',
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & {
  children: ReactNode
  align?: 'left' | 'right' | 'center'
}) {
  return (
    <td
      className={cn(
        'px-3 py-2.5 align-middle text-sm text-ink-800',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  )
}

/** Primary identifier in a row — the cell the eye should land on first. */
export function TDPrimary({
  children,
  secondary,
  className,
}: {
  children: ReactNode
  secondary?: ReactNode
  className?: string
}) {
  return (
    <td className={cn('px-3 py-2.5 align-middle', className)}>
      <div className="text-md font-semibold text-ink-900">{children}</div>
      {secondary && <div className="mt-0.5 text-xs text-ink-600">{secondary}</div>}
    </td>
  )
}

/**
 * Sortable header. The arrow is redundant with `aria-sort` on purpose —
 * one for the eye, one for the screen reader.
 */
export function SortableTH({
  children,
  active,
  direction = 'asc',
  onSort,
  align = 'left',
  width,
}: {
  children: ReactNode
  active?: boolean
  direction?: 'asc' | 'desc'
  onSort: () => void
  align?: 'left' | 'right' | 'center'
  width?: string
}) {
  return (
    <TH align={align} width={width} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={onSort}
        className={cn(
          'inline-flex items-center gap-1 text-2xs font-bold uppercase tracking-wide hover:text-ink-900',
          active ? 'text-ink-900' : 'text-ink-600',
        )}
      >
        {children}
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          {active ? (
            <path
              d={direction === 'asc' ? 'm3 7 3-3 3 3' : 'm3 5 3 3 3-3'}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <path d="m3.5 5 2.5-2.5L8.5 5M3.5 7l2.5 2.5L8.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
          )}
        </svg>
      </button>
    </TH>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Empty state. Says what is absent and, where useful, what to do — never a
 * bare "No data", which leaves the user unsure whether the system failed.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 border border-dashed border-line-strong bg-canvas px-6 py-12 text-center">
      <p className="text-md font-semibold text-ink-800">{title}</p>
      {description && <p className="max-w-md text-sm text-ink-600">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Row-shaped loading placeholder, so the layout does not jump on arrival. */
export function LoadingRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-live="polite" className="divide-y divide-line border border-line bg-canvas">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-3 py-3.5">
          {Array.from({ length: columns }).map((_, c) => (
            <div key={c} className="skeleton h-4" style={{ width: c === 0 ? '28%' : `${Math.max(10, 22 - c * 3)}%` }} />
          ))}
        </div>
      ))}
    </div>
  )
}
