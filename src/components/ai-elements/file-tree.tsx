"use client"

import * as React from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/core/utils"

type FileTreeContextValue = {
  expanded: Set<string>
  selectedPath?: string
  onSelect?: (path: string) => void
  onToggle: (path: string) => void
}

const FileTreeContext = React.createContext<FileTreeContextValue | null>(null)

function useFileTree() {
  const ctx = React.useContext(FileTreeContext)
  if (!ctx) throw new Error("FileTree context missing")
  return ctx
}

export function FileTree({
  expanded,
  defaultExpanded,
  selectedPath,
  onSelect,
  onExpandedChange,
  className,
  children,
}: React.PropsWithChildren<{
  expanded?: Set<string>
  defaultExpanded?: Set<string>
  selectedPath?: string
  onSelect?: (path: string) => void
  onExpandedChange?: (expanded: Set<string>) => void
  className?: string
}>) {
  const [internalExpanded, setInternalExpanded] = React.useState(() => defaultExpanded ?? new Set<string>())
  const mergedExpanded = expanded ?? internalExpanded

  const handleToggle = React.useCallback((path: string) => {
    const next = new Set(mergedExpanded)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    if (expanded === undefined) setInternalExpanded(next)
    onExpandedChange?.(next)
  }, [expanded, mergedExpanded, onExpandedChange])

  const value = React.useMemo<FileTreeContextValue>(() => ({
    expanded: mergedExpanded,
    selectedPath,
    onSelect,
    onToggle: handleToggle,
  }), [mergedExpanded, selectedPath, onSelect, handleToggle])

  return (
    <FileTreeContext.Provider value={value}>
      <div className={cn("flex flex-col", className)}>
        {children}
      </div>
    </FileTreeContext.Provider>
  )
}

export function FileTreeFolder({
  path,
  name,
  className,
  icon,
  actions,
  depth = 0,
  selectOnClick = true,
  children,
}: React.PropsWithChildren<{
  path: string
  name: string
  className?: string
  icon?: React.ReactNode
  actions?: React.ReactNode
  depth?: number
  selectOnClick?: boolean
}>) {
  const { expanded, selectedPath, onSelect, onToggle } = useFileTree()
  const open = expanded.has(path)
  const selected = selectedPath === path || selectedPath?.startsWith(`${path}/`)

  return (
    <div className={className}>
      <button
        type="button"
        className={cn(
          "group flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-[15px] hover:bg-accent hover:text-accent-foreground",
          selected && "bg-accent/70 text-accent-foreground"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          if (selectOnClick) onSelect?.(path)
          onToggle(path)
        }}
      >
        <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-90")} />
        {icon}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {actions ? <span className="ml-1 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">{actions}</span> : null}
      </button>
      {open ? <div>{children}</div> : null}
    </div>
  )
}

export function FileTreeFile({
  path,
  name,
  icon,
  className,
  actions,
  depth = 0,
}: {
  path: string
  name: string
  icon?: React.ReactNode
  className?: string
  actions?: React.ReactNode
  depth?: number
}) {
  const { selectedPath, onSelect } = useFileTree()
  const selected = selectedPath === path

  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-[15px] hover:bg-accent hover:text-accent-foreground",
        selected && "bg-accent text-accent-foreground font-medium",
        className
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => onSelect?.(path)}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {actions ? <span className="ml-1 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">{actions}</span> : null}
    </button>
  )
}
