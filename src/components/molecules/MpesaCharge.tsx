import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../atoms/Button'
import { api, ApiError } from '../../lib/apiClient'
import { formatKES } from '../../lib/format'
import type { BillingLine, MpesaPushResponse, MpesaTransaction } from '../../lib/types'

interface MpesaChargeProps {
  line: BillingLine
  patientPhone: string | null
  onSettled: () => void
}

const terminalStatuses = new Set(['SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT'])

const statusCopy: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'Waiting for the patient to enter their PIN…', tone: 'var(--color-warning)' },
  SUCCESS: { label: 'Paid', tone: 'var(--color-stable)' },
  FAILED: { label: 'Payment failed', tone: 'var(--color-critical)' },
  CANCELLED: { label: 'Cancelled on the handset', tone: 'var(--color-critical)' },
  TIMEOUT: { label: 'The prompt timed out', tone: 'var(--color-critical)' },
}

/**
 * Sends a Lipa na M-Pesa STK push against one billing line and follows it to a
 * conclusion.
 *
 * The line is never marked paid here — the server only settles it on a
 * confirmed Safaricom result, so this component reports what happened rather
 * than deciding it.
 */
export function MpesaCharge({ line, patientPhone, onSettled }: MpesaChargeProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState(patientPhone ?? '')
  const [transactionId, setTransactionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const configQuery = useQuery({
    queryKey: ['mpesa', 'config'],
    queryFn: () => api.get<{ enabled: boolean; mocked: boolean }>('/mpesa/config'),
    staleTime: 5 * 60 * 1000,
  })

  // Poll only while a push is genuinely in flight. The endpoint falls back to
  // Safaricom's status query, which is what rescues a dropped callback.
  const statusQuery = useQuery({
    queryKey: ['mpesa', 'transaction', transactionId],
    queryFn: () => api.get<MpesaTransaction>(`/mpesa/transactions/${transactionId}`),
    enabled: !!transactionId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && terminalStatuses.has(status) ? false : 3000
    },
  })

  const status = statusQuery.data?.status
  useEffect(() => {
    if (status === 'SUCCESS') {
      onSettled()
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    }
  }, [status, onSettled, queryClient])

  const push = useMutation({
    mutationFn: () =>
      api.post<MpesaPushResponse>(`/billing/${line.id}/mpesa/stk-push`, {
        phone: phone.trim() || undefined,
      }),
    onSuccess: (data) => {
      setError(null)
      setTransactionId(data.id)
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Could not reach M-Pesa')
    },
  })

  // Development affordance only: the server exposes this route exclusively
  // while M-Pesa is in mock mode, so the full callback path can be exercised
  // without a Safaricom account.
  const completeMock = useMutation({
    mutationFn: (resultCode: string) =>
      api.post<MpesaTransaction>(`/mpesa/mock/complete/${transactionId}`, { resultCode }),
    onSuccess: () => statusQuery.refetch(),
  })

  if (line.status === 'PAID' || configQuery.data?.enabled === false) return null

  const inFlight = push.isPending || (!!transactionId && status === 'PENDING')

  return (
    <div className="mt-2">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-2xs font-medium text-primary-700 hover:text-primary-700"
        >
          Charge to M-Pesa
        </button>
      ) : (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="overflow-hidden rounded-sm border border-line bg-header p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07XX XXX XXX"
              disabled={inFlight}
              className="min-w-0 flex-1 rounded-[var(--radius-2xs)] border border-line bg-header px-2.5 py-1.5 font-mono text-xs text-ink-900 outline-none placeholder:text-ink-500 focus:border-primary-200 disabled:opacity-50"
            />
            <Button
              size="sm"
              onClick={() => push.mutate()}
              disabled={inFlight || phone.trim().length === 0}
            >
              {inFlight ? 'Sending…' : `Request ${formatKES(line.amount)}`}
            </Button>
            {!transactionId && (
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            )}
          </div>

          <AnimatePresence>
            {(error || status) && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-2 text-xs"
                style={{ color: error ? 'var(--color-critical)' : statusCopy[status!]?.tone }}
              >
                {error ?? statusCopy[status!]?.label}
                {statusQuery.data?.mpesaReceiptNumber && (
                  <span className="ml-1.5 font-mono text-ink-600">
                    {statusQuery.data.mpesaReceiptNumber}
                  </span>
                )}
              </motion.p>
            )}
          </AnimatePresence>

          {configQuery.data?.mocked && transactionId && status === 'PENDING' && (
            <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
              <span className="text-2xs uppercase tracking-wide text-ink-500">Mock mode</span>
              <button
                type="button"
                onClick={() => completeMock.mutate('0')}
                className="text-2xs text-stable hover:underline"
              >
                Simulate paid
              </button>
              <button
                type="button"
                onClick={() => completeMock.mutate('1032')}
                className="text-2xs text-critical hover:underline"
              >
                Simulate cancelled
              </button>
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}
