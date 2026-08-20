/* eslint-env serviceworker */

/**
 * Service worker.
 *
 * Two jobs, deliberately narrow:
 *
 *  1. Keep the app shell available so a device that loses signal mid-shift
 *     still opens rather than showing a browser error page. A blank screen on
 *     a ward tablet is worse than stale data, because staff cannot tell
 *     whether the system is down or the patient has no records.
 *
 *  2. Serve the last-known copy of a small set of reference reads when the
 *     network is gone, clearly marked as cached so nobody mistakes stale data
 *     for live data.
 *
 * It does NOT cache writes. Queued mutations live in IndexedDB (see
 * src/lib/offline.ts) where the application controls exactly what may be
 * replayed. Background Sync is avoided on purpose: it is unevenly supported,
 * and clinical work should not depend on it firing.
 */

const VERSION = 'v1'
const SHELL_CACHE = `uzima-shell-${VERSION}`
const DATA_CACHE = `uzima-data-${VERSION}`

/**
 * Reads worth keeping offline: reference data and the ward view a nurse needs
 * mid-round. Deliberately excludes anything financial — a stale balance is
 * worse than no balance.
 */
const CACHEABLE_API = [
  /^\/api\/wards$/,
  /^\/api\/wards\/[^/]+\/board$/,
  /^\/api\/drugs$/,
  /^\/api\/stations$/,
  /^\/api\/lab\/tests$/,
  /^\/api\/patients\/[^/]+$/,
  /^\/api\/patients\/[^/]+\/(vitals|labs|prescriptions|imaging)$/,
  /^\/api\/auth\/me$/,
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(['/', '/index.html'])).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // The board's SSE stream must never be cached or replayed.
  if (url.pathname.endsWith('/stream')) return

  if (url.pathname.startsWith('/api/')) {
    if (!CACHEABLE_API.some((re) => re.test(url.pathname))) return
    event.respondWith(networkFirst(request))
    return
  }

  // Navigations fall back to the cached shell so the SPA still boots offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r ?? Response.error())),
    )
    return
  }

  event.respondWith(cacheFirst(request))
})

async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch {
    const cached = await cache.match(request)
    if (!cached) throw new Error('offline and not cached')

    // Mark it, so the client can tell the user what they are looking at.
    // Silent stale data in a clinical system is a safety problem.
    const body = await cached.blob()
    const headers = new Headers(cached.headers)
    headers.set('X-From-Cache', 'true')
    headers.set('X-Cached-At', cached.headers.get('date') ?? '')
    return new Response(body, { status: 200, headers })
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok && new URL(request.url).pathname.startsWith('/assets/')) {
    const cache = await caches.open(SHELL_CACHE)
    cache.put(request, response.clone())
  }
  return response
}
