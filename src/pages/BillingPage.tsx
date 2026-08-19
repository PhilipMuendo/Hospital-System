import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/apiClient'
import { GlassPanel } from '../components/atoms/GlassPanel'
import { Badge } from '../components/atoms/Badge'
import { Skeleton } from '../components/atoms/Skeleton'
import { TableRow } from '../components/molecules/TableRow'
import { Dropdown } from '../components/molecules/Dropdown'
import { formatDateTime, formatKES } from '../lib/format'
import type { BillingStatus } from '../lib/types'

interface BillingRow {
  id: string
  description: string
  code: string
  amount: string
  payer: string
  status: BillingStatus
  mpesaReference: string | null
  createdAt: string
  patient: { id: string; name: string; ipNumber: string }
}

interface MpesaRow {
  id: string
  phone: string
  amount: string
  status: string
  mpesaReceiptNumber: string | null
  transactionDate: string | null
  createdAt: string
  patient?: { id: string; name: string; ipNumber: string } | null
}

const statusTone: Record<BillingStatus, 'healthy' | 'warning' | 'critical'> = {
  PAID: 'healthy',
  PENDING: 'warning',
  DENIED: 'critical',
}

const payerLabel: Record<string, string> = {
  SHA: 'SHA',
  IMARA_HEALTH_ASSURANCE: 'Imara',
  SELF_PAY: 'Self-Pay',
}

export function BillingPage() {
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [payerFilter, setPayerFilter] = useState('All payers')

  const statusParam =
    statusFilter === 'All statuses' ? '' : `status=${statusFilter.toUpperCase().replace(/ /g, '_')}`
  const payerParam =
    payerFilter === 'All payers'
      ? ''
      : `payer=${payerFilter === 'Imara' ? 'IMARA_HEALTH_ASSURANCE' : payerFilter === 'Self-Pay' ? 'SELF_PAY' : 'SHA'}`
  const query = [statusParam, payerParam].filter(Boolean).join('&')

  const billingQuery = useQuery({
    queryKey: ['billing', statusFilter, payerFilter],
    queryFn: () => api.get<BillingRow[]>(`/billing${query ? `?${query}` : ''}`),
  })

  const mpesaQuery = useQuery({
    queryKey: ['mpesa-transactions'],
    queryFn: () => api.get<MpesaRow[]>('/mpesa/transactions'),
  })

  const rows = billingQuery.data ?? []
  const totals = rows.reduce(
    (acc, r) => {
      const amt = Number(r.amount)
      acc.total += amt
      if (r.status === 'PAID') acc.paid += amt
      if (r.status === 'PENDING') acc.pending += amt
      if (r.status === 'DENIED') acc.denied += amt
      return acc
    },
    { total: 0, paid: 0, pending: 0, denied: 0 },
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Billed" value={formatKES(totals.total)} />
        <StatCard label="Settled" value={formatKES(totals.paid)} tone="healthy" />
        <StatCard label="Outstanding" value={formatKES(totals.pending)} tone="warning" />
        <StatCard label="Denied" value={formatKES(totals.denied)} tone="critical" />
      </div>

      <GlassPanel className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[17px] font-semibold text-mist-50">Billing Ledger</h2>
          <div className="flex flex-wrap gap-2">
            <Dropdown
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={['All statuses', 'Paid', 'Pending', 'Denied']}
            />
            <Dropdown
              label="Payer"
              value={payerFilter}
              onChange={setPayerFilter}
              options={['All payers', 'SHA', 'Imara', 'Self-Pay']}
            />
          </div>
        </div>

        <div className="mt-5 max-h-[440px] overflow-y-auto pr-1">
          <TableRow
            columns="1.7fr 1.2fr 0.7fr 0.8fr 0.7fr"
            className="text-[11px] font-medium uppercase tracking-wide text-mist-500"
          >
            <span>Description</span>
            <span>Patient</span>
            <span>Payer</span>
            <span>Amount</span>
            <span>Status</span>
          </TableRow>

          {billingQuery.isLoading ? (
            <Skeleton className="mt-2 h-56 rounded-[var(--radius-sm)]" />
          ) : rows.length === 0 ? (
            <p className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-white/8 px-4 py-6 text-center text-[13px] text-mist-600">
              No billing lines match this filter.
            </p>
          ) : (
            rows.map((r) => (
              <TableRow key={r.id} columns="1.7fr 1.2fr 0.7fr 0.8fr 0.7fr">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] text-mist-100">{r.description}</p>
                  <p className="truncate text-[11.5px] text-mist-600">
                    {r.code}
                    {r.mpesaReference ? ` · M-Pesa ${r.mpesaReference}` : ''}
                  </p>
                </div>
                <Link
                  to={`/patients?patient=${r.patient.id}`}
                  className="min-w-0 text-[13px] text-mist-300 hover:text-accent-400"
                >
                  <span className="block truncate">{r.patient.name}</span>
                  <span className="block truncate font-mono text-[11px] text-mist-600">{r.patient.ipNumber}</span>
                </Link>
                <span className="text-[12.5px] text-mist-400">{payerLabel[r.payer] ?? r.payer}</span>
                <span className="font-mono text-[13px] tabular text-mist-100">{formatKES(r.amount)}</span>
                <Badge status={statusTone[r.status]}>{r.status}</Badge>
              </TableRow>
            ))
          )}
        </div>
      </GlassPanel>

      <GlassPanel className="p-6">
        <h2 className="text-[17px] font-semibold text-mist-50">M-Pesa Transactions</h2>
        <p className="mt-1 text-[12.5px] text-mist-500">
          Reconcile these against the Safaricom paybill statement at close of business.
        </p>

        <div className="mt-5 max-h-[320px] overflow-y-auto pr-1">
          <TableRow
            columns="1fr 1.2fr 0.9fr 0.7fr 0.7fr"
            className="text-[11px] font-medium uppercase tracking-wide text-mist-500"
          >
            <span>Receipt</span>
            <span>Patient</span>
            <span>Phone</span>
            <span>Amount</span>
            <span>Status</span>
          </TableRow>

          {mpesaQuery.isLoading ? (
            <Skeleton className="mt-2 h-40 rounded-[var(--radius-sm)]" />
          ) : (mpesaQuery.data ?? []).length === 0 ? (
            <p className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-white/8 px-4 py-6 text-center text-[13px] text-mist-600">
              No M-Pesa transactions yet.
            </p>
          ) : (
            (mpesaQuery.data ?? []).map((t) => (
              <TableRow key={t.id} columns="1fr 1.2fr 0.9fr 0.7fr 0.7fr">
                <span className="font-mono text-[12.5px] tabular text-mist-100">
                  {t.mpesaReceiptNumber ?? '—'}
                </span>
                <span className="truncate text-[13px] text-mist-300">{t.patient?.name ?? '—'}</span>
                <span className="font-mono text-[12px] tabular text-mist-500">{t.phone}</span>
                <span className="font-mono text-[13px] tabular text-mist-100">{formatKES(t.amount)}</span>
                <div className="flex flex-col">
                  <Badge
                    status={
                      t.status === 'SUCCESS' ? 'healthy' : t.status === 'PENDING' ? 'warning' : 'critical'
                    }
                  >
                    {t.status}
                  </Badge>
                  <span className="mt-0.5 text-[10.5px] text-mist-600">
                    {formatDateTime(t.transactionDate ?? t.createdAt)}
                  </span>
                </div>
              </TableRow>
            ))
          )}
        </div>
      </GlassPanel>
    </div>
  )
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'healthy' | 'warning' | 'critical'
}) {
  const color =
    tone === 'healthy'
      ? 'var(--color-status-healthy)'
      : tone === 'warning'
        ? 'var(--color-status-warning)'
        : tone === 'critical'
          ? 'var(--color-status-critical)'
          : 'var(--color-mist-50)'

  return (
    <GlassPanel className="p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-mist-500">{label}</p>
      <p className="mt-1.5 font-mono text-[19px] tabular font-semibold" style={{ color }}>
        {value}
      </p>
    </GlassPanel>
  )
}
