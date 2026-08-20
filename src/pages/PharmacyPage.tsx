import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/apiClient'
import { useAuth } from '../context/AuthContext'
import { GlassPanel } from '../components/atoms/GlassPanel'
import { Badge } from '../components/atoms/Badge'
import { Skeleton } from '../components/atoms/Skeleton'
import { TabBar } from '../components/molecules/TabBar'
import { TableRow } from '../components/molecules/TableRow'
import { formatDate, formatKES } from '../lib/format'

interface Drug {
  id: string
  code: string
  genericName: string
  brandName: string | null
  form: string
  strength: string
  unit: string
  kemlListed: boolean
  controlled: boolean
  unitPrice: string
  reorderLevel: number
  inStock: number
  belowReorderLevel: boolean
  expiringSoon: number
  expiredUnits: number
  earliestExpiry: string | null
}

interface QueueItem {
  id: string
  patient: { id: string; name: string; ipNumber: string; ward?: string }
  prescriber: string
  createdAt: string
  items: {
    id: string
    drug: string
    dose: string
    route: string
    frequency: string
    quantityPrescribed: number
    quantityDispensed: number
    inStock?: number
  }[]
}

const TABS = ['Dispensing Queue', 'Formulary & Stock']

export function PharmacyPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState(TABS[0])
  const [error, setError] = useState<string | null>(null)

  const canDispense = user?.role === 'PHARMACIST' || user?.role === 'ADMIN'

  const drugsQuery = useQuery({ queryKey: ['drugs'], queryFn: () => api.get<Drug[]>('/drugs') })
  const queueQuery = useQuery({
    queryKey: ['pharmacy-queue'],
    queryFn: () => api.get<QueueItem[]>('/pharmacy/queue'),
  })

  const dispense = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) =>
      api.post(`/prescription-items/${itemId}/dispense`, { quantity }),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['pharmacy-queue'] })
      queryClient.invalidateQueries({ queryKey: ['drugs'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Dispense failed'),
  })

  const drugs = drugsQuery.data ?? []
  const lowStock = drugs.filter((d) => d.belowReorderLevel)
  const expiring = drugs.filter((d) => d.expiringSoon > 0)
  const stockValue = drugs.reduce((s, d) => s + d.inStock * Number(d.unitPrice), 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Formulary Lines" value={String(drugs.length)} />
        <Stat label="Below Reorder" value={String(lowStock.length)} tone={lowStock.length ? 'warning' : undefined} />
        <Stat label="Expiring < 90d" value={String(expiring.length)} tone={expiring.length ? 'warning' : undefined} />
        <Stat label="Stock Value" value={formatKES(stockValue)} />
      </div>

      {error && (
        <div className="rounded-sm border border-critical-line bg-critical-bg px-4 py-3 text-sm text-critical">
          {error}
        </div>
      )}

      <GlassPanel className="p-6">
        <TabBar tabs={TABS} active={tab} onChange={setTab} />

        {tab === 'Dispensing Queue' && (
          <div className="mt-5 flex flex-col gap-4">
            {queueQuery.isLoading ? (
              <Skeleton className="h-48 rounded-sm" />
            ) : (queueQuery.data ?? []).length === 0 ? (
              <p className="rounded-sm border border-dashed border-line px-4 py-8 text-center text-sm text-ink-500">
                Nothing awaiting dispensing. All prescriptions are fulfilled.
              </p>
            ) : (
              (queueQuery.data ?? []).map((rx) => (
                <div
                  key={rx.id}
                  className="rounded-sm border border-line bg-header p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-ink-900">{rx.patient.name}</p>
                      <p className="text-2xs text-ink-600">
                        {rx.patient.ipNumber} · prescribed by {rx.prescriber} · {formatDate(rx.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    {rx.items.map((item) => {
                      const outstanding = item.quantityPrescribed - item.quantityDispensed
                      const short = item.inStock !== undefined && item.inStock < outstanding
                      return (
                        <div
                          key={item.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xs bg-header px-3 py-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-ink-900">{item.drug}</p>
                            <p className="text-2xs text-ink-600">
                              {item.dose} · {item.route} · {item.frequency} · {item.quantityDispensed}/
                              {item.quantityPrescribed} dispensed
                              {item.inStock !== undefined ? ` · ${item.inStock} in stock` : ''}
                            </p>
                          </div>
                          {outstanding > 0 && (
                            <button
                              type="button"
                              disabled={!canDispense || short || dispense.isPending}
                              onClick={() => dispense.mutate({ itemId: item.id, quantity: outstanding })}
                              title={
                                !canDispense
                                  ? 'Only a pharmacist may dispense'
                                  : short
                                    ? 'Insufficient unexpired stock'
                                    : undefined
                              }
                              className="shrink-0 rounded-xs bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
                            >
                              {short ? 'Out of stock' : `Dispense ${outstanding}`}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'Formulary & Stock' && (
          <div className="mt-5 max-h-[520px] overflow-y-auto pr-1">
            <TableRow
              columns="1.8fr 0.7fr 0.7fr 0.7fr 0.8fr"
              className="text-2xs font-medium uppercase tracking-wide text-ink-600"
            >
              <span>Drug</span>
              <span>Form</span>
              <span>In Stock</span>
              <span>Unit Price</span>
              <span>Earliest Expiry</span>
            </TableRow>

            {drugsQuery.isLoading ? (
              <Skeleton className="mt-2 h-64 rounded-sm" />
            ) : (
              drugs.map((d) => (
                <TableRow key={d.id} columns="1.8fr 0.7fr 0.7fr 0.7fr 0.8fr">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink-900">
                      {d.genericName} {d.strength}
                      {d.brandName ? <span className="text-ink-600"> ({d.brandName})</span> : null}
                    </p>
                    <p className="flex flex-wrap gap-1.5 truncate text-2xs text-ink-500">
                      <span>{d.code}</span>
                      {d.kemlListed && <span className="text-primary-700">KEML</span>}
                      {d.controlled && <span className="text-critical">CONTROLLED</span>}
                    </p>
                  </div>
                  <span className="text-xs text-ink-600">{d.form}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-sm tabular text-ink-900">{d.inStock}</span>
                    {d.belowReorderLevel && <Badge status="warning">LOW</Badge>}
                  </div>
                  <span className="font-mono text-xs tabular text-ink-700">{formatKES(d.unitPrice)}</span>
                  <span className="text-xs text-ink-600">
                    {d.earliestExpiry ? formatDate(d.earliestExpiry) : '—'}
                    {d.expiringSoon > 0 && <span className="ml-1 text-warning">({d.expiringSoon})</span>}
                  </span>
                </TableRow>
              ))
            )}
          </div>
        )}
      </GlassPanel>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  return (
    <GlassPanel className="p-4">
      <p className="text-2xs font-medium uppercase tracking-wide text-ink-600">{label}</p>
      <p
        className="mt-1.5 font-mono text-lg tabular font-semibold"
        style={{ color: tone === 'warning' ? 'var(--color-warning)' : 'var(--color-ink-900)' }}
      >
        {value}
      </p>
    </GlassPanel>
  )
}
