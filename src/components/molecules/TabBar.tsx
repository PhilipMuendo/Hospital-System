import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

interface TabBarProps {
  tabs: string[]
  active: string
  onChange: (tab: string) => void
}

export function TabBar({ tabs, active, onChange }: TabBarProps) {
  return (
    <div className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-white/6 bg-surface-900/60 p-1">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={cn(
            'relative rounded-[var(--radius-xs)] px-4 py-2 text-[13px] font-medium transition-colors',
            active === tab ? 'text-charcoal-950' : 'text-mist-300 hover:text-mist-50',
          )}
        >
          {active === tab && (
            <motion.span
              layoutId="tab-pill"
              className="absolute inset-0 rounded-[var(--radius-xs)] bg-gradient-to-b from-accent-400 to-accent-500"
              transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            />
          )}
          <span className="relative z-10">{tab}</span>
        </button>
      ))}
    </div>
  )
}
