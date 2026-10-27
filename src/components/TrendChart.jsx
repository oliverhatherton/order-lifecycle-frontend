import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTooltipBox } from './ChartTooltip.jsx'
import { AXIS_TICK, BASELINE_STROKE, GRID_STROKE } from './chartTheme.js'
import { EmptyState } from './Panel.jsx'

function TrendTooltip({ active, payload, formatValue, labelKey }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload ?? {}
  const value = payload[0]?.value
  return (
    <ChartTooltipBox>
      {labelKey && point[labelKey] && <span>{point[labelKey]}</span>}
      <strong className="font-medium text-foreground tabular">
        {value === null || value === undefined ? '—' : formatValue ? formatValue(value) : value}
      </strong>
    </ChartTooltipBox>
  )
}

/**
 * One series over time: a 2px straight line in the chart hue with a flat
 * 12% tint under it (no gradient, no markers), faint horizontal gridlines,
 * round ticks on the left with no axis line.
 */
export function TrendChart({
  data,
  dataKey,
  color = 'var(--chart-1)',
  formatValue,
  formatTick,
  height = 180,
  emptyText = 'Collecting…',
  connectNulls = true,
  labelKey,
}) {
  const hasData = data.some((d) => d[dataKey] !== null && d[dataKey] !== undefined)
  if (!hasData) {
    return (
      <EmptyState className="grid place-items-center text-xs" style={{ height }}>
        {emptyText}
      </EmptyState>
    )
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          {labelKey && (
            <XAxis
              dataKey={labelKey}
              tick={AXIS_TICK}
              axisLine={{ stroke: BASELINE_STROKE }}
              tickLine={false}
              minTickGap={28}
              interval="preserveStartEnd"
            />
          )}
          <YAxis
            domain={[0, 'auto']}
            tick={AXIS_TICK}
            tickFormatter={formatTick}
            axisLine={false}
            tickLine={false}
            width={44}
            tickCount={5}
          />
          <Tooltip
            content={<TrendTooltip formatValue={formatValue} labelKey={labelKey} />}
            cursor={{ stroke: BASELINE_STROKE, strokeWidth: 1 }}
            wrapperStyle={{ outline: 'none' }}
          />
          <Area
            type="linear"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            fill={color}
            fillOpacity={0.12}
            isAnimationActive={false}
            connectNulls={connectNulls}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: color }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
