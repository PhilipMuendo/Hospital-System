import { useMemo } from 'react'
import { GlassPanel } from '../atoms/GlassPanel'
import { SurgeryBlock } from '../molecules/SurgeryBlock'
import { surgeries } from '../../data/mockData'

const START_HOUR = 6
const END_HOUR = 18
const HOUR_WIDTH = 150 // px per hour — DAW-timeline density
const ROOMS = ['OR 1', 'OR 2', 'OR 3', 'OR 4']

function overlaps(a: { startHour: number; durationHours: number }, b: { startHour: number; durationHours: number }) {
  const aEnd = a.startHour + a.durationHours
  const bEnd = b.startHour + b.durationHours
  return a.startHour < bEnd && b.startHour < aEnd
}

// A surgical-room booking timeline styled after DAW / music-production
// software: horizontally scrollable hour ruler, one lane per room, pill
// blocks that glow and visually merge when two bookings collide.
export function SchedulingGrid() {
  const totalWidth = (END_HOUR - START_HOUR) * HOUR_WIDTH
  const hours = useMemo(
    () => Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i),
    [],
  )

  const collidingIds = useMemo(() => {
    const ids = new Set<string>()
    for (const room of ROOMS) {
      const inRoom = surgeries.filter((s) => s.room === room)
      for (let i = 0; i < inRoom.length; i++) {
        for (let j = i + 1; j < inRoom.length; j++) {
          if (overlaps(inRoom[i], inRoom[j])) {
            ids.add(inRoom[i].id)
            ids.add(inRoom[j].id)
          }
        }
      }
    }
    return ids
  }, [])

  return (
    <GlassPanel className="p-6 lg:p-8" delay={0.25}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-wide text-mist-500">Smart Scheduling</p>
          <h2 className="mt-1 text-[20px]">Surgical Rooms &middot; Today</h2>
        </div>
        <div className="flex items-center gap-4 text-[12px] text-mist-400">
          <LegendDot color="var(--color-accent-500)" label="Confirmed" />
          <LegendDot color="var(--color-status-healthy)" label="In progress" />
          <LegendDot color="var(--color-status-critical)" label="Delayed" />
        </div>
      </div>

      <div className="mt-6 overflow-x-auto pb-2">
        <div style={{ width: totalWidth + 96 }}>
          {/* Hour ruler */}
          <div className="relative ml-24 h-6" style={{ width: totalWidth }}>
            {hours.map((h) => (
              <span
                key={h}
                className="absolute top-0 font-mono text-[11px] tabular text-mist-500"
                style={{ left: (h - START_HOUR) * HOUR_WIDTH }}
              >
                {h.toString().padStart(2, '0')}:00
              </span>
            ))}
          </div>

          {/* Lanes */}
          <div className="mt-1 flex flex-col gap-2">
            {ROOMS.map((room) => (
              <div key={room} className="flex items-stretch">
                <div className="flex w-24 shrink-0 items-center pr-3">
                  <span className="font-mono text-[12px] tabular text-mist-300">{room}</span>
                </div>
                <div
                  className="relative h-16 rounded-[var(--radius-sm)] border border-white/6 bg-surface-800/40"
                  style={{ width: totalWidth }}
                >
                  {/* hour gridlines */}
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="absolute top-0 bottom-0 w-px bg-white/5"
                      style={{ left: (h - START_HOUR) * HOUR_WIDTH }}
                    />
                  ))}
                  {surgeries
                    .filter((s) => s.room === room)
                    .map((s) => (
                      <SurgeryBlock
                        key={s.id}
                        surgery={s}
                        colliding={collidingIds.has(s.id)}
                        style={{
                          left: (s.startHour - START_HOUR) * HOUR_WIDTH,
                          width: s.durationHours * HOUR_WIDTH,
                        }}
                      />
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </GlassPanel>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}
