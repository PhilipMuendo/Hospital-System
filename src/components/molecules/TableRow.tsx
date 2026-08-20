import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * Deprecated — use `DataTable` from `components/ui`.
 *
 * A CSS-grid pseudo-row, retained for screens not yet migrated to real
 * `<table>` markup. Restyled to match the design system's row metrics (48px,
 * 1px rules, readable type) so a page using it does not look like a different
 * product. New screens should use DataTable, which screen readers can
 * actually navigate.
 */
export function TableRow({
  columns,
  children,
  className,
  onClick,
}: {
  columns: string
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      // Below md the fr-based grid crushes every column to unreadable width on
      // a ward tablet, so the row wraps instead. Above md it is a real grid.
      style={{ ['--cols' as string]: columns }}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 md:grid md:[grid-template-columns:var(--cols)]',
        'border-b border-line px-3 py-2.5 text-sm text-ink-800 last:border-b-0',
        onClick && 'cursor-pointer hover:bg-primary-50',
        className,
      )}
    >
      {children}
    </div>
  )
}
