import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const LINES = [
  { key: 'latencyAvg', name: 'Latency avg (ms)', color: 'var(--accent)', dash: undefined },
  { key: 'latencyMax', name: 'Latency max (ms)', color: 'var(--accent)', dash: '4 3' },
  { key: 'lagAvg', name: 'Event loop lag avg (ms)', color: 'var(--warning)', dash: undefined },
  { key: 'lagMax', name: 'Event loop stalls, max (ms)', color: 'var(--warning)', dash: '4 3' },
  { key: 'cpu', name: 'CPU (%)', color: 'var(--danger)', dash: undefined },
]

function CorrelationTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <span>{label}</span>
      {payload.map((p) => (
        <span key={p.dataKey} style={{ color: p.color }}>
          {p.name}: <strong>{p.value === null || p.value === undefined ? '—' : p.value.toFixed(1)}</strong>
        </span>
      ))}
    </div>
  )
}

/**
 * Overlays request volume (bars, left axis) against latency/lag/CPU (lines,
 * right axis) on one timeline, so spikes can be visually correlated. Gauge
 * lines break across missing buckets (downtime) instead of interpolating —
 * see src/lib/metricsCorrelation.js for the fill rules.
 */
export function CorrelationChart({ data, height = 320 }) {
  const hasData = data.length > 0
  if (!hasData) {
    return (
      <div className="trend-chart-empty" style={{ height }}>
        no data in this window yet
      </div>
    )
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: 'var(--text-faint)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
          <YAxis
            yAxisId="requests"
            tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <YAxis
            yAxisId="rate"
            orientation="right"
            tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip content={<CorrelationTooltip />} cursor={{ fill: 'var(--bg-hover)' }} wrapperStyle={{ outline: 'none' }} />
          <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-dim)' }} />
          <Bar yAxisId="requests" dataKey="requests" name="Requests/bucket" fill="var(--accent-bg)" stroke="var(--accent)" strokeWidth={1} isAnimationActive={false} />
          {LINES.map((line) => (
            <Line
              key={line.key}
              yAxisId="rate"
              type="monotone"
              dataKey={line.key}
              name={line.name}
              stroke={line.color}
              strokeWidth={1.5}
              strokeDasharray={line.dash}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
