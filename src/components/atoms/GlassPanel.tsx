import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface GlassPanelProps {
  children: ReactNode
  className?: string
  noise?: boolean
  as?: 'div' | 'section'
  delay?: number
}

export function GlassPanel({ children, className, noise = true, delay = 0 }: GlassPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.65, ease: [0.22, 1.12, 0.4, 1], delay }}
      className={cn(
        'glass rounded-[var(--radius-lg)]',
        noise && 'texture-noise',
        className,
      )}
    >
      {children}
    </motion.div>
  )
}
