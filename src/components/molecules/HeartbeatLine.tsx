import { motion } from 'framer-motion'

interface HeartbeatLineProps {
  className?: string
}

// A single continuous ECG trace that redraws itself in a loop.
const PATH =
  'M0 20 L20 20 L28 20 L34 6 L40 34 L46 12 L52 20 L60 20 L66 20 L72 4 L78 32 L84 20 L100 20 L112 20 L118 8 L124 30 L130 20 L150 20 L162 20 L168 6 L174 34 L180 12 L186 20 L200 20'

export function HeartbeatLine({ className }: HeartbeatLineProps) {
  return (
    <svg viewBox="0 0 200 40" className={className} preserveAspectRatio="none">
      <path d={PATH} fill="none" stroke="color-mix(in srgb, var(--color-accent-500) 18%, transparent)" strokeWidth={1.5} />
      <motion.path
        d={PATH}
        fill="none"
        stroke="var(--color-accent-400)"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: 'drop-shadow(0 0 4px color-mix(in srgb, var(--color-accent-400) 70%, transparent))' }}
        initial={{ pathLength: 0, pathOffset: 0 }}
        animate={{ pathLength: [0, 1], pathOffset: [0, 1] }}
        transition={{ duration: 2.6, ease: 'linear', repeat: Infinity }}
      />
    </svg>
  )
}
