import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

const PALETTE = ['var(--accent)', 'var(--success)', 'var(--warning)', 'var(--danger)', 'var(--pending)', 'var(--text-faint)']

function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { key, value } = payload[0].payload
  return (
    <div className="chart-tooltip">
      <span>{key}</span>
      <strong>{value}</strong>
    </div>
  )
}

/** Proportional breakdown (order states, message outcomes) as a donut, with a color-matched legend. */
export function DonutChart({ rows, emptyText = 'No data yet', height = 160 }) {
  if (!rows || rows.length === 0) {
    return <p className="not-exposed">{emptyText}</p>
  }

  const total = rows.reduce((acc, r) => acc + r.value, 0)

  return (
    <div className="donut-layout">
      <div style={{ height, width: height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="key"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={rows.length > 1 ? 2 : 0}
              isAnimationActive={false}
              stroke="var(--bg-card)"
              strokeWidth={2}
            >
              {rows.map((row, i) => (
                <Cell key={row.key} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip />} wrapperStyle={{ outline: 'none' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="donut-legend">
        {rows.map((row, i) => (
          <li key={row.key}>
            <span className="swatch" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="donut-legend-label">{row.key}</span>
            <span className="donut-legend-value">
              {row.value} <span className="not-exposed">({total > 0 ? ((row.value / total) * 100).toFixed(0) : 0}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
