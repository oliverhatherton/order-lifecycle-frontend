import { Link } from 'react-router-dom'
import { useAuth } from '../lib/useAuth.js'

export function Home() {
  const { isAuthenticated } = useAuth()

  return (
    <div>
      <div className="section-heading" style={{ marginTop: 8 }}>
        <h1 style={{ fontSize: 26 }}>Order Lifecycle</h1>
      </div>
      <p style={{ maxWidth: 640, marginBottom: 28 }}>
        A demo UI for a NestJS backend that models an async order-fulfilment pipeline: JWT auth with rotating
        httpOnly refresh tokens, orders that move through <code>PENDING → RESERVED → PAID → COMPLETED</code> over
        RabbitMQ, and a live Prometheus metrics feed.
      </p>

      <div className="grid cols-2">
        <Link to={isAuthenticated ? '/orders' : '/register'} className="card" style={{ textDecoration: 'none' }}>
          <div className="card-title">Orders</div>
          <p>Place an order and watch it move through the fulfilment pipeline in real time.</p>
        </Link>
        <Link to="/metrics" className="card" style={{ textDecoration: 'none' }}>
          <div className="card-title">Metrics</div>
          <p>Live system, API, order-processing and messaging metrics scraped straight from the backend.</p>
        </Link>
      </div>

      <div className="section-heading">
        <h2>Auth model</h2>
        <div className="rule" />
      </div>
      <p style={{ maxWidth: 640 }}>
        The access token is kept in memory only (never <code>localStorage</code>) and sent as{' '}
        <code>Authorization: Bearer</code>. The refresh token lives in an httpOnly cookie the browser manages —
        this page never reads it. A 401 triggers one silent refresh-and-retry before dropping back to login.
      </p>
    </div>
  )
}
