"use client"

import * as React from "react"
import { cn } from "@/lib/core/utils"
import { Button, type ButtonProps } from "@/components/ui/button"
import {
  DetailDrawer,
  DetailDrawerBody,
  DetailDrawerContent,
  DetailDrawerDescription,
  DetailDrawerFooter,
  DetailDrawerHeader,
  DetailDrawerTitle,
} from "@/components/ui/detail-drawer"
import { FormSection } from "@/components/ui/form-section"
import { StatusPill } from "@/components/ui/status-pill"

const DrawerFormSection = FormSection as React.ComponentType<{
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
}>

type ObjectEditDrawerMode = "create" | "edit" | "duplicate" | "view"

type ObjectEditDrawerAction = {
  label: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  variant?: ButtonProps["variant"]
  type?: ButtonProps["type"]
}

type ObjectEditDrawerSection = {
  id: string
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  content: React.ReactNode
}

type ObjectEditDrawerStatus = React.ReactNode | {
  label: React.ReactNode
  tone?: React.ComponentProps<typeof StatusPill>["tone"]
}

type ObjectEditDrawerProps = {
  open: boolean
  mode?: ObjectEditDrawerMode
  title: React.ReactNode
  subtitle?: React.ReactNode
  status?: ObjectEditDrawerStatus
  dirty?: boolean
  saving?: boolean
  saveAction?: ObjectEditDrawerAction
  cancelAction?: ObjectEditDrawerAction
  secondaryActions?: ObjectEditDrawerAction[]
  dangerActions?: ObjectEditDrawerAction[]
  sections?: ObjectEditDrawerSection[]
  children?: React.ReactNode
  widthClassName?: string
  className?: string
  bodyClassName?: string
  onOpenChange?: (open: boolean) => void
  onRequestDiscard?: () => void | boolean | Promise<boolean>
}

function renderDrawerAction(action: ObjectEditDrawerAction, index: number, fallbackVariant: ButtonProps["variant"] = "outline") {
  return (
    <Button
      key={index}
      type={action.type ?? "button"}
      variant={action.variant ?? fallbackVariant}
      disabled={action.disabled || action.loading}
      onClick={action.onClick}
    >
      {action.loading ? "Working..." : action.label}
    </Button>
  )
}

function renderStatus(status: ObjectEditDrawerStatus) {
  if (typeof status === "object" && status !== null && "label" in status) {
    return <StatusPill tone={status.tone}>{status.label}</StatusPill>
  }

  return status
}

function ObjectEditDrawer({
  open,
  mode = "edit",
  title,
  subtitle,
  status,
  dirty = false,
  saving = false,
  saveAction,
  cancelAction,
  secondaryActions,
  dangerActions,
  sections,
  children,
  widthClassName = "w-[min(520px,calc(100vw-1rem))]",
  className,
  bodyClassName,
  onOpenChange,
  onRequestDiscard,
}: ObjectEditDrawerProps) {
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && dirty && onRequestDiscard) {
        const result = onRequestDiscard()
        if (typeof result === "boolean") {
          if (result) onOpenChange?.(false)
          return
        }
        if (result && typeof result === "object" && "then" in result) {
          void result.then((shouldClose) => {
            if (shouldClose) onOpenChange?.(false)
          })
          return
        }
        return
      }

      onOpenChange?.(nextOpen)
    },
    [dirty, onOpenChange, onRequestDiscard]
  )

  const resolvedSaveAction = saveAction
    ? { ...saveAction, loading: saveAction.loading ?? saving, disabled: saveAction.disabled || saving }
    : undefined
  const resolvedCancelAction = cancelAction ?? { label: "Cancel", onClick: () => handleOpenChange(false) }

  return (
    <DetailDrawer open={open} onOpenChange={handleOpenChange}>
      <DetailDrawerContent widthClassName={widthClassName} className={className}>
        <DetailDrawerHeader>
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase text-muted-foreground">{mode}</span>
                {dirty ? <StatusPill tone="warning">Unsaved</StatusPill> : null}
                {status ? renderStatus(status) : null}
              </div>
              <DetailDrawerTitle>{title}</DetailDrawerTitle>
              {typeof subtitle === "string" ? (
                <DetailDrawerDescription>{subtitle}</DetailDrawerDescription>
              ) : subtitle ? (
                <div className="mt-1 text-sm leading-5 text-muted-foreground">{subtitle}</div>
              ) : null}
            </div>
          </div>
        </DetailDrawerHeader>

        <DetailDrawerBody className={cn("pb-6", bodyClassName)}>
          <div className="grid gap-0">
            {sections?.map((section) => (
              <DrawerFormSection key={section.id} title={section.title} description={section.description} actions={section.actions}>
                {section.content}
              </DrawerFormSection>
            ))}
            {children}
          </div>
          {dangerActions?.length ? (
            <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
              <div className="text-sm font-semibold text-foreground">Danger zone</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {dangerActions.map((action, index) => renderDrawerAction(action, index, "outline"))}
              </div>
            </div>
          ) : null}
        </DetailDrawerBody>

        <DetailDrawerFooter className="sticky bottom-0 z-10 flex-wrap justify-between">
          <div className="flex flex-wrap gap-2">
            {secondaryActions?.map((action, index) => renderDrawerAction(action, index, "outline"))}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {renderDrawerAction(resolvedCancelAction, -1, "outline")}
            {resolvedSaveAction ? renderDrawerAction(resolvedSaveAction, -2, "primary") : null}
          </div>
        </DetailDrawerFooter>
      </DetailDrawerContent>
    </DetailDrawer>
  )
}

export { ObjectEditDrawer }
export type {
  ObjectEditDrawerAction,
  ObjectEditDrawerMode,
  ObjectEditDrawerProps,
  ObjectEditDrawerSection,
  ObjectEditDrawerStatus,
}
