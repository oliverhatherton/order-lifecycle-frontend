import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from './api.js'
import { parsePrometheusText, sumSamples } from './prometheus.js'

const DEFAULT_INTERVAL_MS = 5000

/**
 * Polls the backend's raw /metrics text endpoint (no auth — it's a public
 * Prometheus scrape target) and keeps the last two snapshots so callers can
 * derive per-second rates by diffing counters over the elapsed wall time,
 * the same way a Prometheus server's rate() does over a scrape interval.
 */
export function useMetricsPoller(intervalMs = DEFAULT_INTERVAL_MS) {
  const [snapshot, setSnapshot] = useState(null) // { families, text, at }
  const previousRef = useRef(null)
  const [hasTwoSamples, setHasTwoSamples] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/metrics`)
      if (!res.ok) throw new Error(`/metrics returned ${res.status}`)
      const text = await res.text()
      const families = parsePrometheusText(text)
      setSnapshot((prev) => {
        if (prev) {
          previousRef.current = prev
          setHasTwoSamples(true)
        }
        return { families, text, at: Date.now() }
      })
      setError(null)
    } catch (err) {
      setError(err.message ?? 'Failed to fetch /metrics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOnce()
    const id = setInterval(fetchOnce, intervalMs)
    return () => clearInterval(id)
  }, [fetchOnce, intervalMs])

  /** Per-second rate of a counter family between the last two scrapes. */
  const rate = useCallback((familyName, opts = {}) => {
    const prev = previousRef.current
    if (!snapshot || !prev) return null
    const curFamily = snapshot.families.get(familyName)
    const prevFamily = prev.families.get(familyName)
    if (!curFamily) return null
    const deltaSeconds = (snapshot.at - prev.at) / 1000
    if (deltaSeconds <= 0) return null
    const curVal = sumSamples(curFamily, opts)
    const prevVal = sumSamples(prevFamily, opts)
    const delta = curVal - prevVal
    return delta < 0 ? null : delta / deltaSeconds // negative delta = counter reset (process restart)
  }, [snapshot])

  return {
    families: snapshot?.families ?? new Map(),
    rawText: snapshot?.text ?? '',
    hasTwoSamples,
    lastUpdated: snapshot?.at ?? null,
    rate,
    loading,
    error,
    refresh: fetchOnce,
  }
}
