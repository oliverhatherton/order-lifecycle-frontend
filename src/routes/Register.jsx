import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/useAuth.js'
import { ErrorBanner } from '../components/ErrorBanner.jsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const PASSWORD_HINT = '8+ characters, upper and lower case, a number and a symbol.'

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
      <div className="max-w-sm pt-4">
        <h1 className="mb-2 text-[22px] leading-7 font-semibold tracking-tight">Account created</h1>
        <p className="mb-5 text-sm text-muted-foreground">{email}</p>
        <Button size="lg" className="h-10 w-full" onClick={() => navigate('/login')}>
          Log in
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-sm pt-4">
      <h1 className="mb-5 text-[22px] leading-7 font-semibold tracking-tight">Create an account</h1>
      <ErrorBanner error={error} />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="password-hint"
            className="h-10"
          />
          <span id="password-hint" className="text-xs text-muted-foreground">
            {PASSWORD_HINT}
          </span>
        </div>
        <Button type="submit" size="lg" className="mt-1 h-10" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-4 text-[13px] text-muted-foreground">
        Already have one?{' '}
        <Link to="/login" className="text-foreground hover:underline">
          Log in
        </Link>
      </p>
    </div>
  )
}
