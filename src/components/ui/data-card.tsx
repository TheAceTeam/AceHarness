"use client"

import * as React from "react"
import { cn } from "@/lib/core/utils"

type DataCardProps = React.HTMLAttributes<HTMLDivElement> & {
  selected?: boolean
  disabled?: boolean
}

function DataCard({ selected, disabled, className, ...props }: DataCardProps) {
  return (
    <div
      data-state={selected ? "selected" : undefined}
      aria-disabled={disabled || undefined}
      className={cn(
        "rounded-xl border border-border bg-card p-4 text-foreground shadow-none transition-colors hover:border-muted-foreground/35 hover:bg-muted/20",
        selected && "border-primary/40 ring-1 ring-primary/25",
        disabled && "pointer-events-none opacity-55",
        className
      )}
      {...props}
    />
  )
}

function DataCardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-3", className)} {...props} />
}

function DataCardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 truncate text-sm font-semibold text-foreground", className)} {...props} />
}

function DataCardDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-1 text-sm leading-5 text-muted-foreground", className)} {...props} />
}

function DataCardMeta({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground", className)} {...props} />
}

function DataCardActions({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4 flex items-center justify-end gap-2", className)} {...props} />
}

export {
  DataCard,
  DataCardHeader,
  DataCardTitle,
  DataCardDescription,
  DataCardMeta,
  DataCardActions,
}
export type { DataCardProps }
