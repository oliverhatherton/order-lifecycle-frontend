import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts'

function TrendTooltip({ active, payload, formatValue, label }) {
  if (!active || !payload?.length) return null
  const value = payload[0]?.value
  return (
    <div className="chart-tooltip">
      <span>{label}</span>
      <strong>{formatValue ? formatValue(value) : value}</strong>
    </div>
  )
}

/**
 * Small live-updating area chart for a rolling window of client-observed
 * samples. There's no history API on the backend (only the current scrape),
 * so this is only ever as deep as the window this browser tab has been open.
 */
export function TrendChart({ data, dataKey, color = 'var(--accent)', formatValue, height = 64, emptyText = 'collecting…', connectNulls = true }) {
  const hasData = data.some((d) => d[dataKey] !== null && d[dataKey] !== undefined)
  if (!hasData) {
    return (
      <div className="trend-chart-empty" style={{ height }}>
        {emptyText}
      </div>
    )
  }

  const gradientId = `grad-${dataKey}`

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Tooltip
            content={<TrendTooltip formatValue={formatValue} />}
            cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
            wrapperStyle={{ outline: 'none' }}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            connectNulls={connectNulls}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
