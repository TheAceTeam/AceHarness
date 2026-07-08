"use client"

import * as React from "react"
import { MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/core/utils"

type ActionMenuItem = {
  id: string
  label: React.ReactNode
  icon?: React.ReactNode
  description?: React.ReactNode
  primary?: boolean
  inline?: boolean
  disabled?: boolean
  disabledReason?: React.ReactNode
  destructive?: boolean
  href?: string
  target?: React.HTMLAttributeAnchorTarget
  rel?: string
  onSelect?: () => void
}

type ActionMenuGroup = {
  id?: string
  label?: React.ReactNode
  actions: ActionMenuItem[]
}

type ActionMenuProps = {
  actions: ActionMenuGroup[]
  align?: "start" | "center" | "end"
  side?: "top" | "right" | "bottom" | "left"
  triggerLabel?: string
  trigger?: React.ReactNode
  disabled?: boolean
  className?: string
  contentClassName?: string
}

function splitActionGroups(groups: ActionMenuGroup[]) {
  const regularGroups: ActionMenuGroup[] = []
  const destructiveActions: ActionMenuItem[] = []

  groups.forEach((group) => {
    const regularActions = group.actions.filter((action) => !action.destructive)
    const groupDestructiveActions = group.actions.filter((action) => action.destructive)

    if (regularActions.length > 0) {
      regularGroups.push({ ...group, actions: regularActions })
    }
    destructiveActions.push(...groupDestructiveActions)
  })

  return { regularGroups, destructiveActions }
}

function ActionMenu({
  actions,
  align = "end",
  side = "bottom",
  triggerLabel = "Open actions",
  trigger,
  disabled,
  className,
  contentClassName,
}: ActionMenuProps) {
  const { regularGroups, destructiveActions } = React.useMemo(
    () => splitActionGroups(actions),
    [actions]
  )
  const hasActions = regularGroups.some((group) => group.actions.length > 0) || destructiveActions.length > 0

  if (!hasActions) return null

  const renderAction = (action: ActionMenuItem) => {
    const content = (
      <>
        {action.icon ? <span className="mr-2 flex h-4 w-4 shrink-0 items-center justify-center">{action.icon}</span> : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{action.label}</span>
          {action.disabledReason || action.description ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {action.disabled ? action.disabledReason : action.description}
            </span>
          ) : null}
        </span>
      </>
    )

    const itemClassName = cn(
      "min-w-40 gap-0",
      action.destructive && "text-destructive focus:text-destructive"
    )

    if (action.href && !action.disabled) {
      return (
        <DropdownMenuItem key={action.id} asChild className={itemClassName}>
          <a
            href={action.href}
            target={action.target}
            rel={action.rel ?? (action.target === "_blank" ? "noreferrer" : undefined)}
            onClick={(event) => {
              event.stopPropagation()
              action.onSelect?.()
            }}
          >
            {content}
          </a>
        </DropdownMenuItem>
      )
    }

    return (
      <DropdownMenuItem
        key={action.id}
        disabled={action.disabled}
        className={itemClassName}
        onClick={(event) => event.stopPropagation()}
        onSelect={(event) => {
          event.stopPropagation()
          if (action.disabled) {
            event.preventDefault()
            return
          }
          action.onSelect?.()
        }}
      >
        {content}
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {trigger ?? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={triggerLabel}
            className={cn("h-8 w-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground", className)}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={side}
        className={cn("min-w-44 border-border bg-card text-foreground shadow-sm", contentClassName)}
        onClick={(event) => event.stopPropagation()}
      >
        {regularGroups.map((group, groupIndex) => (
          <React.Fragment key={group.id ?? `group-${groupIndex}`}>
            {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
            {group.label ? <DropdownMenuLabel>{group.label}</DropdownMenuLabel> : null}
            {group.actions.map(renderAction)}
          </React.Fragment>
        ))}
        {destructiveActions.length > 0 ? (
          <>
            {regularGroups.length > 0 ? <DropdownMenuSeparator /> : null}
            {destructiveActions.map(renderAction)}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ActionMenu }
export type { ActionMenuGroup, ActionMenuItem, ActionMenuProps }
