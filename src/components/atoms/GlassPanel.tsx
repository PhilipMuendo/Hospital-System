import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * Deprecated — use `Panel` from `components/ui`.
 *
 * Retained as a flat surface so the screens still referencing it render
 * correctly during migration. The blur, shadow and 0.65s entrance animation
 * it used to apply are gone: panel edges are now 1px rules, which survive
 * glare and photocopying in a way glassmorphism does not, and entrance
 * theatrics are fatigue on a screen someone watches for twelve hours.
 */
export function GlassPanel({ children, className }: { children: ReactNode; className?: string; noise?: boolean; delay?: number }) {
  return <div className={cn('border border-line bg-canvas', className)}>{children}</div>
}
