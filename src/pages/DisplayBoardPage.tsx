import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/apiClient'
import { useAnnouncer, useQueueStream, type CalledEvent } from '../lib/useQueueStream'

interface BoardStation {
  id: string
  name: string
  room: string | null
  nowServing: { token: string; counter: string | null; firstName: string | null } | null
  waiting: number
  upcoming: string[]
}

interface Board {
  serverTime: string
  stations: BoardStation[]
}

/**
 * The waiting-room television.
 *
 * Unauthenticated by design — nobody logs a corridor screen in — so it shows
 * only what is safe to project at a room full of strangers: a token, a room,
 * and at most a first name. Never a surname, never a clinic name that would
 * disclose why someone is here.
 *
 * Built to be legible from across a room: very large type, high contrast, and
 * no reliance on colour alone.
 */
export function DisplayBoardPage() {
  const announcer = useAnnouncer()
  const [flash, setFlash] = useState<CalledEvent | null>(null)
  const [soundOn, setSoundOn] = useState(false)
  const [clock, setClock] = useState(() => new Date())

  const board = useQuery({
    queryKey: ['board'],
    queryFn: () => api.get<Board>('/public/board'),
    // Backstop only; the stream is what actually drives updates. Also the
    // recovery path if the stream drops and EventSource is mid-reconnect.
    refetchInterval: 20_000,
  })

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const onCalled = useCallback(
    (event: CalledEvent) => {
      setFlash(event)
      if (soundOn) announcer.announce(event.token, event.counter)
      window.setTimeout(() => setFlash((f) => (f?.at === event.at ? null : f)), 12_000)
    },
    [announcer, soundOn],
  )

  const { connected } = useQueueStream({
    onCalled,
    onChange: () => board.refetch(),
  })

  const stations = board.data?.stations ?? []

  return (
    <div className="min-h-svh bg-[#07090c] px-8 py-6 text-white">
      <header className="flex items-center justify-between border-b border-white/10 pb-5">
        <div>
          <h1 className="text-[38px] font-bold leading-none tracking-tight">Uzima General Hospital</h1>
          <p className="mt-2 text-[18px] text-white/50">Outpatient Department · Idara ya Wagonjwa wa Nje</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[46px] font-bold leading-none tabular">
            {clock.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false })}
          </p>
          <div className="mt-2 flex items-center justify-end gap-3">
            {/* Browsers block audio until someone interacts, so the screen
                needs a one-time press before it can announce. */}
            {!soundOn && (
              <button
                type="button"
                onClick={() => {
                  setSoundOn(true)
                  announcer.announce('TEST', null)
                }}
                className="rounded-full bg-white/10 px-4 py-1.5 text-[14px] text-white/80 hover:bg-white/20"
              >
                🔇 Tap to enable sound
              </button>
            )}
            <span className={`h-3 w-3 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span className="text-[14px] text-white/40">{connected ? 'Live' : 'Reconnecting…'}</span>
          </div>
        </div>
      </header>

      {/* The most recent call, blown up so it is readable from the far wall. */}
      {flash && (
        <div className="mt-6 animate-pulse rounded-3xl bg-gradient-to-r from-emerald-500 to-teal-500 px-10 py-8 text-black">
          <p className="text-[22px] font-semibold uppercase tracking-widest opacity-80">Now calling · Tunaita</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-10 gap-y-2">
            <span className="font-mono text-[110px] font-black leading-none tabular">{flash.token}</span>
            {flash.patientLabel && <span className="text-[52px] font-bold">{flash.patientLabel}</span>}
            {flash.counter && (
              <span className="text-[44px] font-semibold">
                → {flash.counter}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {stations.map((s) => (
          <div key={s.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[24px] font-semibold">{s.name}</h2>
              <span className="text-[15px] text-white/40">{s.waiting} waiting</span>
            </div>

            <p className="mt-4 text-[13px] uppercase tracking-widest text-white/35">Now serving</p>
            {s.nowServing ? (
              <>
                <p className="font-mono text-[64px] font-black leading-none tabular text-emerald-400">
                  {s.nowServing.token}
                </p>
                {s.nowServing.firstName && (
                  <p className="mt-1 text-[22px] text-white/70">{s.nowServing.firstName}</p>
                )}
                {s.nowServing.counter && (
                  <p className="mt-1 text-[18px] text-white/50">{s.nowServing.counter}</p>
                )}
              </>
            ) : (
              <p className="font-mono text-[56px] font-black leading-none text-white/15">—</p>
            )}

            {s.upcoming.length > 0 && (
              <>
                <p className="mt-5 text-[13px] uppercase tracking-widest text-white/35">Next</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {s.upcoming.map((t) => (
                    <span
                      key={t}
                      className="rounded-lg bg-white/8 px-3 py-1.5 font-mono text-[20px] font-bold tabular text-white/70"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {stations.length === 0 && (
        <p className="mt-24 text-center text-[26px] text-white/30">No clinics are currently open.</p>
      )}

      <footer className="mt-10 border-t border-white/10 pt-4 text-center text-[15px] text-white/30">
        Please keep your token. Tafadhali weka nambari yako. · Listen for your number and go to the room shown.
      </footer>
    </div>
  )
}
