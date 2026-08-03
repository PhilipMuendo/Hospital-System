import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { GlassPanel } from '../components/atoms/GlassPanel'
import { Button } from '../components/atoms/Button'
import { useAuth } from '../context/AuthContext'

const DEMO_ACCOUNTS = [
  { role: 'Admin', email: 'admin@uzimageneral.ke' },
  { role: 'Physician', email: 'a.njeri@uzimageneral.ke' },
  { role: 'Nurse', email: 'achieng.otieno@uzimageneral.ke' },
  { role: 'Billing', email: 'b.nyambura@uzimageneral.ke' },
]

export function LoginPage() {
  const { user, login, loginError, isLoggingIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  if (user) {
    const from = (location.state as { from?: Location })?.from?.pathname ?? '/'
    return <Navigate to={from} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      await login(email, password)
    } catch {
      // surfaced via loginError below
    }
  }

  return (
    <div className="relative grid min-h-svh place-items-center overflow-hidden bg-charcoal-950 px-5">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(55% 45% at 50% 0%, color-mix(in srgb, var(--color-accent-600) 16%, transparent) 0%, transparent 60%)',
        }}
      />

      <GlassPanel className="relative w-full max-w-[400px] p-8" delay={0}>
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-gradient-to-b from-accent-400 to-accent-600">
            <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
              <path d="M1.5 8.5h2.5L5.2 5l2 6 1.5-5.5 1 3H14.5" stroke="#08090b" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h1 className="text-[17px]">Uzima General Hospital</h1>
            <p className="text-[12px] text-mist-500">Staff Sign In</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-mist-400">Email</span>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@uzimageneral.ke"
              className="rounded-[var(--radius-xs)] border border-white/8 bg-surface-800/70 px-3.5 py-2.5 text-[14px] text-mist-50 outline-none placeholder:text-mist-600 focus:border-accent-500/60"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-mist-400">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-[var(--radius-xs)] border border-white/8 bg-surface-800/70 px-3.5 py-2.5 text-[14px] text-mist-50 outline-none placeholder:text-mist-600 focus:border-accent-500/60"
            />
          </label>

          {loginError && <p className="text-[13px] text-status-critical">{loginError}</p>}

          <Button type="submit" size="md" disabled={isLoggingIn} className="mt-1 justify-center">
            {isLoggingIn ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>

        <div className="mt-7 border-t border-white/6 pt-5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-mist-500">Demo Accounts</p>
          <p className="mt-1 text-[12px] text-mist-600">Password for all: Passw0rd!</p>
          <div className="mt-2.5 flex flex-col gap-1.5">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => {
                  setEmail(a.email)
                  setPassword('Passw0rd!')
                }}
                className="flex items-center justify-between rounded-[var(--radius-2xs)] px-2.5 py-1.5 text-left text-[12.5px] text-mist-400 hover:bg-white/5 hover:text-mist-100"
              >
                <span>{a.role}</span>
                <span className="font-mono text-[11px] tabular text-mist-600">{a.email}</span>
              </button>
            ))}
          </div>
        </div>
      </GlassPanel>
    </div>
  )
}
