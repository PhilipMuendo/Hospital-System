import { motion } from 'framer-motion'
import type { OccupancyStatus } from '../../lib/occupancy'

interface StatRingProps {
  percent: number
  status: OccupancyStatus
  size?: number
  strokeWidth?: number
  label: string
  sublabel: string
}

const statusColor: Record<OccupancyStatus, string> = {
  healthy: 'var(--color-status-healthy)',
  warning: 'var(--color-status-warning)',
  critical: 'var(--color-status-critical)',
}

// The circular centerpiece of the "Now Playing" dashboard — a large
// bed-occupancy ring that draws itself in with spring physics.
export function StatRing({ percent, status, size = 280, strokeWidth = 14, label, sublabel }: StatRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - percent / 100)
  const color = statusColor[status]

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="color-mix(in srgb, white 6%, transparent)"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.4, ease: [0.22, 1.12, 0.4, 1], delay: 0.2 }}
          style={{ filter: `drop-shadow(0 0 18px color-mix(in srgb, ${color} 55%, transparent))` }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <motion.span
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="font-display text-[64px] font-semibold leading-none tabular text-mist-50"
          style={{ letterSpacing: '-0.03em' }}
        >
          {percent}
          <span className="text-[28px] text-mist-400">%</span>
        </motion.span>
        <span className="mt-2 text-[13px] font-medium text-mist-300">{label}</span>
        <span className="mt-0.5 text-[12px] text-mist-500">{sublabel}</span>
      </div>
    </div>
  )
}
