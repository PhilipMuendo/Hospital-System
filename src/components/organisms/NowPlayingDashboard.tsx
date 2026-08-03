import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GlassPanel } from '../atoms/GlassPanel'
import { Badge } from '../atoms/Badge'
import { Skeleton } from '../atoms/Skeleton'
import { StatRing } from '../molecules/StatRing'
import { occupancyStatus } from '../../lib/occupancy'
import { api } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'
import type { Alert, DashboardMetric, Ward } from '../../lib/types'

const statusBlobColor = {
  healthy: 'var(--color-status-healthy)',
  warning: 'var(--color-status-warning)',
  critical: 'var(--color-status-critical)',
} as const

// The physician's "Now Playing" dashboard — the bed-occupancy ring reads
// like an album's playback dial, sitting in front of a slow-spinning
// ambient gradient blob that shifts hue with the occupancy margin.
export function NowPlayingDashboard() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const wardsQuery = useQuery({ queryKey: ['wards'], queryFn: () => api.get<Ward[]>('/wards') })
  const metricsQuery = useQuery({
    queryKey: ['dashboard-metrics'],
    queryFn: () => api.get<DashboardMetric[]>('/dashboard/metrics'),
  })
  const alertsQuery = useQuery({
    queryKey: ['alerts', { resolved: false }],
    queryFn: () => api.get<Alert[]>('/alerts?resolved=false'),
  })

  const resolveAlert = useMutation({
    mutationFn: (id: string) => api.patch(`/alerts/${id}/resolve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  })

  const wards = wardsQuery.data ?? []
  const totalBeds = wards.reduce((sum, w) => sum + w.bedCapacity, 0)
  const totalOccupied = wards.reduce((sum, w) => sum + w.occupied, 0)
  const occupancyPct = totalBeds === 0 ? 0 : Math.round((totalOccupied / totalBeds) * 100)
  const status = occupancyStatus(occupancyPct)
  const blobColor = statusBlobColor[status]

  return (
    <GlassPanel className="relative overflow-hidden p-6 lg:p-8" delay={0.05}>
      {/* Ambient reactive blob */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[var(--radius-lg)]">
        <div
          className="ambient-blob bloom absolute -top-1/3 left-1/2 h-[120%] w-[120%] -translate-x-1/2 opacity-30"
          style={{
            background: `conic-gradient(from 90deg, ${blobColor}, transparent 35%, transparent 65%, ${blobColor})`,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-surface-900/70" />
      </div>

      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-wide text-mist-500">Hospital Command</p>
          <h2 className="mt-1 text-[22px]">Good afternoon, {user?.name ?? 'Doctor'}</h2>
        </div>
        <Badge status={status}>{status === 'healthy' ? 'Nominal Load' : status === 'warning' ? 'Elevated Load' : 'Critical Load'}</Badge>
      </div>

      <div className="relative mt-6 flex flex-col items-center">
        {wardsQuery.isLoading ? (
          <Skeleton className="h-[280px] w-[280px] rounded-full" />
        ) : (
          <StatRing
            percent={occupancyPct}
            status={status}
            label="Bed Occupancy"
            sublabel={`${totalOccupied} of ${totalBeds} beds in use`}
          />
        )}
      </div>

      {/* Ward breakdown */}
      <div className="relative mt-8 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {wardsQuery.isLoading
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[58px] rounded-[var(--radius-sm)]" />)
          : wards.map((ward, i) => {
              const pct = ward.bedCapacity === 0 ? 0 : Math.round((ward.occupied / ward.bedCapacity) * 100)
              const s = occupancyStatus(pct)
              return (
                <motion.div
                  key={ward.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + i * 0.06, duration: 0.5, ease: [0.22, 1.12, 0.4, 1] }}
                  className="flex items-center justify-between rounded-[var(--radius-sm)] border border-white/6 bg-surface-800/50 px-4 py-3"
                >
                  <div>
                    <p className="text-[13px] font-medium text-mist-100">{ward.name}</p>
                    <p className="text-[12px] text-mist-500">
                      {ward.occupied}/{ward.bedCapacity} beds
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/6">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: `var(--color-status-${s})` }}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 1, delay: 0.6 + i * 0.06, ease: [0.22, 1.12, 0.4, 1] }}
                      />
                    </div>
                    <span className="w-9 text-right font-mono text-[12px] tabular text-mist-300">{pct}%</span>
                  </div>
                </motion.div>
              )
            })}
      </div>

      {/* Metrics row */}
      <div className="relative mt-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {metricsQuery.isLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[76px] rounded-[var(--radius-sm)]" />)
          : (metricsQuery.data ?? []).map((m) => (
              <div key={m.key} className="rounded-[var(--radius-sm)] border border-white/6 bg-surface-800/50 px-4 py-3.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-mist-500">{m.label}</p>
                <p className="mt-1.5 font-display text-[19px] font-semibold text-mist-50">{m.value}</p>
                <p
                  className="mt-0.5 text-[11.5px]"
                  style={{
                    color:
                      m.trend === 'up'
                        ? 'var(--color-status-warning)'
                        : m.trend === 'down'
                          ? 'var(--color-status-healthy)'
                          : 'var(--color-mist-500)',
                  }}
                >
                  {m.delta}
                </p>
              </div>
            ))}
      </div>

      {/* Alerts */}
      <div className="relative mt-6">
        <p className="text-[11px] font-medium uppercase tracking-wide text-mist-500">Live Alerts</p>
        <div className="mt-2.5 flex flex-col gap-2">
          {alertsQuery.isLoading ? (
            <Skeleton className="h-[42px] rounded-[var(--radius-sm)]" />
          ) : (alertsQuery.data ?? []).length === 0 ? (
            <p className="rounded-[var(--radius-sm)] border border-white/6 bg-surface-800/40 px-3.5 py-3 text-[13px] text-mist-500">
              No active alerts.
            </p>
          ) : (
            (alertsQuery.data ?? []).map((a, i) => (
              <motion.button
                key={a.id}
                type="button"
                onClick={() => resolveAlert.mutate(a.id)}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.8 + i * 0.08, duration: 0.45 }}
                whileHover={{ scale: 1.01 }}
                className="group flex items-center gap-3 rounded-[var(--radius-sm)] border border-white/6 bg-surface-800/40 px-3.5 py-2.5 text-left"
                title="Click to resolve"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background: `var(--color-status-${a.severity.toLowerCase()})`,
                    boxShadow: `0 0 8px var(--color-status-${a.severity.toLowerCase()})`,
                  }}
                />
                <span className="flex-1 text-[13px] text-mist-200">{a.message}</span>
                <span className="text-[11.5px] text-mist-500 group-hover:text-accent-400">Resolve</span>
              </motion.button>
            ))
          )}
        </div>
      </div>
    </GlassPanel>
  )
}
