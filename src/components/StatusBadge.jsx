import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const TONES = {
  positive: 'bg-positive-bg text-positive',
  negative: 'bg-negative-bg text-negative',
  warning: 'bg-warning-bg text-warning',
  info: 'bg-info-bg text-info',
  neutral: 'bg-secondary text-muted-foreground',
}

const ORDER_TONE = {
  PENDING: 'info',
  RESERVED: 'warning',
  PAID: 'info',
  COMPLETED: 'positive',
  FAILED: 'negative',
  CANCELLED: 'neutral',
}

/** A status as a pale-on-dark tag of its own hue: one per row, never squeezed. */
export function StatusBadge({ tone = 'neutral', className, children }) {
  return <Badge className={cn('h-[22px] flex-none rounded-sm border-0 px-2 font-medium', TONES[tone], className)}>{children}</Badge>
}

export function OrderStatus({ status }) {
  const label = status ? status.charAt(0) + status.slice(1).toLowerCase() : 'Unknown'
  return <StatusBadge tone={ORDER_TONE[status] ?? 'neutral'}>{label}</StatusBadge>
}
