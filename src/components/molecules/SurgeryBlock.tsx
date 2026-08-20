import { motion } from 'framer-motion'
import type { CSSProperties } from 'react'
import type { Surgery, SurgeryStatus } from '../../lib/types'
import { cn } from '../../lib/utils'

interface SurgeryBlockProps {
  surgery: Surgery
  style: CSSProperties
  colliding?: boolean
  onDelete?: (id: string) => void
}

const statusTint: Record<SurgeryStatus, string> = {
  CONFIRMED: 'var(--color-primary-600)',
  IN_PROGRESS: 'var(--color-stable)',
  DELAYED: 'var(--color-critical)',
  CANCELLED: 'var(--color-ink-600)',
}

// A pill-shaped booking block for the DAW-style scheduling timeline.
// When it overlaps a neighbor in the same room, a blurred underlay in
// the same hue bleeds through with mix-blend-mode: screen — two soft
// blobs visually merging rather than a hard clipped collision.
export function SurgeryBlock({ surgery, style, colliding, onDelete }: SurgeryBlockProps) {
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
          'relative flex h-full flex-col justify-center overflow-hidden rounded-full border px-4 py-1.5',
        )}
        style={{
          borderColor: `color-mix(in srgb, ${tint} 45%, transparent)`,
          background: `linear-gradient(180deg, color-mix(in srgb, ${tint} 22%, var(--color-neutral-bg)) 0%, color-mix(in srgb, ${tint} 10%, var(--color-neutral-bg)) 100%)`,
          boxShadow: `inset 0 0 24px color-mix(in srgb, ${tint} 18%, transparent), inset 0 1px 0 color-mix(in srgb, white 8%, transparent)`,
        }}
      >
        <span className="truncate text-xs font-semibold text-ink-900">{surgery.procedure}</span>
        <span className="truncate font-mono text-2xs tabular text-ink-700">
          {surgery.surgeon.name} · {surgery.patient.name}
        </span>

        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(surgery.id)
            }}
            className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-sunken/70 text-ink-600 opacity-0 transition-opacity hover:text-critical group-hover:opacity-100"
            title="Cancel booking"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </motion.div>
  )
}
