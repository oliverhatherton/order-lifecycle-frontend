/** Bare tooltip box: label and value, no arrow. Floats, so it may cast a shadow. */
export function ChartTooltipBox({ children }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-popover px-2 py-1.5 text-xs text-muted-foreground shadow-lg">
      {children}
    </div>
  )
}
