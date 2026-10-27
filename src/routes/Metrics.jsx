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
import { KpiStrip } from '../components/KpiStrip.jsx'
import { BarList } from '../components/BarList.jsx'
import { TrendChart } from '../components/TrendChart.jsx'
import { DonutChart } from '../components/DonutChart.jsx'
import { CorrelationChart } from '../components/CorrelationChart.jsx'
import { CenterLoading } from '../components/CenterLoading.jsx'
import { EmptyState, PageHeader, Panel } from '../components/Panel.jsx'
import { StatusBadge } from '../components/StatusBadge.jsx'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatLatency, latencyParts, stageRange } from '@/lib/format'

const REFRESH_MS = 5000
const HISTORY_LENGTH = 36 // 3 minutes at the 5s poll

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'api', label: 'API' },
  { key: 'orders', label: 'Orders' },
  { key: 'messaging', label: 'Messaging' },
  { key: 'runtime', label: 'Runtime' },
  { key: 'correlation', label: 'Correlation' },
]

const CORRELATION_RESOLUTIONS = [
  { value: '1m', label: '1 min · 8 h' },
  { value: '5m', label: '5 min · 41 h' },
  { value: '15m', label: '15 min · 5 days' },
  { value: '1h', label: '1 h · 3 weeks' },
]

const IN_FLIGHT_STATUSES = ['PENDING', 'RESERVED', 'PAID']
const STAGES = [
  { key: 'reservation', label: 'Reservation', detail: 'created → reserved' },
  { key: 'payment', label: 'Payment', detail: 'Pay → paid' },
  { key: 'completion', label: 'Completion', detail: 'paid → completed' },
  { key: 'fulfilment', label: 'Fulfilment', detail: 'Pay → completed' },
]
const DLQ = 'order_lifecycle.dlq'
const QUEUE_HOPS = [
  { queue: 'inventory.order_created', label: 'to inventory' },
  { queue: 'payment.inventory_reserved', label: 'to payment' },
  { queue: 'completion.payment_processed', label: 'to completion' },
  { queue: 'email.notifications', label: 'to email' },
]

function formatPercent(n, digits = 1) {
  return n === null || n === undefined || !Number.isFinite(n) ? null : n.toFixed(digits)
}

function formatRate(n) {
  if (n === null || n === undefined) return null
  return n < 10 ? n.toFixed(2) : n.toFixed(1)
}

/** Distinguishes "backend never declared this metric" from "declared but no samples emitted yet". */
function emptyTextFor(families, name) {
  return families.has(name) ? 'No data yet' : 'Not exported by this backend'
}

/** Ratio as a percentage, or null when the denominator is 0 (no traffic ≠ 0% / 100%). */
function percentOf(part, whole) {
  return whole > 0 ? (part / whole) * 100 : null
}

function DurableHistoryLoginPrompt() {
  return (
    <EmptyState>
      <Link to="/login" className="text-foreground hover:underline">
        Log in
      </Link>{' '}
      to see history
    </EmptyState>
  )
}

/** Small key/value table — per-consumer, per-endpoint and per-queue breakdowns. */
function StatTable({ columns, rows, emptyText }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>
  return (
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((c, i) => (
            <TableHead
              key={c.key}
              className={cn('h-8 text-xs font-normal text-muted-foreground', c.numeric && 'text-right', i === 0 && 'pl-0', i === columns.length - 1 && 'pr-0')}
            >
              {c.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className="border-border/60">
            {columns.map((c, i) => (
              <TableCell
                key={c.key}
                className={cn(
                  'h-9 max-w-72 truncate py-1 tabular',
                  c.numeric && 'text-right',
                  c.mono && 'font-mono text-xs',
                  i === 0 && 'pl-0',
                  i === columns.length - 1 && 'pr-0',
                  row.tones?.[c.key] === 'warning' && 'font-semibold text-warning',
                  row.tones?.[c.key] === 'danger' && 'font-semibold text-negative',
                )}
              >
                {row[c.key] ?? '—'}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** One series at a time over the last few minutes, switched by a segmented control. */
function LiveChart({ title, series, history }) {
  const [selected, setSelected] = useState(series[0].key)
  const active = series.find((s) => s.key === selected) ?? series[0]
  return (
    <Panel
      title={title}
      action={
        <ToggleGroup type="single" variant="outline" size="sm" value={active.key} onValueChange={(v) => v && setSelected(v)} aria-label="Series">
          {series.map((s) => (
            <ToggleGroupItem key={s.key} value={s.key} className="px-2.5 text-xs">
              {s.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
    >
      <TrendChart
        data={history}
        dataKey={active.key}
        labelKey="label"
        formatValue={active.format}
        formatTick={active.tick}
        height={200}
        emptyText="Collecting…"
      />
    </Panel>
  )
}

function Pill({ ok, children }) {
  return <StatusBadge tone={ok ? 'positive' : 'negative'}>{children}</StatusBadge>
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

  const windowLabel = windowSeconds ? `last ${Math.round(windowSeconds)} s` : 'collecting…'

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
  const latencyP95 = histogramQuantile(windowLatency, 0.95)

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
  const ordersCreatedPerSec = hasTwoSamples ? rate('orders_created_total') : null
  const ordersCreatedTotal = families.has('orders_created_total') ? sumSamples(families.get('orders_created_total')) : null
  const terminalRows = [
    { status: 'COMPLETED', key: 'Completed', color: 'var(--positive)' },
    { status: 'FAILED', key: 'Failed', color: 'var(--negative)' },
    { status: 'CANCELLED', key: 'Cancelled', color: 'var(--control)' },
  ]
    .map((r) => ({ ...r, value: ordersByStatus[r.status] ?? 0 }))
    .filter((r) => r.value > 0)
  const finished = (ordersByStatus.COMPLETED ?? 0) + (ordersByStatus.FAILED ?? 0)
  const successRate = hasOrderGauge ? percentOf(ordersByStatus.COMPLETED ?? 0, finished) : null

  const stageFamily = families.get('order_stage_duration_seconds')
  const stageSeries = Object.fromEntries(STAGES.map((s) => [s.key, histogramSeries(stageFamily, { where: (l) => l.stage === s.key })]))
  const usually = (key) => stageRange(stageSeries[key])
  const stageRows = STAGES.map((stage) => {
    const series = stageSeries[stage.key]
    return {
      id: stage.key,
      stage: `${stage.label} (${stage.detail})`,
      count: series?.count ?? 0,
      usually: stageRange(series),
    }
  })
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
      processed: (byOutcome.processed ?? 0).toLocaleString(),
      skipped: (byOutcome.skipped ?? 0).toLocaleString(),
      retried: (byOutcome.retried ?? 0).toLocaleString(),
      failed: (byOutcome.failed ?? 0).toLocaleString(),
      p95: formatLatency(p95),
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
  const workQueues = queueNames.filter((q) => q !== DLQ)
  const idleQueues = workQueues.filter((q) => (queueConsumers[q] ?? 0) === 0)

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
      key: keyClass === 'order' ? 'One order (order:{id})' : keyClass === 'orders' ? "A user's list (orders:user:{id})" : keyClass,
      value:
        percentOf(
          sumSamples(families.get(CACHE), { where: (l) => where(l) && isHit(l) }),
          sumSamples(families.get(CACHE), { where }),
        ) ?? 0,
    }
  })

  // ---------- Runtime ----------
  const cpuRate = hasTwoSamples ? rate('process_cpu_seconds_total') : null
  const rss = scalarValue(families.get('process_resident_memory_bytes'))
  const heapUsed = scalarValue(families.get('nodejs_heap_size_used_bytes'))
  const heapTotal = scalarValue(families.get('nodejs_heap_size_total_bytes'))
  const lagP99 = scalarValue(families.get('nodejs_eventloop_lag_p99_seconds'))
  const startTime = scalarValue(families.get('process_start_time_seconds'))
  const uptimeSeconds = startTime && lastUpdated ? lastUpdated / 1000 - startTime : null

  // Append one point per poll tick to the rolling client-side history the
  // live charts draw (the scrape itself only has the current values).
  useEffect(() => {
    if (!lastUpdated) return
    // Accumulating polled snapshots into a rolling buffer has no non-effect equivalent here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory((prev) => {
      if (prev.length && prev[prev.length - 1].t === lastUpdated) return prev
      const point = {
        t: lastUpdated,
        label: new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        cpu: cpuRate !== null ? cpuRate * 100 : null,
        heapMb: heapUsed !== null ? heapUsed / 1048576 : null,
        lag: lagP99,
        rps: requestsPerSec,
        p95S: latencyP95,
        msgRate: messagesPerSec,
        inFlight,
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
        <PageHeader title="Metrics" />
        <p className="rounded-lg bg-negative-bg px-3.5 py-2.5 text-[13px] text-negative">Couldn't reach /metrics: {error}</p>
      </div>
    )
  }

  const alerts = [
    dlqDepth > 0 && `${dlqDepth} in the dead-letter queue`,
    idleQueues.length > 0 && `no consumer on ${idleQueues.join(', ')}`,
    outboxAge > 10 && `outbox ${formatLatency(outboxAge)} behind`,
    serverErrorRate > 1 && `${formatPercent(serverErrorRate)}% 5xx`,
  ].filter(Boolean)

  const finding = !hasTwoSamples ? 'Collecting…' : alerts.length ? `Needs attention: ${alerts.join(' · ')}` : 'Healthy'

  const trafficKpis = [
    {
      label: 'Requests',
      value: formatRate(requestsPerSec),
      unit: ' /s',
      sub: windowLabel,
      empty: hasTwoSamples ? emptyTextFor(families, HTTP) : 'Collecting…',
    },
    {
      label: 'Latency',
      value: latencyParts(latencyP95).value,
      unit: latencyParts(latencyP95).unit,
      empty: hasTwoSamples ? 'No requests' : 'Collecting…',
    },
    {
      label: 'Server errors',
      value: formatPercent(serverErrorRate, 2),
      unit: '%',
      sub: windowRequests ? `${Math.round(window5xx)} of ${Math.round(windowRequests).toLocaleString()}` : undefined,
      tone: serverErrorRate > 1 ? 'danger' : undefined,
      empty: hasTwoSamples ? 'No requests' : 'Collecting…',
    },
    {
      label: 'Cache hit rate',
      value: formatPercent(cacheHitRate),
      unit: '%',
      sub: lifetimeCacheHitRate !== null ? `${formatPercent(lifetimeCacheHitRate)}% since start` : undefined,
      empty: lifetimeCacheHitRate !== null ? 'No reads' : emptyTextFor(families, CACHE),
    },
  ]

  const liveSeries = [
    { key: 'rps', label: 'Requests', format: (v) => `${v.toFixed(2)} req/s`, tick: (v) => v.toFixed(0) },
    { key: 'p95S', label: 'Latency', format: (v) => formatLatency(v), tick: (v) => formatLatency(v) },
    { key: 'msgRate', label: 'Messages', format: (v) => `${v.toFixed(2)} msg/s`, tick: (v) => v.toFixed(1) },
    { key: 'inFlight', label: 'In flight', format: (v) => `${v} orders`, tick: (v) => v.toFixed(0) },
  ]

  const stage = (name, count, note, tone) => (
    <div
      className={cn(
        'min-w-0 rounded-lg px-3.5 pt-3.5 pb-3',
        tone === 'gate' ? 'bg-warning-bg' : tone === 'done' ? 'bg-foreground text-background' : 'bg-secondary',
      )}
    >
      <div className={cn('text-[13px] font-medium', tone === 'done' && 'text-background/70')}>{name}</div>
      <div className="mt-1.5 text-[28px] leading-[34px] tabular">{count}</div>
      <div className={cn('mt-0.5 text-xs', tone === 'gate' ? 'text-warning' : tone === 'done' ? 'text-background/70' : 'text-muted-foreground')}>
        {note}
      </div>
    </div>
  )

  const twoCol = 'grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'

  return (
    <div>
      <PageHeader
        title="Metrics"
        subtitle={<span className={alerts.length ? 'text-negative' : undefined}>{finding}</span>}
        actions={
          <span className="flex items-center gap-2 text-xs text-muted-foreground tabular">
            <span className={cn('size-1.5 rounded-full', error ? 'bg-faint' : 'bg-positive')} />
            {error ? 'Scrape failed' : lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—'}
          </span>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="mb-6">
        <TabsList variant="line" className="w-full justify-start gap-5 overflow-x-auto border-b border-border px-0 [scrollbar-width:none]">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="flex-none px-0">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === 'overview' && (
        <div className="flex flex-col gap-6">
          <div className={twoCol}>
            <Panel title="Pipeline">
              {hasOrderGauge ? (
                <>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    {stage('Reserving', ordersByStatus.PENDING ?? 0, usually('reservation'))}
                    {stage('Waiting for Pay', ordersByStatus.RESERVED ?? 0, 'held', 'gate')}
                    {stage('Paid', ordersByStatus.PAID ?? 0, usually('completion'))}
                    {stage('Completed', (ordersByStatus.COMPLETED ?? 0).toLocaleString(), `Pay → done ${usually('fulfilment')}`, 'done')}
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-2 md:grid-cols-4">
                    {QUEUE_HOPS.map((hop) => {
                      const depth = queueDepth[hop.queue]
                      return (
                        <div key={hop.queue} className="flex min-w-0 flex-col gap-0.5 px-0.5 pt-2 text-xs text-muted-foreground">
                          <span className="truncate font-mono text-[11.5px] text-foreground" title={hop.queue}>
                            {hop.queue}
                          </span>
                          <span className={cn('tabular', depth > 50 && 'font-semibold text-warning')}>
                            {depth === undefined ? '—' : `${depth} ready · ${queueConsumers[hop.queue] ?? 0} consumer${queueConsumers[hop.queue] === 1 ? '' : 's'}`}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{emptyTextFor(families, 'orders_in_status')}</p>
              )}
            </Panel>

            <Panel title="Health">
              <ul className="divide-y divide-border text-[13px]">
                <li className="flex min-h-11 items-center justify-between gap-3">
                  Dead-letter queue
                  {dlqDepth === null ? <span className="text-faint">—</span> : <Pill ok={dlqDepth === 0}>{dlqDepth === 0 ? 'Empty' : dlqDepth}</Pill>}
                </li>
                <li className="flex min-h-11 items-center justify-between gap-3">
                  Consumers
                  {hasQueueGauge ? (
                    <Pill ok={idleQueues.length === 0}>
                      {workQueues.length - idleQueues.length} of {workQueues.length}
                    </Pill>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </li>
                <li className="flex min-h-11 items-center justify-between gap-3">
                  Outbox
                  {outboxAge === null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <Pill ok={outboxAge <= 10}>{outboxAge === 0 ? 'Drained' : formatLatency(outboxAge)}</Pill>
                  )}
                </li>
                <li className="flex min-h-11 items-center justify-between gap-3">
                  Failed orders
                  <span className="tabular">{sumSamples(families.get('order_failures_total')).toLocaleString()}</span>
                </li>
              </ul>
            </Panel>
          </div>

          <KpiStrip items={trafficKpis} />

          <div className={twoCol}>
            <LiveChart title="Last 3 minutes" series={liveSeries} history={history} />
            <Panel title="Outcomes" meta={successRate === null ? null : `${formatPercent(successRate)}% completed`}>
              <DonutChart rows={terminalRows} emptyText={hasOrderGauge ? 'No finished orders' : emptyTextFor(families, 'orders_in_status')} />
            </Panel>
          </div>
        </div>
      )}

      {tab === 'api' && (
        <div className="flex flex-col gap-6">
          <KpiStrip
            items={[
              trafficKpis[0],
              trafficKpis[1],
              trafficKpis[2],
              {
                label: 'Client errors',
                value: formatPercent(clientErrorRate),
                unit: '%',
                empty: hasTwoSamples ? 'No requests' : 'Collecting…',
              },
            ]}
          />
          <Panel title="Endpoints" meta="* idle, since-start p95">
            <StatTable
              columns={[
                { key: 'route', label: 'Endpoint' },
                { key: 'rpsText', label: 'Req/s', numeric: true },
                { key: 'p95Text', label: 'Latency', numeric: true },
                { key: 'totalText', label: 'Total', numeric: true },
                { key: 'errors5xx', label: '5xx', numeric: true },
              ]}
              rows={routeRows.map((r) => ({
                ...r,
                rpsText: r.rps ? r.rps.toFixed(2) : '0',
                p95Text: r.p95 !== null ? `${formatLatency(r.p95)}${r.windowed ? '' : '*'}` : '—',
                totalText: r.total.toLocaleString(),
                tones: { errors5xx: r.errors5xx ? 'danger' : '' },
              }))}
              emptyText={emptyTextFor(families, HTTP)}
            />
          </Panel>
          <div className={twoCol}>
            <Panel title="Latency, hourly">
              {isAuthenticated ? (
                <TrendChart
                  data={latencyHistory.points.map((p) => ({
                    value: p.avg / 1000,
                    label: new Date(p.bucketStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  }))}
                  dataKey="value"
                  labelKey="label"
                  formatValue={(v) => formatLatency(v)}
                  formatTick={(v) => formatLatency(v)}
                  height={180}
                  emptyText={latencyHistory.loading ? 'Loading…' : latencyHistory.error ? "Couldn't load" : 'No requests yet'}
                />
              ) : (
                <DurableHistoryLoginPrompt />
              )}
            </Panel>
            <Panel title="Status codes">
              <BarList rows={statusCodeRows} emptyText={emptyTextFor(families, HTTP)} />
            </Panel>
          </div>
        </div>
      )}

      {tab === 'orders' && (
        <div className="flex flex-col gap-6">
          <KpiStrip
            items={[
              {
                label: 'Created',
                value: ordersCreatedTotal === null ? null : ordersCreatedTotal.toLocaleString(),
                sub: ordersCreatedPerSec !== null ? `${(ordersCreatedPerSec * 60).toFixed(1)} /min` : undefined,
                empty: emptyTextFor(families, 'orders_created_total'),
              },
              {
                label: 'In flight',
                value: inFlight,
                empty: emptyTextFor(families, 'orders_in_status'),
              },
              {
                label: 'Completed',
                value: formatPercent(successRate),
                unit: '%',
                sub: hasOrderGauge ? `${(ordersByStatus.COMPLETED ?? 0).toLocaleString()} of ${finished.toLocaleString()}` : undefined,
                tone: successRate !== null && successRate < 95 ? 'warning' : undefined,
                empty: hasOrderGauge ? 'None yet' : emptyTextFor(families, 'orders_in_status'),
              },
              {
                label: 'Pay → completed',
                value: stageSeries.fulfilment?.count ? usually('fulfilment') : null,
                empty: emptyTextFor(families, 'order_stage_duration_seconds'),
              },
            ]}
          />
          <Panel title="Stages">
            <StatTable
              columns={[
                { key: 'stage', label: 'Stage' },
                { key: 'count', label: 'Orders', numeric: true },
                { key: 'usually', label: 'Usually', numeric: true },
              ]}
              rows={stageRows}
              emptyText={emptyTextFor(families, 'order_stage_duration_seconds')}
            />
          </Panel>
          <div className="grid items-start gap-6 md:grid-cols-2">
            <Panel title="By status">
              <BarList
                rows={Object.entries(ordersByStatus)
                  .map(([key, value]) => ({ key: key.charAt(0) + key.slice(1).toLowerCase(), value }))
                  .sort((a, b) => b.value - a.value)}
                emptyText={emptyTextFor(families, 'orders_in_status')}
              />
            </Panel>
            <div className="flex flex-col gap-6">
              <Panel title="Failure reasons">
                <BarList
                  rows={failureReasonRows.map((r) => ({ ...r, key: r.key.replace(/_/g, ' ') }))}
                  emptyText={families.has('order_failures_total') ? 'None' : 'Not exported'}
                />
              </Panel>
              <Panel title="Payments">
                <BarList rows={paymentOutcomeRows} emptyText={emptyTextFor(families, 'payment_authorizations_total')} />
              </Panel>
            </div>
          </div>
          <Panel title="Daily">
            {isAuthenticated ? (
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-medium">Created</div>
                  <TrendChart
                    data={createdHistory.points.map((p) => ({ value: p.sum, label: new Date(p.bucketStart).toLocaleDateString([], { day: 'numeric', month: 'short' }) }))}
                    dataKey="value"
                    labelKey="label"
                    formatValue={(v) => `${v} created`}
                    height={160}
                    emptyText={createdHistory.loading ? 'Loading…' : createdHistory.error ? "Couldn't load" : 'None yet'}
                  />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium">Finished</div>
                  <TrendChart
                    data={ordersHistory.points.map((p) => ({ value: p.sum, label: new Date(p.bucketStart).toLocaleDateString([], { day: 'numeric', month: 'short' }) }))}
                    dataKey="value"
                    labelKey="label"
                    color="var(--foreground)"
                    formatValue={(v) => `${v} finished`}
                    height={160}
                    emptyText={ordersHistory.loading ? 'Loading…' : ordersHistory.error ? "Couldn't load" : 'None yet'}
                  />
                </div>
              </div>
            ) : (
              <DurableHistoryLoginPrompt />
            )}
          </Panel>
        </div>
      )}

      {tab === 'messaging' && (
        <div className="flex flex-col gap-6">
          <KpiStrip
            items={[
              {
                label: 'Messages',
                value: formatRate(messagesPerSec),
                unit: ' /s',
                sub: windowLabel,
                empty: hasTwoSamples ? emptyTextFor(families, CONSUMER) : 'Collecting…',
              },
              {
                label: 'Handled',
                value: formatPercent(messageSuccessRate),
                unit: '%',
                sub: attempted ? `${outcomeTotals.skipped ?? 0} dupes skipped` : undefined,
                tone: messageSuccessRate !== null && messageSuccessRate < 99 ? 'warning' : undefined,
                empty: emptyTextFor(families, CONSUMER),
              },
              {
                label: 'Retries',
                value: consumerFamily ? (outcomeTotals.retried ?? 0) : null,
                tone: outcomeTotals.retried ? 'warning' : undefined,
                empty: emptyTextFor(families, CONSUMER),
              },
              {
                label: 'Dead-lettered',
                value: consumerFamily ? (outcomeTotals.failed ?? 0) : null,
                tone: outcomeTotals.failed ? 'danger' : undefined,
                empty: emptyTextFor(families, CONSUMER),
              },
              {
                label: 'Outbox',
                value: outboxPending,
                sub: outboxRelayedPerSec !== null ? `${outboxRelayedPerSec.toFixed(2)} /s relayed` : undefined,
                tone: outboxAge > 10 ? 'warning' : undefined,
                empty: emptyTextFor(families, 'outbox_pending_messages'),
              },
            ]}
          />
          <div className="grid items-start gap-6 md:grid-cols-2">
            <Panel title="Consumers">
              <StatTable
                columns={[
                  { key: 'consumer', label: 'Consumer' },
                  { key: 'processed', label: 'Done', numeric: true },
                  { key: 'skipped', label: 'Dupes', numeric: true },
                  { key: 'retried', label: 'Retried', numeric: true },
                  { key: 'failed', label: 'DLQ', numeric: true },
                  { key: 'p95', label: 'Latency', numeric: true },
                ]}
                rows={consumerRows.map((r) => ({ ...r, tones: { failed: r.tones.failed ? 'danger' : '', retried: r.tones.retried ? 'warning' : '' } }))}
                emptyText={emptyTextFor(families, CONSUMER)}
              />
            </Panel>
            <Panel title="Queues">
              <StatTable
                columns={[
                  { key: 'queue', label: 'Queue', mono: true },
                  { key: 'depth', label: 'Ready', numeric: true },
                  { key: 'consumers', label: 'Consumers', numeric: true },
                ]}
                rows={queueRows.map((r) => ({
                  ...r,
                  tones: {
                    depth: r.tones.depth === 'tone-danger' ? 'danger' : r.tones.depth === 'tone-warning' ? 'warning' : '',
                    consumers: r.tones.consumers ? 'danger' : '',
                  },
                }))}
                emptyText={families.has('rabbitmq_queue_messages') ? 'Broker unreachable' : 'Not exported'}
              />
            </Panel>
          </div>
          <Panel title="Cache hit rate">
            <BarList rows={cacheByClass} formatValue={(v) => `${v.toFixed(1)}%`} emptyText={emptyTextFor(families, CACHE)} />
          </Panel>
        </div>
      )}

      {tab === 'runtime' && (
        <div className="flex flex-col gap-6">
          <KpiStrip
            items={[
              { label: 'CPU', value: cpuRate !== null ? (cpuRate * 100).toFixed(1) : null, unit: '%', empty: hasTwoSamples ? 'Not exported' : 'Collecting…' },
              { label: 'Memory', value: rss !== null ? formatBytes(rss) : null },
              {
                label: 'Heap',
                value: heapUsed !== null ? formatBytes(heapUsed) : null,
                sub: heapUsed !== null && heapTotal !== null ? `of ${formatBytes(heapTotal)}` : undefined,
              },
              { label: 'Loop lag', value: latencyParts(lagP99).value, unit: latencyParts(lagP99).unit, tone: lagP99 > 0.1 ? 'warning' : undefined },
              { label: 'Uptime', value: uptimeSeconds !== null ? formatDuration(uptimeSeconds) : null },
            ]}
          />
          <LiveChart
            title="Last 3 minutes"
            history={history}
            series={[
              { key: 'cpu', label: 'CPU', format: (v) => `${v.toFixed(1)}%`, tick: (v) => `${v.toFixed(0)}%` },
              { key: 'heapMb', label: 'Heap', format: (v) => `${v.toFixed(1)} MB`, tick: (v) => v.toFixed(0) },
              { key: 'lag', label: 'Loop lag', format: (v) => formatLatency(v), tick: (v) => formatLatency(v) },
            ]}
          />
        </div>
      )}

      {tab === 'correlation' && (
        <div className="flex flex-col gap-6">
          {!isAuthenticated ? (
            <DurableHistoryLoginPrompt />
          ) : (
            <Panel
              title="Traffic vs latency, loop and CPU"
              action={
                <Select value={correlationResolution} onValueChange={setCorrelationResolution}>
                  <SelectTrigger size="sm" className="w-40 text-xs" aria-label="Bucket size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CORRELATION_RESOLUTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value} className="text-xs">
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
              meta={correlationLoading ? 'Loading…' : correlationError ? "Couldn't load" : `${correlationRows.length} buckets`}
            >
              <CorrelationChart data={correlationRows} />
            </Panel>
          )}
        </div>
      )}

      <details className="mt-10 text-[13px]">
        <summary className="cursor-pointer text-muted-foreground">Raw /metrics ({families.size} families)</summary>
        <pre className="mt-3 max-h-[420px] overflow-auto rounded-lg bg-card p-4 font-mono text-xs leading-[18px]">{rawText}</pre>
      </details>
    </div>
  )
}
