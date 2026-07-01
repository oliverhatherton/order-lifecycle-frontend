import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api.js'
import { useAuth } from '../lib/useAuth.js'
import { ErrorBanner } from '../components/ErrorBanner.jsx'
import { CenterLoading } from '../components/CenterLoading.jsx'

function formatPrice(price) {
  const n = Number(price)
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—'
}

function quantityInCart(cart, productId) {
  return cart?.items?.find((i) => i.productId === productId)?.quantity ?? 0
}

export function Shop() {
  const { status: authStatus, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pendingIds, setPendingIds] = useState(() => new Set())
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutNotice, setCheckoutNotice] = useState(null)

  const withPending = useCallback((id, fn) => {
    setPendingIds((prev) => new Set(prev).add(id))
    return fn().finally(() => {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    })
  }, [])

  const refetchCart = useCallback(async () => {
    const { data } = await api.getCart()
    setCart(data)
  }, [])

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
  }, [isAuthenticated])

  async function handleSetQuantity(productId, quantity) {
    setError(null)
    await withPending(productId, async () => {
      try {
        if (quantity <= 0) {
          await api.removeCartItem(productId)
        } else {
          await api.setCartItem(productId, quantity)
        }
        await refetchCart()
      } catch (err) {
        setError(err)
      }
    })
  }

  async function handleCheckout() {
    setCheckingOut(true)
    setError(null)
    setCheckoutNotice(null)
    try {
      const { data } = await api.checkout()
      navigate('/orders', { state: { justCheckedOut: data?.id } })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // This cart was already checked out (e.g. a double-click race) —
        // GET /cart lazily starts a fresh one, not a real error.
        setCheckoutNotice('That cart was already checked out — starting a new one.')
        try {
          await refetchCart()
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
        <div className="page-header">
          <div>
            <h1>Shop</h1>
            <p className="subtitle">Browse products and check out to create an order.</p>
          </div>
        </div>
        <div className="auth-card" style={{ margin: '48px auto' }}>
          <h2>Log in to shop</h2>
          <p style={{ marginBottom: 20 }}>You'll need an account to add items to a cart and check out.</p>
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

  const cartItemCount = cart?.items?.reduce((acc, i) => acc + i.quantity, 0) ?? 0

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Shop</h1>
          <p className="subtitle">
            Add items to your cart, then check out — that's the only way to create an order now. Stock is real: an
            item running out mid-checkout fails the order, it doesn't fake success.
          </p>
        </div>
      </div>

      <ErrorBanner error={error} />

      {loading ? (
        <CenterLoading />
      ) : (
        <div className="shop-layout">
          <div className="product-grid">
            {products.length === 0 ? (
              <div className="empty-state">No products available.</div>
            ) : (
              products.map((product) => {
                const qty = quantityInCart(cart, product.id)
                const pending = pendingIds.has(product.id)
                const outOfStock = product.stock === 0
                return (
                  <div className="card product-card" key={product.id}>
                    <div className="card-title">{product.name}</div>
                    {product.description && <p className="product-description">{product.description}</p>}
                    <div className="product-meta">
                      <span className="product-price">{formatPrice(product.price)}</span>
                      <span className={`not-exposed${outOfStock ? ' out-of-stock' : ''}`}>
                        {outOfStock ? 'out of stock' : `${product.stock} in stock`}
                      </span>
                    </div>
                    <div className="qty-stepper">
                      <button
                        type="button"
                        className="btn small"
                        disabled={pending || qty <= 0}
                        onClick={() => handleSetQuantity(product.id, qty - 1)}
                      >
                        −
                      </button>
                      <span className="qty-value mono">{pending ? '…' : qty}</span>
                      <button
                        type="button"
                        className="btn small"
                        disabled={pending || outOfStock || qty >= product.stock}
                        onClick={() => handleSetQuantity(product.id, qty + 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="card cart-panel">
            <div className="card-title">
              Cart
              {cartItemCount > 0 && <span className="not-exposed">{cartItemCount} item{cartItemCount === 1 ? '' : 's'}</span>}
            </div>
            {checkoutNotice && <div className="banner info">{checkoutNotice}</div>}
            {!cart?.items?.length ? (
              <p className="not-exposed">Your cart is empty.</p>
            ) : (
              <ul className="cart-lines">
                {cart.items.map((item) => (
                  <li key={item.productId} className="cart-line">
                    <span className="cart-line-name">
                      {item.quantity}× {item.productName}
                    </span>
                    <button
                      type="button"
                      className="btn small"
                      disabled={pendingIds.has(item.productId)}
                      onClick={() => handleSetQuantity(item.productId, 0)}
                      aria-label={`Remove ${item.productName} from cart`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="btn primary"
              style={{ width: '100%', marginTop: 14 }}
              disabled={checkingOut || !cart?.items?.length}
              onClick={handleCheckout}
            >
              {checkingOut ? 'Checking out…' : 'Checkout'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
