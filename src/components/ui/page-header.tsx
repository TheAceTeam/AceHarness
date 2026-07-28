"use client"

import * as React from "react"
import { cn } from "@/lib/core/utils"

type PageHeaderProps = React.HTMLAttributes<HTMLElement> & {
  title: React.ReactNode
  subtitle?: React.ReactNode
  eyebrow?: React.ReactNode
  status?: React.ReactNode
  leading?: React.ReactNode
  primaryAction?: React.ReactNode
  secondaryActions?: React.ReactNode
  overflowActions?: React.ReactNode
}

function PageHeader({
  title,
  subtitle,
  eyebrow,
  status,
  leading,
  primaryAction,
  secondaryActions,
  overflowActions,
  className,
  children,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex min-w-0 items-start justify-between gap-4 border-b border-border bg-card px-6 py-4",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {leading ? <div className="shrink-0 pt-0.5">{leading}</div> : null}
        <div className="min-w-0">
          {eyebrow ? (
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-xl font-semibold leading-7 text-foreground">
              {title}
            </h1>
            {status}
          </div>
          {subtitle ? (
            <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
          {children}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {secondaryActions}
        {overflowActions}
        {primaryAction}
      </div>
    </header>
  )
}

export { PageHeader }
export type { PageHeaderProps }
