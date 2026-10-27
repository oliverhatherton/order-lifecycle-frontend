import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

/** The frame and title stay; the first action sits where the data will appear. */
export function SignInGate({ title }) {
  return (
    <div className="max-w-xl rounded-lg bg-card p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      <div className="flex gap-2">
        <Button asChild>
          <Link to="/register">Create account</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/login">Log in</Link>
        </Button>
      </div>
    </div>
  )
}
