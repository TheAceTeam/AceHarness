"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useTheme } from "next-themes"
import { Loader2, FileCode2, Play } from "lucide-react"
import { NotebookEditor } from "@/components/notebook/NotebookEditor"
import { AnsiLogBlock } from "@/components/AnsiLogBlock"
import { registerCangjieLanguage } from "@/lib/cangjie-language"
import { registerCMakeLanguage } from "@/lib/cmake-language"
import { workspaceApi, type NotebookScope, type WorkspaceMode } from "@/lib/api"
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

interface EditorPanelProps {
  filePath: string | null
  content: string | null
  fileSize: number | null
  loading: boolean
  onSave: (content: string) => Promise<void>
  oversize?: boolean
  fileBlob?: Blob | null
  error?: string | null
  fileType?: string
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

export function EditorPanel({
  filePath,
  content,
  fileSize,
  loading,
  onSave,
  oversize,
  fileBlob,
  error,
  fileType,
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
  const cangjieRegistered = React.useRef(false)
  const cmakeRegistered = React.useRef(false)
  const suggestionDecorationIdsRef = React.useRef<string[]>([])
  const suggestionZoneIdsRef = React.useRef<string[]>([])

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

  const pathSegments = filePath?.split("/").filter(Boolean) || []
  const canRunCangjie = isRunnableCangjieFile(filePath) && !oversize && !loading && editorContent != null
  const isNotebook = mode === 'notebook' && isNotebookFile(filePath)

  React.useEffect(() => {
    if (!isNotebook) {
      setNotebookTocOpen(false)
      setNotebookDependencyGraphOpen(false)
    }
  }, [isNotebook])

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
            </MenubarContent>
          </MenubarMenu>
          {canRunCangjie && (
            <div className="ml-auto flex items-center px-2">
              <Button variant="outline" size="sm" onClick={handleRun} disabled={running} className="h-7 gap-1.5">
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {running ? "运行中" : "运行"}
              </Button>
            </div>
          )}
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
              <p className="text-sm">文件过大（{fileSize ? (fileSize >= 1024 * 1024 ? `${(fileSize / 1024 / 1024).toFixed(1)}MB` : `${(fileSize / 1024).toFixed(1)}KB`) : ""}），仅支持预览和编辑 200KB 以下的文件</p>
            </div>
          ) : fileBlob && fileType && PREVIEW_EXTENSIONS.has(fileType) ? (
            <div className="h-full overflow-auto">
              <FileViewer file={fileBlob} fileType={fileType} />
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
            <MonacoEditor
              height="100%"
              language={getLanguage(filePath)}
              theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
              value={editorContent ?? ""}
              onChange={(value) => setEditorContent(value ?? "")}
              onMount={(editor, monaco) => {
                editorRef.current = editor
                monacoRef.current = monaco
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
