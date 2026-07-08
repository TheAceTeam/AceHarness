"use client"

import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"
import { AlertTriangle, Archive, Eye, RotateCcw, ShieldAlert, Trash2 } from "lucide-react"
import { cn } from "@/lib/core/utils"
import { AlertDialog, AlertDialogPortal } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type ConfirmModalVariant = "default" | "delete" | "archive" | "reset" | "force" | "credential"

type AffectedItem = React.ReactNode | {
  id?: React.Key
  label: React.ReactNode
  description?: React.ReactNode
}

type ConfirmModalProps = {
  open: boolean
  variant?: ConfirmModalVariant
  title?: React.ReactNode
  objectName?: React.ReactNode
  consequence: React.ReactNode
  confirmLabel?: React.ReactNode
  cancelLabel?: React.ReactNode
  requiresText?: string | boolean
  loading?: boolean
  affectedItems?: AffectedItem[]
  onConfirm: () => void | Promise<void>
  onCancel?: () => void
  onOpenChange?: (open: boolean) => void
}

const variantCopy: Record<ConfirmModalVariant, { title: string; confirmLabel: string; icon: React.ElementType; destructive: boolean }> = {
  default: { title: "Confirm action", confirmLabel: "Confirm", icon: AlertTriangle, destructive: false },
  delete: { title: "Delete object", confirmLabel: "Delete", icon: Trash2, destructive: true },
  archive: { title: "Archive object", confirmLabel: "Archive", icon: Archive, destructive: false },
  reset: { title: "Reset object", confirmLabel: "Reset", icon: RotateCcw, destructive: true },
  force: { title: "Force action", confirmLabel: "Force", icon: ShieldAlert, destructive: true },
  credential: { title: "Reveal credential", confirmLabel: "Reveal", icon: Eye, destructive: false },
}

function getAffectedItemKey(item: AffectedItem, index: number) {
  return typeof item === "object" && item !== null && "id" in item && item.id !== undefined ? item.id : index
}

function getAffectedItemContent(item: AffectedItem) {
  if (typeof item === "object" && item !== null && "label" in item) {
    return (
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{item.label}</div>
        {item.description ? <div className="truncate text-xs text-muted-foreground">{item.description}</div> : null}
      </div>
    )
  }

  return <div className="truncate text-sm font-medium text-foreground">{item}</div>
}

function ConfirmModal({
  open,
  variant = "default",
  title,
  objectName,
  consequence,
  confirmLabel,
  cancelLabel = "Cancel",
  requiresText,
  loading = false,
  affectedItems,
  onConfirm,
  onCancel,
  onOpenChange,
}: ConfirmModalProps) {
  const [confirmationText, setConfirmationText] = React.useState("")
  const copy = variantCopy[variant]
  const Icon = copy.icon
  const requiredText = typeof requiresText === "string" ? requiresText : requiresText ? String(objectName ?? "") : ""
  const requiresConfirmationText = requiredText.length > 0
  const canConfirm = !loading && (!requiresConfirmationText || confirmationText.trim() === requiredText)

  React.useEffect(() => {
    if (!open) setConfirmationText("")
  }, [open])

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPortal>
        <AlertDialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-foreground/10 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <AlertDialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-50 grid w-[calc(100vw-2rem)] max-w-md translate-x-[-50%] translate-y-[-50%] gap-5 rounded-xl border border-border bg-popover p-5 shadow-sm outline-none duration-200",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                copy.destructive
                  ? "border-destructive/20 bg-destructive/10 text-destructive"
                  : "border-border bg-card text-muted-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <AlertDialogPrimitive.Title className="text-base font-semibold leading-6 text-foreground">
                {title ?? copy.title}
              </AlertDialogPrimitive.Title>
              {objectName ? (
                <div className="mt-1 truncate text-sm font-medium text-foreground">{objectName}</div>
              ) : null}
              <AlertDialogPrimitive.Description asChild>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">{consequence}</div>
              </AlertDialogPrimitive.Description>
            </div>
          </div>

          {affectedItems?.length ? (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-card">
              {affectedItems.map((item, index) => (
                <div key={getAffectedItemKey(item, index)} className="border-b border-border px-3 py-2 last:border-b-0">
                  {getAffectedItemContent(item)}
                </div>
              ))}
            </div>
          ) : null}

          {requiresConfirmationText ? (
            <div className="grid gap-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="confirm-modal-required-text">
                Type <span className="font-semibold text-foreground">{requiredText}</span> to confirm.
              </label>
              <Input
                id="confirm-modal-required-text"
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.target.value)}
                disabled={loading}
                autoComplete="off"
              />
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel asChild>
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => {
                  onCancel?.()
                }}
              >
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button
                type="button"
                variant={copy.destructive ? "destructive" : "primary"}
                disabled={!canConfirm}
                onClick={(event) => {
                  if (!canConfirm) {
                    event.preventDefault()
                    return
                  }
                  void onConfirm()
                }}
              >
                {loading ? "Working..." : confirmLabel ?? copy.confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPortal>
    </AlertDialog>
  )
}

export { ConfirmModal }
export type { AffectedItem, ConfirmModalProps, ConfirmModalVariant }
