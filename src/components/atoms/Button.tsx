import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface ButtonProps {
  children: ReactNode
  variant?: 'primary' | 'ghost' | 'outline'
  size?: 'sm' | 'md'
  type?: 'button' | 'submit'
  onClick?: () => void
  className?: string
  icon?: ReactNode
  disabled?: boolean
}

const springTap = { type: 'spring', stiffness: 420, damping: 22 } as const

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  type = 'button',
  onClick,
  className,
  icon,
  disabled,
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
      type={type}
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={springTap}
      className={cn(base, sizes[size], variants[variant], disabled && 'opacity-50', className)}
    >
      {icon}
      {children}
    </motion.button>
  )
}
