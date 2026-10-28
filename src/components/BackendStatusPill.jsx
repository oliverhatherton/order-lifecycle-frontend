import { useEffect, useState } from 'react'
import { useBackend } from '../lib/useBackend.js'
import { cn } from '@/lib/utils'

/** How long "Backend live" stays up after it comes back, before the pill fades. */
const LIVE_SHOWN_MS = 4000

const DOT = {
  waking: 'bg-warning motion-safe:animate-pulse',
  down: 'bg-negative',
  up: 'bg-positive',
}

/**
 * Bottom-right pill: appears while the backend is waking from sleep (with
 * the seconds so far) or unreachable, says "Backend live" for a moment once
 * it answers, then gets out of the way. Hidden entirely when the first check
 * comes back fast, so a warm backend never shows it.
 */
export function BackendStatusPill() {
  const { status, since, upAt } = useBackend()
  const [now, setNow] = useState(() => Date.now())

  // Ticks the elapsed counter while waking; once up, one re-render to fade it out.
  useEffect(() => {
    if (status === 'waking') {
      const id = setInterval(() => setNow(Date.now()), 1000)
      return () => clearInterval(id)
    }
    if (status === 'up' && upAt !== undefined) {
      const id = setTimeout(() => setNow(Date.now()), LIVE_SHOWN_MS + 50)
      return () => clearTimeout(id)
    }
  }, [status, upAt])

  const elapsed = Math.max(0, Math.round((now - since) / 1000))
  // "Backend live" only follows a visible wait; a fast first answer shows nothing.
  const cameBack = status === 'up' && upAt !== undefined && upAt - since > 1500
  const visible = status === 'waking' || status === 'down' || (cameBack && Math.max(now, upAt) - upAt < LIVE_SHOWN_MS)

  const label =
    status === 'waking' ? `Waking backend · ${elapsed} s` : status === 'down' ? 'Backend unreachable · retrying' : 'Backend live'

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-full border border-border bg-popover px-3.5 py-2 text-xs font-medium text-foreground shadow-lg transition-all duration-300 tabular max-sm:right-3 max-sm:bottom-3',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
    >
      <span className={cn('size-2 flex-none rounded-full', DOT[status] ?? 'bg-faint')} aria-hidden="true" />
      {visible ? label : null}
    </div>
  )
}
