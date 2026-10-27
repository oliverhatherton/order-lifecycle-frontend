import { Alert, AlertDescription } from '@/components/ui/alert'

export function ErrorBanner({ error }) {
  if (!error) return null
  const message = error.messages?.length ? error.messages.join(', ') : error.message
  return (
    <Alert className="mb-4 border-0 bg-negative-bg text-negative">
      <AlertDescription className="text-negative">
        {message}
        {error.correlationId && <span className="mt-0.5 block font-mono text-xs opacity-80">correlation id {error.correlationId}</span>}
      </AlertDescription>
    </Alert>
  )
}
