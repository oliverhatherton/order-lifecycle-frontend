import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  distinctLabelSets,
  formatBytes,
  formatDuration,
  groupByLabel,
  histogramDelta,
  histogramQuantile,
  histogramSeries,
  scalarValue,
  sumByLabel,
  sumSamples,
} from '../lib/prometheus.js'
import { buildCorrelationRows } from '../lib/metricsCorrelation.js'
import { useMetricsPoller } from '../lib/useMetricsPoller.js'
import { useMetricHistory } from '../lib/useMetricHistory.js'
import { useAuth } from '../lib/useAuth.js'
import { MetricCard } from '../components/MetricCard.jsx'
import { BarList } from '../components/BarList.jsx'
import { TrendChart } from '../components/TrendChart.jsx'
import { DonutChart } from '../components/DonutChart.jsx'
import { CorrelationChart } from '../components/CorrelationChart.jsx'
import { CenterLoading } from '../components/CenterLoading.jsx'

const REFRESH_MS = 5000
const HISTORY_LENGTH = 40 // ~3.3 min of context at the default 5s poll interval

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'api', label: 'API' },
  { key: 'orders', label: 'Orders' },
  { key: 'messaging', label: 'Messaging' },
  { key: 'runtime', label: 'Runtime' },
  { key: 'correlation', label: 'Spike Correlation' },
]

const CORRELATION_RESOLUTIONS = [
  { value: '1m', label: '1m buckets — ~8h span' },
  { value: '5m', label: '5m buckets — ~41h span' },
  { value: '15m', label: '15m buckets — ~5d span' },
  { value: '1h', label: '1h buckets — ~3wk span' },
]

const IN_FLIGHT_STATUSES = ['PENDING', 'RESERVED', 'PAID']
const STAGES = [
  { key: 'reservation', label: 'Reservation (created → RESERVED)' },
  { key: 'payment', label: 'Payment (Pay → PAID)' },
  { key: 'completion', label: 'Completion (PAID → COMPLETED)' },
  { key: 'fulfilment', label: 'Fulfilment (Pay → COMPLETED)' },
]
const DLQ = 'order_lifecycle.dlq'

function formatPercent(n, digits = 1) {
  return n === null || n === undefined || !Number.isFinite(n) ? null : `${n.toFixed(digits)}%`
}

function formatRate(n, unit) {
  if (n === null || n === undefined) return null
  return `${n < 10 ? n.toFixed(2) : n.toFixed(1)} ${unit}`
}

function formatMs(seconds) {
  if (seconds === null || seconds === undefined) return null
  return `${(seconds * 1000).toFixed(seconds < 0.01 ? 2 : 1)} ms`
}

function formatSeconds(seconds) {
  if (seconds === null || seconds === undefined) return null
  return seconds < 1 ? `${(seconds * 1000).toFixed(0)} ms` : `${seconds.toFixed(2)} s`
}

/** Distinguishes "backend never declared this metric" from "declared but no samples emitted yet". */
function emptyTextFor(families, name) {
  return families.has(name) ? 'no data yet' : 'not exposed by backend'
}

/** Ratio as a percentage, or null when the denominator is 0 (no traffic ≠ 0% / 100%). */
function percentOf(part, whole) {
  return whole > 0 ? (part / whole) * 100 : null
}

function DurableHistoryLoginPrompt() {
  return (
    <div className="banner info">
      <Link to="/login" className="nav-link" style={{ padding: 0 }}>
        Log in
      </Link>{' '}
      to view durable history — <code>/metrics/history</code> requires authentication.
    </div>
  )
}

/** Small key/value table — per-consumer and per-queue breakdowns. */
function StatTable({ columns, rows, emptyText }) {
  if (rows.length === 0) return <p className="not-exposed">{emptyText}</p>
  return (
    <table className="stat-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={c.numeric ? 'num' : undefined}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            {columns.map((c) => (
              <td key={c.key} className={`${c.numeric ? 'num' : ''} ${row.tones?.[c.key] ?? ''}`.trim() || undefined}>
                {row[c.key] ?? '—'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Metrics() {
  const { families, baselineFamilies, rawText, hasTwoSamples, windowSeconds, lastUpdated, rate, increase, loading, error } =
    useMetricsPoller(REFRESH_MS)
  const [history, setHistory] = useState([])
  const [tab, setTab] = useState('overview')
  const { isAuthenticated } = useAuth()
  const historyEnabled = isAuthenticated && (tab === 'orders' || tab === 'api')
  const createdHistory = useMetricHistory('orders_created', '1d', { enabled: historyEnabled })
  const ordersHistory = useMetricHistory('orders_terminal', '1d', { enabled: historyEnabled })
  const latencyHistory = useMetricHistory('http_request_duration_ms', '1h', { enabled: historyEnabled })

  // ---------- Spike Correlation ----------
  const [correlationResolution, setCorrelationResolution] = useState('5m')
  const correlationEnabled = isAuthenticated && tab === 'correlation'
  // http_request_duration_ms doubles as both the traffic (count) and latency
  // (avg/max) series — one fetch, two fields.
  const corrTraffic = useMetricHistory('http_request_duration_ms', correlationResolution, { enabled: correlationEnabled })
  const corrLagAvg = useMetricHistory('event_loop_lag_ms', correlationResolution, { enabled: correlationEnabled })
  const corrLagMax = useMetricHistory('event_loop_lag_max_ms', correlationResolution, { enabled: correlationEnabled })
  const corrCpu = useMetricHistory('cpu_percent', correlationResolution, { enabled: correlationEnabled })
  const corrHeap = useMetricHistory('memory_heap_used_bytes', correlationResolution, { enabled: correlationEnabled })
  const correlationLoading = corrTraffic.loading || corrLagAvg.loading || corrLagMax.loading || corrCpu.loading || corrHeap.loading
  const correlationError = corrTraffic.error || corrLagAvg.error || corrLagMax.error || corrCpu.error || corrHeap.error
  const correlationRows = useMemo(
    () =>
      buildCorrelationRows({
        traffic: corrTraffic.points,
        latency: corrTraffic.points,
        lagAvg: corrLagAvg.points,
        lagMax: corrLagMax.points,
        cpu: corrCpu.points,
        heap: corrHeap.points,
      }),
    [corrTraffic.points, corrLagAvg.points, corrLagMax.points, corrCpu.points, corrHeap.points],
  )

  const windowLabel = windowSeconds ? `last ${Math.round(windowSeconds)}s` : 'collecting…'

  // ---------- HTTP (windowed) ----------
  const HTTP = 'http_request_duration_seconds'
  const httpFamily = families.get(HTTP)
  const httpPrev = baselineFamilies?.get(HTTP)
  const requestsPerSec = hasTwoSamples ? rate(HTTP, { suffix: 'count' }) : null
  const isServerError = (l) => /^5/.test(l.status_code ?? '')
  const isClientError = (l) => /^4/.test(l.status_code ?? '')
  const windowRequests = hasTwoSamples ? increase(HTTP, { suffix: 'count' }) : null
  const window5xx = hasTwoSamples ? increase(HTTP, { suffix: 'count', where: isServerError }) : null
  const window4xx = hasTwoSamples ? increase(HTTP, { suffix: 'count', where: isClientError }) : null
  const serverErrorRate = windowRequests !== null ? percentOf(window5xx, windowRequests) : null
  const clientErrorRate = windowRequests !== null ? percentOf(window4xx, windowRequests) : null

  const windowLatency = hasTwoSamples ? histogramDelta(httpFamily, httpPrev) : null
  const latencyP50 = histogramQuantile(windowLatency, 0.5)
  const latencyP95 = histogramQuantile(windowLatency, 0.95)
  const latencyP99 = histogramQuantile(windowLatency, 0.99)

  const routeCombos = distinctLabelSets(httpFamily, ['method', 'route'], { suffix: 'count' })
  const routeRows = routeCombos
    .map((combo) => {
      const where = (l) => l.method === combo.method && l.route === combo.route
      const windowed = hasTwoSamples ? histogramDelta(httpFamily, httpPrev, { where }) : null
      const lifetime = histogramSeries(httpFamily, { where })
      const errors5xx = sumSamples(httpFamily, { suffix: 'count', where: (l) => where(l) && isServerError(l) })
      return {
        id: `${combo.method} ${combo.route}`,
        route: `${combo.method} ${combo.route}`,
        rps: windowed && windowSeconds ? windowed.count / windowSeconds : 0,
        p95: histogramQuantile(windowed?.count ? windowed : lifetime, 0.95),
        windowed: Boolean(windowed?.count),
        total: lifetime?.count ?? 0,
        errors5xx,
      }
    })
    // Endpoints with traffic in the window first (what's hot right now), then
    // the rest; slowest first within each group.
    .sort((a, b) => b.windowed - a.windowed || (b.p95 ?? 0) - (a.p95 ?? 0))
  const statusCodeRows = groupByLabel(httpFamily, 'status_code', { suffix: 'count' })

  // ---------- Orders ----------
  const ordersByStatus = sumByLabel(families.get('orders_in_status'), 'status')
  const hasOrderGauge = Object.keys(ordersByStatus).length > 0
  const inFlight = hasOrderGauge ? IN_FLIGHT_STATUSES.reduce((n, s) => n + (ordersByStatus[s] ?? 0), 0) : null
  const ordersCreatedPerMin = hasTwoSamples ? rate('orders_created_total') : null
  const ordersCreatedTotal = families.has('orders_created_total') ? sumSamples(families.get('orders_created_total')) : null
  const terminalRows = ['COMPLETED', 'FAILED', 'CANCELLED']
    .map((s) => ({ key: s.charAt(0) + s.slice(1).toLowerCase(), value: ordersByStatus[s] ?? 0 }))
    .filter((r) => r.value > 0)
  const finished = (ordersByStatus.COMPLETED ?? 0) + (ordersByStatus.FAILED ?? 0)
  const successRate = hasOrderGauge ? percentOf(ordersByStatus.COMPLETED ?? 0, finished) : null

  const stageFamily = families.get('order_stage_duration_seconds')
  const stageRows = STAGES.map((stage) => {
    const series = histogramSeries(stageFamily, { where: (l) => l.stage === stage.key })
    return {
      id: stage.key,
      stage: stage.label,
      count: series?.count ?? 0,
      p50: formatSeconds(histogramQuantile(series, 0.5)),
      p95: formatSeconds(histogramQuantile(series, 0.95)),
      avg: series?.count ? formatSeconds(series.avg) : null,
    }
  })
  const fulfilmentP95 = histogramQuantile(histogramSeries(stageFamily, { where: (l) => l.stage === 'fulfilment' }), 0.95)
  const failureReasonRows = groupByLabel(families.get('order_failures_total'), 'reason')
  const paymentOutcomeRows = groupByLabel(families.get('payment_authorizations_total'), 'outcome')

  // ---------- Messaging ----------
  const CONSUMER = 'consumer_messages_total'
  const consumerFamily = families.get(CONSUMER)
  const messagesPerSec = hasTwoSamples ? rate(CONSUMER) : null
  const outcomeTotals = sumByLabel(consumerFamily, 'outcome')
  const handled = (outcomeTotals.processed ?? 0) + (outcomeTotals.skipped ?? 0)
  const attempted = handled + (outcomeTotals.failed ?? 0)
  const messageSuccessRate = percentOf(handled, attempted)
  const consumerDuration = families.get('consumer_processing_duration_seconds')
  const consumers = [...new Set((consumerFamily?.samples ?? []).map((s) => s.labels.consumer).filter(Boolean))].sort()
  const consumerRows = consumers.map((consumer) => {
    const byOutcome = sumByLabel(consumerFamily, 'outcome', { where: (l) => l.consumer === consumer })
    const p95 = histogramQuantile(histogramSeries(consumerDuration, { where: (l) => l.consumer === consumer }), 0.95)
    return {
      id: consumer,
      consumer,
      processed: byOutcome.processed ?? 0,
      skipped: byOutcome.skipped ?? 0,
      retried: byOutcome.retried ?? 0,
      failed: byOutcome.failed ?? 0,
      p95: formatMs(p95),
      tones: { failed: byOutcome.failed ? 'tone-danger' : '', retried: byOutcome.retried ? 'tone-warning' : '' },
    }
  })

  const queueDepth = sumByLabel(families.get('rabbitmq_queue_messages'), 'queue')
  const queueConsumers = sumByLabel(families.get('rabbitmq_queue_consumers'), 'queue')
  const queueNames = Object.keys(queueDepth).sort((a, b) => (a === DLQ) - (b === DLQ) || a.localeCompare(b))
  const queueRows = queueNames.map((queue) => {
    const isDlq = queue === DLQ
    const depth = queueDepth[queue]
    const attachedConsumers = queueConsumers[queue] ?? 0
    return {
      id: queue,
      queue,
      depth,
      consumers: isDlq ? '—' : attachedConsumers,
      tones: {
        depth: isDlq && depth > 0 ? 'tone-danger' : depth > 50 ? 'tone-warning' : '',
        consumers: !isDlq && attachedConsumers === 0 ? 'tone-danger' : '',
      },
    }
  })
  const hasQueueGauge = queueNames.length > 0
  const dlqDepth = hasQueueGauge ? (queueDepth[DLQ] ?? 0) : null
  const backlog = hasQueueGauge ? queueNames.filter((q) => q !== DLQ).reduce((n, q) => n + queueDepth[q], 0) : null
  const idleQueues = queueNames.filter((q) => q !== DLQ && (queueConsumers[q] ?? 0) === 0)

  const outboxPending = scalarValue(families.get('outbox_pending_messages'))
  const outboxAge = scalarValue(families.get('outbox_oldest_pending_age_seconds'))
  const outboxRelayedPerSec = hasTwoSamples ? rate('outbox_relayed_messages_total') : null

  // ---------- Cache ----------
  const CACHE = 'cache_requests_total'
  const isHit = (l) => l.result === 'hit'
  const windowCacheReads = hasTwoSamples ? increase(CACHE) : null
  const windowCacheHits = hasTwoSamples ? increase(CACHE, { where: isHit }) : null
  const cacheHitRate = windowCacheReads ? percentOf(windowCacheHits, windowCacheReads) : null
  const lifetimeCacheHitRate = percentOf(sumSamples(families.get(CACHE), { where: isHit }), sumSamples(families.get(CACHE)))
  const cacheByClass = Object.keys(sumByLabel(families.get(CACHE), 'key_class')).map((keyClass) => {
    const where = (l) => l.key_class === keyClass
    return {
      key: keyClass,
      value: percentOf(
        sumSamples(families.get(CACHE), { where: (l) => where(l) && isHit(l) }),
        sumSamples(families.get(CACHE), { where }),
      ) ?? 0,
    }
  })

  // ---------- Runtime ----------
  const cpuRate = hasTwoSamples ? rate('process_cpu_seconds_total') : null
  const cpuUserRate = hasTwoSamples ? rate('process_cpu_user_seconds_total') : null
  const cpuSystemRate = hasTwoSamples ? rate('process_cpu_system_seconds_total') : null
  const rss = scalarValue(families.get('process_resident_memory_bytes'))
  const heapUsed = scalarValue(families.get('nodejs_heap_size_used_bytes'))
  const heapTotal = scalarValue(families.get('nodejs_heap_size_total_bytes'))
  const lagP50 = scalarValue(families.get('nodejs_eventloop_lag_p50_seconds'))
  const lagP90 = scalarValue(families.get('nodejs_eventloop_lag_p90_seconds'))
  const lagP99 = scalarValue(families.get('nodejs_eventloop_lag_p99_seconds'))
  const startTime = scalarValue(families.get('process_start_time_seconds'))
  const uptimeSeconds = startTime && lastUpdated ? lastUpdated / 1000 - startTime : null

  // Append one point per poll tick to the rolling client-side history used by
  // the sparkline charts (the scrape itself only has the current values).
  useEffect(() => {
    if (!lastUpdated) return
    // Accumulating polled snapshots into a rolling buffer has no non-effect equivalent here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory((prev) => {
      if (prev.length && prev[prev.length - 1].t === lastUpdated) return prev
      const point = {
        t: lastUpdated,
        cpu: cpuRate !== null ? cpuRate * 100 : null,
        rss,
        heapUsed,
        lag: lagP99 !== null ? lagP99 * 1000 : null,
        rps: requestsPerSec,
        p95Ms: latencyP95 !== null ? latencyP95 * 1000 : null,
        msgRate: messagesPerSec,
        inFlight,
        backlog: outboxPending !== null || backlog !== null ? (outboxPending ?? 0) + (backlog ?? 0) : null,
        hitRate: cacheHitRate,
      }
      const next = [...prev, point]
      return next.length > HISTORY_LENGTH ? next.slice(next.length - HISTORY_LENGTH) : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastUpdated])

  if (loading) return <CenterLoading />

  if (error && families.size === 0) {
    return (
      <div>
        <div className="page-header">
          <h1>Metrics</h1>
        </div>
        <div className="banner error">Could not reach the backend's /metrics endpoint: {error}</div>
      </div>
    )
  }

  const pipelineAlerts = [
    dlqDepth > 0 && `${dlqDepth} message${dlqDepth === 1 ? '' : 's'} in the dead-letter queue`,
    idleQueues.length > 0 && `no consumer on ${idleQueues.join(', ')}`,
    outboxAge > 10 && `oldest unpublished outbox event is ${formatSeconds(outboxAge)} old`,
    serverErrorRate > 1 && `${formatPercent(serverErrorRate)} of requests are failing with 5xx`,
  ].filter(Boolean)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Metrics</h1>
          <p className="subtitle">
            Live view of <code>GET /metrics</code> — the backend's Prometheus scrape endpoint. Rates and latency
            percentiles cover a rolling 30s window; totals are since the process started unless noted.
          </p>
        </div>
        <div className="user-chip">
          {!error && <span className="live-dot" />}
          <span>{error ? `error: ${error}` : lastUpdated ? `updated ${new Date(lastUpdated).toLocaleTimeString()}` : '—'}</span>
        </div>
      </div>

      {!hasTwoSamples && <div className="banner info">Collecting a second sample to compute rates and windowed latency…</div>}

      <div className="metrics-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`metrics-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          {hasTwoSamples && (
            <div className={`banner ${pipelineAlerts.length ? 'error' : 'success'}`} style={{ marginBottom: 14 }}>
              {pipelineAlerts.length ? `Needs attention: ${pipelineAlerts.join(' · ')}` : 'Pipeline healthy — no dead letters, every queue has a consumer, outbox draining.'}
            </div>
          )}
          <div className="section-heading">
            <h2>Traffic</h2>
            <span className="rule" />
          </div>
          <div className="grid">
            <MetricCard
              label="Requests/sec"
              value={formatRate(requestsPerSec, 'req/s')}
              sub={windowLabel}
              emptyText={hasTwoSamples ? emptyTextFor(families, HTTP) : 'collecting…'}
              chart={<TrendChart data={history} dataKey="rps" color="var(--accent)" formatValue={(v) => `${v.toFixed(2)} req/s`} />}
            />
            <MetricCard
              label="Latency p95"
              value={latencyP95 !== null ? formatMs(latencyP95) : null}
              sub={latencyP50 !== null ? `p50 ${formatMs(latencyP50)} · p99 ${formatMs(latencyP99)}` : undefined}
              emptyText={hasTwoSamples ? 'no requests in window' : 'collecting…'}
              chart={<TrendChart data={history} dataKey="p95Ms" color="var(--pending)" formatValue={(v) => `${v.toFixed(1)} ms`} />}
            />
            <MetricCard
              label="Server errors (5xx)"
              value={formatPercent(serverErrorRate, 2)}
              sub={windowRequests ? `${Math.round(window5xx)} of ${Math.round(windowRequests)} · 4xx ${formatPercent(clientErrorRate)}` : undefined}
              tone={serverErrorRate > 1 ? 'danger' : undefined}
              emptyText={hasTwoSamples ? 'no requests in window' : 'collecting…'}
            />
            <MetricCard
              label="Cache hit rate"
              value={formatPercent(cacheHitRate)}
              sub={lifetimeCacheHitRate !== null ? `${formatPercent(lifetimeCacheHitRate)} since start` : undefined}
              emptyText={lifetimeCacheHitRate !== null ? `no reads in window · ${formatPercent(lifetimeCacheHitRate)} since start` : emptyTextFor(families, CACHE)}
              chart={<TrendChart data={history} dataKey="hitRate" color="var(--success)" formatValue={(v) => `${v.toFixed(1)}%`} />}
            />
          </div>
          <div className="section-heading">
            <h2>Orders &amp; pipeline</h2>
            <span className="rule" />
          </div>
          <div className="grid">
            <MetricCard
              label="Orders in flight"
              value={inFlight}
              sub={hasOrderGauge ? IN_FLIGHT_STATUSES.map((s) => `${s.toLowerCase()} ${ordersByStatus[s] ?? 0}`).join(' · ') : undefined}
              emptyText={emptyTextFor(families, 'orders_in_status')}
              chart={<TrendChart data={history} dataKey="inFlight" color="var(--warning)" formatValue={(v) => `${v} orders`} />}
            />
            <MetricCard
              label="Orders/min"
              value={ordersCreatedPerMin !== null ? (ordersCreatedPerMin * 60).toFixed(1) : null}
              sub={ordersCreatedTotal !== null ? `${ordersCreatedTotal} created since start` : undefined}
              emptyText={hasTwoSamples ? emptyTextFor(families, 'orders_created_total') : 'collecting…'}
            />
            <MetricCard
              label="Pay → completed p95"
              value={formatSeconds(fulfilmentP95)}
              sub="async latency after the user pays"
              emptyText={emptyTextFor(families, 'order_stage_duration_seconds')}
            />
            <MetricCard
              label="Order success rate"
              value={formatPercent(successRate)}
              sub={hasOrderGauge ? `${ordersByStatus.COMPLETED ?? 0} completed · ${ordersByStatus.FAILED ?? 0} failed (all time)` : undefined}
              tone={successRate !== null && successRate < 95 ? 'warning' : undefined}
              emptyText={hasOrderGauge ? 'no finished orders yet' : emptyTextFor(families, 'orders_in_status')}
            />
            <MetricCard
              label="Dead-letter queue"
              value={dlqDepth}
              sub={dlqDepth ? 'poison messages awaiting inspection' : 'empty'}
              tone={dlqDepth > 0 ? 'danger' : undefined}
              emptyText="broker not reachable"
            />
            <MetricCard
              label="Unpublished events"
              value={outboxPending !== null ? outboxPending + (backlog ?? 0) : null}
              sub={outboxPending !== null ? `outbox ${outboxPending} · queued ${backlog ?? '—'} · oldest ${formatSeconds(outboxAge) ?? '—'}` : undefined}
              tone={outboxAge > 10 ? 'warning' : undefined}
              emptyText={emptyTextFor(families, 'outbox_pending_messages')}
              chart={<TrendChart data={history} dataKey="backlog" color="var(--accent)" formatValue={(v) => `${v} events`} />}
            />
          </div>
        </>
      )}

      {tab === 'api' && (
        <>
          <div className="grid">
            <MetricCard
              label="Requests/sec"
              value={formatRate(requestsPerSec, 'req/s')}
              sub={windowLabel}
              emptyText={hasTwoSamples ? emptyTextFor(families, HTTP) : 'collecting…'}
              chart={<TrendChart data={history} dataKey="rps" color="var(--accent)" formatValue={(v) => `${v.toFixed(2)} req/s`} />}
            />
            <MetricCard
              label="Latency"
              value={latencyP95 !== null ? `${formatMs(latencyP95)} p95` : null}
              sub={latencyP50 !== null ? `p50 ${formatMs(latencyP50)} · p99 ${formatMs(latencyP99)} · ${windowLabel}` : undefined}
              emptyText={hasTwoSamples ? 'no requests in window' : 'collecting…'}
              chart={<TrendChart data={history} dataKey="p95Ms" color="var(--pending)" formatValue={(v) => `${v.toFixed(1)} ms`} />}
            />
            <MetricCard
              label="Server errors (5xx)"
              value={formatPercent(serverErrorRate, 2)}
              sub={windowRequests ? `${Math.round(window5xx)} of ${Math.round(windowRequests)} in ${windowLabel.replace('last ', '')}` : undefined}
              tone={serverErrorRate > 1 ? 'danger' : undefined}
              emptyText={hasTwoSamples ? 'no requests in window' : 'collecting…'}
            />
            <MetricCard
              label="Client errors (4xx)"
              value={formatPercent(clientErrorRate)}
              sub="expected: auth failures, 404s, 409 conflicts"
              emptyText={hasTwoSamples ? 'no requests in window' : 'collecting…'}
            />
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-title">
              Endpoints by p95 latency
              <span className="not-exposed">p95 over {windowLabel.replace('last ', 'the last ')}; * = no traffic in window, since-start value</span>
            </div>
            <StatTable
              columns={[
                { key: 'route', label: 'Endpoint' },
                { key: 'rpsText', label: 'req/s', numeric: true },
                { key: 'p95Text', label: 'p95', numeric: true },
                { key: 'total', label: 'Total', numeric: true },
                { key: 'errors5xx', label: '5xx', numeric: true },
              ]}
              rows={routeRows.map((r) => ({
                ...r,
                rpsText: r.rps ? r.rps.toFixed(2) : '0',
                p95Text: r.p95 !== null ? `${formatMs(r.p95)}${r.windowed ? '' : '*'}` : '—',
                tones: { errors5xx: r.errors5xx ? 'tone-danger' : '' },
              }))}
              emptyText={emptyTextFor(families, HTTP)}
            />
          </div>
          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <div className="card">
              <div className="card-title">
                Status codes <span className="not-exposed">since start</span>
              </div>
              <BarList rows={statusCodeRows} emptyText={emptyTextFor(families, HTTP)} />
            </div>
            <div className="card">
              <div className="card-title">
                Latency, hourly avg
                <span className="not-exposed">durable, survives restarts</span>
              </div>
              {isAuthenticated ? (
                <TrendChart
                  data={latencyHistory.points.map((p) => ({ value: p.avg }))}
                  dataKey="value"
                  color="var(--pending)"
                  formatValue={(v) => `${v.toFixed(1)} ms`}
                  height={120}
                  emptyText={latencyHistory.loading ? 'loading…' : latencyHistory.error ? 'failed to load' : 'no requests recorded yet'}
                />
              ) : (
                <DurableHistoryLoginPrompt />
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'orders' && (
        <>
          <div className="grid">
            <MetricCard
              label="Created"
              value={ordersCreatedTotal}
              sub={ordersCreatedPerMin !== null ? `${(ordersCreatedPerMin * 60).toFixed(1)}/min over ${windowLabel.replace('last ', '')}` : 'since start'}
              emptyText={emptyTextFor(families, 'orders_created_total')}
            />
            <MetricCard
              label="In flight"
              value={inFlight}
              sub="pending + reserved + paid, right now"
              emptyText={emptyTextFor(families, 'orders_in_status')}
              chart={<TrendChart data={history} dataKey="inFlight" color="var(--warning)" formatValue={(v) => `${v} orders`} />}
            />
            <MetricCard
              label="Success rate"
              value={formatPercent(successRate)}
              sub="completed ÷ (completed + failed), all time"
              emptyText={hasOrderGauge ? 'no finished orders yet' : emptyTextFor(families, 'orders_in_status')}
            />
            <MetricCard
              label="Pay → completed p95"
              value={formatSeconds(fulfilmentP95)}
              sub="since start"
              emptyText={emptyTextFor(families, 'order_stage_duration_seconds')}
            />
          </div>
          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <div className="card">
              <div className="card-title">
                Orders by status <span className="not-exposed">live, from the database</span>
              </div>
              <BarList
                rows={Object.entries(ordersByStatus).map(([key, value]) => ({ key, value }))}
                emptyText={emptyTextFor(families, 'orders_in_status')}
              />
            </div>
            <div className="card">
              <div className="card-title">
                Outcomes <span className="not-exposed">all time</span>
              </div>
              <DonutChart rows={terminalRows} emptyText={hasOrderGauge ? 'no finished orders yet' : emptyTextFor(families, 'orders_in_status')} />
            </div>
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-title">
              Where the time goes <span className="not-exposed">per pipeline stage, since start</span>
            </div>
            <StatTable
              columns={[
                { key: 'stage', label: 'Stage' },
                { key: 'count', label: 'Orders', numeric: true },
                { key: 'p50', label: 'p50', numeric: true },
                { key: 'p95', label: 'p95', numeric: true },
                { key: 'avg', label: 'avg', numeric: true },
              ]}
              rows={stageRows}
              emptyText={emptyTextFor(families, 'order_stage_duration_seconds')}
            />
            <p className="not-exposed" style={{ marginTop: 10 }}>
              Reservation includes the outbox relay's 1s poll. The time between RESERVED and the user clicking Pay is
              their think-time, so it's deliberately not counted.
            </p>
          </div>
          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <div className="card">
              <div className="card-title">
                Failure reasons <span className="not-exposed">since start</span>
              </div>
              <BarList rows={failureReasonRows} emptyText={families.has('order_failures_total') ? 'no failures' : 'not exposed by backend'} />
            </div>
            <div className="card">
              <div className="card-title">
                Payment authorizations <span className="not-exposed">since start</span>
              </div>
              <BarList rows={paymentOutcomeRows} emptyText={emptyTextFor(families, 'payment_authorizations_total')} />
              <p className="not-exposed" style={{ marginTop: 10 }}>
                <strong>deduplicated</strong> = a redelivery reused the stored decision instead of charging again;{' '}
                <strong>in_flight</strong> = backed off while another delivery held the charge.
              </p>
            </div>
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-title">
              Daily — created vs finished
              <span className="not-exposed">durable, survives restarts</span>
            </div>
            {isAuthenticated ? (
              <div className="grid cols-2">
                <TrendChart
                  data={createdHistory.points.map((p) => ({ value: p.sum }))}
                  dataKey="value"
                  color="var(--accent)"
                  formatValue={(v) => `${v} created`}
                  height={120}
                  emptyText={createdHistory.loading ? 'loading…' : createdHistory.error ? 'failed to load' : 'no orders recorded yet'}
                />
                <TrendChart
                  data={ordersHistory.points.map((p) => ({ value: p.sum }))}
                  dataKey="value"
                  color="var(--success)"
                  formatValue={(v) => `${v} finished`}
                  height={120}
                  emptyText={ordersHistory.loading ? 'loading…' : ordersHistory.error ? 'failed to load' : 'no orders recorded yet'}
                />
              </div>
            ) : (
              <DurableHistoryLoginPrompt />
            )}
          </div>
        </>
      )}

      {tab === 'messaging' && (
        <>
          <div className="grid">
            <MetricCard
              label="Messages/sec"
              value={formatRate(messagesPerSec, 'msg/s')}
              sub={windowLabel}
              emptyText={hasTwoSamples ? emptyTextFor(families, CONSUMER) : 'collecting…'}
              chart={<TrendChart data={history} dataKey="msgRate" color="var(--accent)" formatValue={(v) => `${v.toFixed(2)} msg/s`} />}
            />
            <MetricCard
              label="Handled successfully"
              value={formatPercent(messageSuccessRate)}
              sub={attempted ? `${handled} of ${attempted} · ${outcomeTotals.skipped ?? 0} duplicates skipped` : undefined}
              tone={messageSuccessRate !== null && messageSuccessRate < 99 ? 'warning' : undefined}
              emptyText={emptyTextFor(families, CONSUMER)}
            />
            <MetricCard
              label="Retries"
              value={outcomeTotals.retried ?? (consumerFamily ? 0 : null)}
              sub="backoff 1s → 2s → 4s before dead-lettering"
              tone={outcomeTotals.retried ? 'warning' : undefined}
              emptyText={emptyTextFor(families, CONSUMER)}
            />
            <MetricCard
              label="Dead-lettered"
              value={outcomeTotals.failed ?? (consumerFamily ? 0 : null)}
              sub={dlqDepth !== null ? `${dlqDepth} currently in the DLQ` : undefined}
              tone={outcomeTotals.failed ? 'danger' : undefined}
              emptyText={emptyTextFor(families, CONSUMER)}
            />
            <MetricCard
              label="Outbox backlog"
              value={outboxPending}
              sub={outboxRelayedPerSec !== null ? `oldest ${formatSeconds(outboxAge)} · relaying ${outboxRelayedPerSec.toFixed(2)}/s` : undefined}
              tone={outboxAge > 10 ? 'warning' : undefined}
              emptyText={emptyTextFor(families, 'outbox_pending_messages')}
              chart={<TrendChart data={history} dataKey="backlog" color="var(--accent)" formatValue={(v) => `${v} events`} />}
            />
          </div>
          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <div className="card">
              <div className="card-title">
                Consumers <span className="not-exposed">since start</span>
              </div>
              <StatTable
                columns={[
                  { key: 'consumer', label: 'Consumer' },
                  { key: 'processed', label: 'Processed', numeric: true },
                  { key: 'skipped', label: 'Dupes', numeric: true },
                  { key: 'retried', label: 'Retried', numeric: true },
                  { key: 'failed', label: 'DLQ', numeric: true },
                  { key: 'p95', label: 'p95', numeric: true },
                ]}
                rows={consumerRows}
                emptyText={emptyTextFor(families, CONSUMER)}
              />
            </div>
            <div className="card">
              <div className="card-title">
                Queues <span className="not-exposed">live, from the broker</span>
              </div>
              <StatTable
                columns={[
                  { key: 'queue', label: 'Queue' },
                  { key: 'depth', label: 'Ready', numeric: true },
                  { key: 'consumers', label: 'Consumers', numeric: true },
                ]}
                rows={queueRows}
                emptyText={families.has('rabbitmq_queue_messages') ? 'broker not reachable' : 'not exposed by backend'}
              />
            </div>
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-title">
              Cache hit rate by key class <span className="not-exposed">since start</span>
            </div>
            <BarList rows={cacheByClass} formatValue={(v) => `${v.toFixed(1)}%`} emptyText={emptyTextFor(families, CACHE)} />
            <p className="not-exposed" style={{ marginTop: 10 }}>
              Only orders that have reached a terminal state are cached, so polling an in-flight order always misses
              by design.
            </p>
          </div>
        </>
      )}

      {tab === 'runtime' && (
        <div className="grid">
          <MetricCard
            label="CPU"
            value={formatPercent(cpuRate !== null ? cpuRate * 100 : null)}
            sub={cpuUserRate !== null ? `user ${formatPercent(cpuUserRate * 100)} · sys ${formatPercent(cpuSystemRate * 100)}` : undefined}
            emptyText={hasTwoSamples ? 'not exposed by backend' : 'collecting…'}
            chart={<TrendChart data={history} dataKey="cpu" color="var(--accent)" formatValue={(v) => `${v.toFixed(1)}%`} />}
          />
          <MetricCard
            label="Memory (RSS)"
            value={rss !== null ? formatBytes(rss) : null}
            chart={<TrendChart data={history} dataKey="rss" color="var(--warning)" formatValue={formatBytes} />}
          />
          <MetricCard
            label="Heap"
            value={heapUsed !== null && heapTotal !== null ? formatBytes(heapUsed) : null}
            sub={heapUsed !== null && heapTotal !== null ? `of ${formatBytes(heapTotal)} (${((heapUsed / heapTotal) * 100).toFixed(0)}%)` : undefined}
            chart={<TrendChart data={history} dataKey="heapUsed" color="var(--success)" formatValue={formatBytes} />}
          />
          <MetricCard
            label="Event loop lag p99"
            value={lagP99 !== null ? formatMs(lagP99) : null}
            sub={lagP50 !== null ? `p50 ${formatMs(lagP50)} · p90 ${formatMs(lagP90)}` : undefined}
            tone={lagP99 > 0.1 ? 'warning' : undefined}
            chart={<TrendChart data={history} dataKey="lag" color="var(--danger)" formatValue={(v) => `${v.toFixed(1)} ms`} />}
          />
          <MetricCard label="Uptime" value={uptimeSeconds !== null ? formatDuration(uptimeSeconds) : null} />
        </div>
      )}

      {tab === 'correlation' && (
        <>
          <div className="page-header" style={{ marginBottom: 14, alignItems: 'flex-end' }}>
            <p className="subtitle" style={{ maxWidth: 560 }}>
              Overlays request volume, latency, event loop lag and CPU on one timeline so spikes can be visually
              correlated. Backed by <code>/metrics/history</code> — durable, survives restarts.
            </p>
            <select
              className="select-small"
              value={correlationResolution}
              onChange={(e) => setCorrelationResolution(e.target.value)}
              aria-label="Bucket resolution"
            >
              {CORRELATION_RESOLUTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {!isAuthenticated ? (
            <DurableHistoryLoginPrompt />
          ) : (
            <>
              <div className="card">
                <div className="card-title">
                  Traffic, latency, lag &amp; CPU
                  <span className="not-exposed">{correlationLoading ? 'loading…' : correlationError ? 'failed to load' : `${correlationRows.length} buckets`}</span>
                </div>
                <CorrelationChart data={correlationRows} />
              </div>
              <div className="card" style={{ marginTop: 14 }}>
                <div className="card-title">Heap used (avg)</div>
                <TrendChart
                  data={correlationRows}
                  dataKey="heapBytes"
                  color="var(--success)"
                  formatValue={formatBytes}
                  height={100}
                  connectNulls={false}
                  emptyText={correlationLoading ? 'loading…' : correlationError ? 'failed to load' : 'no data yet'}
                />
              </div>
              <p className="not-exposed" style={{ marginTop: 10 }}>
                Quiet buckets (zero requests) are real data, shown as 0 on the traffic bars. Gaps in the lag / CPU /
                heap lines mean the server was down for that bucket — they're breaks, not interpolated.
              </p>
            </>
          )}
        </>
      )}

      <details className="raw-explorer" style={{ marginTop: 40 }}>
        <summary>Raw /metrics explorer ({families.size} metric families)</summary>
        <pre className="mono">{rawText}</pre>
      </details>
    </div>
  )
}
