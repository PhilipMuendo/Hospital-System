import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface ButtonProps {
  children: ReactNode
  variant?: 'primary' | 'ghost' | 'outline'
  size?: 'sm' | 'md'
  onClick?: () => void
  className?: string
  icon?: ReactNode
}

const springTap = { type: 'spring', stiffness: 420, damping: 22 } as const

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  onClick,
  className,
  icon,
}: ButtonProps) {
  const base =
    'inline-flex items-center gap-2 rounded-[var(--radius-xs)] font-medium tracking-tight select-none whitespace-nowrap'

  const sizes = {
    sm: 'px-3 py-1.5 text-[13px]',
    md: 'px-4 py-2.5 text-[14px]',
  }

  const variants = {
    primary:
      'bg-gradient-to-b from-accent-400 to-accent-600 text-charcoal-950 stroke-elevated',
    ghost: 'bg-transparent text-mist-300 hover:text-mist-50',
    outline:
      'bg-surface-800/60 text-mist-100 border border-white/8 stroke-elevated',
  }

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={springTap}
      className={cn(base, sizes[size], variants[variant], className)}
    >
      {icon}
      {children}
    </motion.button>
  )
}
