import { cn } from '../../lib/utils'
import type { OccupancyStatus } from '../../lib/occupancy'

type BadgeTone = OccupancyStatus | 'neutral'

interface BadgeProps {
  status: BadgeTone
  children: React.ReactNode
  className?: string
}

const statusStyles: Record<BadgeTone, string> = {
  neutral: 'bg-white/6 text-mist-300 border-white/12',
  healthy: 'bg-status-healthy/12 text-status-healthy border-status-healthy/25',
  warning: 'bg-status-warning/12 text-status-warning border-status-warning/25',
  critical: 'bg-status-critical/14 text-status-critical border-status-critical/30',
}

export function Badge({ status, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
        statusStyles[status],
        className,
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: status === 'neutral' ? 'var(--color-mist-500)' : `var(--color-status-${status})`,
        }}
      />
      {children}
    </span>
  )
}
