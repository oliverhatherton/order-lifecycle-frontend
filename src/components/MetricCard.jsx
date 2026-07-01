/**
 * A single stat tile. `value === null` renders a small "not exposed" /
 * "no data yet" placeholder instead of a number, so panels for metrics the
 * backend hasn't emitted yet stay honest rather than showing a fake 0.
 */
export function MetricCard({ label, value, sub, emptyText = 'not exposed', small = false, chart = null }) {
  const isEmpty = value === null || value === undefined
  return (
    <div className={`card metric-card${isEmpty ? ' empty' : ''}${chart ? ' has-chart' : ''}`}>
      <span className="label">{label}</span>
      <span className={`value${small ? ' small' : ''}`}>{isEmpty ? emptyText : value}</span>
      {sub && !isEmpty && <span className="sub">{sub}</span>}
      {chart && !isEmpty && <div className="metric-card-chart">{chart}</div>}
    </div>
  )
}
