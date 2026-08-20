import { useId } from 'react'
import { cn } from '../../lib/utils'

/**
 * Checkbox.
 *
 * A real `<input type="checkbox">` behind a styled box: it stays keyboard
 * operable, announces its state, and participates in forms. The hit area is
 * the whole label, and the control itself is 20px inside a 44px row so a
 * gloved finger can hit it.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  className,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
  className?: string
  disabled?: boolean
}) {
  const id = useId()

  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span className="relative inline-flex h-5 w-5 shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none inline-flex h-5 w-5 items-center justify-center rounded-xs border-2 transition-colors',
            checked ? 'border-primary-600 bg-primary-600 text-white' : 'border-line-strong bg-canvas',
            disabled && 'opacity-45',
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-600',
          )}
        >
          {checked && (
            <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none">
              <path d="m3 7.5 2.6 2.6L11 4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </span>
      {label && (
        <label htmlFor={id} className="cursor-pointer text-sm text-ink-800">
          {label}
        </label>
      )}
    </span>
  )
}
