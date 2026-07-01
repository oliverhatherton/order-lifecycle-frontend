import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api.js'
import { ErrorBanner } from '../components/ErrorBanner.jsx'
import { OrderStatusBadge } from '../components/OrderStatusBadge.jsx'
import { CenterLoading } from '../components/CenterLoading.jsx'

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED'])
const POLL_INTERVAL_MS = 1200

// RESERVED is a genuine pause — nothing advances an order past it until the
// user clicks "Pay" (POST /orders/:id/pay). Only poll orders that the server
// is actively moving: PENDING (still reserving) or RESERVED-with-payment-
// initiated (payment/fulfilment running after a Pay click).
function needsPolling(order) {
  if (TERMINAL_STATUSES.has(order.status)) return false
  if (order.status === 'RESERVED' && !order.paymentInitiatedAt) return false
  return true
}

function awaitingPay(order) {
  return order.status === 'RESERVED' && !order.paymentInitiatedAt
}

function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function Orders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [payingIds, setPayingIds] = useState(() => new Set())
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

  // Fulfilment runs asynchronously over RabbitMQ after POST /orders (and
  // again after POST /orders/:id/pay), so we poll each order the server is
  // actively progressing until it lands on RESERVED-awaiting-pay or a
  // terminal state.
  useEffect(() => {
    const interval = setInterval(async () => {
      const inFlight = ordersRef.current.filter(needsPolling)
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

  async function handlePay(orderId) {
    setPayingIds((prev) => new Set(prev).add(orderId))
    setError(null)
    try {
      const { data } = await api.payOrder(orderId)
      setOrders((prev) => prev.map((o) => (o.id === orderId ? data : o)))
    } catch (err) {
      // 409 = order wasn't RESERVED, or payment was already initiated (e.g. a
      // double-click, or another tab beat us to it) — not a real error, just
      // re-sync with the server so polling picks up wherever it actually is.
      if (err instanceof ApiError && err.status === 409) {
        try {
          const { data } = await api.getOrder(orderId)
          setOrders((prev) => prev.map((o) => (o.id === orderId ? data : o)))
        } catch (refetchErr) {
          setError(refetchErr)
        }
      } else {
        setError(err)
      }
    } finally {
      setPayingIds((prev) => {
        const next = new Set(prev)
        next.delete(orderId)
        return next
      })
    }
  }

  const hasInFlight = orders.some(needsPolling)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Orders</h1>
          <p className="subtitle">
            Placing an order returns immediately as <code>PENDING</code>; inventory reservation runs asynchronously
            and pauses at <code>RESERVED</code> until you click <strong>Pay</strong> — nothing charges or completes
            before that.
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const polling = needsPolling(order)
                const readyToPay = awaitingPay(order)
                const paying = payingIds.has(order.id)
                return (
                  <tr key={order.id}>
                    <td className="mono">{order.id.slice(0, 8)}</td>
                    <td>
                      <OrderStatusBadge status={order.status} />
                      {polling && <span className="live-dot" style={{ marginLeft: 8 }} title="Polling for updates" />}
                      {readyToPay && <span className="not-exposed" style={{ marginLeft: 8 }}>awaiting payment</span>}
                    </td>
                    <td>{formatTime(order.createdAt)}</td>
                    <td>{formatTime(order.updatedAt)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {readyToPay && (
                        <button type="button" className="btn small primary" disabled={paying} onClick={() => handlePay(order.id)}>
                          {paying ? 'Paying…' : 'Pay'}
                        </button>
                      )}
                    </td>
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
