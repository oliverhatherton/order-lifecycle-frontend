import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTooltipBox } from './ChartTooltip.jsx'
import { AXIS_TICK, BASELINE_STROKE, GRID_STROKE } from './chartTheme.js'
import { EmptyState } from './Panel.jsx'
import { formatLatency } from '@/lib/format'

function MultipleTooltip({ active, payload, label, unit, fmt }) {
  if (!active || !payload?.length) return null
  const value = payload[0]?.value
  return (
    <ChartTooltipBox>
      <span>{label}</span>
      <strong className="font-medium text-foreground tabular">
        {value === null || value === undefined ? '—' : `${fmt(Number(value))}${unit}`}
      </strong>
    </ChartTooltipBox>
  )
}

const PANELS = [
  { key: 'requests', name: 'Requests', unit: '', kind: 'bar' },
  { key: 'latencyAvg', name: 'Latency', unit: '', kind: 'line', seconds: true },
  { key: 'lagMax', name: 'Event loop stall', unit: '', kind: 'line', seconds: true },
  { key: 'cpu', name: 'CPU', unit: '%', kind: 'line' },
]

function peak(data, key) {
  const values = data.map((d) => d[key]).filter((v) => v !== null && v !== undefined)
  return values.length ? Math.max(...values) : null
}

/**
 * Traffic against what it did to latency, the event loop and CPU, as small
 * multiples on one shared time axis — never one chart with two y-scales.
 * Requests (the cause) carry the chart hue; the effects are ink lines. Gauge
 * lines break across missing buckets (downtime) instead of interpolating; see
 * src/lib/metricsCorrelation.js for the fill rules.
 */
export function CorrelationChart({ data, height = 96 }) {
  if (data.length === 0) {
    return <EmptyState>No samples in this window yet.</EmptyState>
  }

  // History stores these two in milliseconds; the screen shows seconds.
  const rows = data.map((d) => ({
    ...d,
    latencyAvg: d.latencyAvg === null ? null : d.latencyAvg / 1000,
    lagMax: d.lagMax === null ? null : d.lagMax / 1000,
  }))

  return (
    <div className="flex flex-col gap-1">
      {PANELS.map((panel, i) => {
        const last = i === PANELS.length - 1
        const max = peak(rows, panel.key)
        const fmt = panel.seconds ? formatLatency : (v) => v.toFixed(1)
        const Chart = panel.kind === 'bar' ? BarChart : LineChart
        return (
          <div key={panel.key}>
            <div className="mt-2.5 flex justify-between text-xs text-muted-foreground">
              <strong className="font-medium text-foreground">{panel.name}</strong>
              <span className="tabular">peak {max === null ? '—' : `${fmt(max)}${panel.unit}`}</span>
            </div>
            <div style={{ height: last ? height + 22 : height }}>
              <ResponsiveContainer width="100%" height="100%">
                <Chart data={rows} syncId="correlation" margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                  <XAxis
                    dataKey="label"
                    hide={!last}
                    tick={AXIS_TICK}
                    axisLine={{ stroke: BASELINE_STROKE }}
                    tickLine={false}
                    minTickGap={32}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={AXIS_TICK} tickFormatter={panel.seconds ? formatLatency : undefined} axisLine={false} tickLine={false} width={44} tickCount={3} domain={[0, 'auto']} />
                  <Tooltip
                    content={<MultipleTooltip unit={panel.unit} fmt={fmt} />}
                    cursor={{ fill: 'var(--accent)', stroke: BASELINE_STROKE }}
                    wrapperStyle={{ outline: 'none' }}
                  />
                  {panel.kind === 'bar' ? (
                    <Bar dataKey={panel.key} fill="var(--chart-1)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  ) : (
                    <Line
                      dataKey={panel.key}
                      type="linear"
                      stroke="var(--foreground)"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  )}
                </Chart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })}
    </div>
  )
}
