import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api.js'
import { useAuth } from '../lib/useAuth.js'
import { ErrorBanner } from '../components/ErrorBanner.jsx'
import { OrderStatusBadge } from '../components/OrderStatusBadge.jsx'
import { CenterLoading } from '../components/CenterLoading.jsx'

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED'])
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

// Cancellable while PENDING (still reserving), or RESERVED as long as Pay
// hasn't been clicked yet — once paymentInitiatedAt is set, it's too late.
function canCancel(order) {
  if (order.status === 'PENDING') return true
  return order.status === 'RESERVED' && !order.paymentInitiatedAt
}

function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatItems(items) {
  if (!items?.length) return '—'
  return items.map((i) => `${i.quantity}× ${i.productName}`).join(', ')
}

export function Orders() {
  const { status: authStatus, isAuthenticated } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [payingIds, setPayingIds] = useState(() => new Set())
  const [cancelingIds, setCancelingIds] = useState(() => new Set())
  const [error, setError] = useState(null)
  const ordersRef = useRef(orders)

  useEffect(() => {
    ordersRef.current = orders
  }, [orders])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!isAuthenticated) {
        if (!cancelled) setLoading(false)
        return
      }
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
  }, [isAuthenticated])

  // Fulfilment runs asynchronously over RabbitMQ after checkout (and again
  // after POST /orders/:id/pay), so we poll each order the server is
  // actively progressing until it lands on RESERVED-awaiting-pay or a
  // terminal state.
  useEffect(() => {
    if (!isAuthenticated) return
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
  }, [isAuthenticated])

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

  async function handleCancel(orderId) {
    setCancelingIds((prev) => new Set(prev).add(orderId))
    setError(null)
    try {
      const { data } = await api.cancelOrder(orderId)
      setOrders((prev) => prev.map((o) => (o.id === orderId ? data : o)))
    } catch (err) {
      // 409 = too late to cancel (payment already initiated, or already
      // terminal) — re-sync rather than showing it as an error.
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
      setCancelingIds((prev) => {
        const next = new Set(prev)
        next.delete(orderId)
        return next
      })
    }
  }

  const hasInFlight = orders.some(needsPolling)

  if (authStatus === 'loading') return <CenterLoading />

  if (!isAuthenticated) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Orders</h1>
            <p className="subtitle">Watch orders you've checked out from the shop move through the fulfilment pipeline.</p>
          </div>
        </div>
        <div className="auth-card" style={{ margin: '48px auto' }}>
          <h2>Log in to view your orders</h2>
          <p style={{ marginBottom: 20 }}>You'll need an account to place orders and watch them progress.</p>
          <Link to="/login" className="btn primary" style={{ width: '100%' }}>
            Log in
          </Link>
          <div className="switch">
            No account? <Link to="/register">Sign up</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Orders</h1>
          <p className="subtitle">
            Orders are created by checking out a cart — inventory reservation runs asynchronously and pauses at{' '}
            <code>RESERVED</code> until you click <strong>Pay</strong>. You can cancel any time before that.
          </p>
        </div>
        <Link to="/shop" className="btn primary">
          Shop
        </Link>
      </div>

      <ErrorBanner error={error} />

      {loading ? (
        <CenterLoading />
      ) : orders.length === 0 ? (
        <div className="empty-state">
          No orders yet — <Link to="/shop">visit the shop</Link> to place one and watch the fulfilment pipeline run.
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="orders-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Status</th>
                <th>Items</th>
                <th>Created</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const polling = needsPolling(order)
                const readyToPay = awaitingPay(order)
                const cancelable = canCancel(order)
                const paying = payingIds.has(order.id)
                const canceling = cancelingIds.has(order.id)
                const itemsText = formatItems(order.items)
                return (
                  <tr key={order.id}>
                    <td className="mono">{order.id.slice(0, 8)}</td>
                    <td>
                      <OrderStatusBadge status={order.status} />
                      {polling && <span className="live-dot" style={{ marginLeft: 8 }} title="Polling for updates" />}
                    </td>
                    <td className="truncate" title={itemsText}>
                      {itemsText}
                    </td>
                    <td>{formatTime(order.createdAt)}</td>
                    <td>{formatTime(order.updatedAt)}</td>
                    <td>
                      <div className="orders-actions">
                        {readyToPay && (
                          <button type="button" className="btn small primary" disabled={paying || canceling} onClick={() => handlePay(order.id)}>
                            {paying ? 'Paying…' : 'Pay'}
                          </button>
                        )}
                        {cancelable && (
                          <button type="button" className="btn small danger" disabled={paying || canceling} onClick={() => handleCancel(order.id)}>
                            {canceling ? '…' : 'Cancel'}
                          </button>
                        )}
                      </div>
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
