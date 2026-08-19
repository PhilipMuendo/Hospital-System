import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/apiClient'
import { GlassPanel } from '../components/atoms/GlassPanel'
import { Badge } from '../components/atoms/Badge'
import { Skeleton } from '../components/atoms/Skeleton'
import { Dropdown } from '../components/molecules/Dropdown'
import { TableRow } from '../components/molecules/TableRow'
import { formatDateTime } from '../lib/format'

interface AuditRow {
  id: string
  actorLabel: string
  actorRole: string | null
  action: string
  entity: string
  entityId: string | null
  patientId: string | null
  method: string | null
  path: string
  status: number | null
  ip: string | null
  createdAt: string
  meta: Record<string, unknown> | null
}

const ACTIONS = ['All actions', 'LOGIN', 'LOGIN_FAILED', 'DENIED', 'CREATE', 'UPDATE', 'DELETE', 'READ', 'EXPORT']

const actionTone: Record<string, 'healthy' | 'warning' | 'critical' | 'neutral'> = {
  LOGIN: 'healthy',
  LOGIN_FAILED: 'critical',
  DENIED: 'critical',
  DELETE: 'critical',
  CREATE: 'healthy',
  UPDATE: 'warning',
  EXPORT: 'warning',
}

export function AuditPage() {
  const [action, setAction] = useState('All actions')
  const [expanded, setExpanded] = useState<string | null>(null)

  const query = action === 'All actions' ? '' : `?action=${action}`

  const auditQuery = useQuery({
    queryKey: ['audit', action],
    queryFn: () => api.get<AuditRow[] | { rows: AuditRow[] }>(`/audit${query}`),
    refetchInterval: 15_000,
  })

  const raw = auditQuery.data
  const rows: AuditRow[] = Array.isArray(raw) ? raw : (raw?.rows ?? [])

  return (
    <div className="flex flex-col gap-6">
      <GlassPanel className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold text-mist-50">Audit Trail</h2>
            <p className="mt-1 text-[12.5px] text-mist-500">
              Append-only record of every access and change. Retained for the Data Protection Act 2019.
            </p>
          </div>
          <Dropdown label="Action" value={action} onChange={setAction} options={ACTIONS} />
        </div>

        <div className="mt-5 max-h-[600px] overflow-y-auto pr-1">
          <TableRow
            columns="0.8fr 1.5fr 1.3fr 1.6fr 0.7fr"
            className="text-[11px] font-medium uppercase tracking-wide text-mist-500"
          >
            <span>Action</span>
            <span>Actor</span>
            <span>Entity</span>
            <span>Path</span>
            <span>When</span>
          </TableRow>

          {auditQuery.isLoading ? (
            <Skeleton className="mt-2 h-72 rounded-[var(--radius-sm)]" />
          ) : rows.length === 0 ? (
            <p className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-white/8 px-4 py-6 text-center text-[13px] text-mist-600">
              No audit entries match this filter.
            </p>
          ) : (
            rows.map((r) => (
              <div key={r.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="w-full text-left"
                >
                  <TableRow columns="0.8fr 1.5fr 1.3fr 1.6fr 0.7fr">
                    <Badge status={actionTone[r.action] ?? 'neutral'}>{r.action}</Badge>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] text-mist-200">{r.actorLabel}</p>
                      {r.actorRole && <p className="text-[11px] text-mist-600">{r.actorRole}</p>}
                    </div>
                    <span className="truncate text-[12.5px] text-mist-400">{r.entity}</span>
                    <span className="truncate font-mono text-[11.5px] text-mist-600">
                      {r.method} {r.path}
                      {r.status ? ` · ${r.status}` : ''}
                    </span>
                    <span className="text-[12px] text-mist-500">{formatDateTime(r.createdAt)}</span>
                  </TableRow>
                </button>

                {expanded === r.id && r.meta && (
                  <pre className="mx-3 mb-3 overflow-x-auto rounded-[var(--radius-xs)] border border-white/6 bg-charcoal-950/70 p-3 font-mono text-[11.5px] leading-relaxed text-mist-400">
                    {JSON.stringify({ ip: r.ip, entityId: r.entityId, patientId: r.patientId, meta: r.meta }, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </GlassPanel>
    </div>
  )
}
