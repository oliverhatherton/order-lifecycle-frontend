import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api.js'
import { useAuth } from '../lib/useAuth.js'
import { useCartEditor } from '../lib/useCartEditor.js'
import { ErrorBanner } from '../components/ErrorBanner.jsx'
import { CenterLoading } from '../components/CenterLoading.jsx'
import { SignInGate } from '../components/SignInGate.jsx'
import { EmptyState, PageHeader, Panel } from '../components/Panel.jsx'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { Minus, Plus, X } from 'lucide-react'

/** At or below this many units a product is flagged as running low (matches the backend's replenishment threshold). */
const LOW_STOCK = 10

export function Shop() {
  const { status: authStatus, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutNotice, setCheckoutNotice] = useState(null)
  const { cart, setCart, quantityOf, overrides, setQuantity, flush } = useCartEditor({ onError: setError })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!isAuthenticated) {
        if (!cancelled) setLoading(false)
        return
      }
      try {
        const [productsRes, cartRes] = await Promise.all([api.listProducts(), api.getCart()])
        if (cancelled) return
        setProducts(productsRes.data ?? [])
        setCart(cartRes.data)
      } catch (err) {
        if (!cancelled) setError(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, setCart])

  function handleSetQuantity(product, quantity) {
    setError(null)
    setQuantity(product.id, Math.min(Math.max(quantity, 0), product.stock))
  }

  async function handleCheckout() {
    setCheckingOut(true)
    setError(null)
    setCheckoutNotice(null)
    try {
      // Unsent quantity changes go first, so the order matches what's shown.
      if (!(await flush())) return
      const { data } = await api.checkout()
      navigate('/orders', { state: { justCheckedOut: data?.id } })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // This cart was already checked out (e.g. a double-click race) —
        // GET /cart lazily starts a fresh one, not a real error.
        setCheckoutNotice('That cart was already checked out, so a new one has been started.')
        try {
          const { data } = await api.getCart()
          setCart(data)
        } catch (refetchErr) {
          setError(refetchErr)
        }
      } else {
        setError(err)
      }
    } finally {
      setCheckingOut(false)
    }
  }

  if (authStatus === 'loading') return <CenterLoading />

  if (!isAuthenticated) {
    return (
      <div>
        <PageHeader title="Shop" />
        <SignInGate title="Sign in to fill a cart" />
      </div>
    )
  }

  // The server's cart with unconfirmed quantities applied, so the panel
  // matches the steppers while requests are pending.
  const cartLines = (cart?.items ?? [])
    .map((item) => ({ ...item, quantity: quantityOf(item.productId) }))
    .concat(
      [...overrides.keys()]
        .filter((id) => !cart?.items?.some((i) => i.productId === id))
        .map((id) => ({ productId: id, productName: products.find((p) => p.id === id)?.name ?? '', quantity: quantityOf(id) })),
    )
    .filter((item) => item.quantity > 0)
  const cartUnits = cartLines.reduce((acc, i) => acc + i.quantity, 0)
  const maxStock = Math.max(...products.map((p) => p.stock), 1)
  const lowCount = products.filter((p) => p.stock > 0 && p.stock <= LOW_STOCK).length
  const outCount = products.filter((p) => p.stock === 0).length

  const finding = [
    `${products.length} product${products.length === 1 ? '' : 's'}`,
    lowCount ? `${lowCount} running low` : null,
    outCount ? `${outCount} out of stock` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div>
      <PageHeader title="Shop" subtitle={loading ? 'Loading…' : finding} />

      <ErrorBanner error={error} />

      {loading ? (
        <CenterLoading />
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          {products.length === 0 ? (
            <EmptyState>No products yet.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-0 text-xs font-normal text-muted-foreground">Product</TableHead>
                  <TableHead className="text-right text-xs font-normal text-muted-foreground">In stock</TableHead>
                  <TableHead className="pr-0 text-right text-xs font-normal text-muted-foreground">In cart</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => {
                  const qty = quantityOf(product.id)
                  const outOfStock = product.stock === 0
                  const low = product.stock <= LOW_STOCK
                  return (
                    <TableRow key={product.id} className="border-border/60">
                      <TableCell className="py-2.5 pl-0">
                        <div className="font-medium">{product.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{product.sku}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex flex-col items-end gap-1.5">
                          <span className={cn('tabular', low && 'text-warning')}>{outOfStock ? 'Out' : product.stock}</span>
                          <span className="h-[3px] w-24 rounded-full bg-accent" aria-hidden="true">
                            <span
                              className={cn('block h-full rounded-full', low ? 'bg-warning' : 'bg-chart-1')}
                              style={{ width: `${(product.stock / maxStock) * 100}%` }}
                            />
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="pr-0 text-right">
                        <div className="inline-flex items-center rounded-lg border border-input" aria-label={`${product.name} in cart`}>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={checkingOut || qty <= 0}
                            onClick={() => handleSetQuantity(product, qty - 1)}
                            aria-label={`Remove one ${product.name}`}
                          >
                            <Minus />
                          </Button>
                          <span className="min-w-7 text-center text-[13px] tabular">{qty}</span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={checkingOut || qty >= product.stock}
                            onClick={() => handleSetQuantity(product, qty + 1)}
                            aria-label={`Add one ${product.name}`}
                          >
                            <Plus />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}

          <Panel title="Cart" meta={`${cartUnits} unit${cartUnits === 1 ? '' : 's'}`} className="xl:sticky xl:top-4 max-xl:order-first">
            {checkoutNotice && <p className="mb-3 rounded-md bg-info-bg px-3 py-2 text-[13px] text-info">{checkoutNotice}</p>}
            {cartLines.length === 0 ? (
              <p className="mb-4 text-sm text-muted-foreground">Empty</p>
            ) : (
              <ul className="mb-4 divide-y divide-border">
                {cartLines.map((item) => (
                  <li key={item.productId} className="flex min-h-10 items-center justify-between gap-3 text-[13px]">
                    <span>
                      <span className="mr-1.5 text-muted-foreground tabular">{item.quantity}×</span>
                      {item.productName}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      disabled={checkingOut}
                      onClick={() => {
                        setError(null)
                        setQuantity(item.productId, 0)
                      }}
                      aria-label={`Remove ${item.productName} from cart`}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Button size="lg" className="w-full" disabled={checkingOut || cartLines.length === 0} onClick={handleCheckout}>
              {checkingOut ? 'Checking out…' : 'Check out'}
            </Button>
          </Panel>
        </div>
      )}
    </div>
  )
}
