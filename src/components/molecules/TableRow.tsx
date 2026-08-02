import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface TableRowProps {
  children: ReactNode
  columns: string
  className?: string
}

// Div-based grid row (not a native <table>) so we can safely transform
// on hover — expands slightly with a soft highlight, no harsh borders.
export function TableRow({ children, columns, className }: TableRowProps) {
  return (
    <motion.div
      className={cn(
        'grid items-center gap-4 rounded-[var(--radius-2xs)] border-t border-white/5 px-4 py-3.5 first:border-t-0',
        className,
      )}
      style={{ gridTemplateColumns: columns }}
      whileHover={{
        scaleY: 1.02,
        backgroundColor: 'color-mix(in srgb, white 3.5%, transparent)',
      }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
    >
      {children}
    </motion.div>
  )
}
