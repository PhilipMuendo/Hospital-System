import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Alert, Button, TextInput } from '../components/ui'

/**
 * Sign in.
 *
 * A real `<form>`, so Enter submits and password managers work. No marketing
 * panel, no hero image — this screen is crossed dozens of times a shift and
 * every element that is not the two fields is friction.
 */
export function LoginPage() {
  const { user, login, loginError, isLoggingIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState(false)

  if (user) {
    const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname
    return <Navigate to={from ?? '/dashboard'} replace />
  }

  const missing = touched && (!email || !password)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!email || !password) return
    try {
      await login(email, password)
    } catch {
      // Surfaced through loginError; nothing to do here.
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-sunken px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-primary-600">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M1.5 8.5h2.5L5.2 5l2 6 1.5-5.5 1 3H14.5"
                stroke="#fff"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-ink-900">Uzima General Hospital</h1>
            <p className="text-xs text-ink-600">Staff portal · Nairobi</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="border border-line bg-canvas p-5" noValidate>
          <h2 className="text-md font-semibold text-ink-900">Sign in</h2>
          <p className="mt-0.5 text-sm text-ink-600">Use your hospital account.</p>

          {loginError && (
            <div className="mt-4">
              <Alert tone="critical" title="Could not sign in">
                {loginError}
              </Alert>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-4">
            <TextInput
              autoFocus
              label="Email address"
              type="email"
              autoComplete="username"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={touched && !email ? 'Enter your email address' : undefined}
              placeholder="name@uzimageneral.ke"
            />

            <TextInput
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={touched && !password ? 'Enter your password' : undefined}
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            className="mt-5"
            loading={isLoggingIn}
            loadingText="Signing in…"
            disabled={missing}
          >
            Sign in
          </Button>

          <p className="mt-4 text-xs text-ink-600">
            Accounts are issued by the hospital administrator. There is no public sign-up.
          </p>
        </form>

        <p className="mt-4 text-center text-xs text-ink-500">
          Access is logged. Only open records you are treating.
        </p>
      </div>
    </div>
  )
}
