"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { usePathname, useRouter, useSearchParams } from "@/lib/navigation/client"
import { workspaceApi, type NotebookScope, type TreeNode, type WorkspaceMode, type WorkspaceTreeResponse } from "@/lib/core/api"
import { X, ChevronLeft, ChevronRight } from "lucide-react"
import { useDefaultLayout, usePanelRef } from "react-resizable-panels"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { FileTreeSidebar, type ClipboardItem } from "./FileTreeSidebar"
import { EditorPanel } from "./EditorPanel"
import { FileSearchCommand } from "./FileSearchCommand"
import AiAssistantSheet from "@/components/chat/AiAssistantSheet"
import * as VisuallyHidden from "@radix-ui/react-visually-hidden"
import { useDocumentTitle } from "@/hooks/useDocumentTitle"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/core/utils"
import { parseWorkspaceFileLocation } from "@/lib/workspace/link-target"
import {
  useNotebookFileQuery,
  useNotebookFileBlobQuery,
  useNotebookTreeQuery,
  useWorkspaceFileBlobQuery,
  useWorkspaceFileQuery,
  useWorkspaceTreeQuery,
} from "@/client/query/workspace"
import { queryKeys } from "@/client/query/query-keys"
import {
  syncWorkspaceTreeToDb,
  useSyncWorkspaceTreeToDb,
  useWorkspaceTreeRows,
} from "@/client/db/collections"

interface WorkspaceEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspacePath: string
  initialFilePath?: string | null
  initialLineNumber?: number | null
  initialColumn?: number | null
  mode?: WorkspaceMode
  title?: string
  presentation?: "drawer" | "page"
  notebookScope?: NotebookScope
  notebookShareToken?: string
  notebookPermission?: 'read' | 'write'
  onNotebookInspectorChange?: (state: WorkspaceEditorInspectorState) => void
  onFileLocationChange?: (filePath: string | null, lineNumber?: number | null, column?: number | null) => void
  searchParamsSnapshot?: string
}

export interface WorkspaceEditorInspectorState {
  selectedFile: string | null
  fileSize: number | null
  fileType?: string
  loading: boolean
  error: string | null
  readOnly: boolean
  oversize: boolean
  node: TreeNode | null
  treeCount: number
}

type NotebookBrowserView = "list" | "desktop"

type DiffLine = { type: 'equal' | 'delete' | 'add'; text: string }

const WORKSPACE_TREE_PAGE_SIZE = 200

interface WorkspaceTreePagination {
  hasMore: boolean
  nextOffset: number | null
  totalEntries?: number
}

function getWorkspaceTreePagination(data: WorkspaceTreeResponse): WorkspaceTreePagination {
  return {
    hasMore: Boolean(data.hasMore),
    nextOffset: data.nextOffset ?? null,
    totalEntries: data.totalEntries,
  }
}

function getParentDir(filePath: string): string {
  const normalized = String(filePath || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  const parts = normalized.split("/").filter(Boolean)
  return parts.length > 1 ? parts.slice(0, -1).join("/") : ""
}

function buildLineDiff(beforeText: string, afterText: string): DiffLine[] {
  const before = (beforeText || "").replace(/\r\n/g, "\n").split("\n")
  const after = (afterText || "").replace(/\r\n/g, "\n").split("\n")
  // Ignore pure EOF newline differences to avoid trailing blank-line suggestions.
  if (before.length > 1 && before[before.length - 1] === "") before.pop()
  if (after.length > 1 && after[after.length - 1] === "") after.pop()
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
      lines.push({ type: "equal", text: before[i] })
      i += 1
      j += 1
      continue
    }
    if (j >= after.length || (i < before.length && dp[i + 1][j] > dp[i][j + 1])) {
      lines.push({ type: "delete", text: before[i] ?? "" })
      i += 1
      continue
    }
    lines.push({ type: "add", text: after[j] ?? "" })
    j += 1
  }
  return lines
}

const PREVIEW_EXTENSIONS = new Set([
  "pdf", "docx", "xlsx", "pptx",
  "png", "jpg", "jpeg", "gif",
  "mp4", "webm", "mp3",
])

const WINDOWS_DRIVE_ABSOLUTE_PATH = /^[a-zA-Z]:\//
const UNC_ABSOLUTE_PATH = /^\/\/[^/]+\/[^/]+/

function isPreviewFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() || ""
  return PREVIEW_EXTENSIONS.has(ext)
}

function getFileType(filePath: string): string {
  return filePath.split(".").pop()?.toLowerCase() || ""
}

function normalizeWorkspacePathValue(value: string | null | undefined): string {
  return String(value || "").replace(/\\/g, "/").trim()
}

function isWorkspaceAbsolutePath(value: string): boolean {
  return value.startsWith("/") || WINDOWS_DRIVE_ABSOLUTE_PATH.test(value) || UNC_ABSOLUTE_PATH.test(value)
}

function resolveWorkspaceSelectionCandidate(
  workspacePath: string,
  candidatePath?: string | null,
): string | null {
  const normalizedWorkspace = normalizeWorkspacePathValue(workspacePath).replace(/\/+$/g, "")
  const normalizedCandidate = normalizeWorkspacePathValue(candidatePath)
    .replace(/^\.\//, "")

  if (!normalizedWorkspace || !normalizedCandidate) return null
  if (normalizedCandidate === normalizedWorkspace) return null

  if (!isWorkspaceAbsolutePath(normalizedCandidate)) {
    return normalizedCandidate.replace(/^\/+/, "") || null
  }

  const compareAsCaseInsensitive = WINDOWS_DRIVE_ABSOLUTE_PATH.test(normalizedWorkspace)
    || UNC_ABSOLUTE_PATH.test(normalizedWorkspace)
  const comparableWorkspace = compareAsCaseInsensitive
    ? normalizedWorkspace.toLowerCase()
    : normalizedWorkspace
  const comparableCandidate = compareAsCaseInsensitive
    ? normalizedCandidate.toLowerCase()
    : normalizedCandidate

  if (!comparableCandidate.startsWith(`${comparableWorkspace}/`)) {
    return null
  }

  return normalizedCandidate.slice(normalizedWorkspace.length + 1) || null
}

export function resolveWorkspaceEditorTargetFile(payload: {
  workspacePath: string
  mode?: WorkspaceMode
  initialFilePath?: string | null
  urlFilePath?: string | null
}): string | null {
  const { workspacePath, mode = "default", initialFilePath, urlFilePath } = payload
  const initialLocation = parseWorkspaceFileLocation(initialFilePath)
  const urlLocation = parseWorkspaceFileLocation(urlFilePath)

  if (mode === "notebook") {
    return normalizeWorkspacePathValue(urlLocation.path || initialLocation.path)
      .replace(/^\.\//, "")
      .replace(/^\/+/, "") || null
  }

  return resolveWorkspaceSelectionCandidate(workspacePath, initialLocation.path)
    || resolveWorkspaceSelectionCandidate(workspacePath, urlLocation.path)
}

export function treeCanResolvePath(tree: TreeNode[], targetPath: string): boolean {
  const normalizedTarget = targetPath.replace(/\\/g, "/")
  for (const node of tree) {
    const normalizedNodePath = node.path.replace(/\\/g, "/")
    if (normalizedNodePath === normalizedTarget) return true
    if (node.type !== "directory") continue
    if (!normalizedTarget.startsWith(`${normalizedNodePath}/`)) {
      if (node.children && treeCanResolvePath(node.children, normalizedTarget)) return true
      continue
    }
    // A directory without loaded children means the tree has not proven the deeper path absent yet.
    if (node.children === undefined) return true
    if (treeCanResolvePath(node.children, normalizedTarget)) return true
  }
  return false
}

function findTreeNode(tree: TreeNode[], targetPath: string): TreeNode | null {
  for (const node of tree) {
    if (node.path === targetPath) return node
    if (node.type === "directory" && node.children) {
      const hit = findTreeNode(node.children, targetPath)
      if (hit) return hit
    }
  }
  return null
}

function countTreeNodes(tree: TreeNode[]): number {
  return tree.reduce((total, node) => total + 1 + (node.children ? countTreeNodes(node.children) : 0), 0)
}

function splitSuggestionIntoLineHunks(payload: {
  action: 'review' | 'fixError' | 'addComment'
  sourceText: string
  targetText: string
  baseRange: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
}) {
  const { action, sourceText, targetText, baseRange } = payload
  const beforeLines = (sourceText || "").replace(/\r\n/g, "\n").split("\n")
  const diff = buildLineDiff(sourceText, targetText)
  const suggestions: Array<{
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
  }> = []

  let sourceLineCursor = 0
  let idx = 0
  while (idx < diff.length) {
    if (diff[idx]?.type === "equal") {
      sourceLineCursor += 1
      idx += 1
      continue
    }

    const hunkStartSourceLine = sourceLineCursor
    const deleted: string[] = []
    const added: string[] = []
    while (idx < diff.length && diff[idx]?.type !== "equal") {
      const line = diff[idx]
      if (line.type === "delete") {
        deleted.push(line.text)
        sourceLineCursor += 1
      } else if (line.type === "add") {
        added.push(line.text)
      }
      idx += 1
    }

    const oldLineCount = deleted.length
    const newLineCount = added.length
    if (oldLineCount === 0 && newLineCount === 0) continue
    const startLineNumber = baseRange.startLineNumber + hunkStartSourceLine
    const endLineNumber = oldLineCount > 0 ? startLineNumber + oldLineCount : startLineNumber
    const decorateEndLineNumber = oldLineCount > 0 ? startLineNumber + oldLineCount - 1 : startLineNumber
    const insertsBeforeExistingLine = oldLineCount === 0 && hunkStartSourceLine < beforeLines.length
    suggestions.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action,
      sourceText: deleted.join("\n"),
      targetText: (() => {
        if (newLineCount === 0) return ""
        const joined = added.join("\n")
        if (oldLineCount > 0) return `${joined}\n`
        return insertsBeforeExistingLine ? `${joined}\n` : joined
      })(),
      oldLineCount,
      newLineCount,
      range: {
        startLineNumber,
        startColumn: 1,
        endLineNumber,
        endColumn: 1,
      },
      decorateRange: {
        startLineNumber,
        endLineNumber: decorateEndLineNumber,
      },
      insertBefore: insertsBeforeExistingLine,
    })
  }

  return suggestions
}

function formatErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error.trim()) return error
  return fallback
}

function isFileTooLargeError(error: unknown): error is Error & { status?: number; size?: number } {
  if (error instanceof Error && (error as Error & { status?: number }).status === 413) return true
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  return /[KM]B 限制/i.test(message)
}

export function WorkspaceEditor({
  open,
  onOpenChange,
  workspacePath,
  initialFilePath,
  initialLineNumber,
  initialColumn,
  mode = "default",
  title,
  presentation = "drawer",
  notebookScope = 'personal',
  notebookShareToken,
  notebookPermission = 'write',
  onNotebookInspectorChange,
  onFileLocationChange,
  searchParamsSnapshot,
}: WorkspaceEditorProps) {
  const queryClient = useQueryClient()
  const [tree, setTree] = React.useState<TreeNode[]>([])
  const [treeLoading, setTreeLoading] = React.useState(false)
  const [treeError, setTreeError] = React.useState<string | null>(null)
  const [rootPagination, setRootPagination] = React.useState<WorkspaceTreePagination>({ hasMore: false, nextOffset: null })
  const [rootLoadingMore, setRootLoadingMore] = React.useState(false)
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null)
  const [fileContent, setFileContent] = React.useState<string | null>(null)
  const [fileSize, setFileSize] = React.useState<number | null>(null)
  const [fileLoading, setFileLoading] = React.useState(false)
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [selectedFileReadOnly, setSelectedFileReadOnly] = React.useState(false)
  const [oversize, setOversize] = React.useState(false)
  const [fileBlob, setFileBlob] = React.useState<Blob | null>(null)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [treeCollapsed, setTreeCollapsed] = React.useState(false)
  const [clipboard, setClipboard] = React.useState<ClipboardItem | null>(null)
  const [aiSheetOpen, setAiSheetOpen] = React.useState(false)
  const [notebookBrowserView, setNotebookBrowserView] = React.useState<NotebookBrowserView>("list")
  const [aiContext, setAiContext] = React.useState("")
  const [aiAutoTask, setAiAutoTask] = React.useState<{ id: string; displayText: string; prompt: string } | null>(null)
  const [aiSelectionMeta, setAiSelectionMeta] = React.useState<{
    action: 'explain' | 'review' | 'fixError' | 'addComment'
    text: string
    range: {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
    }
  } | null>(null)
  const [pendingAiSuggestions, setPendingAiSuggestions] = React.useState<Array<{
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
  }>>([])
  const [applyAiSuggestionRequest, setApplyAiSuggestionRequest] = React.useState<{
    id: string
    range: {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
    }
    targetText: string
  } | null>(null)
  const [applyAiSuggestionQueue, setApplyAiSuggestionQueue] = React.useState<Array<{
    id: string
    range: {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
    }
    targetText: string
  }>>([])
  const treePanelRef = usePanelRef()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const effectiveSearchParams = React.useMemo(
    () => new URLSearchParams(searchParamsSnapshot ?? searchParams.toString()),
    [searchParams, searchParamsSnapshot],
  )
  const { toast } = useToast()
  const fileParamKey = mode === "notebook" ? "notebookFile" : "workspaceFile"
  const panelParamKey = mode === "notebook" ? "notebook" : "workspace"
  const scopeParamKey = mode === "notebook" ? "notebookScope" : "workspaceScope"
  const lineParamKey = mode === "notebook" ? "notebookLine" : "workspaceLine"
  const columnParamKey = mode === "notebook" ? "notebookColumn" : "workspaceColumn"
  const initialSelectionSeedRef = React.useRef<string | null>(null)
  const lastUrlSelectionRef = React.useRef<string | null>(null)
  const [selectedLineNumber, setSelectedLineNumber] = React.useState<number | null>(null)
  const [selectedColumn, setSelectedColumn] = React.useState<number | null>(null)

  const baseTitle = React.useMemo(() => {
    if (title?.trim()) return title.trim()
    if (mode === "notebook") return "Cangjie Notebook"
    return workspacePath.split("/").filter(Boolean).pop() || "Workspace"
  }, [mode, title, workspacePath])

  const currentTitle = React.useMemo(() => {
    if (!open) return null
    if (!selectedFile) return baseTitle
    const fileName = selectedFile.split("/").pop() || selectedFile
    return `${fileName} · ${baseTitle}`
  }, [baseTitle, open, selectedFile])

  const openAiWithFilePath = React.useCallback(() => {
    if (!selectedFile) return
    const filePathText = selectedFile ? `当前文件路径：${selectedFile}` : "当前未选择文件"
    setAiContext(filePathText)
    setAiSelectionMeta(null)
    setAiAutoTask(null)
    setAiSheetOpen(true)
  }, [selectedFile])

  const openAiWithSelection = React.useCallback((payload: {
    text: string
    range: {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
    }
  }) => {
    const rawText = payload.text
    if (!rawText.trim()) return
    setAiContext(rawText)
    setAiSelectionMeta({
      action: 'explain',
      text: rawText,
      range: payload.range,
    })
    setAiAutoTask({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      displayText: '解释选中内容',
      prompt: [
        '你是代码解释助手。',
        '请解释下面选中内容的作用、关键逻辑与输入输出。',
        '要求：结构清晰、简洁、可执行。',
        '',
        '选中内容：',
        rawText,
      ].join('\n'),
    })
    setAiSheetOpen(true)
  }, [])

  const openAiWithAction = React.useCallback((action: 'explain' | 'review' | 'fixError' | 'addComment', payload: {
    text: string
    range: {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
    }
  }) => {
    const rawText = payload.text
    if (!rawText.trim()) return
    let displayText = '解释选中内容'
    let instruction = '请解释下面选中内容的作用、关键逻辑与输入输出。'
    if (action === 'review') {
      displayText = '检视意见'
      instruction = '请对下面内容进行代码审查，给出问题点、风险与改进建议。'
    } else if (action === 'fixError') {
      displayText = '解决错误'
      instruction = '请定位下面内容中的错误并给出修复后的代码。'
    } else if (action === 'addComment') {
      displayText = '添加注释'
      instruction = '请在不改变逻辑的前提下，为下面代码补充高质量注释并返回完整结果。'
    }
    setAiContext(rawText)
    setAiSelectionMeta({
      action,
      text: rawText,
      range: payload.range,
    })
    setAiAutoTask({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      displayText,
      prompt: [
        '你是专业代码助手。',
        instruction,
        '输出要求：严格按下面格式返回，不要输出额外说明。',
        '如果是代码结果，必须保持原语言语法与换行缩进，不要压成一行。',
        '<result>',
        action === 'review' ? '检视后的建议内容' : '处理后的完整内容',
        '</result>',
        '',
        '选中内容：',
        rawText,
      ].join('\n'),
    })
    setAiSheetOpen(true)
  }, [])

  const handleAiInsertResult = React.useCallback((content: string) => {
    if (!content.trim()) return
    const result = content
    if (!aiSelectionMeta) return
    const { action } = aiSelectionMeta
    if (action === 'review' || action === 'fixError' || action === 'addComment') {
      const hunks = splitSuggestionIntoLineHunks({
        action,
        sourceText: aiSelectionMeta.text,
        targetText: result,
        baseRange: aiSelectionMeta.range,
      })
      if (hunks.length === 0) return
      setPendingAiSuggestions((prev) => [...prev, ...hunks])
      return
    }
    if (action === 'explain') return
  }, [aiSelectionMeta])

  React.useEffect(() => {
    if (applyAiSuggestionRequest) return
    if (applyAiSuggestionQueue.length === 0) return
    const [next, ...rest] = applyAiSuggestionQueue
    setApplyAiSuggestionRequest(next)
    setApplyAiSuggestionQueue(rest)
  }, [applyAiSuggestionQueue, applyAiSuggestionRequest])

  useDocumentTitle(currentTitle)

  const toggleTree = React.useCallback(() => {
    const panel = treePanelRef.current
    if (!panel) return
    panel.isCollapsed() ? panel.expand() : panel.collapse()
  }, [treePanelRef])

  React.useEffect(() => {
    if (typeof window === "undefined" || mode !== "notebook") return
    const saved = window.localStorage.getItem("notebook-browser-view")
    if (saved === "desktop" || saved === "list") {
      setNotebookBrowserView(saved)
    }
  }, [mode])

  const handleNotebookViewChange = React.useCallback((view: NotebookBrowserView) => {
    setNotebookBrowserView(view)
    if (typeof window !== "undefined") {
      window.localStorage.setItem("notebook-browser-view", view)
    }
  }, [])

  const layoutId = mode === "notebook" ? `workspace-editor-${notebookBrowserView}` : "workspace-editor"
  const isNotebookDesktop = mode === "notebook" && notebookBrowserView === "desktop"
  const workspaceRootTreeParams = React.useMemo(
    () => ({ depth: 0, offset: 0, limit: WORKSPACE_TREE_PAGE_SIZE }),
    [],
  )
  const notebookRootTreeParams = React.useMemo(
    () => ({ depth: 8, scope: notebookScope, shareToken: notebookShareToken || "" }),
    [notebookScope, notebookShareToken],
  )

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: layoutId,
  })

  const updateUrlFileState = React.useCallback((filePath: string | null, lineNumber?: number | null, column?: number | null) => {
    if (onFileLocationChange) {
      onFileLocationChange(filePath, lineNumber, column)
      return
    }
    const params = new URLSearchParams(effectiveSearchParams.toString())
    if (filePath) {
      params.set(fileParamKey, filePath)
      params.set(panelParamKey, "1")
      if (mode === 'notebook') params.set(scopeParamKey, notebookScope)
      if (lineNumber && lineNumber > 0) params.set(lineParamKey, String(lineNumber))
      else params.delete(lineParamKey)
      if (column && column > 0) params.set(columnParamKey, String(column))
      else params.delete(columnParamKey)
    } else {
      params.delete(fileParamKey)
      params.delete(panelParamKey)
      params.delete(lineParamKey)
      params.delete(columnParamKey)
      if (mode === 'notebook') params.delete(scopeParamKey)
    }
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [columnParamKey, effectiveSearchParams, fileParamKey, lineParamKey, mode, notebookScope, onFileLocationChange, panelParamKey, pathname, router, scopeParamKey])

  const workspaceTreeQuery = useWorkspaceTreeQuery(
    workspacePath,
    { depth: workspaceRootTreeParams.depth, offset: workspaceRootTreeParams.offset, limit: workspaceRootTreeParams.limit },
    { enabled: open && mode === "default" && Boolean(workspacePath) },
  )
  const notebookTreeQuery = useNotebookTreeQuery(
    { depth: notebookRootTreeParams.depth, scope: notebookScope, shareToken: notebookShareToken },
    { enabled: open && mode === "notebook" && Boolean(workspacePath) },
  )
  const shouldQueryTextFile = open && Boolean(selectedFile) && Boolean(workspacePath) && !isPreviewFile(selectedFile || "")
  const workspaceFileQuery = useWorkspaceFileQuery(
    workspacePath,
    selectedFile || "",
    { enabled: shouldQueryTextFile && mode === "default" },
  )
  const workspaceFileBlobQuery = useWorkspaceFileBlobQuery(
    workspacePath,
    selectedFile || "",
    { enabled: Boolean(selectedFile && workspacePath && isPreviewFile(selectedFile) && mode === "default") },
  )
  const notebookFileQuery = useNotebookFileQuery(
    selectedFile || "",
    { scope: notebookScope, shareToken: notebookShareToken },
    { enabled: shouldQueryTextFile && mode === "notebook" },
  )
  const notebookFileBlobQuery = useNotebookFileBlobQuery(
    selectedFile || "",
    { scope: notebookScope, shareToken: notebookShareToken },
    { enabled: Boolean(selectedFile && isPreviewFile(selectedFile) && mode === "notebook") },
  )
  const treeSource = mode === "notebook" ? "notebook" : "workspace"
  const treeSourceKey = mode === "notebook"
    ? `${notebookScope}:${notebookShareToken || ""}`
    : workspacePath
  const dbRootTree = useWorkspaceTreeRows({
    source: treeSource,
    sourceKey: treeSourceKey,
    parentPath: "",
  })
  useSyncWorkspaceTreeToDb({
    source: "workspace",
    sourceKey: workspacePath,
    tree: mode === "default" ? workspaceTreeQuery.data?.tree : undefined,
    orderOffset: mode === "default" ? (workspaceTreeQuery.data?.offset || 0) : 0,
    replaceParents: mode === "default" && (workspaceTreeQuery.data?.offset || 0) === 0,
  })
  useSyncWorkspaceTreeToDb({
    source: "notebook",
    sourceKey: `${notebookScope}:${notebookShareToken || ""}`,
    tree: mode === "notebook" ? notebookTreeQuery.data?.tree : undefined,
    replaceParents: mode === "notebook",
  })

  React.useEffect(() => {
    if (!open || !workspacePath) return
    const activeQuery = mode === "notebook" ? notebookTreeQuery : workspaceTreeQuery
    setTreeLoading(activeQuery.isFetching)
    if (activeQuery.data) {
      setRootPagination(mode === "default" ? getWorkspaceTreePagination(activeQuery.data as WorkspaceTreeResponse) : { hasMore: false, nextOffset: null })
      setTreeError(null)
      return
    }
    if (activeQuery.error && !activeQuery.isFetching) {
      const message = formatErrorMessage(activeQuery.error, "加载文件树失败")
      setTree([])
      setRootPagination({ hasMore: false, nextOffset: null })
      setTreeError(message)
      toast("error", message)
    }
  }, [
    mode,
    notebookTreeQuery.data,
    notebookTreeQuery.error,
    notebookTreeQuery.isFetching,
    open,
    toast,
    workspacePath,
    workspaceTreeQuery.data,
    workspaceTreeQuery.error,
    workspaceTreeQuery.isFetching,
  ])

  React.useEffect(() => {
    if (!open || !workspacePath) return
    setTree(dbRootTree)
  }, [dbRootTree, open, workspacePath])

  React.useEffect(() => {
    if (open) return
    initialSelectionSeedRef.current = null
    lastUrlSelectionRef.current = null
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const fileFromUrl = effectiveSearchParams.get(fileParamKey)
    const lineFromUrl = Number.parseInt(effectiveSearchParams.get(lineParamKey) || "", 10)
    const columnFromUrl = Number.parseInt(effectiveSearchParams.get(columnParamKey) || "", 10)
    const initialLocation = parseWorkspaceFileLocation(initialFilePath)
    const urlLocation = parseWorkspaceFileLocation(fileFromUrl)
    const nextLineNumber = initialLineNumber || initialLocation.lineNumber || urlLocation.lineNumber || (lineFromUrl > 0 ? lineFromUrl : null)
    const nextColumn = initialColumn || initialLocation.column || urlLocation.column || (columnFromUrl > 0 ? columnFromUrl : null)
    const seed = [
      mode,
      workspacePath,
      initialFilePath || "",
      nextLineNumber || "",
      nextColumn || "",
      notebookScope,
      notebookShareToken || "",
    ].join("::")

    const urlSelectionKey = [
      fileFromUrl || "",
      lineFromUrl > 0 ? lineFromUrl : "",
      columnFromUrl > 0 ? columnFromUrl : "",
    ].join("::")

    if (initialSelectionSeedRef.current === seed) return
    initialSelectionSeedRef.current = seed
    lastUrlSelectionRef.current = urlSelectionKey

    const nextSelectedFile = resolveWorkspaceEditorTargetFile({
      workspacePath,
      mode,
      initialFilePath,
      urlFilePath: fileFromUrl,
    })
    setSelectedFile(nextSelectedFile)
    setSelectedLineNumber(nextSelectedFile ? nextLineNumber : null)
    setSelectedColumn(nextSelectedFile ? nextColumn : null)
  }, [columnParamKey, effectiveSearchParams, fileParamKey, initialColumn, initialFilePath, initialLineNumber, lineParamKey, mode, notebookScope, notebookShareToken, open, workspacePath])

  React.useEffect(() => {
    if (!open) return
    const fileFromUrl = effectiveSearchParams.get(fileParamKey)
    const lineFromUrl = Number.parseInt(effectiveSearchParams.get(lineParamKey) || "", 10)
    const columnFromUrl = Number.parseInt(effectiveSearchParams.get(columnParamKey) || "", 10)
    const urlSelectionKey = [
      fileFromUrl || "",
      lineFromUrl > 0 ? lineFromUrl : "",
      columnFromUrl > 0 ? columnFromUrl : "",
    ].join("::")
    if (lastUrlSelectionRef.current === urlSelectionKey) return
    lastUrlSelectionRef.current = urlSelectionKey
    const urlLocation = parseWorkspaceFileLocation(fileFromUrl)

    const nextSelectedFile = resolveWorkspaceEditorTargetFile({
      workspacePath,
      mode,
      urlFilePath: fileFromUrl,
    })
    if (nextSelectedFile) {
      setSelectedFile(nextSelectedFile)
      setSelectedLineNumber(urlLocation.lineNumber || (lineFromUrl > 0 ? lineFromUrl : null))
      setSelectedColumn(urlLocation.column || (columnFromUrl > 0 ? columnFromUrl : null))
      return
    }
    if (!fileFromUrl) {
      setSelectedFile(null)
      setSelectedLineNumber(null)
      setSelectedColumn(null)
    }
  }, [columnParamKey, effectiveSearchParams, fileParamKey, lineParamKey, mode, open, workspacePath])

  React.useEffect(() => {
    if (!selectedFile || !workspacePath) return
    setFileLoading(true)
    setOversize(false)
    setFileBlob(null)
    setFileContent(null)
    setFileError(null)
    setSelectedFileReadOnly(false)

    if (isPreviewFile(selectedFile)) {
      const activeBlobQuery = mode === "notebook" ? notebookFileBlobQuery : workspaceFileBlobQuery
      setFileLoading(activeBlobQuery.isFetching)
      if (activeBlobQuery.data) {
        setFileBlob(activeBlobQuery.data)
        setFileError(null)
        setSelectedFileReadOnly(Boolean(findTreeNode(tree, selectedFile)?.readOnly))
        setFileLoading(false)
        return
      }
      if (activeBlobQuery.error && !activeBlobQuery.isFetching) {
        const message = formatErrorMessage(activeBlobQuery.error, "预览文件失败")
        setFileBlob(null)
        setFileError(message)
        setSelectedFileReadOnly(Boolean(findTreeNode(tree, selectedFile)?.readOnly))
        toast("error", message)
        setFileLoading(false)
      }
      return
    }

    const activeQuery = mode === "notebook" ? notebookFileQuery : workspaceFileQuery
    setFileLoading(activeQuery.isFetching)
    if (activeQuery.data) {
      setFileContent(activeQuery.data.content)
      setFileSize(activeQuery.data.size)
      setFileError(null)
      setSelectedFileReadOnly(Boolean((activeQuery.data as { readOnly?: boolean }).readOnly) || Boolean(findTreeNode(tree, selectedFile)?.readOnly))
      setFileLoading(false)
      return
    }
    if (activeQuery.error && !activeQuery.isFetching) {
      const err = activeQuery.error as Error & { size?: number }
      if (isFileTooLargeError(err)) {
        setOversize(true)
        if (err.size != null) setFileSize(err.size)
        setFileError(null)
        setSelectedFileReadOnly(Boolean(findTreeNode(tree, selectedFile)?.readOnly))
        setFileLoading(false)
        return
      }
      const message = formatErrorMessage(err, "读取文件失败")
      setFileError(message)
      setSelectedFileReadOnly(Boolean(findTreeNode(tree, selectedFile)?.readOnly))
      toast("error", message)
      setFileLoading(false)
    }
  }, [
    mode,
    notebookFileQuery.data,
    notebookFileQuery.error,
    notebookFileQuery.isFetching,
    notebookFileBlobQuery.data,
    notebookFileBlobQuery.error,
    notebookFileBlobQuery.isFetching,
    notebookScope,
    notebookShareToken,
    selectedFile,
    toast,
    tree,
    workspaceFileQuery.data,
    workspaceFileQuery.error,
    workspaceFileQuery.isFetching,
    workspaceFileBlobQuery.data,
    workspaceFileBlobQuery.error,
    workspaceFileBlobQuery.isFetching,
    workspacePath,
  ])

  React.useEffect(() => {
    if (!selectedFile) return
    if (onFileLocationChange) return
    if (treeLoading || treeError) return
    if (treeCanResolvePath(tree, selectedFile)) return
    if (mode === "default" && rootPagination.hasMore) return
    setSelectedFile(null)
    setFileContent(null)
    setFileSize(null)
    setFileError(null)
    setSelectedFileReadOnly(false)
    setOversize(false)
    setFileBlob(null)
    setAiSheetOpen(false)
    setAiContext("")
    setAiAutoTask(null)
    setAiSelectionMeta(null)
    setSelectedLineNumber(null)
    setSelectedColumn(null)
    setPendingAiSuggestions([])
    setApplyAiSuggestionRequest(null)
    setApplyAiSuggestionQueue([])
    updateUrlFileState(null)
  }, [mode, onFileLocationChange, rootPagination.hasMore, selectedFile, tree, treeError, treeLoading, updateUrlFileState])

  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open])

  const handleSave = React.useCallback(
    async (content: string) => {
      if (!selectedFile) return
      if (mode === "notebook") {
        if (selectedFileReadOnly) {
          throw new Error('内置文档为只读内容，无法保存')
        }
        if (notebookPermission === 'read') {
          throw new Error('当前分享链接为只读权限，无法保存')
        }
        await workspaceApi.saveNotebookFile(selectedFile, content, { scope: notebookScope, shareToken: notebookShareToken })
        queryClient.setQueryData(queryKeys.notebook.file(selectedFile, {
          scope: notebookScope,
          shareToken: notebookShareToken || "",
        }), {
          content,
          path: selectedFile,
          size: content.length,
          readOnly: selectedFileReadOnly,
        })
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["notebook", "tree"] }),
          queryClient.invalidateQueries({ queryKey: ["notebook", "subtree", getParentDir(selectedFile)] }),
          queryClient.invalidateQueries({ queryKey: queryKeys.notebook.fileBlob(selectedFile, {
            scope: notebookScope,
            shareToken: notebookShareToken || "",
          }) }),
        ])
        return
      }
      await workspaceApi.saveFile(workspacePath, selectedFile, content)
      queryClient.setQueryData(queryKeys.workspace.file(workspacePath, selectedFile), {
        content,
        path: selectedFile,
        size: content.length,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace", "tree", workspacePath] }),
        queryClient.invalidateQueries({ queryKey: ["workspace", "subtree", workspacePath, getParentDir(selectedFile)] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspace.fileBlob(workspacePath, selectedFile) }),
        queryClient.invalidateQueries({ queryKey: ["workspace", "gitBrowser", workspacePath] }),
      ])
    },
    [mode, notebookPermission, notebookScope, notebookShareToken, queryClient, selectedFile, selectedFileReadOnly, workspacePath]
  )

  const handleSelectFile = React.useCallback((filePath: string) => {
    setSelectedFile(filePath)
    setSelectedLineNumber(null)
    setSelectedColumn(null)
    updateUrlFileState(filePath)
  }, [updateUrlFileState])

  const handleDeletedPath = React.useCallback((deletedPath: string) => {
    if (!selectedFile) return
    const affected = selectedFile === deletedPath || selectedFile.startsWith(`${deletedPath}/`)
    if (!affected) return
    setSelectedFile(null)
    setFileContent(null)
    setFileSize(null)
    setFileError(null)
    setSelectedFileReadOnly(false)
    setOversize(false)
    setFileBlob(null)
    updateUrlFileState(null)
  }, [selectedFile, updateUrlFileState])

  const handleTreeRefresh = React.useCallback(async () => {
    if (!workspacePath) return
    setTreeLoading(true)
    try {
      const result = mode === "notebook"
        ? await notebookTreeQuery.refetch()
        : await workspaceTreeQuery.refetch()
      if (result.error) throw result.error
      const data = result.data
      if (!data) return
      syncWorkspaceTreeToDb({
        source: mode === "notebook" ? "notebook" : "workspace",
        sourceKey: mode === "notebook" ? `${notebookScope}:${notebookShareToken || ""}` : workspacePath,
        tree: data.tree || [],
        orderOffset: mode === "default" ? ((data as WorkspaceTreeResponse).offset || 0) : 0,
        replaceParents: mode === "notebook" || ((data as WorkspaceTreeResponse).offset || 0) === 0,
      })
      setRootPagination(mode === "default" ? getWorkspaceTreePagination(data as WorkspaceTreeResponse) : { hasMore: false, nextOffset: null })
      setTreeError(null)
    } catch (error) {
      const message = formatErrorMessage(error, "刷新文件树失败")
      setTree([])
      setRootPagination({ hasMore: false, nextOffset: null })
      setTreeError(message)
      toast("error", message)
    } finally {
      setTreeLoading(false)
    }
  }, [mode, notebookScope, notebookShareToken, notebookTreeQuery, toast, workspacePath, workspaceTreeQuery])

  const handleLoadMoreRoot = React.useCallback(async () => {
    if (mode !== "default" || rootLoadingMore || rootPagination.nextOffset == null || !rootPagination.hasMore) return
    setRootLoadingMore(true)
    try {
      const pageParams = {
        depth: 0,
        offset: rootPagination.nextOffset,
        limit: WORKSPACE_TREE_PAGE_SIZE,
      }
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.workspace.tree(workspacePath, pageParams),
        queryFn: () => workspaceApi.getTree(workspacePath, pageParams),
        staleTime: 30_000,
      })
      syncWorkspaceTreeToDb({
        source: "workspace",
        sourceKey: workspacePath,
        tree: data.tree || [],
        orderOffset: pageParams.offset,
      })
      setRootPagination(getWorkspaceTreePagination(data))
      setTreeError(null)
    } catch (error) {
      const message = formatErrorMessage(error, "加载更多文件失败")
      setTreeError(message)
      toast("error", message)
    } finally {
      setRootLoadingMore(false)
    }
  }, [mode, queryClient, rootLoadingMore, rootPagination.hasMore, rootPagination.nextOffset, toast, workspacePath])

  const handleOpenChange = React.useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setSelectedFile(null)
        setFileContent(null)
        setFileSize(null)
        setFileError(null)
        setSelectedFileReadOnly(false)
        setOversize(false)
        setFileBlob(null)
        setTree([])
        setTreeError(null)
        setRootPagination({ hasMore: false, nextOffset: null })
        setRootLoadingMore(false)
        setSelectedLineNumber(null)
        setSelectedColumn(null)
        setAiSheetOpen(false)
        setAiContext("")
        setAiAutoTask(null)
        setAiSelectionMeta(null)
        setPendingAiSuggestions([])
        setApplyAiSuggestionRequest(null)
        setApplyAiSuggestionQueue([])
        updateUrlFileState(null)
      }
      onOpenChange(newOpen)
    },
    [onOpenChange, updateUrlFileState]
  )

  const showToolbar = presentation === "drawer"
  const showCloseButton = presentation === "drawer"

  React.useEffect(() => {
    if (mode !== "notebook" || !onNotebookInspectorChange) return
    const node = selectedFile ? findTreeNode(tree, selectedFile) : null
    onNotebookInspectorChange({
      selectedFile,
      fileSize,
      fileType: selectedFile ? getFileType(selectedFile) : undefined,
      loading: fileLoading,
      error: fileError,
      readOnly: selectedFileReadOnly,
      oversize,
      node,
      treeCount: countTreeNodes(tree),
    })
  }, [
    fileError,
    fileLoading,
    fileSize,
    mode,
    onNotebookInspectorChange,
    oversize,
    selectedFile,
    selectedFileReadOnly,
    tree,
  ])

  const editorBody = (
    <div className="flex flex-col h-full bg-background">
      {showToolbar && (
        <div className="flex items-center gap-1 px-2 py-1 border-b shrink-0">
          <span className="text-sm text-muted-foreground truncate flex-1 px-2">
            {baseTitle}
          </span>
          {pendingAiSuggestions.length > 0 && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setApplyAiSuggestionQueue(
                    [...pendingAiSuggestions]
                      .sort((a, b) => b.range.startLineNumber - a.range.startLineNumber)
                      .map((item) => ({
                        id: item.id,
                        range: item.range,
                        targetText: item.targetText,
                      })),
                  )
                }}
              >
                接受全部
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setPendingAiSuggestions([])}
              >
                拒绝全部
              </Button>
            </div>
          )}
          {selectedFile && (
            <Button
              variant="ghost"
              size={mode === "notebook" ? "sm" : "icon"}
              className={cn("shrink-0", mode === "notebook" ? "h-8 gap-2 px-3" : "h-7 w-7")}
              onClick={openAiWithFilePath}
              title="问 AI"
            >
              <span className="material-symbols-outlined text-[16px]">smart_toy</span>
              {mode === "notebook" ? <span>问 AI</span> : <span className="sr-only">问 AI</span>}
            </Button>
          )}
          {showCloseButton && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => handleOpenChange(false)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">关闭</span>
            </Button>
          )}
        </div>
      )}
      <ResizablePanelGroup key={layoutId} id={layoutId} orientation="horizontal" className="flex-1 min-h-0" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
        <ResizablePanel
          id="workspace-tree"
          panelRef={treePanelRef}
          defaultSize={isNotebookDesktop ? "50%" : "20%"}
          minSize={isNotebookDesktop ? "28%" : "12%"}
          maxSize={isNotebookDesktop ? "60%" : "40%"}
          collapsible
          collapsedSize="0%"
          onResize={() => setTreeCollapsed(treePanelRef.current?.isCollapsed() ?? false)}
        >
          {treeError && (
            <div className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {treeError}
            </div>
          )}
          <FileTreeSidebar
            workspacePath={workspacePath}
            tree={tree}
            rootPagination={rootPagination}
            rootLoadingMore={rootLoadingMore}
            onLoadMoreRoot={handleLoadMoreRoot}
            selectedFile={selectedFile}
            onSelectFile={handleSelectFile}
            onDeletedPath={handleDeletedPath}
            loading={treeLoading}
            clipboard={clipboard}
            setClipboard={setClipboard}
            onRefresh={handleTreeRefresh}
            mode={mode}
            notebookScope={notebookScope}
            notebookShareToken={notebookShareToken}
            notebookPermission={selectedFileReadOnly ? 'read' : notebookPermission}
            notebookView={notebookBrowserView}
            onNotebookViewChange={handleNotebookViewChange}
          />
        </ResizablePanel>
        <ResizableHandle
          withHandle
          collapsed={treeCollapsed}
          onClickHandle={toggleTree}
          handleIcon={treeCollapsed
            ? <ChevronRight className="h-2.5 w-2.5" />
            : <ChevronLeft className="h-2.5 w-2.5" />
          }
        />
        <ResizablePanel id="workspace-editor-panel" defaultSize={isNotebookDesktop ? "50%" : "80%"} minSize="40%">
          <EditorPanel
            filePath={selectedFile}
            workspacePath={workspacePath}
            content={fileContent}
            fileSize={fileSize}
            loading={fileLoading}
            onSave={handleSave}
            oversize={oversize}
            fileBlob={fileBlob}
            error={fileError}
            fileType={selectedFile ? getFileType(selectedFile) : undefined}
            targetLineNumber={selectedLineNumber}
            targetColumn={selectedColumn}
            mode={mode}
            notebookScope={notebookScope}
            notebookShareToken={notebookShareToken}
            notebookPermission={selectedFileReadOnly ? 'read' : notebookPermission}
            onAskAIFromFile={openAiWithFilePath}
            onAskAIFromSelection={openAiWithSelection}
            onAskAIAction={openAiWithAction}
            applyAiSuggestion={applyAiSuggestionRequest}
            aiSuggestions={pendingAiSuggestions}
            onAcceptAiSuggestion={(id) => {
              const hit = pendingAiSuggestions.find((item) => item.id === id)
              if (!hit) return
              setApplyAiSuggestionRequest({
                id: hit.id,
                range: hit.range,
                targetText: hit.targetText,
              })
              const lineDelta = hit.newLineCount - hit.oldLineCount
              setPendingAiSuggestions((prev) => prev
                .filter((item) => item.id !== id)
                .map((item) => {
                  if (lineDelta === 0) return item
                  if (item.range.startLineNumber < hit.range.endLineNumber) return item
                  return {
                    ...item,
                    range: {
                      ...item.range,
                      startLineNumber: item.range.startLineNumber + lineDelta,
                      endLineNumber: item.range.endLineNumber + lineDelta,
                    },
                    decorateRange: {
                      startLineNumber: item.decorateRange.startLineNumber + lineDelta,
                      endLineNumber: item.decorateRange.endLineNumber + lineDelta,
                    },
                    insertBefore: item.insertBefore,
                  }
                }))
            }}
            onRejectAiSuggestion={(id) => {
              setPendingAiSuggestions((prev) => prev.filter((x) => x.id !== id))
            }}
            onApplyAiSuggestionDone={(id) => {
              if (applyAiSuggestionRequest?.id === id) {
                setApplyAiSuggestionRequest(null)
              }
              setPendingAiSuggestions((prev) => prev.filter((x) => x.id !== id))
            }}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )

  return (
    <>
      {presentation === "drawer" ? (
        <Drawer direction="bottom" open={open} onOpenChange={handleOpenChange} dismissible={false}>
          <DrawerContent className="h-screen w-screen max-w-none rounded-none mt-0 after:hidden">
            <VisuallyHidden.Root>
              <DrawerTitle>工作区编辑器</DrawerTitle>
            </VisuallyHidden.Root>
            {editorBody}
          </DrawerContent>
        </Drawer>
      ) : (
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
          <div className="flex-1 min-h-0">
            {editorBody}
          </div>
        </div>
      )}

      <FileSearchCommand
        open={searchOpen}
        onOpenChange={setSearchOpen}
        tree={tree}
        onSelectFile={handleSelectFile}
      />
      <AiAssistantSheet
        open={aiSheetOpen}
        onOpenChange={setAiSheetOpen}
        title={mode === "notebook" ? "Notebook AI 助手" : "Editor AI 助手"}
        context={aiContext}
        contextLabel="当前上下文（文件路径 / 选中内容）"
        autoTask={aiAutoTask}
        onInsertResult={handleAiInsertResult}
        inputPlaceholder="基于当前文件问点具体问题..."
        sessionStorageKey={mode === "notebook" ? "workspace-notebook-ai-session-id" : "workspace-editor-ai-session-id"}
        sessionTitle={mode === "notebook" ? "Notebook Editor AI" : "Workspace Editor AI"}
      />
    </>
  )
}
