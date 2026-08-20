/**
 * End-to-end test harness.
 *
 * Safety first: these tests write, delete and re-seed. They therefore refuse
 * to run unless TEST_DATABASE_URL is set AND names a database distinct from
 * DATABASE_URL. A test suite that can silently wipe a production hospital
 * database is a worse liability than no test suite.
 *
 * The suite talks to the API over HTTP rather than calling route handlers
 * directly, because the things that broke in this system — middleware order,
 * role guards, transaction boundaries, race conditions — only exist at that
 * boundary.
 */

export const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:4001'

export function assertSafeDatabase() {
  const test = process.env.TEST_DATABASE_URL
  const dev = process.env.DATABASE_URL

  if (!test) {
    throw new Error(
      'TEST_DATABASE_URL is not set.\n' +
        'These tests destroy and re-seed data. Point them at a throwaway database:\n' +
        '  TEST_DATABASE_URL="postgresql://uzima_app:uzima_dev_pw@127.0.0.1:5434/uzima_hms_test"',
    )
  }

  const nameOf = (url: string) => url.split('/').pop()?.split('?')[0] ?? ''
  if (dev && nameOf(dev) === nameOf(test)) {
    throw new Error(
      `Refusing to run: TEST_DATABASE_URL points at "${nameOf(test)}", the same database as DATABASE_URL.`,
    )
  }
  if (!/test/i.test(nameOf(test))) {
    throw new Error(
      `Refusing to run: test database "${nameOf(test)}" does not contain "test" in its name.`,
    )
  }
}

/* ------------------------------------------------------------------ */

export interface Session {
  cookie: string
  user: { id: string; name: string; role: string }
}

interface CallOptions {
  method?: string
  body?: unknown
  session?: Session | null
  headers?: Record<string, string>
  /** Do not throw on a non-2xx; the test asserts the status itself. */
  raw?: boolean
}

export interface ApiResponse<T = any> {
  status: number
  body: T
  headers: Headers
}

export async function call<T = any>(path: string, options: CallOptions = {}): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.session ? { Cookie: options.session.cookie } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const text = await res.text()
  let body: any = undefined
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = text
  }

  if (!options.raw && res.status >= 400) {
    throw new Error(`${options.method ?? 'GET'} ${path} → ${res.status}: ${JSON.stringify(body)}`)
  }

  return { status: res.status, body, headers: res.headers }
}

export async function login(email: string, password = 'Passw0rd!'): Promise<Session> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`)

  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) throw new Error(`No session cookie returned for ${email}`)

  return {
    cookie: setCookie.split(';')[0]!,
    user: (await res.json()) as Session['user'],
  }
}

/** Waits for the API to answer, so the suite can start the server itself. */
export async function waitForApi(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`)
      if (res.ok) return
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`API did not become ready at ${BASE_URL} within ${timeoutMs}ms`)
}

/** Seeded accounts, one per role the tests exercise. */
export const ACCOUNTS = {
  admin: 'admin@uzimageneral.ke',
  physician: 'a.njeri@uzimageneral.ke',
  physician2: 'b.kiptoo@uzimageneral.ke',
  nurse: 'achieng.otieno@uzimageneral.ke',
  nurse2: 'chebet.kiptoo@uzimageneral.ke',
  billing: 'b.nyambura@uzimageneral.ke',
  pharmacist: 'j.kariuki@uzimageneral.ke',
  labTech: 'm.adhiambo@uzimageneral.ke',
  labTech2: 'k.mutiso@uzimageneral.ke',
  radiographer: 'd.kiprop@uzimageneral.ke',
} as const

/** Unique enough to keep parallel runs from colliding on unique columns. */
export function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}
