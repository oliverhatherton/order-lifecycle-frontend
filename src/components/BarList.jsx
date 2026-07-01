/**
 * @param {{ rows: Array<{ key: string, value: number }>, formatValue?: (n: number) => string, emptyText?: string }} props
 */
export function BarList({ rows, formatValue = (n) => String(n), emptyText = 'No data yet' }) {
  if (!rows || rows.length === 0) {
    return <p className="not-exposed">{emptyText}</p>
  }
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div>
      {rows.map((row) => (
        <div className="bar-row" key={row.key}>
          <span className="bar-label" title={row.key}>
            {row.key}
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(row.value / max) * 100}%` }} />
          </span>
          <span className="bar-value">{formatValue(row.value)}</span>
        </div>
      ))}
    </div>
  )
}
