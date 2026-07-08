"use client"

import * as React from "react"
import { cn } from "@/lib/core/utils"
import { Button } from "@/components/ui/button"

type BulkActionBarProps = React.HTMLAttributes<HTMLDivElement> & {
  selectedCount: number
  onClear?: () => void
  actions?: React.ReactNode
}

function BulkActionBar({ selectedCount, onClear, actions, className, children, ...props }: BulkActionBarProps) {
  if (selectedCount <= 0) return null

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-4 z-40 mx-auto flex w-[min(720px,calc(100vw-2rem))] items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm",
        className
      )}
      {...props}
    >
      <div className="min-w-0 text-sm text-foreground">
        Selected <span className="font-semibold">{selectedCount}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {children}
        {actions}
        {onClear ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export { BulkActionBar }
export type { BulkActionBarProps }
