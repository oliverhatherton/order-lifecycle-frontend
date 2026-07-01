import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  distinctLabelSets,
  formatBytes,
  formatDuration,
  groupByLabel,
  histogramQuantile,
  histogramSeries,
  primaryLabelKey,
  scalarValue,
  sumSamples,
} from '../lib/prometheus.js'
import { useMetricsPoller } from '../lib/useMetricsPoller.js'
import { useMetricHistory } from '../lib/useMetricHistory.js'
import { useAuth } from '../lib/useAuth.js'
import { MetricCard } from '../components/MetricCard.jsx'
import { BarList } from '../components/BarList.jsx'
import { TrendChart } from '../components/TrendChart.jsx'
import { DonutChart } from '../components/DonutChart.jsx'
import { CenterLoading } from '../components/CenterLoading.jsx'

const REFRESH_MS = 5000
const HISTORY_LENGTH = 40 // ~3.3 min of context at the default 5s poll interval

const TABS = [
  { key: 'system', label: 'System Overview' },
  { key: 'api', label: 'API' },
  { key: 'orders', label: 'Order Processing' },
  { key: 'messaging', label: 'Messaging' },
]

function formatPercent(n, digits = 1) {
  return n === null || n === undefined ? null : `${n.toFixed(digits)}%`
}

function formatRate(n, unit) {
  if (n === null || n === undefined) return null
  return `${n < 10 ? n.toFixed(2) : n.toFixed(1)} ${unit}`
}

function formatMs(seconds) {
  if (seconds === null || seconds === undefined) return null
  return `${(seconds * 1000).toFixed(1)} ms`
}

/** Distinguishes "backend never declared this metric" from "declared but no samples emitted yet". */
function emptyTextFor(families, name) {
  return families.has(name) ? 'no data yet' : 'not exposed by backend'
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

export function Metrics() {
  const { families, rawText, hasTwoSamples, lastUpdated, rate, loading, error } = useMetricsPoller(REFRESH_MS)
  const [history, setHistory] = useState([])
  const [tab, setTab] = useState('system')
  const { isAuthenticated } = useAuth()
  const ordersHistory = useMetricHistory('orders_terminal', '1d', { enabled: isAuthenticated })
  const latencyHistory = useMetricHistory('http_request_duration_ms', '1h', { enabled: isAuthenticated })

  // ---------- System Overview ----------
  const cpuRate = hasTwoSamples ? rate('process_cpu_seconds_total') : null
  const cpuUserRate = hasTwoSamples ? rate('process_cpu_user_seconds_total') : null
  const cpuSystemRate = hasTwoSamples ? rate('process_cpu_system_seconds_total') : null

  const rss = scalarValue(families.get('process_resident_memory_bytes'))
  const virtualMem = scalarValue(families.get('process_virtual_memory_bytes'))

  const heapUsed = scalarValue(families.get('nodejs_heap_size_used_bytes'))
  const heapTotal = scalarValue(families.get('nodejs_heap_size_total_bytes'))

  const eventLoopLag = scalarValue(families.get('nodejs_eventloop_lag_seconds'))
  const lagP50 = scalarValue(families.get('nodejs_eventloop_lag_p50_seconds'))
  const lagP90 = scalarValue(families.get('nodejs_eventloop_lag_p90_seconds'))
  const lagP99 = scalarValue(families.get('nodejs_eventloop_lag_p99_seconds'))

  const startTime = scalarValue(families.get('process_start_time_seconds'))
  const uptimeSeconds = startTime && lastUpdated ? lastUpdated / 1000 - startTime : null

  // ---------- API ----------
  const httpFamily = families.get('http_request_duration_seconds')
  const requestsPerSec = hasTwoSamples ? rate('http_request_duration_seconds', { suffix: 'count' }) : null
  const overallLatency = histogramSeries(httpFamily)
  const p95Latency = overallLatency ? histogramQuantile(overallLatency, 0.95) : null

  const totalRequests = sumSamples(httpFamily, { suffix: 'count' })
  const errorRequests = sumSamples(httpFamily, { suffix: 'count', where: (l) => /^[45]/.test(l.status_code ?? '') })
  const errorRate = totalRequests > 0 ? (errorRequests / totalRequests) * 100 : null

  const statusCodeRows = groupByLabel(httpFamily, 'status_code', { suffix: 'count' })

  const routeCombos = distinctLabelSets(httpFamily, ['method', 'route'], { suffix: 'count' })
  const slowEndpoints = routeCombos
    .map((combo) => {
      const series = histogramSeries(httpFamily, {
        where: (l) => l.method === combo.method && l.route === combo.route,
      })
      return { key: `${combo.method} ${combo.route}`, value: series?.avg ?? 0 }
    })
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)

  // ---------- Order Processing ----------
  const ordersFamily = families.get('orders_terminal_total')
  const orderStateKey = primaryLabelKey(ordersFamily)
  const completedOrders = orderStateKey
    ? sumSamples(ordersFamily, { where: (l) => /complet/i.test(l[orderStateKey] ?? '') })
    : null
  const failedOrders = orderStateKey
    ? sumSamples(ordersFamily, { where: (l) => /fail/i.test(l[orderStateKey] ?? '') })
    : null
  const stateDistribution = orderStateKey ? groupByLabel(ordersFamily, orderStateKey) : []

  // ---------- Messaging ----------
  const consumerFamily = families.get('consumer_messages_total')
  const messagesPerSec = hasTwoSamples ? rate('consumer_messages_total') : null
  const outcomeKey = primaryLabelKey(consumerFamily)
  const outcomeRows = outcomeKey ? groupByLabel(consumerFamily, outcomeKey) : []
  const totalMessages = sumSamples(consumerFamily)
  const successMessages = outcomeKey
    ? sumSamples(consumerFamily, { where: (l) => /success|ok|ack/i.test(l[outcomeKey] ?? '') })
    : null
  const successRate = outcomeKey && totalMessages > 0 ? (successMessages / totalMessages) * 100 : null
  const retryMessages = outcomeKey
    ? sumSamples(consumerFamily, { where: (l) => /retry/i.test(l[outcomeKey] ?? '') })
    : null
  const failedMessages = outcomeKey
    ? sumSamples(consumerFamily, { where: (l) => /fail|error|nack|reject/i.test(l[outcomeKey] ?? '') })
    : null

  // Append one point per poll tick to the rolling client-side history used by
  // the trend charts below (the backend only exposes the current scrape).
  useEffect(() => {
    if (!lastUpdated) return
    // Accumulating polled snapshots into a rolling buffer has no non-effect equivalent here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory((prev) => {
      if (prev.length && prev[prev.length - 1].t === lastUpdated) return prev
      const point = {
        t: lastUpdated,
        label: new Date(lastUpdated).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' }),
        cpu: cpuRate !== null ? cpuRate * 100 : null,
        rss,
        heapUsed,
        lag: eventLoopLag !== null ? eventLoopLag * 1000 : null,
        rps: requestsPerSec,
        latencyMs: overallLatency ? overallLatency.avg * 1000 : null,
        msgRate: messagesPerSec,
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Metrics</h1>
          <p className="subtitle">
            Live view of <code>GET /metrics</code> — the backend's Prometheus scrape endpoint. Public, no login
            required.
          </p>
        </div>
        <div className="user-chip">
          {!error && <span className="live-dot" />}
          <span>{error ? `error: ${error}` : lastUpdated ? `updated ${new Date(lastUpdated).toLocaleTimeString()}` : '—'}</span>
        </div>
      </div>

      {!hasTwoSamples && (
        <div className="banner info">Collecting a second sample to compute rates (requests/sec, CPU %, messages/sec)…</div>
      )}

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

      {tab === 'system' && (
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
            sub={virtualMem !== null ? `${formatBytes(virtualMem)} virtual` : undefined}
            chart={<TrendChart data={history} dataKey="rss" color="var(--warning)" formatValue={formatBytes} />}
          />
          <MetricCard
            label="Heap"
            value={heapUsed !== null && heapTotal !== null ? formatBytes(heapUsed) : null}
            sub={heapUsed !== null && heapTotal !== null ? `of ${formatBytes(heapTotal)} (${((heapUsed / heapTotal) * 100).toFixed(0)}%)` : undefined}
            chart={<TrendChart data={history} dataKey="heapUsed" color="var(--success)" formatValue={formatBytes} />}
          />
          <MetricCard
            label="Event loop lag"
            value={eventLoopLag !== null ? formatMs(eventLoopLag) : null}
            sub={lagP99 !== null ? `p50 ${formatMs(lagP50)} · p90 ${formatMs(lagP90)} · p99 ${formatMs(lagP99)}` : undefined}
            chart={<TrendChart data={history} dataKey="lag" color="var(--danger)" formatValue={(v) => `${v.toFixed(1)} ms`} />}
          />
          <MetricCard label="Uptime" value={uptimeSeconds !== null ? formatDuration(uptimeSeconds) : null} />
        </div>
      )}

      {tab === 'api' && (
        <>
          <div className="grid">
            <MetricCard
              label="Requests/sec"
              value={formatRate(requestsPerSec, 'req/s')}
              emptyText={hasTwoSamples ? emptyTextFor(families, 'http_request_duration_seconds') : 'collecting…'}
              chart={<TrendChart data={history} dataKey="rps" color="var(--accent)" formatValue={(v) => `${v.toFixed(2)} req/s`} />}
            />
            <MetricCard
              label="Latency"
              value={overallLatency ? `${(overallLatency.avg * 1000).toFixed(1)} ms avg` : null}
              sub={p95Latency !== null ? `p95 ${formatMs(p95Latency)}` : undefined}
              chart={<TrendChart data={history} dataKey="latencyMs" color="var(--pending)" formatValue={(v) => `${v.toFixed(1)} ms`} />}
            />
            <MetricCard label="Error rate" value={formatPercent(errorRate)} sub={totalRequests > 0 ? `${errorRequests} / ${totalRequests} requests` : undefined} />
          </div>
          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <div className="card">
              <div className="card-title">Status codes</div>
              <BarList rows={statusCodeRows} emptyText={emptyTextFor(families, 'http_request_duration_seconds')} />
            </div>
            <div className="card">
              <div className="card-title">Slowest endpoints (avg)</div>
              <BarList rows={slowEndpoints} formatValue={(v) => `${(v * 1000).toFixed(0)} ms`} emptyText={emptyTextFor(families, 'http_request_duration_seconds')} />
            </div>
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-title">
              Latency, hourly — full history
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
        </>
      )}

      {tab === 'orders' && (
        <>
          <div className="grid">
            <MetricCard label="Orders created" value={null} emptyText="not exposed by backend" />
            <MetricCard label="Orders completed" value={completedOrders} emptyText={emptyTextFor(families, 'orders_terminal_total')} />
            <MetricCard label="Orders failed" value={failedOrders} emptyText={emptyTextFor(families, 'orders_terminal_total')} />
            <MetricCard label="Processing duration" value={null} emptyText="not exposed by backend" />
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-title">Current state distribution</div>
            <DonutChart rows={stateDistribution} emptyText={emptyTextFor(families, 'orders_terminal_total')} />
            <p className="not-exposed" style={{ marginTop: 10 }}>
              Only terminal states (COMPLETED / FAILED) are exposed via <code>orders_terminal_total</code>; live
              PENDING / RESERVED / PAID / CANCELLED counts aren't published as a metric.
            </p>
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-title">
              Orders completed/failed, daily — full history
              <span className="not-exposed">durable, survives restarts</span>
            </div>
            {isAuthenticated ? (
              <TrendChart
                data={ordersHistory.points.map((p) => ({ value: p.sum }))}
                dataKey="value"
                color="var(--success)"
                formatValue={(v) => `${v} order${v === 1 ? '' : 's'}`}
                height={120}
                emptyText={ordersHistory.loading ? 'loading…' : ordersHistory.error ? 'failed to load' : 'no orders recorded yet'}
              />
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
              emptyText={hasTwoSamples ? emptyTextFor(families, 'consumer_messages_total') : 'collecting…'}
              chart={<TrendChart data={history} dataKey="msgRate" color="var(--accent)" formatValue={(v) => `${v.toFixed(2)} msg/s`} />}
            />
            <MetricCard label="Consumer success rate" value={formatPercent(successRate)} emptyText={emptyTextFor(families, 'consumer_messages_total')} />
            <MetricCard label="Retry count" value={retryMessages} emptyText={emptyTextFor(families, 'consumer_messages_total')} />
            <MetricCard label="Failed messages" value={failedMessages} emptyText={emptyTextFor(families, 'consumer_messages_total')} />
            <MetricCard label="Queue depth" value={null} emptyText="not exposed (requires RabbitMQ management API)" />
            <MetricCard label="DLQ" value={null} emptyText="not exposed (requires RabbitMQ management API)" />
          </div>
          {outcomeRows.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="card-title">Messages by outcome</div>
              <DonutChart rows={outcomeRows} />
            </div>
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
