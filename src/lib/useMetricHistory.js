import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'

const REFRESH_MS = 30000

/**
 * Durable, resolution-bucketed history from GET /metrics/history (Postgres-
 * backed, survives a restart) — distinct from the in-memory Prometheus
 * /metrics scrape. Requires auth, so callers should gate on isAuthenticated.
 */
export function useMetricHistory(metric, resolution = '1h', { enabled = true } = {}) {
  const [points, setPoints] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const { data } = await api.metricsHistory(metric, { resolution })
      setPoints(data?.points ?? [])
      setError(null)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [metric, resolution])

  useEffect(() => {
    if (!enabled) return
    // load()'s state updates happen after its internal await, not synchronously
    // here — same fetch-in-effect shape as useMetricsPoller's fetchOnce().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [load, enabled])

  // Disabled means "nothing to load," not "still loading" — derive rather
  // than setState from the effect above for the disabled branch.
  return { points, error, loading: enabled ? loading : false }
}
