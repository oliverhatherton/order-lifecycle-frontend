export function OrderStatusBadge({ status }) {
  return <span className={`badge ${status?.toLowerCase()}`}>{status}</span>
}
