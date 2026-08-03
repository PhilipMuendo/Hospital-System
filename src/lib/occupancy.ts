export type OccupancyStatus = 'healthy' | 'warning' | 'critical'

export function occupancyStatus(pct: number): OccupancyStatus {
  if (pct >= 90) return 'critical'
  if (pct >= 75) return 'warning'
  return 'healthy'
}
