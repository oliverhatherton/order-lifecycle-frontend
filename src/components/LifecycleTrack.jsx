import { cn } from '@/lib/utils'

const LABELS = ['Reserving', 'Reserved', 'Paid', 'Completed']

/**
 * The four segments for an order, as [state, label] pairs.
 *
 * FAILED and CANCELLED don't record the step they stopped at, so it's
 * inferred: a FAILED order with payment initiated failed at payment,
 * otherwise at reservation (insufficient stock). A CANCELLED order is always
 * pre-payment, but the API doesn't say whether it was PENDING or RESERVED, so
 * the cancel is marked on the first segment rather than claiming a reservation.
 */
function segments({ status, paymentInitiatedAt }) {
  const blank = LABELS.map((label) => ['', label])
  const done = (n) => blank.map((s, i) => (i < n ? ['done', s[1]] : s))
  switch (status) {
    case 'PENDING':
      return blank.map((s, i) => (i === 0 ? ['current', s[1]] : s))
    case 'RESERVED':
      return paymentInitiatedAt
        ? done(2).map((s, i) => (i === 2 ? ['current', 'Paying…'] : s))
        : done(1).map((s, i) => (i === 1 ? ['waiting', 'Pay to continue'] : s))
    case 'PAID':
      return done(3).map((s, i) => (i === 3 ? ['current', s[1]] : s))
    case 'COMPLETED':
      return done(4)
    case 'FAILED':
      return paymentInitiatedAt
        ? done(2).map((s, i) => (i === 2 ? ['failed', 'Payment failed'] : s))
        : blank.map((s, i) => (i === 0 ? ['failed', 'Out of stock'] : s))
    case 'CANCELLED':
      return blank.map((s, i) => (i === 0 ? ['stopped', 'Cancelled'] : s))
    default:
      return blank
  }
}

function describe({ status, paymentInitiatedAt }) {
  if (status === 'RESERVED') return paymentInitiatedAt ? 'Payment in progress' : 'Reserved, waiting for you to pay'
  if (status === 'FAILED') return paymentInitiatedAt ? 'Failed at payment' : 'Failed at reservation'
  if (status === 'CANCELLED') return 'Cancelled before payment'
  return status ? status.charAt(0) + status.slice(1).toLowerCase() : 'Unknown'
}

const BAR = {
  '': 'bg-accent',
  done: 'bg-foreground',
  current: 'bg-chart-1',
  waiting: 'border-2 border-dashed border-chart-1 bg-transparent',
  failed: 'bg-negative',
  stopped: 'bg-input',
}

/**
 * Where one order is in its pipeline, as four segments — the product's own
 * progress bar. The RESERVED gate is drawn dashed while it waits for the
 * owner's Pay click.
 */
export function LifecycleTrack({ order, compact = false }) {
  const label = describe(order)
  return (
    <div className={cn('grid grid-cols-4 gap-[3px]', compact ? 'min-w-40' : 'min-w-56')} role="img" aria-label={label} title={label}>
      {segments(order).map(([state, text], i) => (
        <div key={LABELS[i]} className="flex min-w-0 flex-col gap-1.5">
          <span className={cn('h-1.5 rounded-full', BAR[state])} />
          {!compact && (
            <span
              className={cn(
                'truncate text-[11.5px] leading-3.5',
                state === '' ? 'text-faint' : state === 'failed' ? 'text-negative' : 'text-foreground',
              )}
            >
              {text}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
