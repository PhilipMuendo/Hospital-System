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
        'relative flex items-center justify-center rounded-full font-display font-semibold text-ink-900',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        letterSpacing: '-0.01em',
        background:
          'radial-gradient(120% 120% at 30% 20%, var(--color-primary-600) 0%, var(--color-neutral-bg) 70%)',
      }}
    >
      {initials}
      <span
        className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-line"
        style={{ background: 'var(--color-stable)' }}
        aria-hidden
      />
    </div>
  )
}
