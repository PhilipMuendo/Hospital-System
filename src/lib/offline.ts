/**
 * Offline support.
 *
 * Kenyan facilities lose power and connectivity routinely, and a ward round
 * does not stop because the link did. But "works offline" cannot mean "queue
 * everything" — some actions are unsafe to replay against a world that moved
 * on while the device was dark.
 *
 * The rule applied here: an action may be queued only if it is *additive* and
 * its correctness does not depend on state the device cannot see.
 *
 *   Queued — observations, triage assessments, drug administrations. These
 *   append to a record. The nurse gave the dose whether or not the network was
 *   up; refusing to chart it would make the record less true, not more.
 *
 *   Never queued — payments, dispensing, lab verification, prescribing, queue
 *   calls. Money must not be taken against a stale balance; stock must not be
 *   drawn down without seeing live stock; a result must not be verified
 *   without the live chain; calling a patient into a room is meaningless to a
 *   device that cannot see the room. These fail loudly and say why.
 */

const DB_NAME = 'uzima-offline'
const DB_VERSION = 1
const OUTBOX = 'outbox'

/** Endpoints safe to queue. Matched as a prefix against the API path. */
const QUEUEABLE: { pattern: RegExp; label: string }[] = [
  { pattern: /^\/patients\/[^/]+\/vitals$/, label: 'Observations' },
  { pattern: /^\/visits\/[^/]+\/triage$/, label: 'Triage assessment' },
  { pattern: /^\/prescription-items\/[^/]+\/administer$/, label: 'Drug administration' },
]

/** Why a given action cannot be queued, for an honest error message. */
const NEVER_QUEUE: { pattern: RegExp; reason: string }[] = [
  { pattern: /^\/cashier\//, reason: 'Payments need a live balance — take payment when the link is back.' },
  { pattern: /mpesa/i, reason: 'M-Pesa needs the network. Nothing has been charged.' },
  { pattern: /\/dispense$/, reason: 'Dispensing needs live stock levels.' },
  { pattern: /^\/lab\/items\/[^/]+\/(result|verify)$/, reason: 'Lab results must be entered online.' },
  { pattern: /\/call-next$/, reason: 'Calling a patient needs the live queue.' },
  { pattern: /^\/sha\//, reason: 'Claims need the network.' },
]

export interface OutboxEntry {
  id: string
  path: string
  method: string
  body: unknown
  label: string
  queuedAt: number
  attempts: number
  lastError?: string
}

export function queueabilityOf(path: string): { queueable: boolean; label?: string; reason?: string } {
  const blocked = NEVER_QUEUE.find((n) => n.pattern.test(path))
  if (blocked) return { queueable: false, reason: blocked.reason }

  const allowed = QUEUEABLE.find((q) => q.pattern.test(path))
  if (allowed) return { queueable: true, label: allowed.label }

  return { queueable: false, reason: 'This action needs a live connection.' }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(OUTBOX)) {
        db.createObjectStore(OUTBOX, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(OUTBOX, mode)
    const request = fn(tx.objectStore(OUTBOX))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function enqueue(entry: Omit<OutboxEntry, 'id' | 'queuedAt' | 'attempts'>): Promise<OutboxEntry> {
  const full: OutboxEntry = {
    ...entry,
    // Generated here, at the moment the clinician acted, and reused as the
    // Idempotency-Key on every retry so a replay cannot double-chart.
    id: crypto.randomUUID(),
    queuedAt: Date.now(),
    attempts: 0,
  }
  await withStore('readwrite', (s) => s.add(full))
  notify()
  return full
}

export async function listQueue(): Promise<OutboxEntry[]> {
  const all = await withStore<OutboxEntry[]>('readonly', (s) => s.getAll() as IDBRequest<OutboxEntry[]>)
  return all.sort((a, b) => a.queuedAt - b.queuedAt)
}

async function remove(id: string) {
  await withStore('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>)
}

async function update(entry: OutboxEntry) {
  await withStore('readwrite', (s) => s.put(entry) as unknown as IDBRequest<IDBValidKey>)
}

/** Attempts that are almost certainly permanent, so we stop retrying. */
const PERMANENT = new Set([400, 401, 403, 404, 409, 422])
const MAX_ATTEMPTS = 8

export interface FlushResult {
  sent: number
  failed: number
  remaining: number
}

/**
 * Push the queue, oldest first.
 *
 * Strictly sequential: observations and administrations are ordered clinical
 * events, and replaying them out of order would produce a chart that reads
 * wrong even though every individual row is right.
 */
export async function flush(): Promise<FlushResult> {
  if (!navigator.onLine) return { sent: 0, failed: 0, remaining: (await listQueue()).length }

  const queue = await listQueue()
  let sent = 0
  let failed = 0

  for (const entry of queue) {
    try {
      const res = await fetch(`/api${entry.path}`, {
        method: entry.method,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': entry.id,
        },
        body: entry.body === undefined ? undefined : JSON.stringify(entry.body),
      })

      if (res.ok) {
        await remove(entry.id)
        sent++
        continue
      }

      const permanent = PERMANENT.has(res.status)
      const body = await res.json().catch(() => ({}))
      const next: OutboxEntry = {
        ...entry,
        attempts: entry.attempts + 1,
        lastError: body?.error ?? `HTTP ${res.status}`,
      }

      if (permanent || next.attempts >= MAX_ATTEMPTS) {
        // Kept, not silently dropped. A rejected administration is something a
        // human has to look at, not something to discard on the client.
        await update({ ...next, lastError: `${next.lastError} — needs review` })
        failed++
      } else {
        await update(next)
        // Stop on the first transient failure: order matters, and hammering a
        // struggling server with the rest of the queue will not help.
        break
      }
    } catch {
      // Network died again mid-flush. Leave the rest queued.
      break
    }
  }

  notify()
  return { sent, failed, remaining: (await listQueue()).length }
}

/* --- subscription so the UI can show queue depth --- */

type Listener = () => void
const listeners = new Set<Listener>()

function notify() {
  for (const l of listeners) l()
}

export function subscribeToQueue(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Flush on reconnect, and periodically in case the online event is missed. */
export function startOfflineSync() {
  window.addEventListener('online', () => void flush())
  // Some Android browsers fire `online` before the route is actually usable,
  // so a slow poll is a cheap backstop rather than the primary trigger.
  window.setInterval(() => {
    if (navigator.onLine) void flush()
  }, 60_000)
  void flush()
}
