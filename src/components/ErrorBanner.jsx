export function ErrorBanner({ error }) {
  if (!error) return null
  const message = error.messages?.length ? error.messages.join(', ') : error.message
  return (
    <div className="banner error">
      {message}
      {error.correlationId && <span className="cid">correlation id: {error.correlationId}</span>}
    </div>
  )
}
