import { useEffect, useState } from 'react'
import { flush, listQueue, subscribeToQueue, type OutboxEntry } from '../../lib/offline'

/**
 * Connection and sync status.
 *
 * Deliberately always visible once anything is pending. In a clinical system
 * the dangerous state is not being offline — it is *not knowing* you are
 * offline and assuming a record reached the chart when it is still sitting on
 * one tablet.
 */
export function OfflineIndicator() {
  const [online, setOnline] = useState(navigator.onLine)
  const [queue, setQueue] = useState<OutboxEntry[]>([])
  const [syncing, setSyncing] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const refresh = () => void listQueue().then(setQueue)
    refresh()

    const unsubscribe = subscribeToQueue(refresh)
    const up = () => {
      setOnline(true)
      refresh()
    }
    const down = () => setOnline(false)

    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    const poll = window.setInterval(refresh, 15_000)

    return () => {
      unsubscribe()
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
      window.clearInterval(poll)
    }
  }, [])

  const stuck = queue.filter((q) => q.lastError?.includes('needs review'))
  const pending = queue.length - stuck.length

  // Nothing to say when online with an empty queue.
  if (online && queue.length === 0) return null

  return (
    <div className="no-print fixed bottom-4 right-4 z-50">
      {open && queue.length > 0 && (
        <div className="mb-2 max-h-72 w-80 overflow-y-auto rounded-[var(--radius-sm)] border border-white/10 bg-charcoal-950/95 p-3 shadow-xl backdrop-blur">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-mist-500">
            Waiting to sync
          </p>
          {queue.map((q) => (
            <div key={q.id} className="mb-1.5 rounded-[var(--radius-xs)] bg-surface-800/60 px-2.5 py-2">
              <p className="text-[12.5px] text-mist-200">{q.label}</p>
              <p className="text-[11px] text-mist-600">
                {new Date(q.queuedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                {q.attempts > 0 ? ` · ${q.attempts} attempt${q.attempts === 1 ? '' : 's'}` : ''}
              </p>
              {q.lastError && <p className="mt-0.5 text-[11px] text-status-critical">{q.lastError}</p>}
            </div>
          ))}
          {stuck.length > 0 && (
            <p className="mt-2 text-[11px] text-status-critical">
              {stuck.length} item(s) were rejected by the server and need a person to review them. They have
              not been discarded.
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 rounded-full border px-4 py-2.5 shadow-lg backdrop-blur transition-colors"
        style={{
          borderColor: online ? 'rgb(255 255 255 / 0.12)' : 'var(--color-status-warning)',
          background: online ? 'rgb(12 14 17 / 0.9)' : 'color-mix(in srgb, var(--color-status-warning) 18%, #0c0e11)',
        }}
      >
        <span
          className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'animate-pulse bg-amber-400'}`}
        />
        <span className="text-[12.5px] font-medium text-mist-100">
          {!online ? 'Working offline' : pending > 0 ? 'Syncing…' : 'Needs review'}
        </span>
        {queue.length > 0 && (
          <span className="rounded-full bg-white/12 px-2 py-0.5 font-mono text-[11px] tabular text-mist-100">
            {queue.length}
          </span>
        )}
        {online && queue.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              setSyncing(true)
              void flush().finally(() => setSyncing(false))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation()
                setSyncing(true)
                void flush().finally(() => setSyncing(false))
              }
            }}
            className="ml-1 rounded-full bg-accent-500 px-2.5 py-0.5 text-[11px] font-semibold text-charcoal-950"
          >
            {syncing ? 'Sending…' : 'Retry'}
          </span>
        )}
      </button>
    </div>
  )
}
