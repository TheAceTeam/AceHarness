export type DockviewOpenMode =
  | "canonical"
  | "session"
  | "split"
  | "compare"
  | "inspect"
  | "preview"

export type DockviewPreferredGroup = "main" | "right" | "bottom" | string

export type DockviewSplitDirection = "left" | "right" | "above" | "below"

export type DockviewActivation = "activate" | "preserve" | "background"

export type DockviewDirtyState =
  | boolean
  | {
      dirty: boolean
      label?: string
      reason?: string
    }

export type DockviewCloseGuard = {
  enabled: boolean
  title?: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
}

export type DockviewCloseBehavior =
  | { type: "close" }
  | { type: "confirm"; guard: DockviewCloseGuard }
  | { type: "prevent"; reason?: string }

export type DockviewTabActionGroup = "run" | "edit" | "view" | "export" | "danger"

export type DockviewContextAction = {
  id: string
  label: string
  group?: DockviewTabActionGroup
  disabled?: boolean
  disabledReason?: string
  danger?: boolean
  order?: number
}

export type DockviewTabPolicyInput = {
  resourceType: string
  resourceId: string
  resourceTitle?: string
  resourceSubtitle?: string
  openMode?: DockviewOpenMode
  preferredGroup?: DockviewPreferredGroup
  restoreKey?: string
  dirtyState?: DockviewDirtyState
  closeGuard?: DockviewCloseGuard
  contextActions?: DockviewContextAction[]
  icon?: string
  title?: string
  subtitle?: string
  splitDirection?: DockviewSplitDirection
  activation?: DockviewActivation
}

export type DockviewTabPolicy = {
  tabId: string
  title: string
  subtitle?: string
  icon?: string
  resourceType: string
  resourceId: string
  openMode: DockviewOpenMode
  preferredGroup: DockviewPreferredGroup
  restoreKey: string
  reuseExisting: boolean
  splitDirection?: DockviewSplitDirection
  activation: DockviewActivation
  closeBehavior: DockviewCloseBehavior
  contextActions: DockviewContextAction[]
}

const ACTION_GROUP_ORDER: Record<DockviewTabActionGroup, number> = {
  run: 0,
  edit: 1,
  view: 2,
  export: 3,
  danger: 4,
}

function normalizeDockviewIdPart(value: string) {
  return encodeURIComponent(value.trim().toLowerCase()).replace(/%20/g, "-")
}

function isSplitLikeOpenMode(openMode: DockviewOpenMode | undefined) {
  return openMode === "split" || openMode === "compare"
}

function isSessionOpenMode(openMode: DockviewOpenMode | undefined) {
  return openMode === "session"
}

export function isDockviewTabDirty(dirtyState: DockviewDirtyState | undefined) {
  if (typeof dirtyState === "boolean") return dirtyState
  return Boolean(dirtyState?.dirty)
}

export function buildStableDockviewTabId(input: {
  resourceType: string
  resourceId: string
  openMode?: DockviewOpenMode
  restoreKey?: string
}) {
  const resourceType = normalizeDockviewIdPart(input.resourceType)
  const resourceId = normalizeDockviewIdPart(input.resourceId)
  const baseId = `${resourceType}:${resourceId}`
  const openMode = input.openMode || "canonical"

  if (isSplitLikeOpenMode(openMode) || isSessionOpenMode(openMode)) {
    const restoreKey = normalizeDockviewIdPart(input.restoreKey || openMode)
    return `${baseId}:${openMode}:${restoreKey}`
  }

  return baseId
}

export function shouldReuseDockviewTab(
  current: Pick<DockviewTabPolicy, "resourceType" | "resourceId" | "openMode" | "tabId">,
  next: Pick<DockviewTabPolicyInput, "resourceType" | "resourceId" | "openMode" | "restoreKey">
) {
  const nextOpenMode = next.openMode || "canonical"
  if (isSplitLikeOpenMode(nextOpenMode)) return false

  const nextTabId = buildStableDockviewTabId(next)
  if (current.tabId === nextTabId) return true

  return (
    !isSplitLikeOpenMode(current.openMode) &&
    current.resourceType === next.resourceType &&
    current.resourceId === next.resourceId
  )
}

export function mergeDockviewContextActions(
  ...actionSets: Array<readonly DockviewContextAction[] | undefined>
) {
  const merged = new Map<string, DockviewContextAction>()

  for (const actions of actionSets) {
    for (const action of actions || []) {
      const group = action.danger ? "danger" : action.group
      merged.set(action.id, { ...action, group })
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    const groupA = ACTION_GROUP_ORDER[a.group || "view"]
    const groupB = ACTION_GROUP_ORDER[b.group || "view"]
    if (groupA !== groupB) return groupA - groupB
    return (a.order || 0) - (b.order || 0) || a.label.localeCompare(b.label)
  })
}

export function groupDockviewContextActions(actions: readonly DockviewContextAction[]) {
  return mergeDockviewContextActions(actions).reduce<Record<DockviewTabActionGroup, DockviewContextAction[]>>(
    (groups, action) => {
      const group = action.group || "view"
      groups[group].push(action)
      return groups
    },
    { run: [], edit: [], view: [], export: [], danger: [] }
  )
}

export function resolveDockviewCloseBehavior(input: Pick<DockviewTabPolicyInput, "dirtyState" | "closeGuard">) {
  if (input.closeGuard?.enabled) {
    return { type: "confirm", guard: input.closeGuard } satisfies DockviewCloseBehavior
  }

  if (isDockviewTabDirty(input.dirtyState)) {
    const dirtyLabel = typeof input.dirtyState === "object" ? input.dirtyState.label : undefined
    return {
      type: "confirm",
      guard: {
        enabled: true,
        title: dirtyLabel ? `Close ${dirtyLabel}?` : "Close dirty tab?",
        message: typeof input.dirtyState === "object" ? input.dirtyState.reason : undefined,
        confirmLabel: "Close",
        cancelLabel: "Cancel",
      },
    } satisfies DockviewCloseBehavior
  }

  return { type: "close" } satisfies DockviewCloseBehavior
}

export function resolveDockviewTabPolicy(input: DockviewTabPolicyInput): DockviewTabPolicy {
  const openMode = input.openMode || "canonical"
  const tabId = buildStableDockviewTabId(input)
  const title = input.title || input.resourceTitle || input.resourceId
  const restoreKey = input.restoreKey || tabId
  const contextActions = mergeDockviewContextActions(input.contextActions)

  return {
    tabId,
    title,
    subtitle: input.subtitle || input.resourceSubtitle,
    icon: input.icon,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    openMode,
    preferredGroup: input.preferredGroup || "main",
    restoreKey,
    reuseExisting: !isSplitLikeOpenMode(openMode),
    splitDirection: input.splitDirection,
    activation: input.activation || "activate",
    closeBehavior: resolveDockviewCloseBehavior(input),
    contextActions,
  }
}
