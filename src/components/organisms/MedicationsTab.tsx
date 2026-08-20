import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '../atoms/Badge'
import { Button } from '../atoms/Button'
import { Skeleton } from '../atoms/Skeleton'
import { api, ApiError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'
import { formatDate, formatDateTime, formatKES } from '../../lib/format'
import type { Prescription, PrescriptionItem } from '../../lib/types'

const statusTone: Record<string, 'healthy' | 'warning' | 'critical'> = {
  ACTIVE: 'warning',
  PARTIALLY_DISPENSED: 'warning',
  DISPENSED: 'healthy',
  CANCELLED: 'critical',
}

const statusLabel: Record<string, string> = {
  ACTIVE: 'Active',
  PARTIALLY_DISPENSED: 'Part dispensed',
  DISPENSED: 'Dispensed',
  CANCELLED: 'Cancelled',
}

export function MedicationsTab({ patientId }: { patientId: string | null }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const prescriptionsQuery = useQuery({
    queryKey: ['patient', patientId, 'prescriptions'],
    queryFn: () => api.get<Prescription[]>(`/patients/${patientId}/prescriptions`),
    enabled: !!patientId,
  })

  const canDispense = user?.role === 'PHARMACIST' || user?.role === 'ADMIN'

  if (prescriptionsQuery.isLoading) {
    return <Skeleton className="h-40 rounded-sm" />
  }

  const prescriptions = prescriptionsQuery.data ?? []
  if (prescriptions.length === 0) {
    return (
      <div className="mt-2 rounded-sm border border-dashed border-line px-4 py-6 text-center text-sm text-ink-500">
        No prescriptions on file.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {prescriptions.map((p) => (
        <div
          key={p.id}
          className="rounded-sm border border-line bg-header px-4 py-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-900">{p.prescriber.name}</p>
              <p className="text-2xs text-ink-500">{formatDate(p.createdAt)}</p>
            </div>
            <Badge status={statusTone[p.status]}>{statusLabel[p.status]}</Badge>
          </div>

          {p.notes && <p className="mt-2 text-sm text-ink-700">{p.notes}</p>}

          {/* An override is a deliberate clinical decision to prescribe through
              a recorded allergy. It stays visible on the chart, not just in the
              audit log. */}
          {p.allergyOverrideReason && (
            <p
              className="mt-2 rounded-[var(--radius-2xs)] border px-2.5 py-1.5 text-xs"
              style={{
                borderColor: 'color-mix(in srgb, var(--color-critical) 30%, transparent)',
                background: 'color-mix(in srgb, var(--color-critical) 10%, transparent)',
                color: 'var(--color-critical)',
              }}
            >
              Allergy override — {p.allergyOverrideReason}
            </p>
          )}

          <div className="mt-3 flex flex-col gap-2">
            {p.items.map((item) => (
              <MedicationRow
                key={item.id}
                item={item}
                cancelled={p.status === 'CANCELLED'}
                canDispense={canDispense}
                onDispensed={() => {
                  queryClient.invalidateQueries({ queryKey: ['patient', patientId, 'prescriptions'] })
                  queryClient.invalidateQueries({ queryKey: ['patient', patientId, 'billing'] })
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function MedicationRow({
  item,
  cancelled,
  canDispense,
  onDispensed,
}: {
  item: PrescriptionItem
  cancelled: boolean
  canDispense: boolean
  onDispensed: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const dispense = useMutation({
    mutationFn: () => api.post(`/prescription-items/${item.id}/dispense`, {}),
    onSuccess: () => {
      setError(null)
      onDispensed()
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Dispense failed')
    },
  })

  const outstanding = item.quantityRemaining
  const charge = Number(item.drug.unitPrice) * item.quantityPrescribed

  return (
    <div className="rounded-[var(--radius-2xs)] border border-line bg-header px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm text-ink-900">
            {item.drug.genericName} {item.drug.strength}
            {item.drug.brandName && <span className="text-ink-600"> ({item.drug.brandName})</span>}
            {item.drug.controlled && (
              <span
                className="ml-1.5 rounded-full border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-critical) 35%, transparent)',
                  color: 'var(--color-critical)',
                }}
              >
                Controlled
              </span>
            )}
          </p>
          <p className="mt-0.5 text-2xs text-ink-600">
            {item.dose} · {item.route} · {item.frequency}
            {item.durationDays ? ` · ${item.durationDays} days` : ''}
          </p>
          {item.instructions && (
            <p className="mt-1 text-2xs text-ink-600">{item.instructions}</p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <p className="font-mono text-xs tabular text-ink-800">
            {item.quantityDispensed}/{item.quantityPrescribed} {item.drug.unit}
          </p>
          <p className="font-mono text-2xs tabular text-ink-500">{formatKES(charge)}</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canDispense && outstanding > 0 && !cancelled && (
          <Button size="sm" variant="outline" onClick={() => dispense.mutate()} disabled={dispense.isPending}>
            {dispense.isPending ? 'Dispensing…' : `Dispense ${outstanding}`}
          </Button>
        )}

        {item.dispenseEvents.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-2xs text-ink-600 hover:text-ink-700"
          >
            {expanded ? 'Hide' : `${item.dispenseEvents.length} dispense record${item.dispenseEvents.length > 1 ? 's' : ''}`}
          </button>
        )}

        {error && <span className="text-2xs text-critical">{error}</span>}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 flex flex-col gap-1.5 border-t border-line pt-2">
              {item.dispenseEvents.map((event) => (
                <div key={event.id} className="text-2xs text-ink-600">
                  <span className="text-ink-700">{event.quantity} {item.drug.unit}</span>
                  {' · '}
                  {formatDateTime(event.createdAt)}
                  {' · '}
                  {event.dispensedBy.name}
                  {/* Batch and expiry are what a recall or an adverse-event
                      investigation is traced through. */}
                  <span className="ml-1 font-mono text-ink-500">
                    {event.batchBreakdown
                      .map((b) => `${b.batchNumber} ×${b.quantity} (exp ${formatDate(b.expiryDate)})`)
                      .join(', ')}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
