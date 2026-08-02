import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'

interface DropdownProps {
  label: string
  options: string[]
  value: string
  onChange: (value: string) => void
  className?: string
}

// A fully custom dropdown — no native <select>. Panel is frosted glass
// and springs up from the trigger rather than fading in flatly.
export function Dropdown({ label, options, value, onChange, className }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-[var(--radius-xs)] border border-white/8 bg-surface-800/70 px-3.5 py-2 text-[13px] font-medium text-mist-200 stroke-elevated"
      >
        <span className="text-mist-500">{label}</span>
        <span className="text-mist-50">{value}</span>
        <motion.svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 26 }}
        >
          <path d="M1 3.5L5 7.5L9 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </motion.svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            className="glass texture-noise absolute right-0 z-30 mt-2 w-48 overflow-hidden rounded-[var(--radius-sm)] p-1.5"
          >
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center rounded-[var(--radius-2xs)] px-3 py-2 text-left text-[13px] transition-colors',
                  opt === value ? 'bg-accent-500/15 text-accent-300' : 'text-mist-300 hover:bg-white/5 hover:text-mist-50',
                )}
              >
                {opt}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
