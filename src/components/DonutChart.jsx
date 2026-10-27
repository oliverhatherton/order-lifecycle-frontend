import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { ChartTooltipBox } from './ChartTooltip.jsx'

function RingTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { key, value } = payload[0].payload
  return (
    <ChartTooltipBox>
      <span>{key}</span>
      <strong className="font-medium text-foreground tabular">{value}</strong>
    </ChartTooltipBox>
  )
}

/**
 * Three to five parts of a whole as a thin ring — no labels on the slices,
 * the legend is a small table that carries the values. Each row brings its
 * own `color` (status colours for outcomes); rows without one fall back to
 * neutral greys so a ring never invents a categorical hue.
 */
export function DonutChart({ rows, emptyText = 'No data yet', size = 132 }) {
  if (!rows || rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>
  }
  const neutrals = ['var(--foreground)', 'var(--muted-foreground)', 'var(--input)']
  const colorOf = (row, i) => row.color ?? neutrals[i % neutrals.length]
  const total = rows.reduce((acc, r) => acc + r.value, 0)

  return (
    <div className="flex items-center gap-6">
      <div className="flex-none" style={{ height: size, width: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="key"
              innerRadius="88%"
              outerRadius="100%"
              paddingAngle={rows.length > 1 ? 2 : 0}
              isAnimationActive={false}
              stroke="var(--card)"
              strokeWidth={2}
              startAngle={90}
              endAngle={-270}
            >
              {rows.map((row, i) => (
                <Cell key={row.key} fill={colorOf(row, i)} />
              ))}
            </Pie>
            <Tooltip content={<RingTooltip />} wrapperStyle={{ outline: 'none' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 divide-y divide-border">
        {rows.map((row, i) => (
          <li key={row.key} className="grid h-8 grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]">
            <span className="size-2 rounded-full" style={{ background: colorOf(row, i) }} />
            <span>{row.key}</span>
            <span className="text-right tabular">
              {row.value.toLocaleString()}
              <span className="ml-1.5 text-muted-foreground">{total > 0 ? `${((row.value / total) * 100).toFixed(0)}%` : '0%'}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
