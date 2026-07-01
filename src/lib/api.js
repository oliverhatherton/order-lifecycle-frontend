// Thin fetch wrapper for the Order Lifecycle API.
//
// - Access token lives only in this module's closure (never localStorage),
//   per the integration guide's XSS-blast-radius rationale.
// - Every request sends credentials so the httpOnly refresh cookie rides
//   along, and an x-correlation-id so failures can be traced server-side.
// - A single 401 triggers one shared refresh (in-flight de-duped) and one
//   retry of the original request; a second 401 is treated as "not logged in".

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor({ status, message, error, correlationId }) {
    super(Array.isArray(message) ? message.join(', ') : message || error || `Request failed (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.messages = Array.isArray(message) ? message : message ? [message] : []
    this.error = error
    this.correlationId = correlationId
  }
}

let accessToken = null
const listeners = new Set()

function setAccessToken(token) {
  accessToken = token
  for (const listener of listeners) listener(token)
}

export function getAccessToken() {
  return accessToken
}

// Lets React components (AuthContext) re-render when the token changes,
// without accessToken itself living in React state.
export function subscribeToken(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function correlationId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `cid-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function parseBody(res) {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

let refreshPromise = null

async function doRefresh() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-correlation-id': correlationId() },
    })
      .then(async (res) => {
        if (!res.ok) {
          setAccessToken(null)
          throw new ApiError({ status: res.status, message: 'Session expired', correlationId: res.headers.get('x-correlation-id') })
        }
        const body = await parseBody(res)
        setAccessToken(body?.accessToken ?? null)
        return body?.accessToken ?? null
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

/**
 * @param {string} path e.g. '/orders'
 * @param {{ method?: string, body?: unknown, skipAuthRetry?: boolean }} [options]
 */
export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, skipAuthRetry = false } = options

  const headers = { 'x-correlation-id': correlationId() }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const respCorrelationId = res.headers.get('x-correlation-id') ?? headers['x-correlation-id']

  if (res.status === 401 && !skipAuthRetry && path !== '/auth/login' && path !== '/auth/refresh') {
    try {
      await doRefresh()
    } catch {
      throw new ApiError({ status: 401, message: 'Not authenticated', correlationId: respCorrelationId })
    }
    return apiRequest(path, { ...options, skipAuthRetry: true })
  }

  const parsed = await parseBody(res)

  if (!res.ok) {
    throw new ApiError({
      status: res.status,
      message: parsed?.message,
      error: parsed?.error,
      correlationId: respCorrelationId,
    })
  }

  return { data: parsed, correlationId: respCorrelationId }
}

export const api = {
  register: (email, password) => apiRequest('/auth/register', { method: 'POST', body: { email, password } }),
  login: (email, password) => apiRequest('/auth/login', { method: 'POST', body: { email, password } }).then((res) => {
    setAccessToken(res.data?.accessToken ?? null)
    return res
  }),
  refresh: () => doRefresh(),
  me: () => apiRequest('/auth/me'),
  logout: () => setAccessToken(null),

  // POST /orders no longer exists — an order can only be created by checking
  // out a cart (see cart.* below).
  listOrders: () => apiRequest('/orders'),
  getOrder: (id) => apiRequest(`/orders/${id}`),
  // 409 means the order wasn't RESERVED or was already paid — the atomic
  // Postgres claim makes this safe to no-op rather than treat as a real error.
  payOrder: (id) => apiRequest(`/orders/${id}/pay`, { method: 'POST' }),
  // 409 means the order is past the point of no return (payment already
  // initiated, or already terminal) — treat as "too late," not an error.
  cancelOrder: (id) => apiRequest(`/orders/${id}/cancel`, { method: 'POST' }),

  listProducts: () => apiRequest('/products'),
  getCart: () => apiRequest('/cart'),
  // Upserts (sets, doesn't add to) a line item's quantity.
  setCartItem: (productId, quantity) => apiRequest('/cart/items', { method: 'POST', body: { productId, quantity } }),
  removeCartItem: (productId) => apiRequest(`/cart/items/${productId}`, { method: 'DELETE' }),
  // The only way to create an order. One-shot: a second checkout call on the
  // same cart gets a 409, not a duplicate order.
  checkout: () => apiRequest('/cart/checkout', { method: 'POST' }),

  listUsers: () => apiRequest('/admin/users'),
  disableUser: (id) => apiRequest(`/admin/users/${id}/disable`, { method: 'PATCH' }),
  enableUser: (id) => apiRequest(`/admin/users/${id}/enable`, { method: 'PATCH' }),

  // Durable, resolution-bucketed history (Postgres-backed, survives restarts) —
  // distinct from the in-memory Prometheus /metrics scrape. Requires auth.
  metricsHistory: (metric, { resolution = 'raw', from, to } = {}) => {
    const params = new URLSearchParams({ metric, resolution })
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return apiRequest(`/metrics/history?${params.toString()}`)
  },
}

export { API_BASE }
