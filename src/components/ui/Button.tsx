import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Replaces the label while a mutation is in flight. */
  loading?: boolean
  loadingText?: string
  block?: boolean
  children: ReactNode
}

/**
 * The only button in the system.
 *
 * Sizes are floors, not suggestions: `md` is 40px and `lg` is 48px so a gloved
 * finger on a ward tablet has a real target. `sm` (32px) exists for dense
 * table rows on a mouse-driven workstation and should not be used for a
 * primary action.
 *
 * `primary` is the single blue in the palette. If two primaries appear in one
 * view, one of them is wrong.
 */
const variants: Record<Variant, string> = {
  primary:
    'bg-primary-600 text-white border border-primary-600 hover:bg-primary-700 hover:border-primary-700 active:bg-primary-800',
  secondary:
    'bg-canvas text-ink-800 border border-line-strong hover:bg-header active:bg-line-soft',
  ghost:
    'bg-transparent text-ink-700 border border-transparent hover:bg-neutral-bg active:bg-line',
  // Outlined rather than filled: a destructive action should be findable but
  // never the most eye-catching thing on the screen.
  danger:
    'bg-canvas text-critical border border-critical-line hover:bg-critical-bg active:bg-critical-bg',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-md gap-2',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  loadingText,
  block = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      // Announces the busy state rather than leaving a screen reader on the
      // old label while the request is in flight.
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-sm font-semibold whitespace-nowrap',
        'transition-colors duration-100',
        'disabled:cursor-not-allowed disabled:opacity-45',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {loading ? (loadingText ?? children) : children}
    </button>
  )
}

/** Small, low-contrast, and only ever inside a button. */
function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Icon-only control. Requires a label — an icon a tired person cannot decode
 * is worse than a word, so the label is both the tooltip and the accessible
 * name rather than optional decoration.
 */
export function IconButton({
  label,
  size = 'md',
  variant = 'ghost',
  className,
  children,
  ...rest
}: Omit<ButtonProps, 'children' | 'block'> & { label: string; children: ReactNode }) {
  const box = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm',
        'transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-45',
        variants[variant],
        box,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
