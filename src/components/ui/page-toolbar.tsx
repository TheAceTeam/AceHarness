"use client"

import * as React from "react"
import { cn } from "@/lib/core/utils"

type PageToolbarProps = React.HTMLAttributes<HTMLDivElement> & {
  search?: React.ReactNode
  filters?: React.ReactNode
  sort?: React.ReactNode
  viewToggle?: React.ReactNode
  refresh?: React.ReactNode
  actions?: React.ReactNode
  activeFilters?: React.ReactNode
}

function PageToolbar({
  search,
  filters,
  sort,
  viewToggle,
  refresh,
  actions,
  activeFilters,
  className,
  children,
  ...props
}: PageToolbarProps) {
  return (
    <div
      className={cn("border-b border-border bg-card px-6 py-3", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {search ? <div className="min-w-[220px] flex-1 sm:max-w-sm">{search}</div> : null}
        {filters}
        <div className="min-w-0 flex-1" />
        {sort}
        {viewToggle}
        {refresh}
        {actions}
        {children}
      </div>
      {activeFilters ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">{activeFilters}</div>
      ) : null}
    </div>
  )
}

export { PageToolbar }
export type { PageToolbarProps }
