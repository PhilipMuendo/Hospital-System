import { useEffect, useRef, useState } from 'react'

export interface CalledEvent {
  token: string
  counter: string | null
  patientLabel: string
  stationId: string
  at: number
}

/**
 * Subscribes to the queue's server-sent events.
 *
 * EventSource is used rather than polling because the waiting-room board and
 * the announcement have to land the moment the clinician presses "call" — a
 * board that trails the spoken announcement reads as broken. EventSource also
 * reconnects by itself, which matters on hospital wifi.
 */
export function useQueueStream(options: {
  stationId?: string | null
  onChange?: () => void
  onCalled?: (event: CalledEvent) => void
} = {}) {
  const [connected, setConnected] = useState(false)
  // Held in refs so a changing callback identity never tears down the stream.
  const onChangeRef = useRef(options.onChange)
  const onCalledRef = useRef(options.onCalled)
  onChangeRef.current = options.onChange
  onCalledRef.current = options.onCalled

  const stationId = options.stationId ?? null

  useEffect(() => {
    const url = `/api/public/board/stream${stationId ? `?station=${encodeURIComponent(stationId)}` : ''}`
    const source = new EventSource(url)

    source.addEventListener('hello', () => setConnected(true))
    source.addEventListener('error', () => setConnected(false))

    source.addEventListener('queue.changed', () => onChangeRef.current?.())
    source.addEventListener('ticket.issued', () => onChangeRef.current?.())
    source.addEventListener('ticket.completed', () => onChangeRef.current?.())
    source.addEventListener('ticket.noshow', () => onChangeRef.current?.())

    source.addEventListener('ticket.called', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        onCalledRef.current?.({ ...data, at: Date.now() })
        onChangeRef.current?.()
      } catch {
        // A malformed frame must not kill the stream.
      }
    })

    return () => source.close()
  }, [stationId])

  return { connected }
}

/**
 * Waiting-room announcement.
 *
 * The chime and the on-screen token are the mechanism; speech is an
 * enhancement. Browser voice availability is inconsistent and Kiswahili TTS
 * especially so, so a missing voice degrades to the chime rather than
 * throwing.
 */
export function useAnnouncer() {
  const audioRef = useRef<AudioContext | null>(null)

  function chime() {
    try {
      audioRef.current ??= new AudioContext()
      const ctx = audioRef.current
      // Browsers suspend audio until a user gesture; resume is a no-op after.
      void ctx.resume()

      const now = ctx.currentTime
      // Two-tone bing-bong, the sound every waiting room already uses.
      for (const [index, freq] of [880, 660].entries()) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.frequency.value = freq
        osc.type = 'sine'
        gain.gain.setValueAtTime(0.0001, now + index * 0.28)
        gain.gain.exponentialRampToValueAtTime(0.25, now + index * 0.28 + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.28 + 0.26)
        osc.connect(gain).connect(ctx.destination)
        osc.start(now + index * 0.28)
        osc.stop(now + index * 0.28 + 0.3)
      }
    } catch {
      // No audio device, or autoplay blocked. The screen still updates.
    }
  }

  function speak(token: string, counter: string | null) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

    // Spaced out so "C-042" is read as letters and digits, not "c minus 42".
    const spokenToken = token.replace(/-/g, ' ').split('').join(' ')
    const english = `Token ${spokenToken}${counter ? `, proceed to ${counter}` : ''}`
    const swahili = `Nambari ${spokenToken}${counter ? `, nenda ${counter}` : ''}`

    try {
      window.speechSynthesis.cancel()
      for (const [index, text] of [english, swahili].entries()) {
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.rate = 0.85
        utterance.lang = index === 0 ? 'en-KE' : 'sw-KE'
        // A missing sw-KE voice falls back to the default rather than silence.
        window.speechSynthesis.speak(utterance)
      }
    } catch {
      // Speech unavailable — chime and screen carry the announcement.
    }
  }

  return {
    announce(token: string, counter: string | null) {
      chime()
      // Let the chime finish before the voice starts.
      window.setTimeout(() => speak(token, counter), 700)
    },
  }
}
