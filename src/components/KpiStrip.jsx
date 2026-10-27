import { cn } from '@/lib/utils'

const COLS = { 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5' }

/**
 * Headline figures as one container split by 1px dividers: label above
 * value, the unit a smaller grey suffix, no icon, no sparkline. A missing
 * value is a grey phrase at label size, never a fake zero. On a phone it
 * becomes a 2-column grid; an odd last cell takes the full width.
 *
 * items: [{ label, value, unit?, sub?, empty?, tone? }]
 */
export function KpiStrip({ items }) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 divide-border overflow-hidden rounded-lg border border-border bg-card md:divide-x',
        COLS[items.length] ?? 'md:grid-cols-4',
      )}
    >
      {items.map((item, i) => {
        const missing = item.value === null || item.value === undefined
        return (
          <div
            key={item.label}
            className={cn(
              'flex min-w-0 flex-col gap-1.5 px-5 py-4',
              'max-md:border-border max-md:[&:nth-child(even)]:border-l max-md:[&:nth-child(n+3)]:border-t',
              i === items.length - 1 && items.length % 2 === 1 && 'max-md:col-span-2',
            )}
          >
            <span className="text-[13px] font-medium text-muted-foreground">{item.label}</span>
            {missing ? (
              <span className="text-[15px] leading-[34px] text-faint">{item.empty ?? '—'}</span>
            ) : (
              <span
                className={cn(
                  'text-[28px] leading-[34px] font-normal whitespace-nowrap tabular',
                  item.tone === 'danger' && 'text-negative',
                  item.tone === 'warning' && 'text-warning',
                )}
              >
                {item.value}
                {item.unit && <span className="ml-0.5 text-[15px] text-muted-foreground">{item.unit}</span>}
              </span>
            )}
            {item.sub && <span className="text-xs leading-4 text-muted-foreground">{item.sub}</span>}
          </div>
        )
      })}
    </div>
  )
}
