"use client"

import * as React from "react"
import { createRoot, type Root } from "react-dom/client"
import dynamic from "@/lib/navigation/dynamic"
import { useTheme } from "next-themes"
import { Loader2, FileCode2, Play, Eye, RefreshCw, Maximize2 } from "lucide-react"
import { AgGridReact } from "ag-grid-react"
import { AllCommunityModule, ModuleRegistry, type ColDef, type GridApi, type GridReadyEvent } from "ag-grid-community"
import "ag-grid-community/styles/ag-grid.css"
import "ag-grid-community/styles/ag-theme-quartz.css"
import { NotebookEditor } from "@/components/notebook/NotebookEditor"
import { AnsiLogBlock } from "@/components/AnsiLogBlock"
import Markdown from "@/components/Markdown"
import { registerCangjieLanguage } from "@/lib/cangjie/language"
import { registerCMakeLanguage } from "@/lib/core/cmake-language"
import { workspaceApi, type NotebookScope, type WorkspaceMode } from "@/lib/core/api"
import { cn } from "@/lib/core/utils"
import { useToast } from "@/components/ui/toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
  MenubarCheckboxItem,
} from "@/components/ui/menubar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import previewStyles from "./EditorPanelPreview.module.css"

ModuleRegistry.registerModules([AllCommunityModule])

const NDJSON_TRACE_GRID_SELECTION_STYLE_ID = "ndjson-trace-grid-selection-style"

function ensureNdjsonTraceGridSelectionStyle(): void {
  if (typeof document === "undefined") return
  if (document.getElementById(NDJSON_TRACE_GRID_SELECTION_STYLE_ID)) return
  const style = document.createElement("style")
  style.id = NDJSON_TRACE_GRID_SELECTION_STYLE_ID
  style.textContent = `
    .ndjson-trace-detail,
    .ndjson-trace-detail * {
      -webkit-user-select: text !important;
      user-select: text !important;
    }
  `
  document.head.appendChild(style)
}

const MonacoEditor = dynamic(
  async () => {
    const monaco = await import("monaco-editor")
    const { loader, default: Editor } = await import("@monaco-editor/react")
    loader.config({ monaco })
    return Editor
  },
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  }
)

const FileViewer = dynamic(
  () => import("react-file-viewer-v2").then((mod) => mod.FileViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  }
)

const PREVIEW_EXTENSIONS = new Set([
  "pdf", "docx", "xlsx", "pptx",
  "png", "jpg", "jpeg", "gif",
  "mp4", "webm", "mp3",
])

const OFFICE_PREVIEW_EXTENSIONS = new Set([
  "docx", "xlsx", "pptx",
])

const HTML_PREVIEW_EXTENSIONS = new Set(["html", "htm"])
const MARKDOWN_PREVIEW_EXTENSIONS = new Set(["md", "markdown", "mdx"])
const NDJSON_PREVIEW_EXTENSIONS = new Set(["ndjson", "jsonl"])

interface EditorPanelProps {
  filePath: string | null
  workspacePath?: string
  content: string | null
  fileSize: number | null
  loading: boolean
  onSave: (content: string) => Promise<void>
  oversize?: boolean
  fileBlob?: Blob | null
  error?: string | null
  fileType?: string
  targetLineNumber?: number | null
  targetColumn?: number | null
  mode?: WorkspaceMode
  notebookScope?: NotebookScope
  notebookShareToken?: string
  notebookPermission?: 'read' | 'write'
  onAskAIFromFile?: () => void
  onAskAIFromSelection?: (payload: {
    text: string
    range: {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
    }
  }) => void
  onAskAIAction?: (action: 'explain' | 'review' | 'fixError' | 'addComment', payload: {
    text: string
    range: {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
    }
  }) => void
  applyAiSuggestion?: {
    id: string
    range: {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
    }
    targetText: string
  } | null
  onApplyAiSuggestionDone?: (id: string) => void
  aiSuggestions?: Array<{
    id: string
    action: 'review' | 'fixError' | 'addComment'
    sourceText: string
    targetText: string
    oldLineCount: number
    newLineCount: number
    range: {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
    }
    decorateRange: {
      startLineNumber: number
      endLineNumber: number
    }
    insertBefore: boolean
  }>
  onAcceptAiSuggestion?: (id: string) => void
  onRejectAiSuggestion?: (id: string) => void
}

interface RunCangjieResult {
  success: boolean
  stdout: string
  stderr: string
  combinedOutput: string
  exitCode: number | null
  commandSummary?: string
  error?: string
}

const EXT_LANG_MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  json: "json", md: "markdown", css: "css", scss: "scss", less: "less",
  html: "html", xml: "xml", yaml: "yaml", yml: "yaml",
  py: "python", rs: "rust", go: "go", java: "java",
  sh: "shell", bash: "shell", zsh: "shell",
  sql: "sql", graphql: "graphql", toml: "ini", env: "ini",
  c: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", h: "cpp", hpp: "cpp", hxx: "cpp",
  cmake: "cmake",
  cj: "cangjie",
}

function getLanguage(filePath: string): string {
  const name = filePath.split("/").pop() || ""
  if (name === "CMakeLists.txt") return "cmake"
  if (name === "Makefile" || name === "makefile") return "shell"
  if (name.endsWith(".cj.d") || name.endsWith(".cj")) return "cangjie"
  const ext = name.split(".").pop()?.toLowerCase() || ""
  return EXT_LANG_MAP[ext] || "plaintext"
}

function isRunnableCangjieFile(filePath: string | null) {
  return !!filePath && filePath.endsWith(".cj") && !filePath.endsWith(".cj.d")
}

function isNotebookFile(filePath: string | null) {
  return !!filePath && filePath.endsWith('.cj.md')
}

function getDisplayedPathSegment(segment: string): string {
  return segment === "__builtin__" ? "Cangjie Notebook介绍" : segment
}

type DiffLine = { type: 'equal' | 'delete' | 'add'; text: string }

function buildLineDiff(beforeText: string, afterText: string): DiffLine[] {
  const before = (beforeText || '').replace(/\r\n/g, '\n').split('\n')
  const after = (afterText || '').replace(/\r\n/g, '\n').split('\n')
  // Ignore pure EOF newline differences to avoid trailing blank-line suggestions.
  if (before.length > 1 && before[before.length - 1] === '') before.pop()
  if (after.length > 1 && after[after.length - 1] === '') after.pop()
  const dp: number[][] = Array.from({ length: before.length + 1 }, () => Array(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      lines.push({ type: 'equal', text: before[i] })
      i += 1
      j += 1
      continue
    }
    if (j >= after.length || (i < before.length && dp[i + 1][j] > dp[i][j + 1])) {
      lines.push({ type: 'delete', text: before[i] ?? '' })
      i += 1
      continue
    }
    lines.push({ type: 'add', text: after[j] ?? '' })
    j += 1
  }
  return lines
}

function formatErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error.trim()) return error
  return fallback
}

function formatFileSize(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "未知大小"
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

type NdjsonPreviewRow = {
  lineNumber: number
  valid: boolean
  timestamp: string
  stage: string
  source: string
  status: string
  event: string
  text: string
  usage: string
  runtimeSessionId: string
  frontendSessionId: string
  chatId: string
  turnId: string
  requestId: string
  traceId: string
  payload: string
  raw: string
  error: string
}

function readFlatValue(source: unknown, key: string): string {
  if (!source || typeof source !== "object") return ""
  const value = (source as Record<string, unknown>)[key]
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : ""
}

function stringifyGridValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function shortenTraceText(value: string, limit = 220): string {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function readPayloadText(payload: any): string {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {}
  const nestedPayload = payload?.payload && typeof payload.payload === "object" ? payload.payload : {}
  const candidates = [
    payload?.content,
    payload?.text,
    payload?.message,
    payload?.output,
    payload?.error,
    payload?.result,
    data?.content,
    data?.text,
    data?.message,
    nestedPayload?.text,
    nestedPayload?.message,
  ]
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return shortenTraceText(value)
  }
  return ""
}

function readTraceEvent(payload: any): string {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {}
  const candidates = [
    payload?.event,
    payload?.eventType,
    payload?.type,
    payload?.tag,
    payload?.stopReason,
    payload?.source,
    data?.event,
    data?.type,
  ]
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value
  }
  return ""
}

function readTraceStatus(payload: any): string {
  const parts: string[] = []
  if (typeof payload?.status === "string") parts.push(payload.status)
  if (typeof payload?.success === "boolean") parts.push(payload.success ? "success" : "failed")
  if (typeof payload?.active === "boolean") parts.push(payload.active ? "active" : "inactive")
  if (typeof payload?.found === "boolean") parts.push(payload.found ? "found" : "not_found")
  if (typeof payload?.is_error === "boolean") parts.push(payload.is_error ? "error" : "ok")
  return parts.join(" / ")
}

function readTraceUsage(payload: any): string {
  const usage = payload?.usage && typeof payload.usage === "object" ? payload.usage : payload?.responsePayload?.usage
  if (usage && typeof usage === "object") {
    const input = (usage as any).input_tokens ?? (usage as any).inputTokens
    const output = (usage as any).output_tokens ?? (usage as any).outputTokens
    const total = (usage as any).total_tokens ?? (usage as any).totalTokens
    const cacheRead = (usage as any).cache_read_input_tokens ?? (usage as any).cacheReadInputTokens
    return [
      input != null ? `in ${input}` : "",
      output != null ? `out ${output}` : "",
      cacheRead != null ? `cache ${cacheRead}` : "",
      total != null ? `total ${total}` : "",
    ].filter(Boolean).join(" / ")
  }
  if (payload?.used != null || payload?.size != null) return `${payload?.used ?? "-"} / ${payload?.size ?? "-"}`
  return ""
}

function parseNdjsonPreviewRows(content: string): { rows: NdjsonPreviewRow[]; stages: string[]; invalidCount: number } {
  const rows: NdjsonPreviewRow[] = []
  const stages = new Set<string>()
  let invalidCount = 0
  String(content || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line, index) => {
      const raw = line.trim()
      if (!raw) return
      const lineNumber = index + 1
      try {
        const parsed = JSON.parse(raw)
        const context = parsed?.context && typeof parsed.context === "object" ? parsed.context : {}
        const payload = parsed?.payload
        const stage = readFlatValue(parsed, "stage")
        if (stage) stages.add(stage)
        rows.push({
          lineNumber,
          valid: true,
          timestamp: readFlatValue(parsed, "timestamp"),
          stage,
          source: readFlatValue(payload, "source") || readFlatValue(context, "runtime"),
          status: readTraceStatus(payload),
          event: readTraceEvent(payload),
          text: readPayloadText(payload),
          usage: readTraceUsage(payload),
          runtimeSessionId: readFlatValue(context, "runtimeSessionId"),
          frontendSessionId: readFlatValue(context, "frontendSessionId"),
          chatId: readFlatValue(context, "chatId"),
          turnId: readFlatValue(context, "turnId"),
          requestId: readFlatValue(context, "requestId"),
          traceId: readFlatValue(context, "traceId"),
          payload: stringifyGridValue(payload),
          raw,
          error: "",
        })
      } catch (error) {
        invalidCount += 1
        stages.add("invalid")
        rows.push({
          lineNumber,
          valid: false,
          timestamp: "",
          stage: "invalid",
          source: "",
          status: "invalid",
          event: "",
          text: "",
          usage: "",
          runtimeSessionId: "",
          frontendSessionId: "",
          chatId: "",
          turnId: "",
          requestId: "",
          traceId: "",
          payload: raw,
          raw,
          error: error instanceof Error ? error.message : "JSON parse failed",
        })
      }
    })
  return {
    rows,
    stages: Array.from(stages).sort((a, b) => a.localeCompare(b)),
    invalidCount,
  }
}

function NdjsonAgGridPreview({ content, filePath, fullscreen = false }: { content: string; filePath?: string | null; fullscreen?: boolean }) {
  const { resolvedTheme } = useTheme()
  const gridApiRef = React.useRef<GridApi<NdjsonPreviewRow> | null>(null)
  const [selectedStages, setSelectedStages] = React.useState<string[]>([])
  const [stagePanelOpen, setStagePanelOpen] = React.useState(false)
  const [selectedRow, setSelectedRow] = React.useState<NdjsonPreviewRow | null>(null)
  const parsed = React.useMemo(() => parseNdjsonPreviewRows(content), [content])
  const activeStages = selectedStages.length > 0 ? selectedStages : parsed.stages
  const rowData = React.useMemo(() => (
    activeStages.length === parsed.stages.length ? parsed.rows : parsed.rows.filter((row) => activeStages.includes(row.stage))
  ), [activeStages, parsed.rows, parsed.stages.length])
  const themeClass = resolvedTheme === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz"

  React.useEffect(() => {
    ensureNdjsonTraceGridSelectionStyle()
  }, [])

  React.useEffect(() => {
    setSelectedStages((current) => current.filter((stage) => parsed.stages.includes(stage)))
  }, [parsed.stages])

  const handleGridReady = React.useCallback((event: GridReadyEvent<NdjsonPreviewRow>) => {
    gridApiRef.current = event.api
  }, [])

  const handleCopyCellSelection = React.useCallback(() => {
    gridApiRef.current?.copySelectedRangeToClipboard()
  }, [])

  const defaultColDef = React.useMemo<ColDef<NdjsonPreviewRow>>(() => ({
    sortable: true,
    filter: false,
    floatingFilter: false,
    resizable: true,
    minWidth: 90,
    wrapText: false,
    autoHeight: false,
  }), [])

  const columnDefs = React.useMemo<ColDef<NdjsonPreviewRow>[]>(() => [
    {
      field: "lineNumber",
      headerName: "Line",
      width: 92,
      pinned: "left",
      filter: "agNumberColumnFilter",
      sort: "asc",
    },
    {
      field: "timestamp",
      headerName: "Time",
      width: 215,
    },
    {
      field: "stage",
      headerName: "Stage",
      width: 240,
      filter: true,
      floatingFilter: true,
    },
    {
      field: "source",
      headerName: "Source",
      width: 130,
    },
    {
      field: "status",
      headerName: "Status",
      width: 150,
    },
    {
      field: "event",
      headerName: "Event",
      width: 180,
    },
    {
      field: "text",
      headerName: "Text",
      minWidth: 280,
      flex: 1,
      tooltipField: "text",
    },
    {
      field: "runtimeSessionId",
      headerName: "Runtime",
      width: 280,
    },
    {
      field: "frontendSessionId",
      headerName: "Frontend",
      width: 190,
    },
    {
      field: "requestId",
      headerName: "Request ID",
      width: 260,
    },
    {
      field: "traceId",
      headerName: "Trace ID",
      width: 260,
    },
    {
      field: "usage",
      headerName: "Usage",
      width: 190,
    },
    {
      field: "error",
      headerName: "Error",
      width: 260,
      hide: parsed.invalidCount === 0,
    },
    {
      field: "raw",
      headerName: "Raw",
      width: 520,
      hide: true,
      tooltipField: "raw",
    },
  ], [parsed.invalidCount])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 min-w-[240px] justify-between font-normal"
              onClick={() => setStagePanelOpen((value) => !value)}
            >
              <span className="truncate">
                Stage: {activeStages.length === parsed.stages.length ? "全部" : `${activeStages.length} 项`}
              </span>
            </Button>
            {stagePanelOpen ? (
              <div className="absolute left-0 top-9 z-30 w-[360px] rounded-md border bg-popover p-2 shadow-lg">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedStages([...parsed.stages])}>
                    全选
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedStages([])}>
                    清空
                  </Button>
                </div>
                <div className="max-h-72 overflow-auto pr-1">
                  {parsed.stages.map((stage) => {
                    const checked = activeStages.includes(stage)
                    return (
                      <label key={stage} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(next) => {
                            setSelectedStages((current) => {
                              const base = current.length > 0 ? current : parsed.stages
                              return next === true
                                ? Array.from(new Set([...base, stage]))
                                : base.filter((item) => item !== stage)
                            })
                          }}
                        />
                        <span className="truncate font-mono">{stage}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground">
            {rowData.length} / {parsed.rows.length} 行{parsed.invalidCount ? `，${parsed.invalidCount} 行解析失败` : ""}
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={handleCopyCellSelection}>
            复制选区
          </Button>
        </div>
        {fullscreen && filePath ? (
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{filePath}</div>
        ) : null}
      </div>
      <div className={cn(themeClass, "ndjson-trace-grid min-h-0 flex-[1_1_0]")}>
        <AgGridReact<NdjsonPreviewRow>
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          onGridReady={handleGridReady}
          onRowClicked={(event) => setSelectedRow(event.data || null)}
          animateRows={false}
          cellSelection
          ensureDomOrder
          pagination={rowData.length > 2000}
          paginationPageSize={500}
          paginationPageSizeSelector={[100, 500, 1000, 2000]}
          tooltipShowDelay={250}
        />
      </div>
      <div className="ndjson-trace-detail min-h-[180px] max-h-[38%] shrink-0 border-t bg-muted/20">
        {selectedRow ? (
          <div className="grid h-full min-h-0 grid-cols-[minmax(260px,360px)_1fr]">
            <div className="min-h-0 overflow-auto border-r p-3 text-xs">
              <div className="mb-2 font-medium">选中记录</div>
              <dl className="grid grid-cols-[86px_1fr] gap-x-2 gap-y-1">
                <dt className="text-muted-foreground">Line</dt><dd className="font-mono">{selectedRow.lineNumber}</dd>
                <dt className="text-muted-foreground">Time</dt><dd className="font-mono break-all">{selectedRow.timestamp || "-"}</dd>
                <dt className="text-muted-foreground">Stage</dt><dd className="font-mono break-all">{selectedRow.stage || "-"}</dd>
                <dt className="text-muted-foreground">Status</dt><dd className="break-all">{selectedRow.status || "-"}</dd>
                <dt className="text-muted-foreground">Event</dt><dd className="break-all">{selectedRow.event || "-"}</dd>
                <dt className="text-muted-foreground">Session</dt><dd className="font-mono break-all">{selectedRow.runtimeSessionId || selectedRow.frontendSessionId || selectedRow.chatId || "-"}</dd>
                <dt className="text-muted-foreground">Request</dt><dd className="font-mono break-all">{selectedRow.requestId || selectedRow.turnId || "-"}</dd>
              </dl>
            </div>
            <div className="min-h-0 overflow-auto p-3">
              <div className="mb-2 text-xs font-medium">Payload</div>
              <pre className="whitespace-pre-wrap break-words rounded border bg-background p-3 font-mono text-[11px] leading-relaxed">
                {selectedRow.error ? `${selectedRow.error}\n\n${selectedRow.raw}` : selectedRow.payload || selectedRow.raw}
              </pre>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            选择一行查看 payload 详情
          </div>
        )}
      </div>
    </div>
  )
}

function openReactPreviewWindow(title: string, node: React.ReactNode): Window | null {
  if (typeof window === "undefined") return null
  const previewWindow = window.open("", "_blank", "popup=yes")
  if (!previewWindow) return null

  previewWindow.document.write(`<!doctype html><html><head><title>${title.replace(/[<>&"]/g, "")}</title></head><body><div id="root"></div></body></html>`)
  previewWindow.document.close()

  document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style').forEach((element) => {
    previewWindow.document.head.appendChild(element.cloneNode(true))
  })

  const style = previewWindow.document.createElement("style")
  style.textContent = `
    html, body, #root { height: 100%; margin: 0; }
    body { background: hsl(var(--background, 0 0% 100%)); color: hsl(var(--foreground, 222.2 84% 4.9%)); overflow: hidden; }
  `
  previewWindow.document.head.appendChild(style)

  const mount = previewWindow.document.getElementById("root")
  if (!mount) return previewWindow
  const root: Root = createRoot(mount)
  root.render(node)
  previewWindow.addEventListener("beforeunload", () => root.unmount(), { once: true })
  return previewWindow
}

export function EditorPanel({
  filePath,
  workspacePath,
  content,
  fileSize,
  loading,
  onSave,
  oversize,
  fileBlob,
  error,
  fileType,
  targetLineNumber,
  targetColumn,
  mode = 'default',
  notebookScope = 'personal',
  notebookShareToken,
  notebookPermission = 'write',
  onAskAIFromFile,
  onAskAIFromSelection,
  onAskAIAction,
  applyAiSuggestion,
  onApplyAiSuggestionDone,
  aiSuggestions = [],
  onAcceptAiSuggestion,
  onRejectAiSuggestion,
}: EditorPanelProps) {
  const { resolvedTheme } = useTheme()
  const { toast } = useToast()
  const editorRef = React.useRef<any>(null)
  const monacoRef = React.useRef<any>(null)
  const [wordWrap, setWordWrap] = React.useState<"on" | "off">("off")
  const [saving, setSaving] = React.useState(false)
  const [editorContent, setEditorContent] = React.useState<string | null>(null)
  const [runDialogOpen, setRunDialogOpen] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [runResult, setRunResult] = React.useState<RunCangjieResult | null>(null)
  const [notebookTocOpen, setNotebookTocOpen] = React.useState(false)
  const [notebookDependencyGraphOpen, setNotebookDependencyGraphOpen] = React.useState(false)
  const [htmlPreviewOpen, setHtmlPreviewOpen] = React.useState(false)
  const [htmlPreviewVersion, setHtmlPreviewVersion] = React.useState(0)
  const [markdownPreviewOpen, setMarkdownPreviewOpen] = React.useState(false)
  const [ndjsonPreviewOpen, setNdjsonPreviewOpen] = React.useState(false)
  const cangjieRegistered = React.useRef(false)
  const cmakeRegistered = React.useRef(false)
  const suggestionDecorationIdsRef = React.useRef<string[]>([])
  const suggestionZoneIdsRef = React.useRef<string[]>([])
  const targetLineDecorationIdsRef = React.useRef<string[]>([])
  const appliedTargetSignatureRef = React.useRef<string | null>(null)
  const previewHostRef = React.useRef<HTMLDivElement | null>(null)
  const [previewViewport, setPreviewViewport] = React.useState({ width: 0, height: 0 })
  const [editorMountVersion, setEditorMountVersion] = React.useState(0)
  const hasEditorContent = editorContent != null

  React.useEffect(() => {
    setEditorContent(content)
  }, [content])

  React.useEffect(() => {
    if (!applyAiSuggestion) return
    const editor = editorRef.current
    if (!editor) return
    editor.executeEdits('ai-suggestion', [
      {
        range: applyAiSuggestion.range,
        text: applyAiSuggestion.targetText,
        forceMoveMarkers: true,
      },
    ])
    const next = editor.getValue()
    setEditorContent(next)
    onApplyAiSuggestionDone?.(applyAiSuggestion.id)
  }, [applyAiSuggestion, onApplyAiSuggestionDone])

  React.useEffect(() => {
    const editor = editorRef.current
    const monacoGlobal = monacoRef.current
    if (!editor || !monacoGlobal) return

    const clearDecorations = () => {
      targetLineDecorationIdsRef.current = editor.deltaDecorations(targetLineDecorationIdsRef.current, [])
    }

    const requestedLine = targetLineNumber && targetLineNumber > 0 ? targetLineNumber : null
    if (!filePath || !requestedLine || loading || !hasEditorContent) {
      appliedTargetSignatureRef.current = null
      clearDecorations()
      return
    }

    const signature = `${editorMountVersion}:${filePath}:${requestedLine}:${targetColumn || 1}`
    if (appliedTargetSignatureRef.current === signature) return
    appliedTargetSignatureRef.current = signature

    const model = editor.getModel?.()
    if (!model) {
      clearDecorations()
      return
    }

    let styleEl = document.getElementById('workspace-target-line-style') as HTMLStyleElement | null
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = 'workspace-target-line-style'
      styleEl.textContent = `
        .workspace-target-line { background: rgba(59, 130, 246, 0.18); }
        .workspace-target-line-glyph {
          margin-left: 3px;
          width: 4px !important;
          background: rgba(59, 130, 246, 0.9);
          border-radius: 999px;
        }
      `
      document.head.appendChild(styleEl)
    }

    const lineCount = Math.max(1, model.getLineCount?.() || 1)
    const lineNumber = Math.min(requestedLine, lineCount)
    const lineLength = Math.max(1, model.getLineLength?.(lineNumber) || 1)
    const column = Math.min(Math.max(1, targetColumn || 1), lineLength + 1)
    const range = new monacoGlobal.Range(lineNumber, 1, lineNumber, lineLength + 1)

    targetLineDecorationIdsRef.current = editor.deltaDecorations(targetLineDecorationIdsRef.current, [{
      range,
      options: {
        isWholeLine: true,
        className: 'workspace-target-line',
        linesDecorationsClassName: 'workspace-target-line-glyph',
      },
    }])

    editor.revealLineInCenter?.(lineNumber)
    editor.setPosition?.({ lineNumber, column })
    editor.focus?.()

    return () => {
      const currentEditor = editorRef.current
      if (!currentEditor) return
      targetLineDecorationIdsRef.current = currentEditor.deltaDecorations(targetLineDecorationIdsRef.current, [])
    }
  }, [editorMountVersion, filePath, hasEditorContent, loading, targetColumn, targetLineNumber])

  React.useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const monacoGlobal = monacoRef.current
    const model = editor.getModel?.()
    if (!model || !monacoGlobal) return
    let styleEl = document.getElementById('ai-suggestion-inline-style') as HTMLStyleElement | null
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = 'ai-suggestion-inline-style'
      styleEl.textContent = `
        .ai-suggestion-delete-line { background: rgba(239,68,68,0.18); }
        .ai-suggestion-zone {
          border-left: 2px solid rgba(34,197,94,0.85);
          background: linear-gradient(90deg, rgba(34,197,94,0.18), rgba(34,197,94,0.08));
          padding: 2px 8px;
          position: relative;
          overflow: hidden;
          box-shadow: inset 0 0 0 1px rgba(34,197,94,0.18);
          animation: ai-zone-pulse 2.8s ease-in-out infinite;
        }
        .ai-suggestion-zone::before {
          content: "";
          position: absolute;
          inset: 0;
          transform: translateX(-120%);
          background: linear-gradient(110deg, transparent 20%, rgba(255,255,255,0.35) 50%, transparent 80%);
          animation: ai-zone-scan 2.2s ease-in-out infinite;
          pointer-events: none;
        }
        .ai-suggestion-actions { position: absolute; top: 4px; right: 6px; display: flex; gap: 6px; z-index: 5; }
        .ai-suggestion-action-btn {
          font-size: 12px;
          line-height: 1;
          border: 1px solid rgba(148,163,184,0.45);
          border-radius: 6px;
          padding: 3px 8px;
          cursor: pointer;
          color: #0f172a;
          transition: transform .14s ease, box-shadow .2s ease, background .2s ease;
          backdrop-filter: blur(4px);
        }
        .ai-suggestion-action-btn:hover { transform: translateY(-1px); }
        .ai-suggestion-action-btn:active { transform: translateY(0) scale(0.98); }
        .ai-suggestion-action-btn--accept { background: rgba(34,197,94,0.18); border-color: rgba(22,163,74,0.45); }
        .ai-suggestion-action-btn--accept:hover { background: rgba(34,197,94,0.28); box-shadow: 0 0 0 1px rgba(34,197,94,0.25), 0 0 14px rgba(34,197,94,0.35); }
        .ai-suggestion-action-btn--reject { background: rgba(239,68,68,0.16); border-color: rgba(220,38,38,0.4); }
        .ai-suggestion-action-btn--reject:hover { background: rgba(239,68,68,0.26); box-shadow: 0 0 0 1px rgba(239,68,68,0.22), 0 0 12px rgba(239,68,68,0.32); }
        @keyframes ai-zone-scan {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(130%); }
        }
        @keyframes ai-zone-pulse {
          0%, 100% { box-shadow: inset 0 0 0 1px rgba(34,197,94,0.16), 0 0 0 rgba(34,197,94,0); }
          50% { box-shadow: inset 0 0 0 1px rgba(34,197,94,0.28), 0 0 10px rgba(34,197,94,0.22); }
        }
      `
      document.head.appendChild(styleEl)
    }

    suggestionDecorationIdsRef.current = editor.deltaDecorations(
      suggestionDecorationIdsRef.current,
      aiSuggestions
        .filter((item) => (item.oldLineCount ?? 0) > 0)
        .map((item) => {
          const fallbackEndLine = Math.max(item.range.startLineNumber, item.range.endLineNumber - 1)
          const decorateStart = item.decorateRange?.startLineNumber ?? item.range.startLineNumber
          const decorateEnd = item.decorateRange?.endLineNumber ?? fallbackEndLine
          return {
            range: new monacoGlobal.Range(
              decorateStart,
              1,
              decorateEnd + 1,
              1,
            ),
            options: {
              isWholeLine: true,
              className: 'ai-suggestion-delete-line',
            },
          }
        }),
    )

    editor.changeViewZones((accessor: any) => {
      suggestionZoneIdsRef.current.forEach((zoneId) => {
        try { accessor.removeZone(zoneId) } catch {}
      })
      suggestionZoneIdsRef.current = []
      aiSuggestions.forEach((item) => {
        const zoneNode = document.createElement('div')
        zoneNode.className = 'ai-suggestion-zone'
        zoneNode.style.pointerEvents = 'auto'
        zoneNode.style.userSelect = 'text'
        zoneNode.style.zIndex = '4'
        const diffLines = buildLineDiff(item.sourceText, item.targetText)
          .filter((line) => line.type === 'add')
          .map((line) => line.text)
        const contentText = diffLines.join('\n') || item.targetText
        const pre = document.createElement('pre')
        pre.textContent = contentText
        pre.style.whiteSpace = 'pre-wrap'
        pre.style.margin = '0'
        pre.style.fontSize = '12px'
        pre.style.lineHeight = '1.35'
        pre.style.userSelect = 'text'
        zoneNode.appendChild(pre)
        const actions = document.createElement('div')
        actions.className = 'ai-suggestion-actions'
        actions.style.pointerEvents = 'auto'
        const acceptBtn = document.createElement('button')
        acceptBtn.type = 'button'
        acceptBtn.className = 'ai-suggestion-action-btn ai-suggestion-action-btn--accept'
        acceptBtn.style.pointerEvents = 'auto'
        acceptBtn.style.cursor = 'pointer'
        acceptBtn.textContent = '应用建议'
        acceptBtn.onmousedown = (event) => {
          event.preventDefault()
          event.stopPropagation()
        }
        acceptBtn.onclick = (event) => {
          event.preventDefault()
          event.stopPropagation()
          onAcceptAiSuggestion?.(item.id)
        }
        const rejectBtn = document.createElement('button')
        rejectBtn.type = 'button'
        rejectBtn.className = 'ai-suggestion-action-btn ai-suggestion-action-btn--reject'
        rejectBtn.style.pointerEvents = 'auto'
        rejectBtn.style.cursor = 'pointer'
        rejectBtn.textContent = '忽略建议'
        rejectBtn.onmousedown = (event) => {
          event.preventDefault()
          event.stopPropagation()
        }
        rejectBtn.onclick = (event) => {
          event.preventDefault()
          event.stopPropagation()
          onRejectAiSuggestion?.(item.id)
        }
        actions.appendChild(acceptBtn)
        actions.appendChild(rejectBtn)
        zoneNode.appendChild(actions)
        const lineCount = Math.max(1, contentText.split('\n').length)
        const zoneId = accessor.addZone({
          afterLineNumber: item.insertBefore
            ? Math.max(0, item.range.startLineNumber - 1)
            : item.range.endLineNumber,
          heightInLines: Math.min(14, lineCount + 1),
          domNode: zoneNode,
          suppressMouseDown: true,
        })
        suggestionZoneIdsRef.current.push(zoneId)
      })
    })

    aiSuggestions.forEach((item) => {
      void item
    })

    return () => {
      const currentEditor = editorRef.current
      if (!currentEditor) return
      currentEditor.changeViewZones((accessor: any) => {
        suggestionZoneIdsRef.current.forEach((zoneId) => {
          try { accessor.removeZone(zoneId) } catch {}
        })
      })
      suggestionZoneIdsRef.current = []
      suggestionDecorationIdsRef.current = currentEditor.deltaDecorations(suggestionDecorationIdsRef.current, [])
    }
  }, [aiSuggestions, onAcceptAiSuggestion, onRejectAiSuggestion])

  const handleSave = React.useCallback(async () => {
    if (editorContent == null || saving) return
    setSaving(true)
    try {
      await onSave(editorContent)
    } catch (error) {
      toast("error", formatErrorMessage(error, "保存失败"))
    } finally {
      setSaving(false)
    }
  }, [editorContent, onSave, saving, toast])

  const handleRun = React.useCallback(async () => {
    if (!filePath || !isRunnableCangjieFile(filePath) || editorContent == null || running) return
    setRunDialogOpen(true)
    setRunning(true)
    try {
      const result = await workspaceApi.runCangjie(editorContent, filePath.split("/").pop() || "snippet.cj", "workspace")
      setRunResult(result)
    } catch (error: any) {
      const message = error?.message || "运行失败"
      setRunResult({
        success: false,
        stdout: "",
        stderr: message,
        combinedOutput: message,
        exitCode: null,
        error: message,
      })
      toast("error", message)
    } finally {
      setRunning(false)
    }
  }, [editorContent, filePath, running, toast])

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [handleSave])

  const handleUndo = () => {
    editorRef.current?.trigger("keyboard", "undo", null)
  }
  const handleRedo = () => {
    editorRef.current?.trigger("keyboard", "redo", null)
  }

  const pathSegments = (filePath?.replace(/\\/g, "/").split("/").filter(Boolean) || []).map(getDisplayedPathSegment)
  const canRunCangjie = isRunnableCangjieFile(filePath) && !oversize && !loading && editorContent != null
  const isNotebook = mode === 'notebook' && isNotebookFile(filePath)
  const canPreviewHtml = Boolean(
    mode === 'default'
      && workspacePath
      && filePath
      && fileType
      && HTML_PREVIEW_EXTENSIONS.has(fileType)
      && !loading
      && !error
      && !oversize,
  )
  const canPreviewMarkdown = Boolean(
    mode === 'default'
      && filePath
      && fileType
      && MARKDOWN_PREVIEW_EXTENSIONS.has(fileType)
      && editorContent != null
      && !loading
      && !error
      && !oversize,
  )
  const canPreviewNdjson = Boolean(
    mode === 'default'
      && filePath
      && fileType
      && NDJSON_PREVIEW_EXTENSIONS.has(fileType)
      && editorContent != null
      && !loading
      && !error
      && !oversize,
  )
  const markdownPreviewContent = editorContent ?? ""
  const ndjsonPreviewContent = editorContent ?? ""
  const editorSplitPreviewOpen = (canPreviewHtml && htmlPreviewOpen) || (canPreviewMarkdown && markdownPreviewOpen) || (canPreviewNdjson && ndjsonPreviewOpen)
  const htmlPreviewUrl = React.useMemo(() => {
    if (!canPreviewHtml || !workspacePath || !filePath) return ""
    try {
      return `${workspaceApi.getStaticPreviewUrl(workspacePath, filePath)}?v=${htmlPreviewVersion}`
    } catch {
      return ""
    }
  }, [canPreviewHtml, filePath, htmlPreviewVersion, workspacePath])

  const openHtmlPreviewWindow = React.useCallback(() => {
    if (!htmlPreviewUrl) return
    const opened = window.open(htmlPreviewUrl, "_blank", "noopener,noreferrer")
    if (!opened) toast("error", "浏览器阻止了新窗口")
  }, [htmlPreviewUrl, toast])

  const openMarkdownPreviewWindow = React.useCallback(() => {
    if (!workspacePath || !filePath) return
    const routeParams = new URLSearchParams()
    routeParams.set("workspace", workspacePath)
    routeParams.set("file", filePath)
    const opened = window.open(`/workspace/markdown-preview?${routeParams.toString()}`, "_blank", "noopener,noreferrer")
    if (!opened) toast("error", "浏览器阻止了新窗口")
  }, [filePath, toast, workspacePath])

  const openNdjsonPreviewWindow = React.useCallback(() => {
    const opened = openReactPreviewWindow("NDJSON 表格预览", (
      <NdjsonAgGridPreview content={ndjsonPreviewContent} filePath={filePath} fullscreen />
    ))
    if (!opened) toast("error", "浏览器阻止了新窗口")
  }, [filePath, ndjsonPreviewContent, toast])

  React.useEffect(() => {
    if (!isNotebook) {
      setNotebookTocOpen(false)
      setNotebookDependencyGraphOpen(false)
    }
  }, [isNotebook])

  React.useEffect(() => {
    if (!canPreviewHtml) {
      setHtmlPreviewOpen(false)
    }
  }, [canPreviewHtml])

  React.useEffect(() => {
    if (!canPreviewMarkdown) {
      setMarkdownPreviewOpen(false)
    }
  }, [canPreviewMarkdown])

  React.useEffect(() => {
    if (!canPreviewNdjson) {
      setNdjsonPreviewOpen(false)
    }
  }, [canPreviewNdjson])

  React.useEffect(() => {
    const isPreviewableFile = Boolean(fileBlob && fileType && PREVIEW_EXTENSIONS.has(fileType))
    if (!isPreviewableFile) {
      setPreviewViewport({ width: 0, height: 0 })
      return
    }

    const host = previewHostRef.current
    if (!host) return

    const updateViewport = () => {
      const rect = host.getBoundingClientRect()
      const width = Math.max(0, Math.floor(rect.width))
      const height = Math.max(0, Math.floor(rect.height))
      setPreviewViewport((prev) => (
        prev.width === width && prev.height === height
          ? prev
          : { width, height }
      ))
    }

    updateViewport()

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateViewport())
      observer.observe(host)
      return () => observer.disconnect()
    }

    window.addEventListener("resize", updateViewport)
    return () => window.removeEventListener("resize", updateViewport)
  }, [fileBlob, fileType])

  const resolvedPreviewTheme = resolvedTheme === "dark" ? "dark" : "light"
  const previewViewerWidth = previewViewport.width > 0 ? Math.max(previewViewport.width, 320) : null
  const previewViewerHeight = previewViewport.height > 0 ? Math.max(previewViewport.height, 240) : null
  const isOfficePreview = Boolean(fileType && OFFICE_PREVIEW_EXTENSIONS.has(fileType))
  const MeasuredFileViewer = FileViewer as unknown as React.ComponentType<{
    file: Blob
    fileType: string
    theme?: "auto" | "light" | "dark"
    width?: number
    height?: number
  }>

  return (
    <>
      <div className="flex flex-col h-full w-full">
        <Menubar className="rounded-none border-x-0 border-t-0 shrink-0">
          <MenubarMenu>
            <MenubarTrigger>文件</MenubarTrigger>
            <MenubarContent>
              <MenubarItem onClick={handleSave} disabled={!filePath || oversize || saving}>
                {saving ? "保存中..." : "保存"}
                <MenubarShortcut>⌘S</MenubarShortcut>
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem onClick={handleRun} disabled={!canRunCangjie || running}>
                {running ? "运行中..." : "运行仓颉代码"}
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger>编辑</MenubarTrigger>
            <MenubarContent>
              <MenubarItem onClick={handleUndo} disabled={!filePath}>
                撤销
                <MenubarShortcut>⌘Z</MenubarShortcut>
              </MenubarItem>
              <MenubarItem onClick={handleRedo} disabled={!filePath}>
                重做
                <MenubarShortcut>⇧⌘Z</MenubarShortcut>
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger>视图</MenubarTrigger>
            <MenubarContent>
              <MenubarCheckboxItem
                checked={wordWrap === "on"}
                onCheckedChange={(checked) => setWordWrap(checked ? "on" : "off")}
              >
                自动换行
              </MenubarCheckboxItem>
              {isNotebook && (
                <>
                  <MenubarSeparator />
                  <MenubarCheckboxItem
                    checked={notebookTocOpen}
                    onCheckedChange={(checked) => setNotebookTocOpen(checked === true)}
                  >
                    目录
                  </MenubarCheckboxItem>
                  <MenubarCheckboxItem
                    checked={notebookDependencyGraphOpen}
                    onCheckedChange={(checked) => setNotebookDependencyGraphOpen(checked === true)}
                  >
                    依赖图
                  </MenubarCheckboxItem>
                </>
              )}
              {canPreviewHtml && (
                <>
                  <MenubarSeparator />
                  <MenubarCheckboxItem
                    checked={htmlPreviewOpen}
                    onCheckedChange={(checked) => setHtmlPreviewOpen(checked === true)}
                  >
                    HTML 预览
                  </MenubarCheckboxItem>
                  <MenubarItem onClick={openHtmlPreviewWindow}>
                    全屏预览
                  </MenubarItem>
                </>
              )}
              {canPreviewMarkdown && (
                <>
                  <MenubarSeparator />
                  <MenubarCheckboxItem
                    checked={markdownPreviewOpen}
                    onCheckedChange={(checked) => setMarkdownPreviewOpen(checked === true)}
                  >
                    Markdown 预览
                  </MenubarCheckboxItem>
                  <MenubarItem onClick={openMarkdownPreviewWindow}>
                    全屏预览
                  </MenubarItem>
                </>
              )}
              {canPreviewNdjson && (
                <>
                  <MenubarSeparator />
                  <MenubarCheckboxItem
                    checked={ndjsonPreviewOpen}
                    onCheckedChange={(checked) => setNdjsonPreviewOpen(checked === true)}
                  >
                    NDJSON 表格预览
                  </MenubarCheckboxItem>
                  <MenubarItem onClick={openNdjsonPreviewWindow}>
                    全屏表格预览
                  </MenubarItem>
                </>
              )}
            </MenubarContent>
          </MenubarMenu>
          <div className="ml-auto flex items-center px-2 gap-2">
            {canPreviewHtml && (
              <>
                <Button
                  variant={htmlPreviewOpen ? "default" : "outline"}
                  size="sm"
                  onClick={() => setHtmlPreviewOpen((value) => !value)}
                  className="h-7 gap-1.5"
                  title="切换 HTML 预览"
                >
                  <Eye className="h-3.5 w-3.5" />
                  预览
                </Button>
                {htmlPreviewOpen && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setHtmlPreviewVersion((value) => value + 1)}
                    className="h-7 w-7"
                    title="刷新 HTML 预览"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span className="sr-only">刷新 HTML 预览</span>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={openHtmlPreviewWindow}
                  className="h-7 w-7"
                  title="全屏 HTML 预览"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span className="sr-only">全屏 HTML 预览</span>
                </Button>
              </>
            )}
            {canPreviewMarkdown && (
              <>
                <Button
                  variant={markdownPreviewOpen ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMarkdownPreviewOpen((value) => !value)}
                  className="h-7 gap-1.5"
                  title="切换 Markdown 预览"
                >
                  <Eye className="h-3.5 w-3.5" />
                  预览
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={openMarkdownPreviewWindow}
                  className="h-7 w-7"
                  title="全屏 Markdown 预览"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span className="sr-only">全屏 Markdown 预览</span>
                </Button>
              </>
            )}
            {canPreviewNdjson && (
              <>
                <Button
                  variant={ndjsonPreviewOpen ? "default" : "outline"}
                  size="sm"
                  onClick={() => setNdjsonPreviewOpen((value) => !value)}
                  className="h-7 gap-1.5"
                  title="切换 NDJSON 表格预览"
                >
                  <Eye className="h-3.5 w-3.5" />
                  表格
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={openNdjsonPreviewWindow}
                  className="h-7 w-7"
                  title="全屏 NDJSON 表格预览"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span className="sr-only">全屏 NDJSON 表格预览</span>
                </Button>
              </>
            )}
            {canRunCangjie && (
              <Button variant="outline" size="sm" onClick={handleRun} disabled={running} className="h-7 gap-1.5">
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {running ? "运行中" : "运行"}
              </Button>
            )}
            {filePath && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAskAIFromFile?.()}
                className="h-7 gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">smart_toy</span>
                问 AI
              </Button>
            )}
          </div>
        </Menubar>

        {filePath && (
          <div className="px-3 py-1.5 border-b bg-muted/30 shrink-0">
            <Breadcrumb>
              <BreadcrumbList>
                {pathSegments.map((segment, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem>
                      {i === pathSegments.length - 1 ? (
                        <BreadcrumbPage>{segment}</BreadcrumbPage>
                      ) : (
                        <span className="text-muted-foreground">{segment}</span>
                      )}
                    </BreadcrumbItem>
                  </React.Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        )}

        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !filePath ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <FileCode2 className="h-12 w-12" />
              <p className="text-sm">选择一个文件开始编辑</p>
              <p className="text-xs">使用 ⌘P 快速搜索文件</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center text-destructive">
              <FileCode2 className="h-12 w-12" />
              <p className="text-sm">{error}</p>
            </div>
          ) : oversize ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <FileCode2 className="h-12 w-12" />
              <p className="text-sm">文件过大（{formatFileSize(fileSize)}），仅支持预览和编辑 1 MB 以下的文件</p>
            </div>
          ) : fileBlob && fileType && PREVIEW_EXTENSIONS.has(fileType) ? (
            <div
              ref={previewHostRef}
              className={cn(
                "h-full min-h-0 overflow-auto",
                previewStyles.fileViewerShell,
                isOfficePreview && previewStyles.officeViewerShell,
              )}
            >
              {previewViewerWidth && previewViewerHeight ? (
                <MeasuredFileViewer
                  file={fileBlob}
                  fileType={fileType}
                  theme={resolvedPreviewTheme}
                  width={previewViewerWidth}
                  height={previewViewerHeight}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          ) : isNotebook && content != null ? (
            <NotebookEditor
              filePath={filePath!}
              content={content}
              onSave={onSave}
              scope={notebookScope}
              shareToken={notebookShareToken}
              permission={notebookPermission}
              tocOpen={notebookTocOpen}
              onTocOpenChange={setNotebookTocOpen}
              dependencyGraphOpen={notebookDependencyGraphOpen}
              onDependencyGraphOpenChange={setNotebookDependencyGraphOpen}
            />
          ) : (
            <div className="flex h-full min-h-0">
              <div className={cn("min-h-0", editorSplitPreviewOpen ? "w-1/2 border-r" : "w-full")}>
                <MonacoEditor
                  height="100%"
                  language={getLanguage(filePath)}
                  theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
                  value={editorContent ?? ""}
                  onChange={(value: string | undefined) => setEditorContent(value ?? "")}
                  onMount={(editor: any, monaco: any) => {
                editorRef.current = editor
                monacoRef.current = monaco
                setEditorMountVersion((version) => version + 1)
                if (!cangjieRegistered.current) {
                  registerCangjieLanguage(monaco)
                  cangjieRegistered.current = true
                }
                if (!cmakeRegistered.current) {
                  registerCMakeLanguage(monaco)
                  cmakeRegistered.current = true
                }

                editor.addAction({
                  id: "ask-ai-current-file",
                  label: "解释当前文件",
                  precondition: "!editorHasSelection",
                  contextMenuGroupId: "navigation",
                  contextMenuOrder: 1.4,
                  run: () => {
                    onAskAIFromFile?.()
                  },
                })

                editor.addAction({
                  id: "ask-ai-selection",
                  label: "解释选中内容",
                  precondition: "editorHasSelection",
                  contextMenuGroupId: "navigation",
                  contextMenuOrder: 1.5,
                  run: () => {
                    if (!onAskAIFromSelection) return
                    const model = editor.getModel()
                    const selection = editor.getSelection()
                    if (!model || !selection) return
                    const selectedText = model.getValueInRange(selection)
                    if (!selectedText.trim()) return
                    onAskAIFromSelection({
                      text: selectedText,
                      range: {
                        startLineNumber: selection.startLineNumber,
                        startColumn: selection.startColumn,
                        endLineNumber: selection.endLineNumber,
                        endColumn: selection.endColumn,
                      },
                    })
                  },
                })

                editor.addAction({
                  id: "ask-ai-review-selection",
                  label: "检视意见",
                  precondition: "editorHasSelection",
                  contextMenuGroupId: "navigation",
                  contextMenuOrder: 1.6,
                  run: () => {
                    if (!onAskAIAction) return
                    const model = editor.getModel()
                    const selection = editor.getSelection()
                    if (!model || !selection) return
                    const selectedText = model.getValueInRange(selection)
                    if (!selectedText.trim()) return
                    onAskAIAction('review', {
                      text: selectedText,
                      range: {
                        startLineNumber: selection.startLineNumber,
                        startColumn: selection.startColumn,
                        endLineNumber: selection.endLineNumber,
                        endColumn: selection.endColumn,
                      },
                    })
                  },
                })

                editor.addAction({
                  id: "ask-ai-fix-error-selection",
                  label: "解决错误",
                  precondition: "editorHasSelection",
                  contextMenuGroupId: "navigation",
                  contextMenuOrder: 1.7,
                  run: () => {
                    if (!onAskAIAction) return
                    const model = editor.getModel()
                    const selection = editor.getSelection()
                    if (!model || !selection) return
                    const selectedText = model.getValueInRange(selection)
                    if (!selectedText.trim()) return
                    onAskAIAction('fixError', {
                      text: selectedText,
                      range: {
                        startLineNumber: selection.startLineNumber,
                        startColumn: selection.startColumn,
                        endLineNumber: selection.endLineNumber,
                        endColumn: selection.endColumn,
                      },
                    })
                  },
                })

                editor.addAction({
                  id: "ask-ai-add-comment-selection",
                  label: "添加注释",
                  precondition: "editorHasSelection",
                  contextMenuGroupId: "navigation",
                  contextMenuOrder: 1.8,
                  run: () => {
                    if (!onAskAIAction) return
                    const model = editor.getModel()
                    const selection = editor.getSelection()
                    if (!model || !selection) return
                    const selectedText = model.getValueInRange(selection)
                    if (!selectedText.trim()) return
                    onAskAIAction('addComment', {
                      text: selectedText,
                      range: {
                        startLineNumber: selection.startLineNumber,
                        startColumn: selection.startColumn,
                        endLineNumber: selection.endLineNumber,
                        endColumn: selection.endColumn,
                      },
                    })
                  },
                })
                  }}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: "on",
                    wordWrap,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    padding: { top: 8 },
                  }}
                />
              </div>
              {canPreviewHtml && htmlPreviewOpen ? (
                <div className="flex min-h-0 w-1/2 flex-col bg-background">
                  <div className="flex h-9 shrink-0 items-center justify-between border-b px-3 text-xs text-muted-foreground">
                    <span className="truncate">静态 HTML 预览</span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setHtmlPreviewVersion((value) => value + 1)}
                        title="刷新预览"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span className="sr-only">刷新预览</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={openHtmlPreviewWindow}
                        title="全屏预览"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                        <span className="sr-only">全屏预览</span>
                      </Button>
                    </div>
                  </div>
                  <iframe
                    key={htmlPreviewUrl}
                    src={htmlPreviewUrl}
                    title="HTML 预览"
                    className="h-full min-h-0 w-full flex-1 bg-white"
                    sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
                  />
                </div>
              ) : null}
              {canPreviewMarkdown && markdownPreviewOpen ? (
                <div className="flex min-h-0 w-1/2 flex-col bg-background">
                  <div className="flex h-9 shrink-0 items-center justify-between border-b px-3 text-xs text-muted-foreground">
                    <span className="truncate">Markdown 预览</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={openMarkdownPreviewWindow}
                      title="全屏预览"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                      <span className="sr-only">全屏预览</span>
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
                    <Markdown>{markdownPreviewContent}</Markdown>
                  </div>
                </div>
              ) : null}
              {canPreviewNdjson && ndjsonPreviewOpen ? (
                <div className="flex min-h-0 w-1/2 flex-col bg-background">
                  <div className="flex h-9 shrink-0 items-center justify-between border-b px-3 text-xs text-muted-foreground">
                    <span className="truncate">NDJSON 表格预览</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={openNdjsonPreviewWindow}
                      title="全屏表格预览"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                      <span className="sr-only">全屏表格预览</span>
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1">
                    <NdjsonAgGridPreview content={ndjsonPreviewContent} filePath={filePath} />
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>运行仓颉代码</DialogTitle>
            <DialogDescription>
              {filePath ? `当前文件：${filePath}` : "当前编辑器内容"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto space-y-3 text-sm">
            {running ? (
              <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>运行中...</span>
              </div>
            ) : (
              <>
                {runResult?.commandSummary && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">执行命令</div>
                    <AnsiLogBlock text={runResult.commandSummary} />
                  </div>
                )}
                {runResult?.stdout && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">stdout</div>
                    <AnsiLogBlock text={runResult.stdout} />
                  </div>
                )}
                {runResult?.stderr && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">stderr</div>
                    <AnsiLogBlock text={runResult.stderr} />
                  </div>
                )}
                {!runResult?.stdout && !runResult?.stderr && !runResult?.commandSummary && (
                  <div className="text-muted-foreground py-8 text-center">暂无输出</div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="items-center gap-2 sm:justify-between">
            <div className="text-xs text-muted-foreground">
              {runResult?.exitCode != null ? `exit code: ${runResult.exitCode}` : runResult?.error || ""}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setRunDialogOpen(false)}>关闭</Button>
              <Button onClick={handleRun} disabled={!canRunCangjie || running}>
                {running ? "运行中..." : "重新运行"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
