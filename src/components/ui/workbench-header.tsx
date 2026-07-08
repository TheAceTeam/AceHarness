"use client"

import * as React from "react"
import { MoreHorizontal } from "lucide-react"

import { Button, type ButtonProps } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { StatusPill } from "@/components/ui/status-pill"
import { cn } from "@/lib/core/utils"

type WorkbenchActionGroup = "run" | "edit" | "view" | "export" | "danger"

type WorkbenchAction = {
  id: string
  label: React.ReactNode
  icon?: React.ReactNode
  group?: WorkbenchActionGroup
  variant?: ButtonProps["variant"]
  className?: string
  disabled?: boolean
  disabledReason?: string
  loading?: boolean
  href?: string
  onSelect?: () => void
}

type WorkbenchTab = {
  id: string
  label: React.ReactNode
  active?: boolean
  disabled?: boolean
  onSelect?: () => void
}

type WorkbenchModeOption = {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

type WorkbenchStatus = {
  label: React.ReactNode
  tone?: React.ComponentProps<typeof StatusPill>["tone"]
  dot?: boolean
}

type WorkbenchMetadataItem = {
  label?: React.ReactNode
  value: React.ReactNode
}

type WorkbenchHeaderProps = React.HTMLAttributes<HTMLElement> & {
  objectName: React.ReactNode
  objectType?: React.ReactNode
  mode?: string
  modeOptions?: WorkbenchModeOption[]
  onModeChange?: (mode: string) => void
  status?: React.ReactNode | WorkbenchStatus
  primaryAction?: WorkbenchAction
  secondaryActions?: WorkbenchAction[]
  overflowActions?: WorkbenchAction[]
  tabs?: WorkbenchTab[]
  dirty?: boolean
  running?: boolean
  breadcrumbs?: React.ReactNode
  metadata?: React.ReactNode | WorkbenchMetadataItem[]
  leading?: React.ReactNode
}

const ACTION_GROUP_LABELS: Record<WorkbenchActionGroup, string> = {
  run: "Run",
  edit: "Edit",
  view: "View",
  export: "Export",
  danger: "Danger",
}

const ACTION_GROUP_ORDER: WorkbenchActionGroup[] = ["run", "edit", "view", "export", "danger"]

function getActionGroup(action: WorkbenchAction): WorkbenchActionGroup {
  if (action.variant === "destructive") return "danger"
  return action.group || "edit"
}

function groupActions(actions: readonly WorkbenchAction[]) {
  return actions.reduce<Record<WorkbenchActionGroup, WorkbenchAction[]>>(
    (groups, action) => {
      groups[getActionGroup(action)].push(action)
      return groups
    },
    { run: [], edit: [], view: [], export: [], danger: [] }
  )
}

function sortActionsByGroup(actions: readonly WorkbenchAction[]) {
  return [...actions].sort((a, b) => {
    return ACTION_GROUP_ORDER.indexOf(getActionGroup(a)) - ACTION_GROUP_ORDER.indexOf(getActionGroup(b))
  })
}

function renderActionContent(action: WorkbenchAction) {
  return (
    <>
      {action.icon ? <span className="shrink-0">{action.icon}</span> : null}
      <span className="truncate">{action.loading ? "Working..." : action.label}</span>
    </>
  )
}

function WorkbenchActionButton({
  action,
  primary = false,
}: {
  action: WorkbenchAction
  primary?: boolean
}) {
  const variant = action.variant || (primary ? "primary" : "default")
  const disabled = action.disabled || action.loading
  const className = cn("max-w-[11rem] gap-2", action.className)

  if (action.href) {
    return (
      <Button asChild size="sm" variant={variant} className={className} aria-disabled={disabled}>
        <a href={disabled ? undefined : action.href} title={action.disabledReason}>
          {renderActionContent(action)}
        </a>
      </Button>
    )
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      className={className}
      disabled={disabled}
      title={action.disabledReason}
      onClick={action.onSelect}
    >
      {renderActionContent(action)}
    </Button>
  )
}

function WorkbenchOverflowMenu({ actions }: { actions: readonly WorkbenchAction[] }) {
  if (actions.length === 0) return null

  const groups = groupActions(actions)
  const populatedGroups = ACTION_GROUP_ORDER.filter((group) => groups[group].length > 0)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="default" size="icon" className="h-9 w-9" aria-label="More workbench actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {populatedGroups.map((group, index) => {
          const groupActions = groups[group]

          return (
            <React.Fragment key={group}>
              <DropdownMenuLabel>{ACTION_GROUP_LABELS[group]}</DropdownMenuLabel>
              {groupActions.map((action) => (
                <DropdownMenuItem
                  key={action.id}
                  disabled={action.disabled || action.loading}
                  className={cn(group === "danger" && "text-destructive focus:text-destructive")}
                  title={action.disabledReason}
                  onSelect={(event) => {
                    if (action.href) return
                    event.preventDefault()
                    action.onSelect?.()
                  }}
                >
                  {action.href ? (
                    <a href={action.href} className="flex min-w-0 flex-1 items-center gap-2">
                      {renderActionContent(action)}
                    </a>
                  ) : (
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      {renderActionContent(action)}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
              {index < populatedGroups.length - 1 ? <DropdownMenuSeparator /> : null}
            </React.Fragment>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function WorkbenchStatusBadge({ status }: { status?: React.ReactNode | WorkbenchStatus }) {
  if (!status) return null
  if (React.isValidElement(status)) return status
  if (typeof status !== "object" || !("label" in status)) return <>{status}</>

  return (
    <StatusPill tone={status.tone || "neutral"} dot={status.dot ?? true}>
      {status.label}
    </StatusPill>
  )
}

function WorkbenchMetadata({ metadata }: { metadata?: React.ReactNode | WorkbenchMetadataItem[] }) {
  if (!metadata) return null
  if (!Array.isArray(metadata)) return <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">{metadata}</div>

  return (
    <dl className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {metadata.map((item, index) => (
        <div key={index} className="flex min-w-0 items-center gap-1.5">
          {item.label ? <dt className="shrink-0">{item.label}</dt> : null}
          <dd className="truncate text-foreground/80">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function WorkbenchModeSwitch({
  mode,
  modeOptions,
  onModeChange,
}: {
  mode?: string
  modeOptions?: WorkbenchModeOption[]
  onModeChange?: (mode: string) => void
}) {
  if (!mode) return null

  if (!modeOptions?.length) {
    return (
      <span className="inline-flex h-7 items-center rounded-md border border-border bg-muted px-2 text-xs font-medium text-muted-foreground">
        {mode}
      </span>
    )
  }

  return (
    <ButtonGroup className="h-8">
      {modeOptions.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={option.value === mode ? "secondary" : "default"}
          className="h-8 px-2.5 text-xs"
          disabled={option.disabled}
          aria-pressed={option.value === mode}
          onClick={() => onModeChange?.(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </ButtonGroup>
  )
}

function WorkbenchTabs({ tabs }: { tabs?: WorkbenchTab[] }) {
  if (!tabs?.length) return null

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-t border-border px-4 py-1.5">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          disabled={tab.disabled}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "h-8 shrink-0 rounded-md px-3 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
            tab.active && "bg-muted text-foreground"
          )}
          onClick={tab.onSelect}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function WorkbenchHeader({
  objectName,
  objectType,
  mode,
  modeOptions,
  onModeChange,
  status,
  primaryAction,
  secondaryActions = [],
  overflowActions = [],
  tabs,
  dirty,
  running,
  breadcrumbs,
  metadata,
  leading,
  className,
  children,
  ...props
}: WorkbenchHeaderProps) {
  const sortedSecondaryActions = sortActionsByGroup(secondaryActions)
  const visibleSecondaryActions = sortedSecondaryActions
    .filter((action) => getActionGroup(action) !== "danger")
    .slice(0, 4)
  const visibleSecondaryActionIds = new Set(visibleSecondaryActions.map((action) => action.id))
  const collapsedSecondaryActions = sortedSecondaryActions.filter((action) => !visibleSecondaryActionIds.has(action.id))
  const allOverflowActions = sortActionsByGroup([...collapsedSecondaryActions, ...overflowActions])

  return (
    <header
      className={cn("min-w-0 border-b border-border bg-card text-foreground", className)}
      {...props}
    >
      <div className="flex min-w-0 items-start justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {leading ? <div className="shrink-0 pt-0.5">{leading}</div> : null}
          <div className="min-w-0 flex-1">
            {breadcrumbs ? (
              <div className="mb-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                {breadcrumbs}
              </div>
            ) : null}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {objectType ? (
                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                  {objectType}
                </span>
              ) : null}
              <h1 className="min-w-0 truncate text-lg font-semibold leading-7">
                {objectName}
              </h1>
              <WorkbenchStatusBadge status={status} />
              {dirty ? <StatusPill tone="warning">Unsaved</StatusPill> : null}
              {running ? <StatusPill tone="info">Running</StatusPill> : null}
            </div>
            <WorkbenchMetadata metadata={metadata} />
            {children}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <WorkbenchModeSwitch mode={mode} modeOptions={modeOptions} onModeChange={onModeChange} />
          {visibleSecondaryActions.map((action) => (
            <WorkbenchActionButton key={action.id} action={action} />
          ))}
          <WorkbenchOverflowMenu actions={allOverflowActions} />
          {primaryAction ? <WorkbenchActionButton action={primaryAction} primary /> : null}
        </div>
      </div>
      <WorkbenchTabs tabs={tabs} />
    </header>
  )
}

export { WorkbenchHeader, WorkbenchActionButton, WorkbenchOverflowMenu }
export type {
  WorkbenchAction,
  WorkbenchActionGroup,
  WorkbenchHeaderProps,
  WorkbenchMetadataItem,
  WorkbenchModeOption,
  WorkbenchStatus,
  WorkbenchTab,
}
