"use client"

import * as React from "react"
import { CheckCircle2, Circle, CircleAlert, CircleDot, FileUp, XCircle } from "lucide-react"
import { cn } from "@/lib/core/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { StatusPill } from "@/components/ui/status-pill"

type ImportStage = "select" | "validate" | "preview" | "confirm" | "result"

type ImportSourceOption = {
  id: string
  label: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  disabled?: boolean
  selected?: boolean
  onSelect?: () => void
}

type ImportValidation = {
  status: "idle" | "running" | "success" | "warning" | "error"
  message?: React.ReactNode
  progress?: number
  items?: Array<{ id?: React.Key; label: React.ReactNode; status?: "success" | "warning" | "error"; detail?: React.ReactNode }>
}

type ImportPreviewRow = {
  id: React.Key
  label: React.ReactNode
  action?: "create" | "update" | "skip" | "error"
  description?: React.ReactNode
  values?: Array<{ label: React.ReactNode; value: React.ReactNode }>
}

type ImportConflict = {
  id: React.Key
  label: React.ReactNode
  description?: React.ReactNode
  resolution?: React.ReactNode
}

type ImportResult = {
  status: "success" | "partial" | "error"
  title?: React.ReactNode
  message?: React.ReactNode
  summary?: Array<{ label: React.ReactNode; value: React.ReactNode }>
}

type ImportSlotProps = {
  previewRows: ImportPreviewRow[]
  conflicts: ImportConflict[]
  validation?: ImportValidation
  result?: ImportResult
}

type ImportModalProps = {
  open: boolean
  title?: React.ReactNode
  description?: React.ReactNode
  sourceOptions: ImportSourceOption[]
  currentStage: ImportStage
  stages?: ImportStage[]
  validation?: ImportValidation
  previewRows?: ImportPreviewRow[]
  conflicts?: ImportConflict[]
  result?: ImportResult
  previewContent?: React.ReactNode | ((props: ImportSlotProps) => React.ReactNode)
  confirmContent?: React.ReactNode | ((props: ImportSlotProps) => React.ReactNode)
  footerMeta?: React.ReactNode
  loading?: boolean
  contentClassName?: string
  nextLabel?: React.ReactNode
  applyLabel?: React.ReactNode
  cancelLabel?: React.ReactNode
  onBack?: () => void
  onNext?: () => void
  onApply?: () => void
  onCancel?: () => void
  onOpenChange?: (open: boolean) => void
}

const defaultStages: ImportStage[] = ["select", "validate", "preview", "confirm", "result"]

const stageLabels: Record<ImportStage, string> = {
  select: "Select",
  validate: "Validate",
  preview: "Preview",
  confirm: "Confirm",
  result: "Result",
}

const actionTone: Record<NonNullable<ImportPreviewRow["action"]>, React.ComponentProps<typeof StatusPill>["tone"]> = {
  create: "success",
  update: "info",
  skip: "neutral",
  error: "danger",
}

function validationTone(status: ImportValidation["status"]): React.ComponentProps<typeof StatusPill>["tone"] {
  if (status === "success") return "success"
  if (status === "warning") return "warning"
  if (status === "error") return "danger"
  if (status === "running") return "info"
  return "neutral"
}

function ImportModal({
  open,
  title = "Import",
  description = "Validate and preview changes before applying them.",
  sourceOptions,
  currentStage,
  stages = defaultStages,
  validation,
  previewRows,
  conflicts,
  result,
  previewContent,
  confirmContent,
  footerMeta,
  loading = false,
  contentClassName,
  nextLabel = "Next",
  applyLabel = "Apply import",
  cancelLabel = "Cancel",
  onBack,
  onNext,
  onApply,
  onCancel,
  onOpenChange,
}: ImportModalProps) {
  const currentIndex = stages.indexOf(currentStage)
  const isResult = currentStage === "result"
  const slotProps = React.useMemo<ImportSlotProps>(() => ({
    previewRows: previewRows ?? [],
    conflicts: conflicts ?? [],
    validation,
    result,
  }), [conflicts, previewRows, result, validation])
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        onCancel?.()
      }
      onOpenChange?.(nextOpen)
    },
    [onCancel, onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn("grid max-h-[min(760px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0", contentClassName)}>
        <DialogHeader className="border-b border-border bg-card px-5 py-4">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="mb-5 grid gap-2 sm:grid-cols-5">
            {stages.map((stage, index) => {
              const complete = index < currentIndex
              const active = stage === currentStage
              return (
                <div
                  key={stage}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                    active ? "border-primary/25 bg-accent text-foreground" : "border-border bg-card text-muted-foreground"
                  )}
                >
                  {complete ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : active ? <CircleDot className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                  <span className="truncate">{stageLabels[stage]}</span>
                </div>
              )
            })}
          </div>

          {currentStage === "select" ? <SourceStep sourceOptions={sourceOptions} /> : null}
          {currentStage === "validate" ? <ValidationStep validation={validation} /> : null}
          {currentStage === "preview" ? (
            <SlotContent content={previewContent} fallback={<PreviewStep rows={previewRows ?? []} />} props={slotProps} />
          ) : null}
          {currentStage === "confirm" ? (
            <SlotContent content={confirmContent} fallback={<ConfirmStep rows={previewRows ?? []} conflicts={conflicts ?? []} />} props={slotProps} />
          ) : null}
          {currentStage === "result" ? <ResultStep result={result} /> : null}
        </div>

        <DialogFooter className="items-center justify-between gap-3 border-t border-border bg-card px-5 py-4">
          <div className="min-w-0 text-xs text-muted-foreground">{footerMeta}</div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
              {isResult ? "Close" : cancelLabel}
            </Button>
            {!isResult && onBack ? (
              <Button type="button" variant="outline" onClick={onBack} disabled={loading || currentIndex <= 0}>
                Back
              </Button>
            ) : null}
            {!isResult && currentStage !== "confirm" ? (
              <Button type="button" variant="primary" onClick={onNext} disabled={loading}>
                {loading ? "Working..." : nextLabel}
              </Button>
            ) : null}
            {currentStage === "confirm" ? (
              <Button type="button" variant="primary" onClick={onApply} disabled={loading}>
                {loading ? "Applying..." : applyLabel}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SlotContent({
  content,
  fallback,
  props,
}: {
  content?: React.ReactNode | ((props: ImportSlotProps) => React.ReactNode)
  fallback: React.ReactNode
  props: ImportSlotProps
}) {
  if (!content) return fallback
  return <>{typeof content === "function" ? content(props) : content}</>
}

function SourceStep({ sourceOptions }: { sourceOptions: ImportSourceOption[] }) {
  return (
    <div className="grid gap-3">
      {sourceOptions.map((option) => (
        <button
          key={option.id}
          type="button"
          className={cn(
            "flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
            option.selected && "border-primary/30 bg-accent"
          )}
          disabled={option.disabled}
          onClick={option.onSelect}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-popover text-muted-foreground">
            {option.icon ?? <FileUp className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <div className="font-medium text-foreground">{option.label}</div>
            {option.description ? <div className="mt-1 text-sm leading-5 text-muted-foreground">{option.description}</div> : null}
          </div>
        </button>
      ))}
    </div>
  )
}

function ValidationStep({ validation }: { validation?: ImportValidation }) {
  const status = validation?.status ?? "idle"

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <StatusPill tone={validationTone(status)}>{status}</StatusPill>
          {typeof validation?.progress === "number" ? <span className="text-xs text-muted-foreground">{validation.progress}%</span> : null}
        </div>
        {validation?.message ? <div className="mt-3 text-sm leading-6 text-muted-foreground">{validation.message}</div> : null}
        {typeof validation?.progress === "number" ? <Progress value={validation.progress} className="mt-4" /> : null}
      </div>
      {validation?.items?.length ? (
        <div className="rounded-xl border border-border bg-card">
          {validation.items.map((item, index) => (
            <div key={item.id ?? index} className="flex gap-3 border-b border-border px-4 py-3 last:border-b-0">
              {item.status === "error" ? <XCircle className="mt-0.5 h-4 w-4 text-red-500" /> : item.status === "warning" ? <CircleAlert className="mt-0.5 h-4 w-4 text-amber-500" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />}
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{item.label}</div>
                {item.detail ? <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PreviewStep({ rows }: { rows: ImportPreviewRow[] }) {
  if (!rows.length) {
    return <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">No preview rows available.</div>
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      {rows.map((row) => (
        <div key={row.id} className="grid gap-2 border-b border-border px-4 py-3 last:border-b-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{row.label}</div>
              {row.description ? <div className="mt-1 text-xs text-muted-foreground">{row.description}</div> : null}
            </div>
            {row.action ? <StatusPill tone={actionTone[row.action]}>{row.action}</StatusPill> : null}
          </div>
          {row.values?.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {row.values.map((value, index) => (
                <div key={index} className="rounded-lg border border-border bg-popover px-3 py-2">
                  <div className="text-xs text-muted-foreground">{value.label}</div>
                  <div className="mt-1 truncate text-sm text-foreground">{value.value}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function ConfirmStep({ rows, conflicts }: { rows: ImportPreviewRow[]; conflicts: ImportConflict[] }) {
  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-sm font-semibold text-foreground">Ready to apply</div>
        <div className="mt-1 text-sm text-muted-foreground">{rows.length} preview rows and {conflicts.length} conflicts will be handled by the page flow.</div>
      </div>
      {conflicts.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50">
          {conflicts.map((conflict) => (
            <div key={conflict.id} className="border-b border-amber-200 px-4 py-3 last:border-b-0">
              <div className="text-sm font-medium text-foreground">{conflict.label}</div>
              {conflict.description ? <div className="mt-1 text-xs text-muted-foreground">{conflict.description}</div> : null}
              {conflict.resolution ? <div className="mt-2 text-sm text-foreground">{conflict.resolution}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ResultStep({ result }: { result?: ImportResult }) {
  const status = result?.status ?? "success"
  const tone = status === "success" ? "success" : status === "partial" ? "warning" : "danger"

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <StatusPill tone={tone}>{status}</StatusPill>
      <div className="mt-3 text-base font-semibold text-foreground">{result?.title ?? "Import complete"}</div>
      {result?.message ? <div className="mt-2 text-sm leading-6 text-muted-foreground">{result.message}</div> : null}
      {result?.summary?.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {result.summary.map((item, index) => (
            <div key={index} className="rounded-lg border border-border bg-popover px-3 py-2">
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div className="mt-1 text-sm font-medium text-foreground">{item.value}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export { ImportModal }
export type {
  ImportConflict,
  ImportModalProps,
  ImportPreviewRow,
  ImportResult,
  ImportSlotProps,
  ImportSourceOption,
  ImportStage,
  ImportValidation,
}
