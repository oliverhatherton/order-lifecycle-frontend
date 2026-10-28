import { useEffect, useState } from 'react'
import { API_BASE } from './api.js'

/** No answer within this long on the first check means it's waking from sleep. */
const SLOW_MS = 1500
/** A single /health request is abandoned after this long and retried. */
const REQUEST_TIMEOUT_MS = 10_000
/** How often to re-check while it isn't up yet, and once it is. */
const RETRY_MS = 3000
const HEALTHY_MS = 30_000
/** Render's free tier usually wakes within a minute; past this it reads as down. */
const WAKE_BUDGET_MS = 90_000

/**
 * Whether the backend is answering, for the status pill. The free hosting
 * tier spins the API down when idle and the first request wakes it, so a slow
 * first answer reads as "waking", not as an outage.
 *
 * status: 'checking' (first request in flight, under SLOW_MS) · 'waking' ·
 * 'up' · 'down'. `since` is when the current not-up stretch began, for the
 * elapsed counter; `upAt` is when it last came up.
 */
export function useBackendStatus() {
  const [state, setState] = useState(() => ({ status: 'checking', since: Date.now() }))

  useEffect(() => {
    let timer
    let cancelled = false

    async function check() {
      clearTimeout(timer)
      let ok = false
      try {
        const res = await fetch(`${API_BASE}/health`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        ok = res.ok
      } catch {
        ok = false
      }
      if (cancelled) return

      setState((prev) => {
        if (ok) return prev.status === 'up' ? prev : { status: 'up', since: prev.since, upAt: Date.now() }
        // The first failure after being up starts a new not-up stretch.
        const since = prev.status === 'up' ? Date.now() : prev.since
        return { status: Date.now() - since > WAKE_BUDGET_MS ? 'down' : 'waking', since }
      })
      timer = setTimeout(check, ok ? HEALTHY_MS : RETRY_MS)
    }

    // Only flag "waking" if the very first answer is slow, so a warm backend never flashes it.
    const slow = setTimeout(() => {
      setState((prev) => (prev.status === 'checking' ? { ...prev, status: 'waking' } : prev))
    }, SLOW_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }

    check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearTimeout(slow)
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return state
}
