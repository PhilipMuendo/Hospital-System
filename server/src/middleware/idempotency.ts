import type { NextFunction, Request, Response } from 'express'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

/**
 * Replay protection for offline-queued mutations.
 *
 * A ward tablet that loses signal keeps recording and flushes its queue on
 * reconnect. If that flush is interrupted halfway and retried, every request
 * it already delivered would run a second time. For append-only records — a
 * drug administration, a set of observations — a duplicate is not
 * self-correcting: it becomes a second dose in the legal record.
 *
 * The client sends an Idempotency-Key it generated when the action was taken.
 * The first request through stores its response; any repeat replays that
 * response verbatim without touching the database, so a retry is
 * indistinguishable from the original call.
 *
 * Keys are scoped to the acting user so one person's key cannot replay
 * another's request.
 */
export function idempotent(req: Request, res: Response, next: NextFunction) {
  const key = req.header('Idempotency-Key')
  if (!key || !req.user) return next()

  // Namespaced so the same key on a different endpoint is a different action.
  const scoped = `${req.user.id}:${req.method}:${req.path}:${key}`

  void (async () => {
    try {
      const existing = await prisma.idempotencyKey.findUnique({ where: { key: scoped } })
      if (existing) {
        res.setHeader('Idempotent-Replay', 'true')
        res.status(existing.statusCode).json(existing.responseBody ?? {})
        return
      }
    } catch (err) {
      // A lookup failure must not block clinical work; fall through and let
      // the request run normally.
      console.error('[idempotency] lookup failed', err)
    }

    // Capture the response so a later retry can replay it.
    const originalJson = res.json.bind(res)
    res.json = (body: unknown) => {
      // Only successful writes are worth replaying. A 4xx should be allowed to
      // re-evaluate — the condition that caused it may have changed.
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Wrapped, not just .catch()-ed: if the client is stale or the table
        // is missing, property access throws synchronously and would turn a
        // successful clinical write into a 500. Recording the key is a
        // convenience; the write itself already happened.
        try {
          void prisma.idempotencyKey
            .create({
              data: {
                key: scoped,
                endpoint: `${req.method} ${req.path}`,
                userId: req.user!.id,
                statusCode: res.statusCode,
                responseBody: body as Prisma.InputJsonValue,
              },
            })
            .catch((err: unknown) => {
              // A unique violation means two copies of the same request raced.
              // Harmless: both produced the same effect by definition.
              if ((err as { code?: string }).code !== 'P2002') {
                console.error('[idempotency] store failed', err)
              }
            })
        } catch (err) {
          console.error('[idempotency] store unavailable', err)
        }
      }
      return originalJson(body)
    }

    next()
  })()
}

/**
 * Keys are only useful for as long as a client might retry. Anything older
 * than a day is a replay attempt, not a retry, and the table should not grow
 * without bound.
 */
export async function pruneIdempotencyKeys(olderThanHours = 24) {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000)
  const { count } = await prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: cutoff } } })
  return count
}
