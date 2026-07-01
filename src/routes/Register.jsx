import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/useAuth.js'
import { ErrorBanner } from '../components/ErrorBanner.jsx'

const PASSWORD_HINT = 'At least 8 characters, with upper & lower case, a number, and a symbol.'

export function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await register(email, password)
      setDone(true)
    } catch (err) {
      setError(err)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="auth-card">
        <h1>Account created</h1>
        <p style={{ marginBottom: 20 }}>You can now log in with your new account.</p>
        <button type="button" className="btn primary" style={{ width: '100%' }} onClick={() => navigate('/login')}>
          Go to login
        </button>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <h1>Create account</h1>
      <p style={{ marginBottom: 20 }}>Sign up to place and track orders.</p>
      <ErrorBanner error={error} />
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="hint">{PASSWORD_HINT}</span>
        </div>
        <button type="submit" className="btn primary" disabled={submitting} style={{ width: '100%' }}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <div className="switch">
        Already have an account? <Link to="/login">Log in</Link>
      </div>
    </div>
  )
}
