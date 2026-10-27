import { useCallback, useEffect, useState } from 'react'
import { API_BASE } from './api.js'
import { parsePrometheusText, sumSamples } from './prometheus.js'

const DEFAULT_INTERVAL_MS = 5000
/** Rates and windowed histograms are computed over (at most) this much history. */
export const DEFAULT_WINDOW_MS = 30_000

/**
 * Polls the backend's raw /metrics text endpoint (no auth — it's a public
 * Prometheus scrape target) and keeps a short ring of snapshots, so callers
 * can derive per-second rates and windowed histograms by diffing the newest
 * scrape against the oldest one still inside `windowMs` — the same way a
 * Prometheus server's `rate(x[30s])` works. A 30s window instead of the last
 * single 5s interval keeps low-traffic panels from flickering between 0 and
 * a spike on every poll.
 */
export function useMetricsPoller(intervalMs = DEFAULT_INTERVAL_MS, windowMs = DEFAULT_WINDOW_MS) {
  const [snapshots, setSnapshots] = useState([]) // [{ families, text, at }], oldest first
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/metrics`)
      if (!res.ok) throw new Error(`/metrics returned ${res.status}`)
      const text = await res.text()
      const snapshot = { families: parsePrometheusText(text), text, at: Date.now() }
      setSnapshots((prev) => {
        // Keep one snapshot older than the window so the baseline always spans it.
        const cutoff = snapshot.at - windowMs
        const kept = prev.filter((s, i) => s.at >= cutoff || prev[i + 1]?.at >= cutoff)
        return [...kept, snapshot]
      })
      setError(null)
    } catch (err) {
      setError(err.message ?? 'Failed to fetch /metrics')
    } finally {
      setLoading(false)
    }
  }, [windowMs])

  useEffect(() => {
    // fetchOnce()'s state updates happen after its internal await, not
    // synchronously here — same shape as useMetricHistory's load().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchOnce()
    const id = setInterval(fetchOnce, intervalMs)
    return () => clearInterval(id)
  }, [fetchOnce, intervalMs])

  const current = snapshots[snapshots.length - 1] ?? null
  const baseline = snapshots.length > 1 ? snapshots[0] : null
  const windowSeconds = current && baseline ? (current.at - baseline.at) / 1000 : null

  /** Per-second rate of a counter over the window (null until two scrapes, or across a restart). */
  const rate = useCallback(
    (familyName, opts = {}) => {
      if (!current || !baseline || !windowSeconds) return null
      const curFamily = current.families.get(familyName)
      if (!curFamily) return null
      const delta = sumSamples(curFamily, opts) - sumSamples(baseline.families.get(familyName), opts)
      return delta < 0 ? null : delta / windowSeconds // negative delta = counter reset (process restart)
    },
    [current, baseline, windowSeconds],
  )

  /** Absolute increase of a counter over the window. */
  const increase = useCallback(
    (familyName, opts = {}) => {
      const r = rate(familyName, opts)
      return r === null ? null : r * windowSeconds
    },
    [rate, windowSeconds],
  )

  return {
    families: current?.families ?? new Map(),
    baselineFamilies: baseline?.families ?? null,
    rawText: current?.text ?? '',
    hasTwoSamples: baseline !== null,
    windowSeconds,
    lastUpdated: current?.at ?? null,
    rate,
    increase,
    loading,
    error,
    refresh: fetchOnce,
  }
}
