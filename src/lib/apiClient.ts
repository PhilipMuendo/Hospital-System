import { enqueue, queueabilityOf } from './offline'

/** Thrown when an action was safely queued rather than sent. */
export class QueuedOfflineError extends Error {
  readonly queued = true
  readonly label: string

  constructor(label: string) {
    super(`${label} saved on this device — it will sync when the connection returns.`)
    this.label = label
  }
}

export class ApiError extends Error {
  status: number
  details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET'

  // Offline writes: queue what is safe to replay, refuse the rest with a
  // reason rather than a generic network error.
  if (method !== 'GET' && !navigator.onLine) {
    const { queueable, label, reason } = queueabilityOf(path)
    if (!queueable) throw new ApiError(0, reason ?? 'You are offline.')

    await enqueue({
      path,
      method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      label: label!,
    })
    throw new QueuedOfflineError(label!)
  }

  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })

  if (res.status === 204) {
    return undefined as T
  }

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const body = isJson ? await res.json() : undefined

  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? res.statusText, body?.details ?? body?.conflicts)
  }

  return body as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
