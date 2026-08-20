import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/apiClient'
import { GlassPanel } from '../components/atoms/GlassPanel'
import { Badge } from '../components/atoms/Badge'
import { Skeleton } from '../components/atoms/Skeleton'
import { Checkbox } from '../components/atoms/Checkbox'
import { formatDateTime, formatKES } from '../lib/format'
import { MpesaCharge } from '../components/molecules/MpesaCharge'

interface Line {
  id: string
  description: string
  code: string
  amount: string
  payer: string
  status: string
  paymentMethod: string | null
  receiptNumber: string | null
  mpesaReference: string | null
  paidAt: string | null
  createdAt: string
}

interface CashierView {
  patient: { id: string; name: string; opNumber: string | null; ipNumber: string | null; phone: string | null }
  visit: { id: string; visitNumber: string; currentStation: { id: string; name: string } | null } | null
  lines: Line[]
  totals: {
    dueNow: string
    dueNowCount: number
    onInsurer: string
    onInsurerCount: number
    settled: string
  }
}

interface QueueEntry {
  id: string
  token: string
  status: string
  visitId: string
  patient: { id: string; name: string; opNumber: string | null }
}

interface Station {
  id: string
  name: string
  kind: string
}

export function CashierPage() {
  const queryClient = useQueryClient()
  const [patientId, setPatientId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [tendered, setTendered] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<{ receiptNumber: string; total: string; change: string | null } | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200)
    return () => clearTimeout(t)
  }, [search])

  const stations = useQuery({ queryKey: ['stations'], queryFn: () => api.get<Station[]>('/stations') })
  const cashierStation = stations.data?.find((s) => s.kind === 'CASHIER')

  const queue = useQuery({
    queryKey: ['queue', cashierStation?.id],
    queryFn: () => api.get<QueueEntry[]>(`/stations/${cashierStation!.id}/queue`),
    enabled: !!cashierStation,
    refetchInterval: 15_000,
  })

  const results = useQuery({
    queryKey: ['reception-search', debounced],
    queryFn: () => api.get<any[]>(`/reception/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.trim().length >= 3,
  })

  const account = useQuery({
    queryKey: ['cashier', patientId],
    queryFn: () => api.get<CashierView>(`/cashier/patients/${patientId}`),
    enabled: !!patientId,
  })

  const shift = useQuery({
    queryKey: ['cashier-shift'],
    queryFn: () => api.get<any>('/cashier/shift-summary'),
    refetchInterval: 60_000,
  })

  const pay = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<any>('/cashier/pay', body),
    onSuccess: (r) => {
      setError(null)
      setReceipt(r)
      setSelected(new Set())
      setTendered('')
      queryClient.invalidateQueries({ queryKey: ['cashier'] })
      queryClient.invalidateQueries({ queryKey: ['cashier-shift'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Payment failed'),
  })

  const view = account.data
  const payable = (view?.lines ?? []).filter((l) => l.status === 'PENDING' && l.payer === 'SELF_PAY')
  const selectedLines = payable.filter((l) => selected.has(l.id))
  const selectedTotal = selectedLines.reduce((s, l) => s + Number(l.amount), 0)
  const change = tendered ? Number(tendered) - selectedTotal : null

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className="flex flex-col gap-6">
      {receipt && (
        <GlassPanel className="border border-accent-500/30 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-mist-500">Receipt issued</p>
              <p className="mt-1 font-mono text-[26px] font-bold text-accent-400">{receipt.receiptNumber}</p>
              <p className="mt-1 text-[13px] text-mist-400">
                {formatKES(receipt.total)} received
                {receipt.change !== null && Number(receipt.change) > 0
                  ? ` · change ${formatKES(receipt.change)}`
                  : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-[var(--radius-xs)] bg-accent-500 px-4 py-2.5 text-[13px] font-semibold text-charcoal-950 hover:opacity-90"
              >
                Print receipt
              </button>
              <button
                type="button"
                onClick={() => setReceipt(null)}
                className="rounded-[var(--radius-xs)] border border-white/10 px-4 py-2.5 text-[13px] text-mist-300 hover:text-mist-100"
              >
                Next
              </button>
            </div>
          </div>
        </GlassPanel>
      )}

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-status-critical/30 bg-status-critical/10 px-4 py-3 text-[13px] text-status-critical">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-6">
          <GlassPanel className="p-5">
            <h2 className="text-[15px] font-semibold text-mist-50">Waiting at the cash office</h2>
            <div className="mt-3 flex flex-col gap-1.5">
              {queue.isLoading ? (
                <Skeleton className="h-24 rounded-[var(--radius-sm)]" />
              ) : (queue.data ?? []).length === 0 ? (
                <p className="rounded-[var(--radius-sm)] border border-dashed border-white/8 px-3 py-5 text-center text-[12.5px] text-mist-600">
                  Nobody queued.
                </p>
              ) : (
                (queue.data ?? []).map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => {
                      setPatientId(q.patient.id)
                      setSelected(new Set())
                    }}
                    className={`flex items-center gap-3 rounded-[var(--radius-xs)] border px-3 py-2.5 text-left ${
                      patientId === q.patient.id
                        ? 'border-accent-500/50 bg-accent-500/10'
                        : 'border-white/6 bg-surface-800/50 hover:border-white/12'
                    }`}
                  >
                    <span className="font-mono text-[15px] font-bold tabular text-accent-400">{q.token}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-mist-200">{q.patient.name}</span>
                    {q.status === 'CALLED' && <Badge status="warning">CALLED</Badge>}
                  </button>
                ))
              )}
            </div>

            <div className="mt-4 border-t border-white/6 pt-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="…or search any patient"
                className="w-full rounded-[var(--radius-xs)] border border-white/8 bg-surface-800/60 px-3 py-2 text-[13px] text-mist-100 outline-none placeholder:text-mist-600 focus:border-accent-500"
              />
              {(results.data ?? []).slice(0, 5).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setPatientId(m.id)
                    setSelected(new Set())
                  }}
                  className="mt-1.5 block w-full truncate rounded-[var(--radius-xs)] border border-white/6 px-3 py-2 text-left text-[12.5px] text-mist-300 hover:border-white/12"
                >
                  {m.name} · {m.opNumber ?? m.ipNumber ?? '—'}
                </button>
              ))}
            </div>
          </GlassPanel>

          <GlassPanel className="p-5">
            <h2 className="text-[15px] font-semibold text-mist-50">Shift so far</h2>
            <div className="mt-3 flex flex-col gap-1.5">
              {(shift.data?.byMethod ?? []).length === 0 ? (
                <p className="text-[12.5px] text-mist-600">Nothing taken yet today.</p>
              ) : (
                (shift.data?.byMethod ?? []).map((m: any) => (
                  <div key={m.method} className="flex items-center justify-between text-[13px]">
                    <span className="text-mist-400">
                      {m.method} <span className="text-mist-600">({m.count})</span>
                    </span>
                    <span className="font-mono tabular text-mist-100">{formatKES(m.total)}</span>
                  </div>
                ))
              )}
            </div>
          </GlassPanel>
        </div>

        <GlassPanel className="p-6">
          {!patientId ? (
            <p className="py-16 text-center text-[13.5px] text-mist-600">
              Select a patient from the queue to take payment.
            </p>
          ) : account.isLoading || !view ? (
            <Skeleton className="h-72 rounded-[var(--radius-sm)]" />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-[18px] font-semibold text-mist-50">{view.patient.name}</h2>
                  <p className="mt-0.5 text-[12.5px] text-mist-500">
                    {view.patient.opNumber ?? view.patient.ipNumber ?? '—'}
                    {view.visit ? ` · ${view.visit.visitNumber}` : ''}
                    {view.patient.phone ? ` · ${view.patient.phone}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-mist-600">Due now</p>
                  <p className="font-mono text-[24px] font-bold tabular text-status-warning">
                    {formatKES(view.totals.dueNow)}
                  </p>
                  {view.totals.onInsurerCount > 0 && (
                    <p className="mt-0.5 text-[11.5px] text-mist-500">
                      {formatKES(view.totals.onInsurer)} billed to insurer
                    </p>
                  )}
                </div>
              </div>

              {view.totals.onInsurerCount > 0 && (
                <p className="mt-3 rounded-[var(--radius-xs)] border border-white/8 bg-surface-800/50 px-3 py-2 text-[12px] text-mist-400">
                  {view.totals.onInsurerCount} line(s) are payable by SHA or an insurer and are not collected at
                  the window.
                </p>
              )}

              <p className="mt-5 text-[11px] font-medium uppercase tracking-wide text-mist-500">
                Outstanding — self-pay
              </p>
              <div className="mt-2 flex max-h-[280px] flex-col gap-1.5 overflow-y-auto pr-1">
                {payable.length === 0 ? (
                  <p className="rounded-[var(--radius-sm)] border border-dashed border-white/8 px-3 py-6 text-center text-[12.5px] text-mist-600">
                    Nothing outstanding at the window.
                  </p>
                ) : (
                  payable.map((l) => (
                    <label
                      key={l.id}
                      className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-xs)] border border-white/6 bg-surface-800/50 px-3 py-2.5"
                    >
                      <Checkbox checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-mist-100">{l.description}</span>
                        <span className="block truncate font-mono text-[11px] text-mist-600">
                          {l.code} · {formatDateTime(l.createdAt)}
                        </span>
                      </span>
                      <span className="font-mono text-[13.5px] tabular text-mist-50">{formatKES(l.amount)}</span>
                    </label>
                  ))
                )}
              </div>

              {selectedLines.length > 0 && (
                <div className="mt-4 rounded-[var(--radius-sm)] border border-white/8 bg-surface-800/40 p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[13px] text-mist-400">
                      {selectedLines.length} line(s) selected
                    </span>
                    <span className="font-mono text-[20px] font-bold tabular text-mist-50">
                      {formatKES(selectedTotal)}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      value={tendered}
                      onChange={(e) => setTendered(e.target.value)}
                      placeholder="Cash tendered"
                      inputMode="decimal"
                      className="w-36 rounded-[var(--radius-xs)] border border-white/10 bg-surface-900/70 px-3 py-2 font-mono text-[13px] tabular text-mist-100 outline-none placeholder:text-mist-700 focus:border-accent-500"
                    />
                    {change !== null && !Number.isNaN(change) && (
                      <span
                        className="text-[13px]"
                        style={{
                          color: change < 0 ? 'var(--color-status-critical)' : 'var(--color-status-healthy)',
                        }}
                      >
                        {change < 0 ? `Short by ${formatKES(-change)}` : `Change ${formatKES(change)}`}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={pay.isPending || (change !== null && change < 0)}
                      onClick={() =>
                        pay.mutate({
                          lineIds: [...selected],
                          method: 'CASH',
                          amountTendered: tendered ? Number(tendered) : undefined,
                        })
                      }
                      className="rounded-[var(--radius-xs)] bg-accent-500 px-4 py-2 text-[13px] font-semibold text-charcoal-950 hover:opacity-90 disabled:opacity-35"
                    >
                      Take cash
                    </button>
                    <button
                      type="button"
                      disabled={pay.isPending}
                      onClick={() => {
                        const reason = window.prompt('Reason for the waiver (required)')
                        if (reason && reason.trim())
                          pay.mutate({ lineIds: [...selected], method: 'WAIVER', reason: reason.trim() })
                      }}
                      className="rounded-[var(--radius-xs)] border border-white/10 px-3 py-2 text-[13px] text-mist-400 hover:text-mist-100"
                    >
                      Waive
                    </button>
                  </div>

                  {selectedLines.length === 1 && (
                    <div className="mt-3 border-t border-white/6 pt-3">
                      <p className="mb-1.5 text-[11.5px] text-mist-500">
                        Or push an M-Pesa prompt — the line settles only when Safaricom confirms.
                      </p>
                      <MpesaCharge
                        line={selectedLines[0] as never}
                        patientPhone={view.patient.phone}
                        onSettled={() => {
                          setSelected(new Set())
                          queryClient.invalidateQueries({ queryKey: ['cashier'] })
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </GlassPanel>
      </div>
    </div>
  )
}
