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
    'inline-flex items-center gap-2 rounded-xs font-medium tracking-tight select-none whitespace-nowrap'

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-sm',
  }

  const variants = {
    primary:
      'bg-gradient-to-b from-primary-600 to-primary-700 text-white',
    ghost: 'bg-transparent text-ink-700 hover:text-ink-900',
    outline:
      'bg-header text-ink-900 border border-line',
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
