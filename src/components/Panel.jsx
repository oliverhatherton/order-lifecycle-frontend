import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * A card on the sheet: shadcn's Card with this app's one radius and a 1px
 * edge instead of the ring, a 16px title and an optional grey meta or
 * control on the right of the header.
 */
export function Panel({ title, meta, action, className, contentClassName, children }) {
  return (
    <Card className={cn('gap-4 rounded-lg bg-card py-5 ring-0 border border-border', className)}>
      {(title || meta || action) && (
        <CardHeader className="px-5 max-sm:grid-cols-1">
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
          {(meta || action) && (
            <CardAction className="flex flex-wrap items-center gap-3 text-xs text-faint tabular max-sm:col-start-1 max-sm:row-start-2 max-sm:justify-self-start">
              {meta}
              {action}
            </CardAction>
          )}
        </CardHeader>
      )}
      <CardContent className={cn('px-5', contentClassName)}>{children}</CardContent>
    </Card>
  )
}

/** The screen's title row: a 22px noun, one short grey line, real actions only. */
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-7 font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Grey "nothing here" line inside the block's own frame. */
export function EmptyState({ children, className, ...props }) {
  return (
    <div className={cn('rounded-lg border border-dashed border-input px-4 py-3.5 text-sm text-muted-foreground', className)} {...props}>
      {children}
    </div>
  )
}
