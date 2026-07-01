import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { ErrorBanner } from '../components/ErrorBanner.jsx'
import { OrderStatusBadge } from '../components/OrderStatusBadge.jsx'
import { CenterLoading } from '../components/CenterLoading.jsx'

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED'])
const POLL_INTERVAL_MS = 1200

function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function Orders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)
  const ordersRef = useRef(orders)

  useEffect(() => {
    ordersRef.current = orders
  }, [orders])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.listOrders()
        if (!cancelled) setOrders(data ?? [])
      } catch (err) {
        if (!cancelled) setError(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Fulfilment runs asynchronously over RabbitMQ after POST /orders returns,
  // so we poll each non-terminal order until it lands on COMPLETED or FAILED.
  useEffect(() => {
    const interval = setInterval(async () => {
      const inFlight = ordersRef.current.filter((o) => !TERMINAL_STATUSES.has(o.status))
      if (inFlight.length === 0) return
      const results = await Promise.allSettled(inFlight.map((o) => api.getOrder(o.id)))
      setOrders((prev) =>
        prev.map((o) => {
          const idx = inFlight.findIndex((p) => p.id === o.id)
          if (idx === -1) return o
          const result = results[idx]
          return result.status === 'fulfilled' ? result.value.data : o
        }),
      )
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  async function handleCreate() {
    setCreating(true)
    setError(null)
    try {
      const { data } = await api.createOrder()
      setOrders((prev) => [data, ...prev])
    } catch (err) {
      setError(err)
    } finally {
      setCreating(false)
    }
  }

  const hasInFlight = orders.some((o) => !TERMINAL_STATUSES.has(o.status))

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Orders</h1>
          <p className="subtitle">
            Placing an order returns immediately as <code>PENDING</code>; inventory, payment and completion run
            asynchronously and are reflected here as they land.
          </p>
        </div>
        <button type="button" className="btn primary" onClick={handleCreate} disabled={creating}>
          {creating ? 'Placing…' : 'Place order'}
        </button>
      </div>

      <ErrorBanner error={error} />

      {loading ? (
        <CenterLoading />
      ) : orders.length === 0 ? (
        <div className="empty-state">No orders yet — place one to see the fulfilment pipeline run.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Status</th>
                <th>Created</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const inFlight = !TERMINAL_STATUSES.has(order.status)
                return (
                  <tr key={order.id}>
                    <td className="mono">{order.id.slice(0, 8)}</td>
                    <td>
                      <OrderStatusBadge status={order.status} />
                      {inFlight && <span className="live-dot" style={{ marginLeft: 8 }} title="Polling for updates" />}
                    </td>
                    <td>{formatTime(order.createdAt)}</td>
                    <td>{formatTime(order.updatedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {hasInFlight && <p style={{ marginTop: 12, fontSize: 12.5 }}>Polling in-flight orders every {POLL_INTERVAL_MS / 1000}s…</p>}
    </div>
  )
}
