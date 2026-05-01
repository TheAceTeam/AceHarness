"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { workspaceApi, type NotebookScope, type TreeNode, type WorkspaceMode } from "@/lib/api"
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

interface WorkspaceEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspacePath: string
  initialFilePath?: string | null
  mode?: WorkspaceMode
  title?: string
  notebookScope?: NotebookScope
  notebookShareToken?: string
  notebookPermission?: 'read' | 'write'
}

type DiffLine = { type: 'equal' | 'delete' | 'add'; text: string }

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

function isPreviewFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() || ""
  return PREVIEW_EXTENSIONS.has(ext)
}

function getFileType(filePath: string): string {
  return filePath.split(".").pop()?.toLowerCase() || ""
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

export function WorkspaceEditor({
  open,
  onOpenChange,
  workspacePath,
  initialFilePath,
  mode = "default",
  title,
  notebookScope = 'personal',
  notebookShareToken,
  notebookPermission = 'write',
}: WorkspaceEditorProps) {
  const [tree, setTree] = React.useState<TreeNode[]>([])
  const [treeLoading, setTreeLoading] = React.useState(false)
  const [treeError, setTreeError] = React.useState<string | null>(null)
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null)
  const [fileContent, setFileContent] = React.useState<string | null>(null)
  const [fileSize, setFileSize] = React.useState<number | null>(null)
  const [fileLoading, setFileLoading] = React.useState(false)
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [oversize, setOversize] = React.useState(false)
  const [fileBlob, setFileBlob] = React.useState<Blob | null>(null)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [treeCollapsed, setTreeCollapsed] = React.useState(false)
  const [clipboard, setClipboard] = React.useState<ClipboardItem | null>(null)
  const [aiSheetOpen, setAiSheetOpen] = React.useState(false)
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
  const { toast } = useToast()
  const fileParamKey = mode === "notebook" ? "notebookFile" : "workspaceFile"
  const panelParamKey = mode === "notebook" ? "notebook" : "workspace"
  const scopeParamKey = mode === "notebook" ? "notebookScope" : "workspaceScope"

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

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "workspace-editor",
  })

  const updateUrlFileState = React.useCallback((filePath: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (filePath) {
      params.set(fileParamKey, filePath)
      params.set(panelParamKey, "1")
      if (mode === 'notebook') params.set(scopeParamKey, notebookScope)
    } else {
      params.delete(fileParamKey)
      params.delete(panelParamKey)
      if (mode === 'notebook') params.delete(scopeParamKey)
    }
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [fileParamKey, mode, notebookScope, panelParamKey, pathname, router, scopeParamKey, searchParams])

  React.useEffect(() => {
    if (!open || !workspacePath) return
    setTreeLoading(true)
    const loadTree = mode === "notebook"
      ? workspaceApi.getNotebookTree(2, { scope: notebookScope, shareToken: notebookShareToken })
      : workspaceApi.getTree(workspacePath)
    loadTree
      .then((data) => {
        setTree(data.tree)
        setTreeError(null)
      })
      .catch((error) => {
        const message = formatErrorMessage(error, "加载文件树失败")
        setTree([])
        setTreeError(message)
        toast("error", message)
      })
      .finally(() => setTreeLoading(false))
  }, [mode, notebookScope, notebookShareToken, open, toast, workspacePath])

  React.useEffect(() => {
    if (!open) return
    if (initialFilePath && mode !== 'notebook') {
      const normalizedWorkspace = workspacePath.replace(/\\/g, "/").replace(/\/+$/g, "")
      const normalizedFile = initialFilePath.replace(/\\/g, "/")
      if (normalizedFile === normalizedWorkspace) {
        setSelectedFile(null)
        return
      }
      if (normalizedFile.startsWith(`${normalizedWorkspace}/`)) {
        const relativePath = normalizedFile.slice(normalizedWorkspace.length + 1)
        if (relativePath) {
          setSelectedFile(relativePath)
          return
        }
      }
    }
    const fileFromUrl = searchParams.get(fileParamKey)
    if (fileFromUrl) {
      setSelectedFile(fileFromUrl)
    }
  }, [fileParamKey, initialFilePath, mode, open, searchParams, workspacePath])

  React.useEffect(() => {
    if (!selectedFile || !workspacePath) return
    setFileLoading(true)
    setOversize(false)
    setFileBlob(null)
    setFileContent(null)
    setFileError(null)

    if (isPreviewFile(selectedFile)) {
      const loadBlob = mode === "notebook"
        ? workspaceApi.getNotebookFileBlob(selectedFile, { scope: notebookScope, shareToken: notebookShareToken })
        : workspaceApi.getFileBlob(workspacePath, selectedFile)
      loadBlob
        .then((blob) => {
          setFileBlob(blob)
          setFileError(null)
        })
        .catch((error) => {
          const message = formatErrorMessage(error, "预览文件失败")
          setFileBlob(null)
          setFileError(message)
          toast("error", message)
        })
        .finally(() => setFileLoading(false))
      return
    }

    const loadFile = mode === "notebook"
      ? workspaceApi.getNotebookFile(selectedFile, { scope: notebookScope, shareToken: notebookShareToken })
      : workspaceApi.getFile(workspacePath, selectedFile)
    loadFile
      .then((data) => {
        setFileContent(data.content)
        setFileSize(data.size)
        setFileError(null)
      })
      .catch((err: Error & { size?: number }) => {
        if (err.message?.includes("KB 限制")) {
          setOversize(true)
          if (err.size != null) setFileSize(err.size)
          setFileError(null)
          return
        }
        const message = formatErrorMessage(err, "读取文件失败")
        setFileError(message)
        toast("error", message)
      })
      .finally(() => setFileLoading(false))
  }, [mode, notebookScope, notebookShareToken, selectedFile, toast, workspacePath])

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
        if (notebookPermission === 'read') {
          throw new Error('当前分享链接为只读权限，无法保存')
        }
        await workspaceApi.saveNotebookFile(selectedFile, content, { scope: notebookScope, shareToken: notebookShareToken })
        return
      }
      await workspaceApi.saveFile(workspacePath, selectedFile, content)
    },
    [mode, notebookPermission, notebookScope, notebookShareToken, selectedFile, workspacePath]
  )

  const handleSelectFile = React.useCallback((filePath: string) => {
    setSelectedFile(filePath)
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
    setOversize(false)
    setFileBlob(null)
    updateUrlFileState(null)
  }, [selectedFile, updateUrlFileState])

  const handleTreeRefresh = React.useCallback(() => {
    if (!workspacePath) return
    setTreeLoading(true)
    const loadTree = mode === "notebook"
      ? workspaceApi.getNotebookTree(2, { scope: notebookScope, shareToken: notebookShareToken })
      : workspaceApi.getTree(workspacePath)
    loadTree
      .then((data) => {
        setTree(data.tree)
        setTreeError(null)
      })
      .catch((error) => {
        const message = formatErrorMessage(error, "刷新文件树失败")
        setTree([])
        setTreeError(message)
        toast("error", message)
      })
      .finally(() => setTreeLoading(false))
  }, [mode, notebookScope, notebookShareToken, toast, workspacePath])

  const handleOpenChange = React.useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setSelectedFile(null)
        setFileContent(null)
        setFileSize(null)
        setFileError(null)
        setOversize(false)
        setFileBlob(null)
        setTree([])
        setTreeError(null)
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

  return (
    <>
      <Drawer direction="bottom" open={open} onOpenChange={handleOpenChange} dismissible={false}>
        <DrawerContent className="h-screen w-screen max-w-none rounded-none mt-0 after:hidden">
          <VisuallyHidden.Root>
            <DrawerTitle>工作区编辑器</DrawerTitle>
          </VisuallyHidden.Root>
          <div className="flex flex-col h-full">
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
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={openAiWithFilePath}
                title="问 AI"
              >
                <span className="material-symbols-outlined text-[16px]">smart_toy</span>
                <span className="sr-only">问 AI</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => handleOpenChange(false)}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">关闭</span>
              </Button>
            </div>
            <ResizablePanelGroup id="workspace-editor" orientation="horizontal" className="flex-1 min-h-0" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
              <ResizablePanel
                id="workspace-tree"
                panelRef={treePanelRef}
                defaultSize="20%"
                minSize="12%"
                maxSize="40%"
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
                  notebookPermission={notebookPermission}
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
              <ResizablePanel id="workspace-editor-panel" defaultSize="80%" minSize="40%">
                <EditorPanel
                  filePath={selectedFile}
                  content={fileContent}
                  fileSize={fileSize}
                  loading={fileLoading}
                  onSave={handleSave}
                  oversize={oversize}
                  fileBlob={fileBlob}
                  error={fileError}
                  fileType={selectedFile ? getFileType(selectedFile) : undefined}
                  mode={mode}
                  notebookScope={notebookScope}
                  notebookShareToken={notebookShareToken}
                  notebookPermission={notebookPermission}
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
        </DrawerContent>
      </Drawer>

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
