import { motion } from 'framer-motion'
import type { CSSProperties } from 'react'
import type { Surgery } from '../../data/mockData'
import { cn } from '../../lib/utils'

interface SurgeryBlockProps {
  surgery: Surgery
  style: CSSProperties
  colliding?: boolean
}

const statusTint: Record<Surgery['status'], string> = {
  confirmed: 'var(--color-accent-500)',
  'in-progress': 'var(--color-status-healthy)',
  delayed: 'var(--color-status-critical)',
}

// A pill-shaped booking block for the DAW-style scheduling timeline.
// When it overlaps a neighbor in the same room, a blurred underlay in
// the same hue bleeds through with mix-blend-mode: screen — two soft
// blobs visually merging rather than a hard clipped collision.
export function SurgeryBlock({ surgery, style, colliding }: SurgeryBlockProps) {
  const tint = statusTint[surgery.status]

  return (
    <motion.div
      className="group absolute top-1.5 bottom-1.5"
      style={style}
      initial={{ opacity: 0, scale: 0.9, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      whileHover={{ scale: 1.03, zIndex: 20 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
    >
      {colliding && (
        <div
          className="absolute -inset-2 rounded-full opacity-60 blur-xl"
          style={{ background: tint, mixBlendMode: 'screen' }}
          aria-hidden
        />
      )}
      <div
        className={cn(
          'relative flex h-full flex-col justify-center overflow-hidden rounded-full border px-4 py-1.5 stroke-elevated',
        )}
        style={{
          borderColor: `color-mix(in srgb, ${tint} 45%, transparent)`,
          background: `linear-gradient(180deg, color-mix(in srgb, ${tint} 22%, var(--color-surface-800)) 0%, color-mix(in srgb, ${tint} 10%, var(--color-surface-800)) 100%)`,
          boxShadow: `inset 0 0 24px color-mix(in srgb, ${tint} 18%, transparent), inset 0 1px 0 color-mix(in srgb, white 8%, transparent)`,
        }}
      >
        <span className="truncate text-[12.5px] font-semibold text-mist-50">{surgery.procedure}</span>
        <span className="truncate font-mono text-[11px] tabular text-mist-300">
          {surgery.surgeon} · {surgery.patient}
        </span>
      </div>
    </motion.div>
  )
}
