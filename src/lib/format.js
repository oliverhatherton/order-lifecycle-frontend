import { histogramQuantile } from './prometheus.js'

/** Operational latency (HTTP, event loop): milliseconds under a second, seconds above. */
export function latencyParts(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return { value: null, unit: '' }
  if (seconds < 1) {
    const ms = seconds * 1000
    return { value: ms < 10 ? ms.toFixed(1) : Math.round(ms).toString(), unit: ' ms' }
  }
  return { value: seconds.toFixed(2), unit: ' s' }
}

export function formatLatency(seconds) {
  const { value, unit } = latencyParts(seconds)
  return value === null ? '—' : `${value}${unit}`
}

const tenth = (n) => Math.round(n * 10) / 10
const trim = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/**
 * A stage duration as a narrow band around its median ("0.7–0.9 s"), never
 * a single exact figure: stages vary run to run, so a precise number claims
 * more than the data knows. The band is ±0.1 s, widening to ±10% above 2 s
 * so a slow stage doesn't read as falsely tight.
 */
export function formatAround(median) {
  if (median === null || median === undefined || !Number.isFinite(median)) return '—'
  const spread = median > 2 ? median * 0.1 : 0.1
  const round = median >= 10 ? Math.round : tenth
  const lo = Math.max(0, round(median - spread))
  const hi = round(median + spread)
  if (lo === 0) return `under ${trim(hi)} s`
  return `${trim(lo)}–${trim(hi)} s`
}

/** The band around a histogram's median, or a dash when it has no observations. */
export function stageRange(series) {
  if (!series?.count) return '—'
  return formatAround(histogramQuantile(series, 0.5))
}
