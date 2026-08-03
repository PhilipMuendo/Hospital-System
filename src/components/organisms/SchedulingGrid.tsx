import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GlassPanel } from '../atoms/GlassPanel'
import { Skeleton } from '../atoms/Skeleton'
import { Button } from '../atoms/Button'
import { Dropdown } from '../molecules/Dropdown'
import { SurgeryBlock } from '../molecules/SurgeryBlock'
import { api, ApiError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'
import type { ORRoom, PatientSummary, Surgery } from '../../lib/types'

const START_HOUR = 6
const END_HOUR = 18
const HOUR_WIDTH = 150 // px per hour — DAW-timeline density
const ROOMS: { id: ORRoom; label: string }[] = [
  { id: 'OR_1', label: 'OR 1' },
  { id: 'OR_2', label: 'OR 2' },
  { id: 'OR_3', label: 'OR 3' },
  { id: 'OR_4', label: 'OR 4' },
]

function nairobiDecimalHour(iso: string): number {
  const d = new Date(iso)
  return (d.getUTCHours() + 3 + d.getUTCMinutes() / 60) % 24
}

function todayNairobiDateStr(): string {
  const nairobiMs = Date.now() + 3 * 60 * 60 * 1000
  return new Date(nairobiMs).toISOString().slice(0, 10)
}

function overlaps(a: Surgery, b: Surgery) {
  return new Date(a.startsAt) < new Date(b.endsAt) && new Date(b.startsAt) < new Date(a.endsAt)
}

// A surgical-room booking timeline styled after DAW / music-production
// software: horizontally scrollable hour ruler, one lane per room, pill
// blocks that glow and visually merge when two bookings collide.
export function SchedulingGrid() {
  const { user } = useAuth()
  const canSchedule = user?.role === 'ADMIN' || user?.role === 'PHYSICIAN'
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)

  const surgeriesQuery = useQuery({
    queryKey: ['surgeries', todayNairobiDateStr()],
    queryFn: () => api.get<Surgery[]>('/surgeries'),
  })

  const deleteSurgery = useMutation({
    mutationFn: (id: string) => api.del(`/surgeries/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['surgeries'] }),
  })

  const totalWidth = (END_HOUR - START_HOUR) * HOUR_WIDTH
  const hours = useMemo(
    () => Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i),
    [],
  )

  const surgeries = surgeriesQuery.data ?? []

  const collidingIds = useMemo(() => {
    const ids = new Set<string>()
    for (const room of ROOMS) {
      const inRoom = surgeries.filter((s) => s.room === room.id)
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
  }, [surgeries])

  return (
    <GlassPanel className="p-6 lg:p-8" delay={0.25}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-wide text-mist-500">Smart Scheduling</p>
          <h2 className="mt-1 text-[20px]">Surgical Rooms &middot; Today</h2>
        </div>
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-4 text-[12px] text-mist-400">
            <LegendDot color="var(--color-accent-500)" label="Confirmed" />
            <LegendDot color="var(--color-status-healthy)" label="In progress" />
            <LegendDot color="var(--color-status-critical)" label="Delayed" />
          </div>
          {canSchedule && (
            <Button size="sm" onClick={() => setFormOpen((o) => !o)}>
              {formOpen ? 'Close' : '+ New Booking'}
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {formOpen && canSchedule && (
          <NewBookingForm
            onClose={() => setFormOpen(false)}
            onCreated={() => {
              setFormOpen(false)
              queryClient.invalidateQueries({ queryKey: ['surgeries'] })
            }}
          />
        )}
      </AnimatePresence>

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
              <div key={room.id} className="flex items-stretch">
                <div className="flex w-24 shrink-0 items-center pr-3">
                  <span className="font-mono text-[12px] tabular text-mist-300">{room.label}</span>
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
                  {surgeriesQuery.isLoading ? (
                    <Skeleton className="absolute inset-1.5 rounded-full" />
                  ) : (
                    surgeries
                      .filter((s) => s.room === room.id)
                      .map((s) => {
                        const startHour = nairobiDecimalHour(s.startsAt)
                        const endHour = nairobiDecimalHour(s.endsAt)
                        return (
                          <SurgeryBlock
                            key={s.id}
                            surgery={s}
                            colliding={collidingIds.has(s.id)}
                            onDelete={canSchedule ? (id) => deleteSurgery.mutate(id) : undefined}
                            style={{
                              left: (startHour - START_HOUR) * HOUR_WIDTH,
                              width: (endHour - startHour) * HOUR_WIDTH,
                            }}
                          />
                        )
                      })
                  )}
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

function NewBookingForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [patientId, setPatientId] = useState<string | null>(null)
  const [patientLabel, setPatientLabel] = useState('')
  const [procedure, setProcedure] = useState('')
  const [surgeonName, setSurgeonName] = useState('')
  const [roomLabel, setRoomLabel] = useState('OR 1')
  const [startTime, setStartTime] = useState('08:00')
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [conflict, setConflict] = useState<{ message: string; conflicts: Surgery[] } | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 150)
    return () => clearTimeout(t)
  }, [search])

  const patientsQuery = useQuery({
    queryKey: ['patients', debouncedSearch],
    queryFn: () => api.get<PatientSummary[]>(`/patients${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ''}`),
    enabled: debouncedSearch.length > 0,
  })

  const surgeonsQuery = useQuery({
    queryKey: ['staff', 'PHYSICIAN'],
    queryFn: () => api.get<{ id: string; name: string; role: string }[]>('/auth/staff?role=PHYSICIAN'),
  })

  const createSurgery = useMutation({
    mutationFn: (force: boolean) => {
      const surgeon = surgeonsQuery.data?.find((s) => s.name === surgeonName)
      const room = ROOMS.find((r) => r.label === roomLabel)!
      const dateStr = todayNairobiDateStr()
      const startsAt = `${dateStr}T${startTime}:00+03:00`
      const startDate = new Date(startsAt)
      const endsAt = new Date(startDate.getTime() + durationMinutes * 60 * 1000).toISOString()
      return api.post<Surgery>(`/surgeries${force ? '?force=true' : ''}`, {
        patientId,
        procedure,
        surgeonId: surgeon?.id,
        room: room.id,
        startsAt,
        endsAt,
      })
    },
    onSuccess: () => {
      setConflict(null)
      onCreated()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setConflict({ message: err.message, conflicts: (err.details as Surgery[]) ?? [] })
      }
    },
  })

  const canSubmit = patientId && procedure && surgeonName && roomLabel && startTime && durationMinutes > 0

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: 'spring', stiffness: 340, damping: 32 }}
      className="overflow-hidden"
    >
      <div className="mt-5 rounded-[var(--radius-md)] border border-white/8 bg-surface-800/50 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="relative">
            <label className="mb-1 block text-[11px] text-mist-500">Patient</label>
            <input
              type="text"
              value={patientId ? patientLabel : search}
              onChange={(e) => {
                setPatientId(null)
                setSearch(e.target.value)
                setPickerOpen(true)
              }}
              onFocus={() => setPickerOpen(true)}
              onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
              placeholder="Search patient…"
              className="w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-900/70 px-3 py-2 text-[13px] text-mist-100 outline-none placeholder:text-mist-600 focus:border-accent-500/60"
            />
            <AnimatePresence>
              {pickerOpen && (patientsQuery.data?.length ?? 0) > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="glass texture-noise absolute left-0 right-0 z-30 mt-2 max-h-48 overflow-y-auto rounded-[var(--radius-sm)] p-1.5"
                >
                  {patientsQuery.data!.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setPatientId(p.id)
                        setPatientLabel(p.name)
                        setPickerOpen(false)
                      }}
                      className="flex w-full items-center justify-between rounded-[var(--radius-2xs)] px-3 py-2 text-left text-[13px] text-mist-300 hover:bg-white/5 hover:text-mist-50"
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="ml-2 shrink-0 font-mono text-[11px] tabular text-mist-600">{p.ipNumber}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-mist-500">Procedure</label>
            <input
              type="text"
              value={procedure}
              onChange={(e) => setProcedure(e.target.value)}
              placeholder="e.g. Appendectomy"
              className="w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-900/70 px-3 py-2 text-[13px] text-mist-100 outline-none placeholder:text-mist-600 focus:border-accent-500/60"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-mist-500">Surgeon</label>
            <Dropdown
              label=""
              value={surgeonName || 'Select…'}
              onChange={setSurgeonName}
              options={(surgeonsQuery.data ?? []).map((s) => s.name)}
              className="w-full [&>button]:w-full [&>button]:justify-between"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-mist-500">Room</label>
            <Dropdown
              label=""
              value={roomLabel}
              onChange={setRoomLabel}
              options={ROOMS.map((r) => r.label)}
              className="w-full [&>button]:w-full [&>button]:justify-between"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-mist-500">Start Time (Nairobi)</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-900/70 px-3 py-2 text-[13px] text-mist-100 outline-none focus:border-accent-500/60"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-mist-500">Duration (minutes)</label>
            <input
              type="number"
              min={15}
              step={15}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-900/70 px-3 py-2 text-[13px] text-mist-100 outline-none focus:border-accent-500/60"
            />
          </div>
        </div>

        {conflict && (
          <div className="mt-3 rounded-[var(--radius-sm)] border border-status-critical/30 bg-status-critical/10 px-3.5 py-2.5">
            <p className="text-[12.5px] text-status-critical">{conflict.message}</p>
            <ul className="mt-1 text-[12px] text-mist-400">
              {conflict.conflicts.map((c) => (
                <li key={c.id}>
                  {c.procedure} · {c.patient.name}
                </li>
              ))}
            </ul>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => createSurgery.mutate(true)}>
              Schedule anyway
            </Button>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" disabled={!canSubmit || createSurgery.isPending} onClick={() => createSurgery.mutate(false)}>
            {createSurgery.isPending ? 'Booking…' : 'Book Surgery'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
