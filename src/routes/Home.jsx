import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/useAuth.js'
import { useMetricsPoller } from '../lib/useMetricsPoller.js'
import { histogramQuantile, histogramSeries, sumByLabel, sumSamples } from '../lib/prometheus.js'
import { API_BASE } from '../lib/api.js'
import { Mark } from '../components/Mark.jsx'
import { StateMachineDemo } from '../components/StateMachineDemo.jsx'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatAround, stageRange } from '@/lib/format'

const BACKEND_REPO = 'https://github.com/oliverhatherton/order-lifecycle-backend'
const FRONTEND_REPO = 'https://github.com/oliverhatherton/order-lifecycle-frontend'

/** Median seconds per stage from a local run, used until the live backend has its own. */
const MEASURED_LOCALLY = { reservation: 0.031, payment: 0.035, completion: 0.016, fulfilment: 0.048 }

/** The four consumers, in pipeline order, as the backend labels them. */
const CONSUMERS = [
  ['inventory', 'Inventory'],
  ['payment', 'Payment'],
  ['completion', 'Completion'],
  ['email', 'Email'],
]

/** Upper bounds (seconds) of order_stage_duration_seconds, as the backend declares them. */
const BAND_LABELS = {
  0.05: 'under 0.05 s',
  0.1: '0.05–0.1 s',
  0.25: '0.1–0.25 s',
  0.5: '0.25–0.5 s',
  1: '0.5–1 s',
  2: '1–2 s',
  5: '2–5 s',
  10: '5–10 s',
  30: '10–30 s',
  60: '30–60 s',
  Infinity: 'over 60 s',
}

/** Per-band counts (not cumulative) of the fulfilment histogram. */
function fulfilmentBands(family) {
  const series = histogramSeries(family, { where: (l) => l.stage === 'fulfilment' })
  if (!series) return { bands: [], total: 0, series: null }
  let prev = 0
  const bands = series.buckets.map((b) => {
    const count = b.value - prev
    prev = b.value
    return { le: b.le, label: BAND_LABELS[b.le] ?? `≤ ${b.le} s`, count }
  })
  return { bands, total: series.count, series }
}

/** Reveal the parts of each section as it enters; content stays visible without script. */
function useEntrances(rootRef) {
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    document.documentElement.classList.add('js')
    const targets = root.querySelectorAll('.rise, .shutter')
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            observer.unobserve(e.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    )
    targets.forEach((t) => observer.observe(t))
    return () => {
      observer.disconnect()
      document.documentElement.classList.remove('js')
    }
  }, [rootRef])
}


const TILE = 'relative min-w-0 overflow-hidden rounded-lg p-6'
const ACCENT_TILE = 'bg-[#0b6f80] text-white'
const H2 = 'text-[clamp(40px,5.2vw,84px)] leading-none font-medium tracking-[-0.035em]'

/** A product fragment framed as the tile's picture, cropped by the tile's far edge. */
function Fragment({ children, side = 'left', className }) {
  return (
    <div
      data-ui
      className={cn(
        'min-w-0 flex-1 overflow-hidden border-border bg-sheet p-5 text-[13px] leading-[18px]',
        // Cropped by the tile's far edge on wider screens; inset on both sides on a phone so nothing is cut off.
        side === 'left'
          ? 'mt-6 ml-6 rounded-tl-lg border-t border-l max-md:mt-4 max-md:mr-4 max-md:ml-4 max-md:rounded-t-lg max-md:border-r'
          : 'mt-6 mr-6 rounded-tr-lg border-t border-r max-md:mt-4 max-md:mr-4 max-md:ml-4 max-md:rounded-t-lg max-md:border-l',
        className,
      )}
    >
      {children}
    </div>
  )
}

function FragmentHead({ title, meta }) {
  return (
    <div className="mb-3.5 flex items-baseline justify-between gap-3">
      <strong className="text-sm font-semibold">{title}</strong>
      <span className="text-xs whitespace-nowrap text-muted-foreground tabular">{meta}</span>
    </div>
  )
}

function Stage({ name, count, note, tone }) {
  return (
    <div className={cn('min-w-0 rounded-lg px-3.5 pt-3.5 pb-3', tone === 'gate' ? 'bg-warning-bg' : tone === 'done' ? 'bg-foreground text-background' : 'bg-secondary')}>
      <div className={cn('text-[13px] font-medium', tone === 'done' && 'text-background/70')}>{name}</div>
      <div className="mt-1.5 text-[34px] leading-10 tabular">{count}</div>
      <div className={cn('mt-0.5 text-xs', tone === 'gate' ? 'text-warning' : tone === 'done' ? 'text-background/70' : 'text-muted-foreground')}>{note}</div>
    </div>
  )
}

function MiniTable({ head, rows }) {
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          {head.map((h, i) => (
            <th key={h} className={cn('h-7 pr-2 font-normal', i > 0 && 'text-right last:pr-0')}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r) => (
          <tr key={r.key ?? r.cells.join()}>
            {r.cells.map((c, i) => (
              <td
                key={i}
                className={cn(
                  'h-8 pr-2 whitespace-nowrap',
                  i > 0 && 'text-right tabular last:pr-0',
                  r.mono?.includes(i) && 'font-mono text-xs',
                  r.tone?.[i] === 'warning' && 'text-warning',
                  r.tone?.[i] === 'negative' && 'text-negative',
                  r.tone?.[i] === 'muted' && 'text-muted-foreground',
                  r.bold && 'font-semibold',
                )}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function FeatureCell({ title, children, fragFirst, i }) {
  return (
    <article
      className={cn(
        'rise flex min-h-[380px] flex-col overflow-hidden rounded-lg bg-secondary md:col-span-6 lg:col-span-4 lg:h-[400px] col-span-12',
        fragFirst && 'lg:flex-col-reverse',
      )}
      style={{ '--i': i }}
    >
      <h3 className="p-6 text-[17px] leading-6 font-medium">{title}</h3>
      <div className="flex min-h-0 flex-1">
        <Fragment
          side="left"
          className={cn('mt-0', fragFirst && 'lg:mt-0 lg:mr-6 lg:ml-0 lg:rounded-tl-none lg:rounded-br-lg lg:border-t-0 lg:border-r lg:border-b lg:border-l-0')}
        >
          {children}
        </Fragment>
      </div>
    </article>
  )
}

export function Home() {
  const { isAuthenticated } = useAuth()
  const { families, lastUpdated, error } = useMetricsPoller(5000)
  const rootRef = useRef(null)
  useEntrances(rootRef)

  const host = (() => {
    try {
      return new URL(API_BASE || window.location.origin).host
    } catch {
      return 'the API'
    }
  })()

  const byStatus = sumByLabel(families.get('orders_in_status'), 'status')
  const hasLive = Object.keys(byStatus).length > 0
  const queueDepth = sumByLabel(families.get('rabbitmq_queue_messages'), 'queue')
  const queued = Object.entries(queueDepth)
    .filter(([q]) => q !== 'order_lifecycle.dlq')
    .reduce((n, [, v]) => n + v, 0)
  const dlq = queueDepth['order_lifecycle.dlq']

  const stageFamily = families.get('order_stage_duration_seconds')
  const seriesOf = (key) => histogramSeries(stageFamily, { where: (l) => l.stage === key })
  const completedSinceStart = histogramSeries(stageFamily, { where: (l) => l.stage === 'completion' })?.count ?? 0
  const liveTimes = completedSinceStart > 0
  const usually = (key) => (liveTimes ? stageRange(seriesOf(key)) : formatAround(MEASURED_LOCALLY[key]))

  const { bands, series: fulfilmentSeries } = fulfilmentBands(stageFamily)
  const consumerFamily = families.get('consumer_messages_total')
  const fulfilmentP50 = histogramQuantile(fulfilmentSeries, 0.5)
  const maxBand = Math.max(...bands.map((b) => b.count), 1)
  const leadIndex = bands.findIndex((b) => fulfilmentP50 !== null && b.le >= fulfilmentP50)
  const labelled = new Set(
    [...bands.map((b, i) => [b.count, i])]
      .sort((a, b) => b[0] - a[0])
      .slice(0, 3)
      .map(([, i]) => i),
  )

  const cacheReads = sumSamples(families.get('cache_requests_total'))
  const cacheHits = sumSamples(families.get('cache_requests_total'), { where: (l) => l.result === 'hit' })
  const cacheHitRate = cacheReads > 0 ? (cacheHits / cacheReads) * 100 : null

  const updated = lastUpdated ? new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null
  const startHref = isAuthenticated ? '/shop' : '/register'

  return (
    <div className="min-h-svh bg-background p-1.5 text-base leading-[26px] md:p-2" ref={rootRef}>
      <div className="grid grid-cols-12 gap-1.5 md:gap-2">
        {/* Top row: mark · links · action */}
        <div className="col-span-12 grid h-[60px] grid-cols-[60px_minmax(0,1fr)] gap-1.5 md:grid-cols-[60px_minmax(0,1fr)_auto] md:gap-2">
          <Link to="/" className={cn(TILE, 'grid place-items-center bg-card p-0')} aria-label="Order Lifecycle home">
            <Mark size={26} />
          </Link>
          <nav className={cn(TILE, 'flex items-center bg-secondary px-6 py-0 text-[15px] max-md:hidden')} aria-label="Main">
            <div className="ml-[calc(50%-84px)] flex gap-7">
              <Link to="/shop" className="hover:underline">
                Shop
              </Link>
              <Link to="/orders" className="hover:underline">
                Orders
              </Link>
              <Link to="/metrics" className="hover:underline">
                Metrics
              </Link>
              <a href={`${API_BASE}/docs`} target="_blank" rel="noreferrer" className="hover:underline">
                API docs
              </a>
            </div>
          </nav>
          <Link
            to={startHref}
            className={cn(TILE, 'flex items-center bg-foreground px-5 py-0 text-[15px] font-medium text-background transition-colors hover:bg-foreground/85')}
          >
            {isAuthenticated ? 'Start an order' : 'Create an account'}
          </Link>
        </div>

        {/* Hero: two-by-two board */}
        <section
          className="col-span-12 grid gap-1.5 md:h-[calc(100svh-60px-24px)] md:min-h-[640px] md:grid-cols-2 md:grid-rows-2 md:gap-2"
          aria-labelledby="home-title"
        >
          <div className={cn(TILE, 'flex flex-col justify-end bg-card max-md:min-h-[44svh]')}>
            <h1 id="home-title" className="text-[17vw] leading-[0.92] font-medium tracking-[-0.045em] md:text-[clamp(72px,8vw,128px)]">
              Order Lifecycle
            </h1>
            <p className="mt-8 text-xl md:text-2xl md:leading-8">An order pipeline you can drive.</p>
          </div>

          <div className={cn(TILE, 'shutter flex bg-secondary p-0 max-md:aspect-[4/3.4]')} aria-label="Live pipeline">
            <Fragment>
              <FragmentHead title="Live pipeline" meta={error ? 'scrape failed' : updated ? `${host} · ${updated}` : 'connecting…'} />
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                <Stage name="Reserving" count={hasLive ? (byStatus.PENDING ?? 0) : '—'} note="holding stock" />
                <Stage name="Waiting for Pay" count={hasLive ? (byStatus.RESERVED ?? 0) : '—'} note="held" tone="gate" />
                <Stage name="Paid" count={hasLive ? (byStatus.PAID ?? 0) : '—'} note="completing" />
                <Stage name="Completed" count={hasLive ? (byStatus.COMPLETED ?? 0).toLocaleString() : '—'} note="all time" tone="done" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground xl:grid-cols-4">
                {[
                  ['In queues', hasLive ? queued : '—'],
                  ['Dead-letter', dlq === undefined ? '—' : dlq === 0 ? 'empty' : dlq],
                  ['Failed', hasLive ? (byStatus.FAILED ?? 0).toLocaleString() : '—'],
                  ['Cancelled', hasLive ? (byStatus.CANCELLED ?? 0).toLocaleString() : '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-0.5 px-0.5 pt-1">
                    <span>{k}</span>
                    <span className="text-foreground tabular">{v}</span>
                  </div>
                ))}
              </div>
            </Fragment>
          </div>

          <div className={cn(TILE, 'flex bg-secondary p-0 max-md:order-4 max-md:aspect-[4/3.4]')} aria-label="Consumers">
            <Fragment side="right">
              <FragmentHead title="Consumers" meta="since restart" />
              <MiniTable
                head={['Step', 'Handled', 'Duplicates skipped']}
                rows={CONSUMERS.map(([key, label]) => {
                  const outcomes = sumByLabel(consumerFamily, 'outcome', { where: (l) => l.consumer === key })
                  const known = consumerFamily !== undefined
                  return {
                    key,
                    cells: [
                      label,
                      known ? (outcomes.processed ?? 0).toLocaleString() : '—',
                      known ? (outcomes.skipped ?? 0).toLocaleString() : '—',
                    ],
                    tone: { 2: outcomes.skipped ? 'warning' : 'muted' },
                  }
                })}
              />
            </Fragment>
          </div>

          <div className="grid grid-cols-2 gap-1.5 md:gap-2">
            <div className={cn(TILE, 'bg-warning-bg text-warning max-md:min-h-52')}>
              <p className="max-w-[22ch] text-xl md:text-2xl md:leading-8">Waits at Reserved until you pay.</p>
            </div>
            <div className={cn(TILE, ACCENT_TILE, 'flex flex-col justify-between gap-6 max-md:min-h-52')}>
              <p className="max-w-[22ch] text-xl md:text-2xl md:leading-8">Never charged twice.</p>
              <Link to="/metrics" className="text-[15px] font-medium underline underline-offset-4">
                Metrics
              </Link>
            </div>
          </div>
        </section>

        {/* how-it-works: the order's own progress bar, enlarged */}
        <section className="col-span-12 px-2.5 pt-20 md:px-6 md:pt-30" aria-labelledby="how-title">
          <h2 id="how-title" className={cn('rise max-w-[16ch]', H2)}>
            Four hops, one pause
          </h2>
          {/* The order's four steps as one bar. Timings live in the hero's table
              only; here the hops are equal and the pause is drawn wide. */}
          <div className="mt-12 flex gap-1.5 max-md:flex-col md:mt-16 md:h-[22vh] md:min-h-[170px]" data-ui role="img" aria-label="Reserve stock, then wait for payment, then charge, then fulfil the order">
            {[
              { grow: 1, name: 'Reserve stock', cls: 'bg-secondary' },
              { grow: 2.4, name: 'Wait for payment', cls: 'bg-warning-bg text-warning' },
              { grow: 1, name: 'Charge', cls: ACCENT_TILE },
              { grow: 1, name: 'Fulfil order', cls: 'bg-foreground text-background' },
            ].map((seg, i) => (
              <div
                key={seg.name}
                className={cn('rise flex flex-col justify-end rounded-lg p-5 max-md:min-h-24', seg.cls)}
                style={{ flexGrow: seg.grow, flexBasis: 0, '--i': i }}
              >
                <span className="text-[clamp(22px,2vw,30px)] leading-tight font-medium">{seg.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* showcase: the state machine, runnable */}
        <section className="col-span-12 grid items-start gap-12 px-2.5 py-20 md:px-6 md:py-30 xl:grid-cols-[5fr_7fr]" aria-labelledby="try-title">
          <h2 id="try-title" className={cn('rise', H2)}>
            Try it
          </h2>
          <div className="rise" style={{ '--i': 1 }}>
            <StateMachineDemo />
          </div>
        </section>

        {/* features: staggered fragment cells */}
        <div className="col-span-12 px-2.5 pb-10 md:px-6 md:pb-14">
          <h2 className={cn('rise', H2)}>Built for redelivery</h2>
        </div>

        <FeatureCell title="An event can't go missing" i={0}>
          <MiniTable
            head={['outbox_messages', 'published']}
            rows={[
              { cells: ['order.created', '12:04:18.412'], mono: [0] },
              { cells: ['order.inventory_reserved', '12:04:27.031'], mono: [0] },
              { cells: ['order.payment_processed', 'retry in 1 s'], mono: [0], tone: { 1: 'muted' } },
            ]}
          />
        </FeatureCell>
        <FeatureCell title="A duplicate is skipped" fragFirst i={1}>
          <MiniTable
            head={['message', 'consumer', 'outcome']}
            rows={[
              { cells: ['7c1e…a04f', 'inventory', 'processed'], mono: [0] },
              { cells: ['7c1e…a04f', 'inventory', 'skipped'], mono: [0], tone: { 2: 'warning' } },
              { cells: ['0b93…d2e1', 'payment', 'processed'], mono: [0] },
            ]}
          />
        </FeatureCell>
        <FeatureCell title="One charge per order" i={2}>
          <MiniTable
            head={['payment_authorizations', 'authorized']}
            rows={[
              { cells: ['claimed', 'null'], tone: { 1: 'muted' } },
              { cells: ['decided', 'true'] },
              { cells: ['redelivered', 'true, no charge'] },
            ]}
          />
        </FeatureCell>
        <FeatureCell title="Retries back off" fragFirst i={0}>
          <MiniTable
            head={['attempt', 'waits']}
            rows={[
              { cells: ['1st retry', '1 s'] },
              { cells: ['2nd retry', '2 s'] },
              { cells: ['3rd retry', '4 s'] },
              { cells: ['order_lifecycle.dlq', 'kept'], mono: [0] },
            ]}
          />
        </FeatureCell>
        <FeatureCell title="A stolen token ends one session" i={1}>
          <MiniTable
            head={['family', 'device', 'state']}
            rows={[
              { cells: ['f3a9…', 'Laptop', 'revoked'], mono: [0], tone: { 2: 'negative' } },
              { cells: ['8d20…', 'Phone', 'active'], mono: [0] },
            ]}
          />
        </FeatureCell>
        <FeatureCell title="Finished orders come from cache" fragFirst i={2}>
          <FragmentHead title="Cache hit rate" meta="live" />
          <div className="text-[40px] leading-[44px] tabular">{cacheHitRate === null ? '—' : `${cacheHitRate.toFixed(1)}%`}</div>
          <p className="mt-2 text-muted-foreground tabular">{cacheReads > 0 ? `${cacheHits.toLocaleString()} of ${cacheReads.toLocaleString()} reads` : 'No reads yet'}</p>
        </FeatureCell>

        {/* stats: bars standing on the edge */}
        <section className="col-span-12 mt-20 flex flex-col overflow-hidden rounded-lg bg-card px-5 pt-10 md:mt-28 md:min-h-[90svh] md:px-6 md:pt-12" aria-labelledby="stats-title">
          <div id="stats-title" className="rise text-[26vw] leading-[0.95] font-medium tracking-[-0.045em] tabular md:text-[clamp(88px,10vw,168px)]">
            {usually('fulfilment')}
          </div>
          <p className="rise mt-4 text-[22px] leading-7 md:text-[28px] md:leading-[34px]" style={{ '--i': 1 }}>
            Pay to completed, usually
          </p>
          <div className="-mx-5 mt-10 grid h-64 auto-cols-fr grid-flow-col items-end gap-1.5 md:-mx-6 md:mt-auto md:h-[58vh] md:gap-2" data-ui role="list" aria-label="Pay to completed, by time band">
            {bands.map((band, i) => (
              <div
                key={band.label}
                role="listitem"
                tabIndex={0}
                className={cn(
                  'group relative min-h-1 rounded-t-md outline-none transition-colors',
                  i === leadIndex ? 'bg-chart-1 hover:bg-[#22b3c8] focus-visible:bg-[#22b3c8]' : 'bg-accent hover:bg-input focus-visible:bg-input',
                )}
                style={{ height: `${Math.max((band.count / maxBand) * 100, 1)}%` }}
                aria-label={`${band.label}: ${band.count} orders`}
              >
                <span
                  className={cn(
                    'absolute bottom-[calc(100%+8px)] text-[clamp(14px,1.4vw,22px)] leading-tight whitespace-nowrap tabular transition-opacity',
                    // Labels on the right half hang left so none runs off the edge.
                    i >= bands.length / 2 ? 'right-2 text-right' : 'left-2',
                    labelled.has(i) && band.count > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                  )}
                >
                  {band.count.toLocaleString()}
                  <small className="block text-[13px] text-muted-foreground">{band.label}</small>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* footer: the four states, built large */}
        <footer className="col-span-12 mt-20 rounded-lg bg-card p-5 md:mt-28 md:p-6" aria-labelledby="footer-title">
          <h2 id="footer-title" className="sr-only">
            Order Lifecycle
          </h2>
          <div className="flex h-[22svh] min-h-36 items-end gap-1 md:h-[34svh] md:min-h-56" aria-hidden="true">
            {[
              ['Pending', 'h-[60%] bg-secondary'],
              ['Reserved', 'h-[78%] bg-warning-bg text-warning'],
              ['Paid', cn('h-[88%]', ACCENT_TILE)],
              ['Completed', 'h-full bg-foreground text-background'],
            ].map(([label, cls]) => (
              <span key={label} className={cn('flex flex-1 items-end overflow-hidden rounded-md p-2.5 text-[5.4vw] leading-none font-medium tracking-[-0.03em] md:p-4 md:text-[clamp(22px,3.4vw,56px)]', cls)}>
                {label}
              </span>
            ))}
          </div>
          <div className="mt-14 grid grid-cols-2 gap-6 text-[15px] md:grid-cols-12">
            {[
              ['Try it', [['Shop', '/shop'], ['Orders', '/orders'], ['Metrics', '/metrics']]],
              ['Source', [['Backend', BACKEND_REPO, true], ['Frontend', FRONTEND_REPO, true]]],
              ['API', [['Docs', `${API_BASE}/docs`, true], ['/metrics', `${API_BASE}/metrics`, true]]],
            ].map(([heading, links]) => (
              <nav key={heading} aria-label={heading} className="flex flex-col md:col-span-2">
                <h3 className="mb-1.5 font-medium">{heading}</h3>
                {links.map(([label, href, external]) =>
                  external ? (
                    <a key={label} href={href} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                      {label}
                    </a>
                  ) : (
                    <Link key={label} to={href} className="text-muted-foreground hover:text-foreground">
                      {label}
                    </Link>
                  ),
                )}
              </nav>
            ))}
          </div>
          <div className="mt-12 flex items-center justify-between gap-4 text-sm text-muted-foreground">
            <span>© 2026 Oliver Atherton</span>
            <Button asChild size="sm">
              <Link to={startHref}>{isAuthenticated ? 'Start an order' : 'Create an account'}</Link>
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
