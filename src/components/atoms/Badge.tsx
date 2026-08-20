import type { OccupancyStatus } from '../../lib/occupancy'
import { StatusChip, type StatusTone } from '../ui/Status'

type BadgeTone = OccupancyStatus | 'neutral'

/**
 * Deprecated — use `StatusChip` from `components/ui`.
 *
 * Kept as a thin adapter so the screens still importing it get the design
 * system's chip (icon + colour + label) rather than a second, slightly
 * different badge. The old component signalled state with colour alone.
 */
const toneFor: Record<BadgeTone, StatusTone> = {
  healthy: 'stable',
  warning: 'warning',
  critical: 'critical',
  neutral: 'neutral',
}

export function Badge({
  status,
  children,
  className,
}: {
  status: BadgeTone
  children: React.ReactNode
  className?: string
}) {
  return (
    <StatusChip tone={toneFor[status] ?? 'neutral'} className={className}>
      {children}
    </StatusChip>
  )
}
