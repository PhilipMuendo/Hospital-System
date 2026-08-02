import { cn } from '../../lib/utils'

interface AvatarProps {
  initials: string
  size?: number
  className?: string
}

export function Avatar({ initials, size = 56, className }: AvatarProps) {
  return (
    <div
      className={cn(
        'relative flex items-center justify-center rounded-full font-display font-semibold text-mist-50 stroke-elevated',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        letterSpacing: '-0.01em',
        background:
          'radial-gradient(120% 120% at 30% 20%, var(--color-accent-600) 0%, var(--color-surface-700) 70%)',
      }}
    >
      {initials}
      <span
        className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-charcoal-900"
        style={{ background: 'var(--color-status-healthy)' }}
        aria-hidden
      />
    </div>
  )
}
