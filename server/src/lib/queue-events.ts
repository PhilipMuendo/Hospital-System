import type { Response } from 'express'

/**
 * Server-Sent Events fan-out for the queue.
 *
 * SSE rather than WebSockets because the traffic is entirely one-way — the
 * server tells the waiting-room board and the clinical panels that something
 * changed. SSE reconnects on its own, survives a proxy, and needs no protocol
 * upgrade, which matters when the display is a cheap TV browser on flaky
 * hospital wifi.
 *
 * Rather than polling: a board that lags ten seconds behind the announcement
 * reads as broken to everyone sitting in front of it.
 */

interface Subscriber {
  id: number
  res: Response
  /** Only receive events for this station, or all when null. */
  stationId: string | null
}

let nextId = 1
const subscribers = new Set<Subscriber>()

export type QueueEvent =
  | { type: 'ticket.issued'; stationId: string; token: string }
  | { type: 'ticket.called'; stationId: string; token: string; counter: string | null; patientLabel: string }
  | { type: 'ticket.completed'; stationId: string; token: string }
  | { type: 'ticket.noshow'; stationId: string; token: string }
  | { type: 'queue.changed'; stationId: string | null }

export function subscribe(res: Response, stationId: string | null): () => void {
  const sub: Subscriber = { id: nextId++, res, stationId }
  subscribers.add(sub)

  res.write(`retry: 3000\n\n`)
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`)

  return () => {
    subscribers.delete(sub)
  }
}

export function publish(event: QueueEvent) {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`

  for (const sub of subscribers) {
    // A station-scoped subscriber still needs global events (stationId null).
    const scoped = 'stationId' in event ? event.stationId : null
    if (sub.stationId && scoped && sub.stationId !== scoped) continue

    try {
      sub.res.write(payload)
    } catch {
      subscribers.delete(sub)
    }
  }
}

/**
 * Proxies and load balancers close an idle connection; a comment frame every
 * 25s keeps it open without being an event the client has to handle.
 */
export function startHeartbeat() {
  const timer = setInterval(() => {
    for (const sub of subscribers) {
      try {
        sub.res.write(': keep-alive\n\n')
      } catch {
        subscribers.delete(sub)
      }
    }
  }, 25_000)
  timer.unref?.()
  return timer
}

export function subscriberCount() {
  return subscribers.size
}
