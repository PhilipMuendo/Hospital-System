import { useEffect, useRef } from 'react'

/**
 * Keyboard shortcuts.
 *
 * Reception, triage, pharmacy and the cash desk are high-throughput,
 * repetitive jobs. A clerk doing 200 check-ins a day who has to move hand to
 * mouse for every one will be slower than on the paper system being replaced —
 * which is how HMS rollouts fail.
 *
 * Rules this enforces:
 *  - never intercept a browser or OS combination (Ctrl/Cmd is left alone);
 *  - never fire while the user is typing, unless the shortcut explicitly opts
 *    in (Escape and Enter do);
 *  - single letters only where a screen is a workspace, not a form.
 */

export interface Hotkey {
  /** e.g. "/", "n", "Escape", "Enter", "shift+?" */
  combo: string
  handler: (event: KeyboardEvent) => void
  /** Fire even when focus is in an input. Default false. */
  whileTyping?: boolean
  /** Human-readable, for the shortcut help sheet. */
  description?: string
  enabled?: boolean
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function matches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+')
  const key = parts[parts.length - 1]
  const wantShift = parts.includes('shift')
  const wantAlt = parts.includes('alt')

  // Modifier combinations belong to the browser and the OS. Claiming them
  // breaks find, new tab, bookmarks and screen-reader commands.
  if (event.ctrlKey || event.metaKey) return false
  if (wantShift !== event.shiftKey) return false
  if (wantAlt !== event.altKey) return false

  return event.key.toLowerCase() === key
}

export function useHotkeys(hotkeys: Hotkey[]) {
  // Held in a ref so re-created handler arrays do not rebind the listener on
  // every render.
  const ref = useRef(hotkeys)
  ref.current = hotkeys

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const typing = isTypingTarget(event.target)

      for (const hotkey of ref.current) {
        if (hotkey.enabled === false) continue
        if (typing && !hotkey.whileTyping) continue
        if (!matches(event, hotkey.combo)) continue

        event.preventDefault()
        hotkey.handler(event)
        return
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}

/**
 * Submit on Enter, cancel on Escape, for a form that is not inside a
 * `<form>` element. Enter is ignored in a textarea, where it means newline.
 */
export function useFormKeys({
  onSubmit,
  onCancel,
  canSubmit = true,
}: {
  onSubmit?: () => void
  onCancel?: () => void
  canSubmit?: boolean
}) {
  return {
    onKeyDown(event: React.KeyboardEvent) {
      if (event.key === 'Escape' && onCancel) {
        event.preventDefault()
        onCancel()
        return
      }
      if (
        event.key === 'Enter' &&
        onSubmit &&
        canSubmit &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !event.shiftKey
      ) {
        event.preventDefault()
        onSubmit()
      }
    },
  }
}

/** Shortcuts available everywhere, listed in the help sheet. */
export const GLOBAL_SHORTCUTS: { combo: string; description: string }[] = [
  { combo: '/', description: 'Focus search' },
  { combo: 'g then d', description: 'Go to Dashboard' },
  { combo: 'g then r', description: 'Go to Reception' },
  { combo: 'g then t', description: 'Go to Triage' },
  { combo: 'g then w', description: 'Go to Ward' },
  { combo: '?', description: 'Show keyboard shortcuts' },
  { combo: 'Esc', description: 'Close dialog / clear search' },
]

/**
 * Two-key "go to" sequences, in the style of long-lived keyboard-driven
 * tools. A prefix keeps single letters free for screen-local actions and
 * avoids collisions with browser shortcuts.
 */
export function useGoToNavigation(navigate: (path: string) => void) {
  const pending = useRef<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    const routes: Record<string, string> = {
      d: '/dashboard',
      r: '/reception',
      t: '/triage',
      c: '/consultation',
      w: '/ward',
      p: '/patients',
      l: '/lab',
      m: '/pharmacy',
      b: '/billing',
    }

    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return

      if (pending.current === 'g') {
        const path = routes[event.key.toLowerCase()]
        pending.current = null
        if (timer.current) window.clearTimeout(timer.current)
        if (path) {
          event.preventDefault()
          navigate(path)
        }
        return
      }

      if (event.key.toLowerCase() === 'g') {
        pending.current = 'g'
        // Times out so a stray "g" does not swallow the next keystroke.
        timer.current = window.setTimeout(() => {
          pending.current = null
        }, 1200)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [navigate])
}
