import { Loader2 } from 'lucide-react'

export function CenterLoading() {
  return (
    <div className="grid min-h-40 place-items-center text-muted-foreground" role="status" aria-label="Loading">
      <Loader2 className="size-5 animate-spin" />
    </div>
  )
}
