import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * A ranked list: label and value on one line, a 3px proportional bar under
 * it — grey, with the top item in ink so "most first" is seen, not only read.
 * `describe(key)`, when given, puts a tooltip on each label (e.g. what an
 * HTTP status code means).
 *
 * @param {{ rows: Array<{ key: string, value: number }>, formatValue?: (n: number) => string, emptyText?: string, describe?: (key: string) => string }} props
 */
export function BarList({ rows, formatValue = (n) => n.toLocaleString(), emptyText = 'No data yet', describe }) {
  if (!rows || rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>
  }
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div className="divide-y divide-border">
      {rows.map((row, i) => (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 py-2" key={row.key}>
          {describe ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="w-fit max-w-full cursor-help truncate text-[13px] underline decoration-dotted decoration-faint underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {row.key}
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">{describe(row.key)}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="truncate text-[13px]" title={row.key}>
              {row.key}
            </span>
          )}
          <span className="text-right text-[13px] tabular">{formatValue(row.value)}</span>
          <span className="col-span-2 h-[3px] rounded-full">
            <span className={cn('block h-full rounded-full', i === 0 ? 'bg-foreground' : 'bg-input')} style={{ width: `${(row.value / max) * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  )
}
