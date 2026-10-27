import { useEffect, useReducer, useRef } from 'react'
import { Link } from 'react-router-dom'
import { LifecycleTrack } from './LifecycleTrack.jsx'
import { OrderStatus } from './StatusBadge.jsx'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/**
 * The backend's order rules, run in the browser so a visitor can poke them:
 * the same transitions as order-state-machine.ts, the RESERVED gate, the
 * outbox → queue → consumer hops, and the inbox skipping a redelivered
 * message. Nothing here calls the API; the shop is where the real one runs.
 */

const HOP_MS = 650
const ITEM = '1× Carbon Race Helmet'

const initial = {
  order: null, // { id, status, paymentInitiatedAt }
  stock: true,
  approve: true,
  log: [],
  processed: [], // message ids each consumer has already handled
  lastDelivered: null, // { id, consumer }
  busy: false,
}

let sequence = 0
const nextId = (prefix) => `${prefix}${(++sequence).toString(16).padStart(4, '0')}`

function entry(who, what, kind) {
  return { key: nextId('l'), who, what, kind }
}

function reducer(state, action) {
  switch (action.type) {
    case 'toggle':
      return { ...state, [action.field]: !state[action.field] }
    case 'reset':
      return { ...initial, stock: state.stock, approve: state.approve }
    case 'checkout': {
      const id = `${Math.random().toString(16).slice(2, 10)}`
      return {
        ...initial,
        stock: state.stock,
        approve: state.approve,
        busy: true,
        order: { id, status: 'PENDING', paymentInitiatedAt: null },
        log: [entry('api', `Created · order.created queued`)],
      }
    }
    case 'deliver': {
      const { consumer, messageId } = action
      if (state.processed.includes(`${consumer}:${messageId}`)) {
        return {
          ...state,
          busy: false,
          log: [...state.log, entry(consumer, `Duplicate ${messageId} skipped`, 'skip')],
        }
      }
      const processed = [...state.processed, `${consumer}:${messageId}`]
      const lastDelivered = { consumer, messageId }
      const order = state.order
      if (consumer === 'inventory') {
        if (order.status !== 'PENDING') return { ...state, busy: false }
        return state.stock
          ? {
              ...state,
              processed,
              lastDelivered,
              busy: false,
              order: { ...order, status: 'RESERVED' },
              log: [...state.log, entry('inventory', 'Stock reserved')],
            }
          : {
              ...state,
              processed,
              lastDelivered,
              busy: false,
              order: { ...order, status: 'FAILED' },
              log: [...state.log, entry('inventory', 'Out of stock · failed', 'fail')],
            }
      }
      if (consumer === 'payment') {
        if (order.status !== 'RESERVED') return { ...state, busy: false }
        return state.approve
          ? {
              ...state,
              processed,
              lastDelivered,
              order: { ...order, status: 'PAID' },
              log: [...state.log, entry('payment', 'Charge claimed · authorized')],
            }
          : {
              ...state,
              processed,
              lastDelivered,
              busy: false,
              order: { ...order, status: 'FAILED' },
              log: [...state.log, entry('payment', 'Declined · failed', 'fail')],
            }
      }
      if (consumer === 'completion') {
        if (order.status !== 'PAID') return { ...state, busy: false }
        return {
          ...state,
          processed,
          lastDelivered,
          busy: false,
          order: { ...order, status: 'COMPLETED' },
          log: [...state.log, entry('completion', 'Completed')],
        }
      }
      return state
    }
    case 'pay':
      return {
        ...state,
        busy: true,
        order: { ...state.order, paymentInitiatedAt: new Date().toISOString() },
        log: [...state.log, entry('api', 'Pay claimed')],
      }
    case 'cancel':
      return {
        ...state,
        busy: false,
        order: { ...state.order, status: 'CANCELLED' },
        log: [...state.log, entry('api', state.order.status === 'RESERVED' ? 'Cancelled · stock returned' : 'Cancelled')],
      }
    case 'redeliver':
      return { ...state, busy: true, log: [...state.log, entry('broker', `Redelivering ${state.lastDelivered.messageId}`)] }
    default:
      return state
  }
}

const row = 'flex min-h-[52px] items-center justify-between gap-3 px-5 text-sm'

function Control({ label, onClick, disabled, text = label }) {
  return (
    <div className={row}>
      <span>{label}</span>
      <Button size="sm" variant="secondary" className="min-w-24" onClick={onClick} disabled={disabled}>
        {text}
      </Button>
    </div>
  )
}

export function StateMachineDemo() {
  const [state, dispatch] = useReducer(reducer, initial)
  const timers = useRef([])
  const logRef = useRef(null)

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [state.log.length])

  const later = (fn, delay = HOP_MS) => {
    timers.current.push(setTimeout(fn, delay))
  }

  const deliver = (consumer, messageId, then) => {
    later(() => {
      dispatch({ type: 'deliver', consumer, messageId })
      if (then) then()
    })
  }

  function checkout() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    dispatch({ type: 'checkout' })
    deliver('inventory', nextId('m'))
  }

  function pay() {
    dispatch({ type: 'pay' })
    const paymentMessage = nextId('m')
    deliver('payment', paymentMessage, () => deliver('completion', nextId('m')))
  }

  function redeliver() {
    dispatch({ type: 'redeliver' })
    const { consumer, messageId } = state.lastDelivered
    deliver(consumer, messageId)
  }

  const { order } = state
  const canPay = order?.status === 'RESERVED' && !order.paymentInitiatedAt && !state.busy
  const canCancel = order && (order.status === 'PENDING' || (order.status === 'RESERVED' && !order.paymentInitiatedAt)) && !state.busy
  const canRedeliver = Boolean(state.lastDelivered) && !state.busy

  return (
    <div className="grid overflow-hidden rounded-lg bg-card md:min-h-[560px] md:grid-cols-[minmax(0,1fr)_minmax(250px,38%)]" data-ui>
      <div className="flex min-w-0 flex-col gap-5 bg-sheet p-6 max-md:min-h-80">
        {order ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[13px]">Order {order.id}</div>
                <div className="text-[13px] text-muted-foreground">{ITEM}</div>
              </div>
              <OrderStatus status={order.status} />
            </div>
            <LifecycleTrack order={order} />
          </>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="h-7 font-normal">Step</th>
                <th className="h-7 font-normal">Waits for</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ['Inventory', 'A new order'],
                ['Payment', 'Inventory reserved'],
                ['Completion', 'Payment taken'],
                ['Email', 'Order completed or failed'],
              ].map(([step, waitsFor]) => (
                <tr key={step}>
                  <td className="h-9">{step}</td>
                  <td className="h-9 text-muted-foreground">{waitsFor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ol ref={logRef} aria-live="polite" className="min-h-0 flex-1 divide-y divide-border overflow-auto text-[13px]">
          {state.log.map((l) => (
            <li key={l.key} className="row-in grid grid-cols-[92px_minmax(0,1fr)] gap-3 py-2">
              <span className="font-mono text-xs text-muted-foreground">{l.who}</span>
              <span className={cn(l.kind === 'skip' && 'text-warning', l.kind === 'fail' && 'text-negative')}>{l.what}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col divide-y divide-border py-3">
        <label className={row}>
          <span>Stock</span>
          <Switch checked={state.stock} onCheckedChange={() => dispatch({ type: 'toggle', field: 'stock' })} aria-label="Stock available" />
        </label>
        <label className={row}>
          <span>Card approves</span>
          <Switch checked={state.approve} onCheckedChange={() => dispatch({ type: 'toggle', field: 'approve' })} aria-label="Card approves" />
        </label>
        <Control label="Check out" onClick={checkout} disabled={state.busy} text={order ? 'New order' : 'Check out'} />
        <Control label="Pay" onClick={pay} disabled={!canPay} />
        <Control label="Cancel" onClick={() => dispatch({ type: 'cancel' })} disabled={!canCancel} />
        <Control label="Redeliver" onClick={redeliver} disabled={!canRedeliver} />
        <Control label="Start over" onClick={() => dispatch({ type: 'reset' })} disabled={!order} text="Reset" />
        <p className="mt-auto border-0 px-5 pt-4 pb-1 text-[13px]">
          <Link to="/shop" className="underline underline-offset-4">
            Place a real order
          </Link>
        </p>
      </div>
    </div>
  )
}
