import { motion } from 'framer-motion'
import { useId } from 'react'
import { cn } from '../../lib/utils'

interface CheckboxProps {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
  className?: string
}

const spring = { type: 'spring', stiffness: 380, damping: 24 } as const

// A custom checkbox that morphs its own outline from a circle to a
// rounded square while the check glyph draws itself in via pathLength —
// no native <input type="checkbox"> in sight.
export function Checkbox({ checked, onChange, label, className }: CheckboxProps) {
  const id = useId()

  return (
    <label
      htmlFor={id}
      className={cn('inline-flex cursor-pointer items-center gap-2.5 select-none', className)}
    >
      <button
        id={id}
        role="checkbox"
        aria-checked={checked}
        type="button"
        onClick={() => onChange(!checked)}
        className="relative flex h-5 w-5 shrink-0 items-center justify-center outline-none"
      >
        <motion.span
          className="absolute inset-0 border"
          animate={{
            borderRadius: checked ? '30%' : '50%',
            backgroundColor: checked ? 'var(--color-accent-500)' : 'transparent',
            borderColor: checked
              ? 'var(--color-accent-500)'
              : 'color-mix(in srgb, var(--color-mist-400) 50%, transparent)',
          }}
          transition={spring}
        />
        <motion.svg
          viewBox="0 0 16 16"
          className="relative h-2.5 w-2.5"
          initial={false}
        >
          <motion.path
            d="M3 8.2L6.2 11.4L13 4"
            fill="none"
            stroke="var(--color-charcoal-950)"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
            transition={{ ...spring, delay: checked ? 0.06 : 0 }}
          />
        </motion.svg>
      </button>
      {label && <span className="text-[13px] text-mist-300">{label}</span>}
    </label>
  )
}
