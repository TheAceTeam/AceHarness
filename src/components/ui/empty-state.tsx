import * as React from "react"
import { cn } from "@/lib/core/utils"

type EmptyStateProps = React.HTMLAttributes<HTMLDivElement> & {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  primaryAction?: React.ReactNode
  secondaryAction?: React.ReactNode
}

function EmptyState({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center",
        className
      )}
      {...props}
    >
      {icon ? (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-primary/15 bg-accent text-accent-foreground">
          {icon}
        </div>
      ) : null}
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
      {primaryAction || secondaryAction ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {secondaryAction}
          {primaryAction}
        </div>
      ) : null}
    </div>
  )
}

export { EmptyState }
export type { EmptyStateProps }
