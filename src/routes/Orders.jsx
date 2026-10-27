import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api, ApiError } from '../lib/api.js'
import { useAuth } from '../lib/useAuth.js'
import { ErrorBanner } from '../components/ErrorBanner.jsx'
import { CenterLoading } from '../components/CenterLoading.jsx'
import { LifecycleTrack } from '../components/LifecycleTrack.jsx'
import { SignInGate } from '../components/SignInGate.jsx'
import { EmptyState, PageHeader } from '../components/Panel.jsx'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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

const TABS = [
  { key: 'needs', label: 'Needs you', match: awaitingPay },
  { key: 'moving', label: 'In progress', match: needsPolling },
  { key: 'done', label: 'Finished', match: (o) => TERMINAL_STATUSES.has(o.status) },
  { key: 'all', label: 'All', match: () => true },
]

function formatItems(items) {
  if (!items?.length) return 'No items'
  return items.map((i) => `${i.quantity}× ${i.productName}`).join(', ')
}

/** "Just now", "4 min ago", "2 h ago", or the date for anything older than a day. */
function relative(iso, now) {
  if (!iso) return '—'
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (seconds < 45) return 'Just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export function Orders() {
  const { status: authStatus, isAuthenticated } = useAuth()
  const location = useLocation()
  const justCheckedOut = location.state?.justCheckedOut
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [payingIds, setPayingIds] = useState(() => new Set())
  const [cancelingIds, setCancelingIds] = useState(() => new Set())
  const [error, setError] = useState(null)
  const [tab, setTab] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const ordersRef = useRef(orders)

  useEffect(() => {
    ordersRef.current = orders
  }, [orders])

  // Keeps the "x min ago" column honest without a re-fetch.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

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

  async function resync(orderId) {
    try {
      const { data } = await api.getOrder(orderId)
      setOrders((prev) => prev.map((o) => (o.id === orderId ? data : o)))
    } catch (refetchErr) {
      setError(refetchErr)
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
      if (err instanceof ApiError && err.status === 409) await resync(orderId)
      else setError(err)
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
      if (err instanceof ApiError && err.status === 409) await resync(orderId)
      else setError(err)
    } finally {
      setCancelingIds((prev) => {
        const next = new Set(prev)
        next.delete(orderId)
        return next
      })
    }
  }

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, orders.filter(t.match).length])), [orders])
  // Open on the queue that needs action when there is one; the user's pick wins after that.
  const activeTab = tab ?? (counts.needs > 0 ? 'needs' : 'all')
  const visible = orders.filter(TABS.find((t) => t.key === activeTab).match)
  const hasInFlight = counts.moving > 0

  if (authStatus === 'loading') return <CenterLoading />

  if (!isAuthenticated) {
    return (
      <div>
        <PageHeader title="Orders" />
        <SignInGate title="Sign in to see your orders" />
      </div>
    )
  }

  const finding = counts.needs > 0 ? `${counts.needs} waiting for you to pay` : hasInFlight ? `${counts.moving} in progress` : orders.length ? 'All finished' : null

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle={loading ? 'Loading…' : finding}
        actions={
          <Button asChild>
            <Link to="/shop">New order</Link>
          </Button>
        }
      />

      {justCheckedOut && orders.some((o) => o.id === justCheckedOut && o.status === 'PENDING') && (
        <p className="mb-4 rounded-lg bg-info-bg px-3.5 py-2.5 text-[13px] text-info">
          Order <span className="font-mono">{justCheckedOut.slice(0, 8)}</span> placed
        </p>
      )}

      <ErrorBanner error={error} />

      {loading ? (
        <CenterLoading />
      ) : orders.length === 0 ? (
        <EmptyState>
          No orders yet. <Link to="/shop" className="text-info hover:underline">Go to the shop</Link>
        </EmptyState>
      ) : (
        <>
          <Tabs value={activeTab} onValueChange={setTab} className="mb-4">
            <TabsList variant="line" className="w-full justify-start gap-5 border-b border-border px-0">
              {TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="flex-none px-0">
                  {t.label}
                  <span className="text-xs text-muted-foreground tabular">{counts[t.key]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {visible.length === 0 ? (
            <EmptyState>{activeTab === 'needs' ? 'Nothing waiting' : activeTab === 'moving' ? 'Nothing in progress' : 'Nothing finished'}</EmptyState>
          ) : (
            <Table>
              <TableHeader className="max-sm:hidden">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[32%] pl-0 text-xs font-normal text-muted-foreground">Order</TableHead>
                  <TableHead className="text-xs font-normal text-muted-foreground">Progress</TableHead>
                  <TableHead className="text-right text-xs font-normal text-muted-foreground">Updated</TableHead>
                  <TableHead className="w-40 pr-0">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((order) => {
                  const readyToPay = awaitingPay(order)
                  const cancelable = canCancel(order)
                  const paying = payingIds.has(order.id)
                  const canceling = cancelingIds.has(order.id)
                  const itemsText = formatItems(order.items)
                  return (
                    <TableRow key={order.id} className="border-border/60 max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-3 max-sm:gap-y-2 max-sm:py-3">
                      <TableCell className="py-3 pl-0 max-sm:p-0">
                        <div className="font-mono text-[13px] font-medium" title={order.id}>
                          {order.id.slice(0, 8)}
                        </div>
                        <div className="max-w-64 truncate text-xs text-muted-foreground" title={itemsText}>
                          {itemsText}
                        </div>
                      </TableCell>
                      <TableCell className="max-sm:order-last max-sm:col-span-2 max-sm:p-0">
                        <LifecycleTrack order={order} />
                      </TableCell>
                      <TableCell
                        className="text-right whitespace-nowrap text-muted-foreground tabular max-sm:hidden"
                        title={new Date(order.updatedAt).toLocaleString()}
                      >
                        {relative(order.updatedAt, now)}
                      </TableCell>
                      <TableCell className="pr-0 text-right max-sm:p-0">
                        <div className="flex items-center justify-end gap-1">
                          {cancelable && (
                            <Button variant="ghost" size="sm" className="text-negative hover:text-negative" disabled={paying || canceling} onClick={() => handleCancel(order.id)}>
                              {canceling ? 'Cancelling…' : 'Cancel'}
                            </Button>
                          )}
                          {readyToPay && (
                            <Button variant="outline" size="sm" disabled={paying || canceling} onClick={() => handlePay(order.id)}>
                              {paying ? 'Paying…' : 'Pay'}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  )
}
