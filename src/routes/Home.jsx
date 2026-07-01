import { Link } from 'react-router-dom'
import { useAuth } from '../lib/useAuth.js'
import { useMetricsPoller } from '../lib/useMetricsPoller.js'
import { formatDuration, scalarValue } from '../lib/prometheus.js'

const PIPELINE = ['PENDING', 'RESERVED', 'PAID', 'COMPLETED']

const FEATURES = [
  {
    title: 'Rotating JWT auth',
    body: 'Short-lived access tokens live in memory only; the refresh token is an httpOnly cookie the browser manages. Reuse of a stolen refresh token revokes the whole family.',
  },
  {
    title: 'Async fulfilment, with one manual gate',
    body: 'Placing an order reserves inventory automatically over RabbitMQ. It then genuinely pauses at RESERVED — nothing charges or completes until you click Pay, which resumes the chain.',
  },
  {
    title: 'Role-based admin',
    body: 'Admins can disable or re-enable accounts. A disabled user is immediately blocked from logging in or refreshing a session.',
  },
  {
    title: 'Live observability',
    body: 'The backend exposes a Prometheus scrape endpoint. This UI reads it directly — no separate metrics store — and charts it in real time.',
  },
]

export function Home() {
  const { isAuthenticated } = useAuth()
  const { families, hasTwoSamples, rate, lastUpdated } = useMetricsPoller(5000)

  const startTime = scalarValue(families.get('process_start_time_seconds'))
  const uptimeSeconds = startTime && lastUpdated ? lastUpdated / 1000 - startTime : null
  const requestsPerSec = hasTwoSamples ? rate('http_request_duration_seconds', { suffix: 'count' }) : null
  const hasStats = families.size > 0

  return (
    <div className="landing">
      <section className="hero">
        <span className="eyebrow">
          <span className="live-dot" /> Live demo backend
        </span>
        <h1>An order-fulfilment pipeline you can watch run.</h1>
        <p className="hero-lead">
          A NestJS backend with JWT auth, async order fulfilment over RabbitMQ, and Prometheus observability — and
          this UI as a real client for all three: place an order, watch it move through the pipeline, and see the
          system metrics update as it happens.
        </p>
        <div className="hero-actions">
          <Link to={isAuthenticated ? '/orders' : '/register'} className="btn primary large">
            {isAuthenticated ? 'Go to orders' : 'Create an account'}
          </Link>
          <Link to="/metrics" className="btn large">
            View live metrics
          </Link>
        </div>

        <div className="pipeline-strip" aria-label="Order lifecycle states">
          {PIPELINE.map((step, i) => (
            <div className="pipeline-step" key={step}>
              <div className="pipeline-node">
                <span className={`badge ${step.toLowerCase()}`}>{step}</span>
                {step === 'RESERVED' && <span className="pipeline-gate">⏸ waits for Pay</span>}
              </div>
              {i < PIPELINE.length - 1 && <span className="pipeline-arrow">→</span>}
            </div>
          ))}
        </div>
      </section>

      <section className="feature-grid">
        {FEATURES.map((f) => (
          <div className="card feature-card" key={f.title}>
            <div className="card-title">{f.title}</div>
            <p>{f.body}</p>
          </div>
        ))}
      </section>

      <section className="live-teaser">
        <div className="live-teaser-copy">
          <div className="section-heading" style={{ margin: 0 }}>
            <h2>Right now, on the backend</h2>
          </div>
          <p>
            These numbers come straight from the same <code>/metrics</code> scrape the full dashboard reads — this
            is a live slice of it, not a mock.
          </p>
          <Link to="/metrics" className="nav-link">
            Open the full metrics dashboard →
          </Link>
        </div>
        <div className="live-teaser-stats">
          <div className="card metric-card">
            <span className="label">Uptime</span>
            <span className="value small">{uptimeSeconds !== null ? formatDuration(uptimeSeconds) : hasStats ? 'not exposed' : '—'}</span>
          </div>
          <div className="card metric-card">
            <span className="label">Requests/sec</span>
            <span className="value small">{requestsPerSec !== null ? requestsPerSec.toFixed(2) : hasTwoSamples ? 'not exposed' : 'collecting…'}</span>
          </div>
          <div className="card metric-card">
            <span className="label">Metric families</span>
            <span className="value small">{hasStats ? families.size : '—'}</span>
          </div>
        </div>
      </section>

      <section className="section-heading">
        <h2>Auth model</h2>
        <div className="rule" />
      </section>
      <p style={{ maxWidth: 640 }}>
        The access token is kept in memory only (never <code>localStorage</code>) and sent as{' '}
        <code>Authorization: Bearer</code>. The refresh token lives in an httpOnly cookie the browser manages —
        this page never reads it. A 401 triggers one silent refresh-and-retry before dropping back to login.
      </p>
    </div>
  )
}
