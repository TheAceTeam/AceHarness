"use client"

import * as React from "react"
import { ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, Loader2, FilePlus, FolderPlus, Pencil, Copy, Scissors, Clipboard, Trash2, Upload, Download, FolderUp, RefreshCw, LayoutGrid, List, Home } from "lucide-react"
import { workspaceApi, type NotebookScope, type TreeNode, type WorkspaceMode } from "@/lib/core/api"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@radix-ui/react-collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/core/utils"
import { useToast } from "@/components/ui/toast"
import { useConfirmDialog } from "@/hooks/useConfirmDialog"
import ConfirmDialog from "@/components/ConfirmDialog"
import NotebookSaveDialog, { type NotebookDirectoryOption } from "@/components/notebook/NotebookSaveDialog"

export interface ClipboardItem {
  path: string
  type: "file" | "directory"
  items?: Array<{ path: string; type: "file" | "directory" }>
  action: "copy" | "cut"
}

type DropPosition = "root" | "before" | "after" | "inside"

interface DropIntent {
  position: DropPosition
  targetPath: string
}

interface TreeCapabilityFlags {
  canReorder: boolean
}

interface FileTreeSidebarProps {
  workspacePath: string
  tree: TreeNode[]
  selectedFile: string | null
  onSelectFile: (filePath: string) => void
  onDeletedPath?: (path: string) => void
  loading: boolean
  clipboard: ClipboardItem | null
  setClipboard: (item: ClipboardItem | null) => void
  onRefresh: () => void
  mode?: WorkspaceMode
  notebookScope?: NotebookScope
  notebookShareToken?: string
  notebookPermission?: 'read' | 'write'
  notebookView?: "list" | "desktop"
  onNotebookViewChange?: (view: "list" | "desktop") => void
}

interface MoveConflictState {
  srcPath: string
  destDir: string
  destPath: string
  name: string
  reorderTargetPath?: string
  reorderPosition?: "before" | "after"
}

function formatErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error.trim()) return error
  return fallback
}

function isSameDirectoryReorderError(error: unknown): boolean {
  const message = formatErrorMessage(error, "")
  return message.includes("仅支持同一目录内排序")
}

// Inline rename input
function InlineRenameInput({
  defaultValue,
  onConfirm,
  onCancel,
}: {
  defaultValue: string
  onConfirm: (newName: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = React.useState(defaultValue)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter" && value.trim()) onConfirm(value.trim())
        if (e.key === "Escape") onCancel()
      }}
      onBlur={() => onCancel()}
      className="text-sm bg-background border rounded px-1 py-0.5 w-full outline-none focus:ring-1 focus:ring-primary"
    />
  )
}

// Shared context for file operations
const TreeContext = React.createContext<{
  workspacePath: string
  mode: WorkspaceMode
  clipboard: ClipboardItem | null
  setClipboard: (item: ClipboardItem | null) => void
  onRefresh: () => void
  renamingPath: string | null
  setRenamingPath: (p: string | null) => void
  creatingIn: { dir: string; type: "file" | "folder" } | null
  setCreatingIn: (c: { dir: string; type: "file" | "folder" } | null) => void
  onSelectFile: (filePath: string) => void
  onDeletedPath?: (path: string) => void
  contextTarget: string | null
  setContextTarget: (p: string | null) => void
  notebookScope: NotebookScope
  notebookShareToken?: string
  notebookPermission: 'read' | 'write'
  notebookCanWrite: boolean
  openDirectories: Set<string>
  setDirectoryOpen: (path: string, open: boolean) => void
  capabilities: TreeCapabilityFlags
  draggingPath: string | null
  setDraggingPath: (path: string | null) => void
  dropIntent: DropIntent | null
  setDropIntent: (intent: DropIntent | null) => void
  moveTreeItem: (srcPath: string, destDir: string) => Promise<void>
  applyDropIntent: (srcPath: string, intent: DropIntent) => Promise<void>
  requestCopyBetween: (source: { path: string; type: "file" | "directory"; name: string }) => void
  requestNotebookCreate: (type: "file" | "folder", dir: string) => void
  requestNotebookSetIcon: (path: string, currentIcon?: string) => void
  requestNotebookClearIcon: (path: string) => void
  copyAbsolutePath: (path: string) => Promise<void>
  pasteIntoDirectory: (dir: string) => Promise<void>
  toast: (type: "success" | "error" | "info" | "warning", message: string) => void
  confirm: (options: {
    title: string
    description: string
    confirmLabel?: string
    cancelLabel?: string
    variant?: "default" | "destructive"
  }) => Promise<boolean>
  onUpload: (targetPath: string, directory: boolean) => void
  onDownload: (targetPath: string) => Promise<void>
} | null>(null)

function useTreeCtx() {
  const ctx = React.useContext(TreeContext)
  if (!ctx) throw new Error("TreeContext missing")
  return ctx
}

function getParentDir(filePath: string): string {
  const normalized = normalizeTreePath(filePath) || ""
  const parts = normalized.split("/")
  return parts.length > 1 ? parts.slice(0, -1).join("/") : ""
}

function normalizeTreePath(filePath: string | null | undefined): string | null {
  if (!filePath) return null
  return filePath.replace(/\\/g, "/")
}

function buildWorkspaceAbsolutePath(workspacePath: string, relativePath: string): string {
  const root = workspacePath.trim()
  const normalizedRelative = (normalizeTreePath(relativePath) || "").replace(/^\/+/, "")
  if (!normalizedRelative) return root
  if (!root) return normalizedRelative
  const separator = root.includes("\\") ? "\\" : "/"
  const trimmedRoot = root.replace(/[\\/]+$/, "")
  const pathPart = normalizedRelative.replace(/\//g, separator)
  return `${trimmedRoot}${separator}${pathPart}`
}

async function writeTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  document.body.appendChild(textarea)
  textarea.select()
  const ok = document.execCommand("copy")
  document.body.removeChild(textarea)
  if (!ok) throw new Error("clipboard copy failed")
}

function getClipboardEntries(clipboard: ClipboardItem | null): Array<{ path: string; type: "file" | "directory" }> {
  if (!clipboard) return []
  if (clipboard.items && clipboard.items.length > 0) return clipboard.items
  return [{ path: clipboard.path, type: clipboard.type }]
}

function dedupeTopLevelPaths<T extends { path: string }>(items: T[]): T[] {
  const normalized = [...items]
    .map((item) => ({ ...item, path: normalizeTreePath(item.path) || "" }))
    .filter((item) => item.path)
    .sort((a, b) => a.path.length - b.path.length)

  const result: T[] = []
  for (const item of normalized) {
    const covered = result.some((existing) => item.path === existing.path || item.path.startsWith(`${existing.path}/`))
    if (!covered) result.push(item as T)
  }
  return result
}

function isBuiltinNotebookTreePath(filePath: string | null | undefined): boolean {
  const normalized = normalizeTreePath(filePath)
  return normalized === "__builtin__" || normalized?.startsWith("__builtin__/") || false
}

function isReadOnlyNotebookNode(node: TreeNode | null | undefined): boolean {
  return Boolean(node?.readOnly) || isBuiltinNotebookTreePath(node?.path)
}

function getNotebookDisplayName(name: string, nodePath: string): string {
  if (nodePath === "__builtin__") return "Cangjie Notebook介绍"
  return name
}

const TREE_INDENT = 16
const TREE_BASE_PADDING = 8
const TREE_ROW_INNER_PADDING = 8
const TREE_GUIDE_CENTER = TREE_BASE_PADDING + TREE_ROW_INNER_PADDING + 8

function getTreeIndentStyle(depth: number): React.CSSProperties {
  const paddingLeft = `${depth * TREE_INDENT + TREE_BASE_PADDING}px`
  if (depth <= 0) {
    return { paddingLeft }
  }

  const positions = Array.from(
    { length: depth },
    (_, index) => `${TREE_GUIDE_CENTER + index * TREE_INDENT}px 0`
  )
  return {
    paddingLeft,
    backgroundImage: positions.map(() => "linear-gradient(to bottom, hsl(var(--border)), hsl(var(--border)))").join(", "),
    backgroundPosition: positions.join(", "),
    backgroundRepeat: "no-repeat",
    backgroundSize: positions.map(() => "1px 100%").join(", "),
  }
}

function TreeRow({
  depth,
  children,
}: React.PropsWithChildren<{ depth: number }>) {
  return (
    <div style={getTreeIndentStyle(depth)}>
      {children}
    </div>
  )
}

function isInvalidDropTarget(srcPath: string, destDir: string): boolean {
  const normalizedSrc = normalizeTreePath(srcPath) || ""
  const normalizedDest = normalizeTreePath(destDir) || ""
  if (!normalizedSrc) return true
  if (normalizedSrc === normalizedDest) return true
  if (normalizedDest.startsWith(`${normalizedSrc}/`)) return true
  return getParentDir(normalizedSrc) === normalizedDest
}

function isInvalidSiblingDrop(srcPath: string, targetPath: string): boolean {
  const normalizedSrc = normalizeTreePath(srcPath) || ""
  const normalizedTarget = normalizeTreePath(targetPath) || ""
  if (!normalizedSrc || !normalizedTarget) return true
  if (normalizedSrc === normalizedTarget) return true
  return false
}

function isDropIntentActive(current: DropIntent | null, expected: DropIntent): boolean {
  return current?.position === expected.position && current?.targetPath === expected.targetPath
}

function resolveFileDropIntent(event: React.DragEvent<HTMLElement>, targetPath: string): DropIntent {
  const rect = event.currentTarget.getBoundingClientRect()
  const offsetY = event.clientY - rect.top
  const position: DropPosition = offsetY < rect.height / 2 ? "before" : "after"
  return { position, targetPath }
}

function resolveDirectoryDropIntent(event: React.DragEvent<HTMLElement>, targetPath: string): DropIntent {
  const rect = event.currentTarget.getBoundingClientRect()
  const offsetY = event.clientY - rect.top
  const upperThreshold = rect.height * 0.18
  const lowerThreshold = rect.height * 0.82
  if (offsetY < upperThreshold) return { position: "before", targetPath }
  if (offsetY > lowerThreshold) return { position: "after", targetPath }
  return { position: "inside", targetPath }
}

function isSameParentMove(srcPath: string, targetPath: string): boolean {
  return getParentDir(srcPath) === getParentDir(targetPath)
}

function DropLine({
  active,
  onDragOver,
  onDragLeave,
  onDrop,
  style,
}: {
  active: boolean
  onDragOver: React.DragEventHandler<HTMLDivElement>
  onDragLeave: React.DragEventHandler<HTMLDivElement>
  onDrop: React.DragEventHandler<HTMLDivElement>
  style?: React.CSSProperties
}) {
  return (
    <div
      className="px-2"
      style={style}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="relative h-1">
        <div className={cn("absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full transition-colors", active ? "bg-primary" : "bg-transparent")} />
      </div>
    </div>
  )
}

function collectNotebookDirectories(tree: TreeNode[]): NotebookDirectoryOption[] {
  const dirs = new Set<string>([""])
  const walk = (nodes: TreeNode[]) => {
    nodes.forEach((node) => {
      if (node.type !== "directory") return
      dirs.add(node.path || "")
      if (node.children && node.children.length > 0) {
        walk(node.children)
      }
    })
  }
  walk(tree)
  return Array.from(dirs)
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({ path, label: path || "根目录 /" }))
}

function treeContainsPath(nodes: TreeNode[], targetPath: string): boolean {
  for (const node of nodes) {
    if (node.path === targetPath) return true
    if (node.children && node.children.length > 0 && treeContainsPath(node.children, targetPath)) {
      return true
    }
  }
  return false
}

function splitNotebookLikeName(name: string): { stem: string; ext: string } {
  const lowered = name.toLowerCase()
  if (lowered.endsWith(".cj.md")) return { stem: name.slice(0, -6), ext: name.slice(-6) }
  const dotIndex = name.lastIndexOf(".")
  if (dotIndex <= 0) return { stem: name, ext: "" }
  return { stem: name.slice(0, dotIndex), ext: name.slice(dotIndex) }
}

function buildRenamedConflictPath(nodes: TreeNode[], destDir: string, name: string): string {
  const { stem, ext } = splitNotebookLikeName(name)
  let index = 2
  while (true) {
    const candidateName = `${stem} (${index})${ext}`
    const candidatePath = destDir ? `${destDir}/${candidateName}` : candidateName
    if (!treeContainsPath(nodes, candidatePath)) return candidatePath
    index += 1
  }
}

function stripNotebookSuffix(name: string): string {
  if (name.toLowerCase().endsWith(".cj.md")) {
    return name.slice(0, -6)
  }
  if (name.toLowerCase().endsWith(".md")) {
    return name.slice(0, -3)
  }
  return name
}

function ensureNotebookFileName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return trimmed
  if (trimmed.toLowerCase().endsWith(".cj.md")) return trimmed
  return `${trimmed}.cj.md`
}

function collectExistingPaths(tree: TreeNode[]): Set<string> {
  const paths = new Set<string>()
  const walk = (nodes: TreeNode[]) => {
    nodes.forEach((node) => {
      paths.add(node.path)
      if (node.children && node.children.length > 0) {
        walk(node.children)
      }
    })
  }
  walk(tree)
  return paths
}

function buildUniqueNotebookPath(tree: TreeNode[], type: "file" | "folder", dir = ""): string {
  const existingPaths = collectExistingPaths(tree)
  const baseName = type === "file" ? "未命名文档" : "新建文件夹"
  const suffix = type === "file" ? ".cj.md" : ""
  const normalizedDir = dir.replace(/^\/+|\/+$/g, "")
  let index = 0
  while (true) {
    const candidateName = index === 0 ? `${baseName}${suffix}` : `${baseName} ${index + 1}${suffix}`
    const candidatePath = normalizedDir ? `${normalizedDir}/${candidateName}` : candidateName
    if (!existingPaths.has(candidatePath)) return candidatePath
    index += 1
  }
}

const FILE_TYPE_ICON_DIR = "/file_type"

const FILE_EXT_ALIAS_ICON_MAP: Record<string, string> = {
  // C/C++ and headers
  cc: "cpp.svg",
  cxx: "cpp.svg",
  h: "header.svg",
  hpp: "header.svg",
  hxx: "header.svg",
  hh: "header.svg",
  // CUDA / Cangjie
  cuh: "cuda_header.svg",
  cjh: "cangjie.svg",
  // Python
  py: "python.svg",
  pyw: "python.svg",
  // TS/JS ecosystem
  ts: "typescript.svg",
  js: "javascript.svg",
  mjs: "javascript.svg",
  cjs: "javascript.svg",
  // Markdown / TeX
  md: "markdown.svg",
  markdown: "markdown.svg",
  aux: "latex_aux.svg",
  texi: "tex.svg",
  btx: "bib.svg",
  // Data / config
  yml: "yaml.svg",
  gql: "graphql.svg",
  graphqls: "graphql.svg",
  proto: "protobuf.svg",
  pcss: "postcss.svg",
  // Shell
  bashrc: "shell.svg",
  zshrc: "shell.svg",
  ksh: "shell.svg",
  tcsh: "shell.svg",
  csh: "shell.svg",
  sh: "shell.svg",
  bash: "shell.svg",
  zsh: "shell.svg",
  fish: "shell.svg",
  bat: "shell.svg",
  cmd: "shell.svg",
  ps1: "shell.svg",
  jpg: "image.svg",
  jpeg: "image.svg",
  png: "image.svg",
  gif: "image.svg",
  svg: "image.svg",
  webp: "image.svg",
  bmp: "image.svg",
  ico: "image.svg",
  avif: "image.svg",
  tif: "image.svg",
  tiff: "image.svg",
  // Generic text
  txt: "text.svg",
  log: "text.svg",
  conf: "text.svg",
  ini: "text.svg",
  properties: "text.svg",
  // Archive
  zip: "archive.svg",
  tar: "archive.svg",
  gz: "archive.svg",
  tgz: "archive.svg",
  tbz: "archive.svg",
  tbz2: "archive.svg",
  bz2: "archive.svg",
  xz: "archive.svg",
  rar: "archive.svg",
  "7z": "archive.svg",
  jar: "archive.svg",
  war: "archive.svg",
  ear: "archive.svg",
  // Binary / bytecode
  bin: "binary.svg",
  o: "binary.svg",
  obj: "binary.svg",
  a: "binary.svg",
  lib: "binary.svg",
  exe: "binary.svg",
  dll: "binary.svg",
  so: "binary.svg",
  dylib: "binary.svg",
  wasm: "binary.svg",
  class: "java_class.svg",
  // Languages with non-obvious extensions
  coffee: "coffeescript.svg",
  cson: "coffeescript.svg",
  iced: "coffeescript.svg",
}

function uniqueIcons(icons: string[]): string[] {
  return [...new Set(icons)]
}

function getFileIconCandidates(fileName: string): string[] {
  const lowerName = fileName.toLowerCase()
  const candidates: string[] = []

  if (lowerName.endsWith(".cj.md")) {
    candidates.push("cjmd.svg")
  }

  if (lowerName.endsWith(".cj.d") || lowerName.endsWith(".cj")) {
    candidates.push("cangjie.svg")
  }

  if (lowerName === "cmakelists.txt" || lowerName.endsWith(".cmake")) {
    candidates.push("cmake.svg")
  }

  if (lowerName === "makefile") candidates.push("makefile.svg")
  if (lowerName === "dockerfile") candidates.push("file_dockerfile.svg")
  if (
    lowerName === ".dockerignore"
    || lowerName === ".gitignore"
    || lowerName === ".npmignore"
    || lowerName === ".eslintignore"
    || lowerName === ".prettierignore"
    || lowerName === ".ignore"
  ) {
    candidates.push("ignore_file.svg")
  }
  if (
    lowerName === ".bashrc"
    || lowerName === ".zshrc"
    || lowerName === ".bash_profile"
    || lowerName === ".zprofile"
    || lowerName === ".profile"
  ) {
    candidates.push("shell.svg")
  }
  if (lowerName === ".editorconfig") candidates.push("editorconfig.svg")
  if (lowerName === ".htaccess") candidates.push("htaccess.svg")
  if (lowerName === "yarn.lock") candidates.push("yarn.svg")
  if (lowerName === "pnpm-lock.yaml") candidates.push("pnpm_dark.svg")
  if (lowerName.startsWith("docker-compose.") || lowerName.startsWith("compose.")) candidates.push("dockercompose.svg")
  if (lowerName.startsWith("postcss.config.")) candidates.push("postcss.svg")
  if (lowerName.startsWith("eslint.config.") || lowerName.startsWith(".eslintrc")) candidates.push("eslint.svg")
  if (lowerName.endsWith(".blade.php")) candidates.push("blade.svg")
  if (lowerName.endsWith(".d.ts")) candidates.push("typescript.svg")
  if (lowerName.endsWith(".spec.ts")) candidates.push("test_ts.svg")
  if (lowerName.endsWith(".spec.tsx")) candidates.push("test_ts.svg")
  if (lowerName.endsWith(".spec.js")) candidates.push("test_js.svg")
  if (lowerName.endsWith(".spec.jsx")) candidates.push("test_jsx.svg")

  if (/\.(test|spec)\.tsx$/.test(lowerName) || /\.(test|spec)\.ts$/.test(lowerName)) candidates.push("test_ts.svg")
  if (/\.(test|spec)\.jsx$/.test(lowerName)) candidates.push("test_jsx.svg")
  if (/\.(test|spec)\.js$/.test(lowerName)) candidates.push("test_js.svg")

  const ext = lowerName.includes(".") ? lowerName.split(".").pop() || "" : ""
  if (ext) {
    if (FILE_EXT_ALIAS_ICON_MAP[ext]) candidates.push(FILE_EXT_ALIAS_ICON_MAP[ext])
    // Auto-try icon file with the same basename as extension, to support all existing SVG types.
    candidates.push(`${ext}.svg`)
  }

  candidates.push("file.svg")
  return uniqueIcons(candidates).map((icon) => `${FILE_TYPE_ICON_DIR}/${icon}`)
}

function FileTypeIcon({
  node,
  className = "h-4 w-4",
}: {
  node: TreeNode
  className?: string
}) {
  const fileCandidates = node.type === "directory"
    ? [`${FILE_TYPE_ICON_DIR}/folder.svg`]
    : getFileIconCandidates(node.name)
  const [iconIndex, setIconIndex] = React.useState(0)

  React.useEffect(() => {
    setIconIndex(0)
  }, [node.iconEmoji, node.path, node.name, node.type])

  if (node.type === "directory" && node.iconEmoji) {
    return <span aria-hidden className={cn("inline-flex items-center justify-center leading-none", className)}>{node.iconEmoji}</span>
  }

  const src = fileCandidates[Math.min(iconIndex, fileCandidates.length - 1)]

  return (
    <img
      src={src}
      alt=""
      aria-hidden
      className={className}
      onError={() => {
        if (iconIndex < fileCandidates.length - 1) {
          setIconIndex(iconIndex + 1)
        }
      }}
    />
  )
}

/* --- TreeFileItem --- */
function TreeFileItem({
  node, selectedFile, depth,
}: {
  node: TreeNode; selectedFile: string | null; depth: number
}) {
  const normalizedSelectedFile = normalizeTreePath(selectedFile)
  const normalizedNodePath = normalizeTreePath(node.path) || node.path
  const {
    workspacePath,
    mode,
    setClipboard,
    onRefresh,
    renamingPath,
    setRenamingPath,
    onSelectFile,
    onDeletedPath,
    contextTarget,
    setContextTarget,
    notebookScope,
    notebookShareToken,
    notebookCanWrite,
    openDirectories,
    setDirectoryOpen,
    draggingPath,
    setDraggingPath,
    dropIntent,
    setDropIntent,
    moveTreeItem,
    applyDropIntent,
    requestCopyBetween,
    requestNotebookSetIcon,
    requestNotebookClearIcon,
    copyAbsolutePath,
    toast,
    confirm,
    onDownload,
  } = useTreeCtx()
  const beforeIntent: DropIntent = { position: "before", targetPath: node.path }
  const afterIntent: DropIntent = { position: "after", targetPath: node.path }
  const isBeforeDropTarget = isDropIntentActive(dropIntent, beforeIntent)
  const isAfterDropTarget = isDropIntentActive(dropIntent, afterIntent)
  const nodeReadOnly = mode === "notebook" && isReadOnlyNotebookNode(node)

  const handleDownload = async () => {
    await onDownload(node.path)
  }

  const handleRename = async (newName: string) => {
    const normalizedName = mode === "notebook" ? ensureNotebookFileName(newName) : newName
    const parent = getParentDir(node.path)
    const newPath = parent ? `${parent}/${normalizedName}` : normalizedName
    try {
      if (mode === "notebook") {
        if (!notebookCanWrite) return
        await workspaceApi.manageNotebook("rename", { oldPath: node.path, newPath }, { scope: notebookScope, shareToken: notebookShareToken })
      } else {
        await workspaceApi.manage(workspacePath, "rename", { oldPath: node.path, newPath })
      }
      onRefresh()
    } catch (error) {
      toast("error", formatErrorMessage(error, "重命名失败"))
    }
    setRenamingPath(null)
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: "删除文件",
      description: `确认删除文件「${node.name}」吗？`,
      confirmLabel: "删除",
      variant: "destructive",
    })
    if (!ok) return
    try {
      if (mode === "notebook") {
        if (!notebookCanWrite) return
        await workspaceApi.manageNotebook("delete", { path: node.path }, { scope: notebookScope, shareToken: notebookShareToken })
      } else {
        await workspaceApi.manage(workspacePath, "delete", { path: node.path })
      }
      onDeletedPath?.(node.path)
      onRefresh()
    } catch (error) {
      toast("error", formatErrorMessage(error, "删除失败"))
    }
  }

  if (renamingPath === node.path) {
    return (
      <div style={getTreeIndentStyle(depth)} className="px-2 py-0.5">
        <div className="rounded-sm bg-accent text-accent-foreground">
          <InlineRenameInput
            defaultValue={mode === "notebook" ? stripNotebookSuffix(node.name) : node.name}
            onConfirm={handleRename}
            onCancel={() => setRenamingPath(null)}
          />
        </div>
      </div>
    )
  }

  const isContextActive = contextTarget === node.path

  return (
    <>
      <DropLine
        active={isBeforeDropTarget}
        style={getTreeIndentStyle(depth)}
        onDragOver={(event) => {
          if (nodeReadOnly || !draggingPath || isInvalidSiblingDrop(draggingPath, node.path)) return
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = "move"
          if (!isDropIntentActive(dropIntent, beforeIntent)) setDropIntent(beforeIntent)
        }}
        onDragLeave={(event) => {
          const related = event.relatedTarget as Node | null
          if (related && event.currentTarget.contains(related)) return
          if (isDropIntentActive(dropIntent, beforeIntent)) setDropIntent(null)
        }}
        onDrop={(event) => {
          if (nodeReadOnly) return
          const srcPath = event.dataTransfer.getData("text/plain") || draggingPath
          if (!srcPath || isInvalidSiblingDrop(srcPath, node.path)) return
          event.preventDefault()
          event.stopPropagation()
          setDropIntent(null)
          setDraggingPath(null)
          void applyDropIntent(srcPath, beforeIntent)
        }}
      />
      <ContextMenu onOpenChange={(open) => { if (open) setContextTarget(node.path); else setContextTarget(null) }}>
        <TreeRow depth={depth}>
          <ContextMenuTrigger asChild>
            <button
              draggable={renamingPath !== node.path && !nodeReadOnly}
              onDragStart={(event) => {
                if (nodeReadOnly) {
                  event.preventDefault()
                  return
                }
                event.dataTransfer.effectAllowed = "move"
                event.dataTransfer.setData("text/plain", node.path)
                setDraggingPath(node.path)
              }}
              onDragOver={(event) => {
                if (nodeReadOnly || !draggingPath || isInvalidSiblingDrop(draggingPath, node.path)) return
                event.preventDefault()
                event.stopPropagation()
                event.dataTransfer.dropEffect = "move"
                const nextIntent = resolveFileDropIntent(event, node.path)
                if (!isDropIntentActive(dropIntent, nextIntent)) setDropIntent(nextIntent)
              }}
              onDragLeave={(event) => {
                const related = event.relatedTarget as Node | null
                if (related && event.currentTarget.contains(related)) return
                if (dropIntent?.targetPath === node.path) setDropIntent(null)
              }}
              onDrop={(event) => {
                if (nodeReadOnly) return
                const srcPath = event.dataTransfer.getData("text/plain") || draggingPath
                if (!srcPath || isInvalidSiblingDrop(srcPath, node.path)) return
                event.preventDefault()
                event.stopPropagation()
                const nextIntent = resolveFileDropIntent(event, node.path)
                setDropIntent(null)
                setDraggingPath(null)
                void applyDropIntent(srcPath, nextIntent)
              }}
              onDragEnd={() => {
                setDraggingPath(null)
                setDropIntent(null)
              }}
              onClick={() => onSelectFile(node.path)}
            className={cn(
              "flex items-center gap-2 w-full px-2 rounded-sm",
              mode === "notebook" ? "py-0.5" : "py-1",
              mode === "notebook" ? "text-[15px]" : "text-sm",
              "hover:bg-accent hover:text-accent-foreground",
              normalizedSelectedFile === normalizedNodePath && "bg-accent text-accent-foreground font-medium",
              isContextActive && "bg-accent/70 ring-1 ring-primary/40",
              draggingPath === node.path && "opacity-60"
            )}
          >
            <span aria-hidden className="h-4 w-4 shrink-0" />
            <FileTypeIcon node={node} className="h-4 w-4 shrink-0" />
            <span className="truncate">{mode === "notebook" ? stripNotebookSuffix(getNotebookDisplayName(node.name, node.path)) : getNotebookDisplayName(node.name, node.path)}</span>
          </button>
          </ContextMenuTrigger>
        </TreeRow>
        <ContextMenuContent>
          {mode === "notebook" && <ContextMenuItem onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-2" />刷新</ContextMenuItem>}
          {mode === "notebook" && !nodeReadOnly && <ContextMenuSeparator />}
          {mode === "notebook" && !nodeReadOnly && <ContextMenuItem onClick={() => requestNotebookSetIcon(node.path, node.iconEmoji)}><Pencil className="h-3.5 w-3.5 mr-2" />设置图标</ContextMenuItem>}
          {mode === "notebook" && !nodeReadOnly && node.iconEmoji && <ContextMenuItem onClick={() => { void requestNotebookClearIcon(node.path) }}><Trash2 className="h-3.5 w-3.5 mr-2" />清除图标</ContextMenuItem>}
          {mode === "notebook" && !nodeReadOnly && <ContextMenuSeparator />}
          {!nodeReadOnly && <ContextMenuItem onClick={() => setRenamingPath(node.path)}><Pencil className="h-3.5 w-3.5 mr-2" />重命名</ContextMenuItem>}
          {!nodeReadOnly && <ContextMenuItem onClick={() => setClipboard({ path: node.path, type: "file", action: "copy" })}><Copy className="h-3.5 w-3.5 mr-2" />复制</ContextMenuItem>}
          {mode === "default" && <ContextMenuItem onClick={() => { void copyAbsolutePath(node.path) }}><Copy className="h-3.5 w-3.5 mr-2" />复制绝对路径</ContextMenuItem>}
          {!nodeReadOnly && <ContextMenuItem onClick={() => setClipboard({ path: node.path, type: "file", action: "cut" })}><Scissors className="h-3.5 w-3.5 mr-2" />剪切</ContextMenuItem>}
          {mode === "notebook" && !nodeReadOnly && (
            <ContextMenuItem onClick={() => requestCopyBetween({ path: node.path, type: "file", name: node.name })}>
              <Copy className="h-3.5 w-3.5 mr-2" />
              {notebookScope === 'personal' ? '复制到团队空间' : '复制到个人空间'}
            </ContextMenuItem>
          )}
          {mode === "default" && <ContextMenuItem onClick={handleDownload}><Download className="h-3.5 w-3.5 mr-2" />下载</ContextMenuItem>}
          {!nodeReadOnly && <ContextMenuSeparator />}
          {!nodeReadOnly && <ContextMenuItem className="text-destructive" onClick={handleDelete}><Trash2 className="h-3.5 w-3.5 mr-2" />删除</ContextMenuItem>}
        </ContextMenuContent>
      </ContextMenu>
      <DropLine
        active={isAfterDropTarget}
        style={getTreeIndentStyle(depth)}
        onDragOver={(event) => {
          if (nodeReadOnly || !draggingPath || isInvalidSiblingDrop(draggingPath, node.path)) return
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = "move"
          if (!isDropIntentActive(dropIntent, afterIntent)) setDropIntent(afterIntent)
        }}
        onDragLeave={(event) => {
          const related = event.relatedTarget as Node | null
          if (related && event.currentTarget.contains(related)) return
          if (isDropIntentActive(dropIntent, afterIntent)) setDropIntent(null)
        }}
        onDrop={(event) => {
          if (nodeReadOnly) return
          const srcPath = event.dataTransfer.getData("text/plain") || draggingPath
          if (!srcPath || isInvalidSiblingDrop(srcPath, node.path)) return
          event.preventDefault()
          event.stopPropagation()
          setDropIntent(null)
          setDraggingPath(null)
          void applyDropIntent(srcPath, afterIntent)
        }}
      />
    </>
  )
}

function findTreeNode(nodes: TreeNode[], targetPath: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node
    if (node.children?.length) {
      const hit = findTreeNode(node.children, targetPath)
      if (hit) return hit
    }
  }
  return null
}

function DesktopRenameTile({
  node,
}: {
  node: TreeNode
}) {
  const { mode, setRenamingPath, onSelectFile, notebookCanWrite, notebookScope, notebookShareToken, workspacePath, toast, onRefresh } = useTreeCtx()
  const defaultValue = node.type === "file" && mode === "notebook" ? stripNotebookSuffix(node.name) : node.name

  const handleRename = async (newName: string) => {
    const normalizedName = mode === "notebook" && node.type === "file" ? ensureNotebookFileName(newName) : newName
    const parent = getParentDir(node.path)
    const newPath = parent ? `${parent}/${normalizedName}` : normalizedName
    try {
      if (mode === "notebook") {
        if (!notebookCanWrite) return
        await workspaceApi.manageNotebook("rename", { oldPath: node.path, newPath }, { scope: notebookScope, shareToken: notebookShareToken })
      } else {
        await workspaceApi.manage(workspacePath, "rename", { oldPath: node.path, newPath })
      }
      onRefresh()
    } catch (error) {
      toast("error", formatErrorMessage(error, "重命名失败"))
    }
    setRenamingPath(null)
    if (node.type === "file") onSelectFile(newPath)
  }

  return (
    <div className="rounded-xl border border-border/60 bg-background/70 p-3">
      <InlineRenameInput defaultValue={defaultValue} onConfirm={handleRename} onCancel={() => setRenamingPath(null)} />
    </div>
  )
}

function NotebookDesktopBrowser({
  tree,
  selectedFile,
  loading,
}: {
  tree: TreeNode[]
  selectedFile: string | null
  loading: boolean
}) {
  const {
    workspacePath,
    mode,
    clipboard,
    setClipboard,
    onRefresh,
    renamingPath,
    creatingIn,
    setCreatingIn,
    setRenamingPath,
    contextTarget,
    setContextTarget,
    notebookScope,
    notebookShareToken,
    requestCopyBetween,
    requestNotebookCreate,
    pasteIntoDirectory,
    onSelectFile,
    onDeletedPath,
    moveTreeItem,
    draggingPath,
    setDraggingPath,
    dropIntent,
    setDropIntent,
    notebookCanWrite,
    confirm,
    toast,
  } = useTreeCtx()
  const [currentDir, setCurrentDir] = React.useState("")
  const [desktopSelectedPath, setDesktopSelectedPath] = React.useState<string | null>(selectedFile)

  React.useEffect(() => {
    if (selectedFile) {
      setDesktopSelectedPath(selectedFile)
      setCurrentDir(getParentDir(selectedFile))
    }
  }, [selectedFile])

  const currentNode = currentDir ? findTreeNode(tree, currentDir) : null
  const entries = React.useMemo(() => {
    const source = currentDir ? currentNode?.children || [] : tree
    return [...source].sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1
      return a.name.localeCompare(b.name, "zh-CN")
    })
  }, [currentDir, currentNode, tree])

  const breadcrumbs = React.useMemo(() => {
    const segments = currentDir ? currentDir.split("/") : []
    return [{ path: "", label: "桌面" }, ...segments.map((_, index) => ({
      path: segments.slice(0, index + 1).join("/"),
      label: segments[index] === "__builtin__" ? "Cangjie Notebook介绍" : segments[index],
    }))]
  }, [currentDir])
  const currentDirReadOnly = mode === "notebook" && (isBuiltinNotebookTreePath(currentDir) || isReadOnlyNotebookNode(currentNode))
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const desktopContentRef = React.useRef<HTMLDivElement | null>(null)
  const tileRefs = React.useRef(new Map<string, HTMLButtonElement | null>())
  const [multiSelectedPaths, setMultiSelectedPaths] = React.useState<Set<string>>(() => new Set())
  const [marquee, setMarquee] = React.useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)

  const visibleSelection = React.useMemo(() => {
    const visible = new Set(entries.map((node) => node.path))
    return new Set(Array.from(multiSelectedPaths).filter((path) => visible.has(path)))
  }, [entries, multiSelectedPaths])

  const normalizedSelectionItems = React.useMemo(
    () => dedupeTopLevelPaths(entries.filter((node) => visibleSelection.has(node.path)).map((node) => ({ path: node.path, type: node.type === "directory" ? "directory" as const : "file" as const }))),
    [entries, visibleSelection]
  )
  const clipboardEntries = React.useMemo(
    () => dedupeTopLevelPaths(getClipboardEntries(clipboard)),
    [clipboard]
  )
  const selectionHasReadOnly = React.useMemo(
    () => entries.some((node) => visibleSelection.has(node.path) && mode === "notebook" && isReadOnlyNotebookNode(node)),
    [entries, mode, visibleSelection]
  )

  const clearSelection = React.useCallback(() => {
    setMultiSelectedPaths(new Set())
  }, [])

  const beginClipboardFromSelection = React.useCallback((action: "copy" | "cut") => {
    if (normalizedSelectionItems.length === 0) return
    const [first] = normalizedSelectionItems
    setClipboard({ path: first.path, type: first.type, items: normalizedSelectionItems, action })
  }, [normalizedSelectionItems, setClipboard])

  const handleBatchDelete = React.useCallback(async () => {
    if (normalizedSelectionItems.length === 0) return
    const ok = await confirm({
      title: "批量删除",
      description: `确认删除已选中的 ${normalizedSelectionItems.length} 项吗？`,
      confirmLabel: "删除",
      variant: "destructive",
    })
    if (!ok) return
    try {
      for (const item of normalizedSelectionItems) {
        if (mode === "notebook") {
          if (!notebookCanWrite) return
          await workspaceApi.manageNotebook("delete", { path: item.path }, { scope: notebookScope, shareToken: notebookShareToken })
        } else {
          await workspaceApi.manage(workspacePath, "delete", { path: item.path })
        }
        onDeletedPath?.(item.path)
      }
      clearSelection()
      onRefresh()
    } catch (error) {
      toast("error", formatErrorMessage(error, "批量删除失败"))
    }
  }, [clearSelection, confirm, mode, normalizedSelectionItems, notebookCanWrite, notebookScope, notebookShareToken, onDeletedPath, onRefresh, toast, workspacePath])

  const handleTilePointerDown = React.useCallback((event: React.MouseEvent<HTMLButtonElement>, node: TreeNode) => {
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      setDesktopSelectedPath(node.path)
      setMultiSelectedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(node.path)) next.delete(node.path)
        else next.add(node.path)
        return next
      })
      return
    }
    clearSelection()
    setDesktopSelectedPath(node.path)
  }, [clearSelection])

  const handleDesktopMouseDown = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest("button, input, textarea, [role='menu'], [data-radix-popper-content-wrapper], [data-desktop-floating-bar='true']")) return
    const content = desktopContentRef.current
    const container = containerRef.current
    if (!content || !container) return
    if (!content.contains(target)) return
    const rect = container.getBoundingClientRect()
    const startX = event.clientX - rect.left + container.scrollLeft
    const startY = event.clientY - rect.top + container.scrollTop
    clearSelection()
    setMarquee({ startX, startY, currentX: startX, currentY: startY })
  }, [clearSelection])

  React.useEffect(() => {
    if (!marquee) return
    const handleMove = (event: MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const currentX = event.clientX - rect.left + container.scrollLeft
      const currentY = event.clientY - rect.top + container.scrollTop
      setMarquee((prev) => (prev ? { ...prev, currentX, currentY } : prev))
      const left = Math.min(marquee.startX, currentX)
      const right = Math.max(marquee.startX, currentX)
      const top = Math.min(marquee.startY, currentY)
      const bottom = Math.max(marquee.startY, currentY)
      const next = new Set<string>()
      entries.forEach((node) => {
        const el = tileRefs.current.get(node.path)
        if (!el) return
        const tileRect = el.getBoundingClientRect()
        const elLeft = tileRect.left - rect.left + container.scrollLeft
        const elTop = tileRect.top - rect.top + container.scrollTop
        const elRight = elLeft + tileRect.width
        const elBottom = elTop + tileRect.height
        const intersects = elRight >= left && elLeft <= right && elBottom >= top && elTop <= bottom
        if (intersects) next.add(node.path)
      })
      setMultiSelectedPaths(next)
    }
    const handleUp = () => setMarquee(null)
    window.addEventListener("mousemove", handleMove)
    window.addEventListener("mouseup", handleUp, { once: true })
    return () => {
      window.removeEventListener("mousemove", handleMove)
      window.removeEventListener("mouseup", handleUp)
    }
  }, [entries, marquee])

  const handleDelete = React.useCallback(async (node: TreeNode) => {
    const ok = await confirm({
      title: node.type === "directory" ? "删除文件夹" : "删除文件",
      description: node.type === "directory" ? `确认删除文件夹「${node.name}」及其全部内容吗？` : `确认删除文件「${node.name}」吗？`,
      confirmLabel: "删除",
      variant: "destructive",
    })
    if (!ok) return
    try {
      if (mode === "notebook") {
        if (!notebookCanWrite) return
        await workspaceApi.manageNotebook("delete", { path: node.path }, { scope: notebookScope, shareToken: notebookShareToken })
      }
      onDeletedPath?.(node.path)
      onRefresh()
    } catch (error) {
      toast("error", formatErrorMessage(error, "删除失败"))
    }
  }, [confirm, mode, notebookCanWrite, notebookScope, notebookShareToken, onDeletedPath, onRefresh, toast])

  const handleOpenEntry = React.useCallback((node: TreeNode) => {
    if (node.type === "directory") {
      setCurrentDir(node.path)
      setDesktopSelectedPath(node.path)
      return
    }
    setDesktopSelectedPath(node.path)
    onSelectFile(node.path)
  }, [onSelectFile])

  const currentIsRootDrop = isDropIntentActive(dropIntent, { position: "root", targetPath: currentDir })

  return (
    <ContextMenu onOpenChange={(open) => { if (!open) setContextTarget(null) }}>
      <ContextMenuTrigger asChild>
        <div
          ref={containerRef}
          className={cn("relative flex-1 overflow-auto px-3 py-3", currentIsRootDrop && "bg-accent/30")}
          onMouseDown={handleDesktopMouseDown}
          onDragOver={(event) => {
            if (currentDirReadOnly || !draggingPath || isInvalidDropTarget(draggingPath, currentDir)) return
            event.preventDefault()
            event.dataTransfer.dropEffect = "move"
            const nextIntent: DropIntent = { position: "root", targetPath: currentDir }
            if (!isDropIntentActive(dropIntent, nextIntent)) setDropIntent(nextIntent)
          }}
          onDragLeave={(event) => {
            const related = event.relatedTarget as Node | null
            if (related && event.currentTarget.contains(related)) return
            if (currentIsRootDrop) setDropIntent(null)
          }}
          onDrop={(event) => {
            if (currentDirReadOnly) return
            const srcPath = event.dataTransfer.getData("text/plain") || draggingPath
            if (!srcPath || isInvalidDropTarget(srcPath, currentDir)) return
            event.preventDefault()
            setDropIntent(null)
            setDraggingPath(null)
            void moveTreeItem(srcPath, currentDir)
          }}
        >
          {marquee ? (
            <div
              className="pointer-events-none absolute z-10 border border-primary/50 bg-primary/10"
              style={{
                left: Math.min(marquee.startX, marquee.currentX),
                top: Math.min(marquee.startY, marquee.currentY),
                width: Math.abs(marquee.currentX - marquee.startX),
                height: Math.abs(marquee.currentY - marquee.startY),
              }}
            />
          ) : null}
          <div className="mb-3 flex items-center gap-1 overflow-x-auto">
            {breadcrumbs.map((item, index) => (
              <React.Fragment key={item.path || "root"}>
                <button
                  type="button"
                  onClick={() => setCurrentDir(item.path)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-accent",
                    item.path === currentDir && "bg-accent text-accent-foreground"
                  )}
                >
                  {index === 0 ? <Home className="h-3.5 w-3.5" /> : null}
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
                {index < breadcrumbs.length - 1 ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : null}
              </React.Fragment>
            ))}
          </div>
          <div ref={desktopContentRef} className="min-h-[calc(100%-3rem)]">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : entries.length === 0 && creatingIn?.dir !== currentDir ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-12 text-center text-sm text-muted-foreground">当前目录为空</div>
            ) : (
              <div
                ref={gridRef}
                className="grid min-h-[240px] grid-cols-2 gap-3 select-none content-start sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              >
                {creatingIn?.dir === currentDir ? (
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <InlineRenameInput defaultValue="" onConfirm={async (name) => {
                      const finalName = mode === "notebook" && creatingIn.type === "file" ? ensureNotebookFileName(name) : name
                      const newPath = currentDir ? `${currentDir}/${finalName}` : finalName
                      try {
                        await workspaceApi.manageNotebook(creatingIn.type === "file" ? "create-file" : "create-folder", { path: newPath }, { scope: notebookScope, shareToken: notebookShareToken })
                        onRefresh()
                      } catch (error) {
                        toast("error", formatErrorMessage(error, `创建${creatingIn.type === "file" ? "文件" : "文件夹"}失败`))
                      }
                      setCreatingIn(null)
                    }} onCancel={() => setCreatingIn(null)} />
                  </div>
                ) : null}
                {entries.map((node) => {
                const isClicked = desktopSelectedPath === node.path
                const isOpened = selectedFile === node.path
                const isContextActive = contextTarget === node.path
                const isCurrentDirectory = node.type === "directory" && currentDir === node.path
                const isMultiSelected = visibleSelection.has(node.path)
                const useBatchActions = isMultiSelected && visibleSelection.size > 1
                const isFolderDrop = node.type === "directory" && isDropIntentActive(dropIntent, { position: "inside", targetPath: node.path })
                const nodeReadOnly = mode === "notebook" && isReadOnlyNotebookNode(node)
                if (renamingPath === node.path) {
                  return <DesktopRenameTile key={node.path} node={node} />
                }
                return (
                  <ContextMenu key={node.path} onOpenChange={(open) => { if (open) { setContextTarget(node.path); setDesktopSelectedPath(node.path) } }}>
                    <ContextMenuTrigger asChild>
                      <button
                        ref={(element) => { tileRefs.current.set(node.path, element) }}
                        type="button"
                        draggable={!nodeReadOnly}
                        onMouseDown={(event) => handleTilePointerDown(event, node)}
                        onClick={(event) => {
                          if (event.metaKey || event.ctrlKey) return
                          handleOpenEntry(node)
                        }}
                        onDragStart={(event) => {
                          if (nodeReadOnly) {
                            event.preventDefault()
                            return
                          }
                          event.dataTransfer.effectAllowed = "move"
                          event.dataTransfer.setData("text/plain", node.path)
                          setDraggingPath(node.path)
                        }}
                        onDragEnd={() => {
                          setDraggingPath(null)
                          setDropIntent(null)
                        }}
                        onDragOver={(event) => {
                          if (nodeReadOnly || node.type !== "directory" || !draggingPath || isInvalidDropTarget(draggingPath, node.path)) return
                          event.preventDefault()
                          event.stopPropagation()
                          event.dataTransfer.dropEffect = "move"
                          const nextIntent: DropIntent = { position: "inside", targetPath: node.path }
                          if (!isDropIntentActive(dropIntent, nextIntent)) setDropIntent(nextIntent)
                        }}
                        onDragLeave={(event) => {
                          const related = event.relatedTarget as Node | null
                          if (related && event.currentTarget.contains(related)) return
                          if (isFolderDrop) setDropIntent(null)
                        }}
                        onDrop={(event) => {
                          if (nodeReadOnly || node.type !== "directory") return
                          const srcPath = event.dataTransfer.getData("text/plain") || draggingPath
                          if (!srcPath || isInvalidDropTarget(srcPath, node.path)) return
                          event.preventDefault()
                          event.stopPropagation()
                          setDropIntent(null)
                          setDraggingPath(null)
                          void moveTreeItem(srcPath, node.path)
                        }}
                        className={cn(
                          "flex min-h-[112px] flex-col items-center justify-center gap-3 rounded-2xl border p-3 text-center transition-colors",
                          "border-border/50 bg-background/55 hover:bg-accent/35",
                          isMultiSelected && "border-primary/50 bg-accent/45 shadow-sm",
                          isClicked && "border-primary/35 bg-accent/40 shadow-sm",
                          (isOpened || isCurrentDirectory) && "border-primary bg-primary/10 ring-1 ring-primary/35 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15)]",
                          isContextActive && "ring-1 ring-primary/40",
                          isFolderDrop && "border-primary bg-accent/60"
                        )}
                      >
                        <FileTypeIcon node={node} className={cn("h-10 w-10 shrink-0 transition-transform", (isOpened || isCurrentDirectory) && "scale-105")} />
                        <div className={cn("line-clamp-2 break-all text-xs leading-5", (isOpened || isCurrentDirectory) && "font-medium text-foreground", isClicked && !isOpened && !isCurrentDirectory && "text-foreground")}>
                          {node.type === "file" && mode === "notebook" ? stripNotebookSuffix(getNotebookDisplayName(node.name, node.path)) : getNotebookDisplayName(node.name, node.path)}
                        </div>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => handleOpenEntry(node)}>
                        <ChevronRight className="mr-2 h-3.5 w-3.5" />
                        {node.type === "directory" ? "打开文件夹" : "打开"}
                      </ContextMenuItem>
                      {node.type === "directory" ? (
                        <>
                          {!nodeReadOnly ? <ContextMenuItem onClick={() => requestNotebookCreate("file", node.path)}><FilePlus className="mr-2 h-3.5 w-3.5" />新建文件</ContextMenuItem> : null}
                          {!nodeReadOnly ? <ContextMenuItem onClick={() => requestNotebookCreate("folder", node.path)}><FolderPlus className="mr-2 h-3.5 w-3.5" />新建文件夹</ContextMenuItem> : null}
                          {!nodeReadOnly && clipboard ? <ContextMenuItem onClick={() => { void pasteIntoDirectory(node.path) }}><Clipboard className="mr-2 h-3.5 w-3.5" />粘贴</ContextMenuItem> : null}
                          {!nodeReadOnly ? <ContextMenuSeparator /> : null}
                        </>
                      ) : null}
                      {!nodeReadOnly ? <ContextMenuItem onClick={() => setRenamingPath(node.path)}><Pencil className="mr-2 h-3.5 w-3.5" />重命名</ContextMenuItem> : null}
                      {!nodeReadOnly ? <ContextMenuItem onClick={() => useBatchActions ? beginClipboardFromSelection("copy") : setClipboard({ path: node.path, type: node.type === "directory" ? "directory" : "file", action: "copy" })}><Copy className="mr-2 h-3.5 w-3.5" />{useBatchActions ? `复制已选 ${visibleSelection.size} 项` : "复制"}</ContextMenuItem> : null}
                      {!nodeReadOnly ? <ContextMenuItem disabled={useBatchActions && selectionHasReadOnly} onClick={() => useBatchActions ? beginClipboardFromSelection("cut") : setClipboard({ path: node.path, type: node.type === "directory" ? "directory" : "file", action: "cut" })}><Scissors className="mr-2 h-3.5 w-3.5" />{useBatchActions ? `剪切已选 ${visibleSelection.size} 项` : "剪切"}</ContextMenuItem> : null}
                      {!nodeReadOnly ? <ContextMenuItem onClick={() => requestCopyBetween({ path: node.path, type: node.type === "directory" ? "directory" : "file", name: node.name })}>
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        {notebookScope === "personal" ? "复制到团队空间" : "复制到个人空间"}
                      </ContextMenuItem> : null}
                      {!nodeReadOnly ? <ContextMenuSeparator /> : null}
                      {!nodeReadOnly ? <ContextMenuItem disabled={useBatchActions && selectionHasReadOnly} className="text-destructive" onClick={() => { if (useBatchActions) void handleBatchDelete(); else void handleDelete(node) }}><Trash2 className="mr-2 h-3.5 w-3.5" />{useBatchActions ? `删除已选 ${visibleSelection.size} 项` : "删除"}</ContextMenuItem> : null}
                    </ContextMenuContent>
                  </ContextMenu>
                  )
                })}
              </div>
            )}
          </div>
          {visibleSelection.size > 0 || clipboardEntries.length > 0 ? (
            <div data-desktop-floating-bar="true" className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
              <div className="pointer-events-auto inline-flex select-none items-center gap-1.5 rounded-full border border-border/70 bg-background/75 px-2 py-2 shadow-lg shadow-black/10 backdrop-blur-md">
                {visibleSelection.size > 0 ? <span className="px-2 text-xs text-muted-foreground">已选 {visibleSelection.size} 项</span> : null}
                {clipboardEntries.length > 0 ? <span className="px-2 text-xs text-muted-foreground">剪贴板 {clipboardEntries.length} 项</span> : null}
                {visibleSelection.size > 0 ? (
                  <>
                    <button type="button" className="inline-flex h-8 items-center rounded-full px-3 text-xs hover:bg-accent" onClick={() => beginClipboardFromSelection("copy")}>
                      <Copy className="mr-1 h-3.5 w-3.5" />复制
                    </button>
                    <button type="button" className="inline-flex h-8 items-center rounded-full px-3 text-xs hover:bg-accent disabled:opacity-50" onClick={() => beginClipboardFromSelection("cut")} disabled={currentDirReadOnly || selectionHasReadOnly}>
                      <Scissors className="mr-1 h-3.5 w-3.5" />剪切
                    </button>
                    <button type="button" className="inline-flex h-8 items-center rounded-full px-3 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50" onClick={() => { void handleBatchDelete() }} disabled={currentDirReadOnly || selectionHasReadOnly}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" />删除
                    </button>
                    <button type="button" className="inline-flex h-8 items-center rounded-full px-3 text-xs hover:bg-accent" onClick={clearSelection}>
                      清空
                    </button>
                  </>
                ) : null}
                {clipboardEntries.length > 0 ? (
                  <button type="button" className="inline-flex h-8 items-center rounded-full px-3 text-xs hover:bg-accent disabled:opacity-50" onClick={() => { void pasteIntoDirectory(currentDir) }} disabled={currentDirReadOnly}>
                    <Clipboard className="mr-1 h-3.5 w-3.5" />粘贴
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onRefresh}><RefreshCw className="mr-2 h-3.5 w-3.5" />刷新</ContextMenuItem>
        {!currentDirReadOnly ? <ContextMenuSeparator /> : null}
        {!currentDirReadOnly ? <ContextMenuItem onClick={() => requestNotebookCreate("file", currentDir)}><FilePlus className="mr-2 h-3.5 w-3.5" />新建文件</ContextMenuItem> : null}
        {!currentDirReadOnly ? <ContextMenuItem onClick={() => requestNotebookCreate("folder", currentDir)}><FolderPlus className="mr-2 h-3.5 w-3.5" />新建文件夹</ContextMenuItem> : null}
        {!currentDirReadOnly && clipboard ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => { void pasteIntoDirectory(currentDir) }}><Clipboard className="mr-2 h-3.5 w-3.5" />粘贴</ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/* --- TreeDirItem --- */
function TreeDirItem({
  node, selectedFile, depth,
}: {
  node: TreeNode; selectedFile: string | null; depth: number
}) {
  const normalizedSelectedFile = normalizeTreePath(selectedFile)
  const normalizedNodePath = normalizeTreePath(node.path) || node.path
  const {
    workspacePath,
    mode,
    clipboard,
    setClipboard,
    onRefresh,
    renamingPath,
    setRenamingPath,
    creatingIn,
    setCreatingIn,
    onSelectFile,
    onDeletedPath,
    contextTarget,
    setContextTarget,
    notebookScope,
    notebookShareToken,
    notebookCanWrite,
    openDirectories,
    setDirectoryOpen,
    draggingPath,
    setDraggingPath,
    dropIntent,
    setDropIntent,
    moveTreeItem,
    applyDropIntent,
    requestCopyBetween,
    requestNotebookCreate,
    requestNotebookSetIcon,
    requestNotebookClearIcon,
    copyAbsolutePath,
    toast,
    confirm,
    onUpload,
    onDownload,
  } = useTreeCtx()
  const isCreatingHere = creatingIn?.dir === node.path
  const beforeIntent: DropIntent = { position: "before", targetPath: node.path }
  const insideIntent: DropIntent = { position: "inside", targetPath: node.path }
  const afterIntent: DropIntent = { position: "after", targetPath: node.path }
  const isBeforeDropTarget = isDropIntentActive(dropIntent, beforeIntent)
  const isInsideDropTarget = isDropIntentActive(dropIntent, insideIntent)
  const isAfterDropTarget = isDropIntentActive(dropIntent, afterIntent)
  const nodeReadOnly = mode === "notebook" && isReadOnlyNotebookNode(node)
  const [children, setChildren] = React.useState<TreeNode[] | undefined>(node.children)
  const [loadingChildren, setLoadingChildren] = React.useState(false)
  const shouldAutoOpen = Boolean(
    normalizedSelectedFile && (normalizedSelectedFile === normalizedNodePath || normalizedSelectedFile.startsWith(`${normalizedNodePath}/`))
  )
  const open = isCreatingHere || openDirectories.has(node.path)

  React.useEffect(() => { setChildren(node.children) }, [node])
  React.useEffect(() => {
    if (isCreatingHere || shouldAutoOpen) setDirectoryOpen(node.path, true)
  }, [isCreatingHere, node.path, setDirectoryOpen, shouldAutoOpen])

  const handleOpenChange = React.useCallback(async (nextOpen: boolean) => {
    setDirectoryOpen(node.path, nextOpen)
    if (nextOpen && children === undefined && !loadingChildren) {
      setLoadingChildren(true)
      try {
        if (mode === "notebook") {
          const data = await workspaceApi.getNotebookSubTree(node.path, 2, { scope: notebookScope, shareToken: notebookShareToken })
          setChildren(data.tree || [])
        } else {
          const data = await workspaceApi.getSubTree(workspacePath, node.path, 2)
          setChildren(data.tree || [])
        }
      } catch (error) {
        toast("error", formatErrorMessage(error, `加载目录失败：${node.name}`))
      }
      setLoadingChildren(false)
    }
  }, [children, loadingChildren, workspacePath, node.path, mode, notebookScope, notebookShareToken, setDirectoryOpen, toast, node.name])
  React.useEffect(() => {
    if (!open || children !== undefined || loadingChildren) return
    void handleOpenChange(true)
  }, [children, handleOpenChange, loadingChildren, open])

  const handleRename = async (newName: string) => {
    const parent = getParentDir(node.path)
    const newPath = parent ? `${parent}/${newName}` : newName
    try {
      if (mode === "notebook") {
        if (!notebookCanWrite) return
        await workspaceApi.manageNotebook("rename", { oldPath: node.path, newPath }, { scope: notebookScope, shareToken: notebookShareToken })
      } else {
        await workspaceApi.manage(workspacePath, "rename", { oldPath: node.path, newPath })
      }
      onRefresh()
    } catch (error) {
      toast("error", formatErrorMessage(error, "重命名失败"))
    }
    setRenamingPath(null)
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: "删除文件夹",
      description: `确认删除文件夹「${node.name}」及其全部内容吗？`,
      confirmLabel: "删除",
      variant: "destructive",
    })
    if (!ok) return
    try {
      if (mode === "notebook") {
        if (!notebookCanWrite) return
        await workspaceApi.manageNotebook("delete", { path: node.path }, { scope: notebookScope, shareToken: notebookShareToken })
      } else {
        await workspaceApi.manage(workspacePath, "delete", { path: node.path })
      }
      onDeletedPath?.(node.path)
      onRefresh()
    } catch (error) {
      toast("error", formatErrorMessage(error, "删除失败"))
    }
  }

  const handlePaste = async () => {
    if (!clipboard) return
    const name = clipboard.path.split("/").pop() || "pasted"
    const destPath = `${node.path}/${name}`
    try {
      if (clipboard.action === "copy") {
        if (mode === "notebook") {
          if (!notebookCanWrite) return
          await workspaceApi.manageNotebook("copy", { srcPath: clipboard.path, destPath }, { scope: notebookScope, shareToken: notebookShareToken })
        } else {
          await workspaceApi.manage(workspacePath, "copy", { srcPath: clipboard.path, destPath })
        }
      } else {
        if (mode === "notebook") {
          if (!notebookCanWrite) return
          await workspaceApi.manageNotebook("move", { srcPath: clipboard.path, destPath }, { scope: notebookScope, shareToken: notebookShareToken })
        } else {
          await workspaceApi.manage(workspacePath, "move", { srcPath: clipboard.path, destPath })
        }
        setClipboard(null)
      }
      onRefresh()
    } catch (error) {
      toast("error", formatErrorMessage(error, "粘贴失败"))
    }
  }

  const handleDownload = async () => {
    await onDownload(node.path)
  }

  const handleCreateConfirm = async (name: string) => {
    if (!creatingIn) return
    const finalName = mode === "notebook" && creatingIn.type === "file" ? ensureNotebookFileName(name) : name
    const newPath = `${creatingIn.dir}/${finalName}`
    try {
      if (mode === "notebook") {
        if (!notebookCanWrite) return
        await workspaceApi.manageNotebook(creatingIn.type === "file" ? "create-file" : "create-folder", { path: newPath }, { scope: notebookScope, shareToken: notebookShareToken })
      } else {
        await workspaceApi.manage(workspacePath, creatingIn.type === "file" ? "create-file" : "create-folder", { path: newPath })
      }
      onRefresh()
    } catch (error) {
      toast("error", formatErrorMessage(error, `创建${creatingIn.type === "file" ? "文件" : "文件夹"}失败`))
    }
    setCreatingIn(null)
  }

  if (renamingPath === node.path) {
    return (
      <div style={getTreeIndentStyle(depth)} className="px-2 py-0.5">
        <div className="rounded-sm bg-accent text-accent-foreground">
          <InlineRenameInput defaultValue={node.name} onConfirm={handleRename} onCancel={() => setRenamingPath(null)} />
        </div>
      </div>
    )
  }

  const isContextActive = contextTarget === node.path

  return (
    <>
      <DropLine
        active={isBeforeDropTarget}
        style={getTreeIndentStyle(depth)}
        onDragOver={(event) => {
          if (nodeReadOnly || !draggingPath || isInvalidSiblingDrop(draggingPath, node.path)) return
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = "move"
          if (!isDropIntentActive(dropIntent, beforeIntent)) setDropIntent(beforeIntent)
        }}
        onDragLeave={(event) => {
          const related = event.relatedTarget as Node | null
          if (related && event.currentTarget.contains(related)) return
          if (isDropIntentActive(dropIntent, beforeIntent)) setDropIntent(null)
        }}
        onDrop={(event) => {
          if (nodeReadOnly) return
          const srcPath = event.dataTransfer.getData("text/plain") || draggingPath
          if (!srcPath || isInvalidSiblingDrop(srcPath, node.path)) return
          event.preventDefault()
          event.stopPropagation()
          setDropIntent(null)
          setDraggingPath(null)
          void applyDropIntent(srcPath, beforeIntent)
        }}
      />
      <Collapsible onOpenChange={handleOpenChange} open={open}>
        <ContextMenu onOpenChange={(open) => { if (open) setContextTarget(node.path); else setContextTarget(null) }}>
          <TreeRow depth={depth}>
            <ContextMenuTrigger asChild>
              <button
                type="button"
                draggable={renamingPath !== node.path && !nodeReadOnly}
                onClick={() => { void handleOpenChange(!open) }}
                onDragStart={(event) => {
                  if (nodeReadOnly) {
                    event.preventDefault()
                    return
                  }
                  event.dataTransfer.effectAllowed = "move"
                  event.dataTransfer.setData("text/plain", node.path)
                  setDraggingPath(node.path)
                }}
                onDragOver={(event) => {
                  if (nodeReadOnly || !draggingPath || isInvalidDropTarget(draggingPath, node.path)) return
                  event.preventDefault()
                  event.stopPropagation()
                  event.dataTransfer.dropEffect = "move"
                  const nextIntent = resolveDirectoryDropIntent(event, node.path)
                  if (!isDropIntentActive(dropIntent, nextIntent)) setDropIntent(nextIntent)
                }}
                onDragLeave={(event) => {
                  const related = event.relatedTarget as Node | null
                  if (related && event.currentTarget.contains(related)) return
                  if (dropIntent?.targetPath === node.path) setDropIntent(null)
                }}
                onDrop={(event) => {
                  if (nodeReadOnly) return
                  const srcPath = event.dataTransfer.getData("text/plain") || draggingPath
                  if (!srcPath || isInvalidDropTarget(srcPath, node.path)) return
                  event.preventDefault()
                  event.stopPropagation()
                  const nextIntent = resolveDirectoryDropIntent(event, node.path)
                  setDropIntent(null)
                  setDraggingPath(null)
                  void applyDropIntent(srcPath, nextIntent)
                }}
                onDragEnd={() => {
                  setDraggingPath(null)
                  setDropIntent(null)
                }}
                className={cn(
                  "flex items-center gap-2 w-full px-2 rounded-sm hover:bg-accent hover:text-accent-foreground",
                  mode === "notebook" ? "py-0.5" : "py-1",
                  mode === "notebook" ? "text-[15px]" : "text-sm",
                  (normalizedSelectedFile === normalizedNodePath || normalizedSelectedFile?.startsWith(`${normalizedNodePath}/`)) && "bg-accent/70 text-accent-foreground",
                  isContextActive && "bg-accent/70 ring-1 ring-primary/40",
                  isInsideDropTarget && "bg-accent/60 ring-1 ring-primary/50",
                  draggingPath === node.path && "opacity-60"
                )}
              >
                <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-90")} />
                <FileTypeIcon node={node} className="h-4 w-4 shrink-0" />
                <span className="truncate">{getNotebookDisplayName(node.name, node.path)}</span>
              </button>
            </ContextMenuTrigger>
          </TreeRow>
          <ContextMenuContent>
            {mode === "notebook" && <ContextMenuItem onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-2" />刷新</ContextMenuItem>}
            {mode === "notebook" && !nodeReadOnly && <ContextMenuSeparator />}
            {!nodeReadOnly && <ContextMenuItem onClick={() => mode === "notebook" ? requestNotebookCreate("file", node.path) : setCreatingIn({ dir: node.path, type: "file" })}><FilePlus className="h-3.5 w-3.5 mr-2" />新建文件</ContextMenuItem>}
            {!nodeReadOnly && <ContextMenuItem onClick={() => mode === "notebook" ? requestNotebookCreate("folder", node.path) : setCreatingIn({ dir: node.path, type: "folder" })}><FolderPlus className="h-3.5 w-3.5 mr-2" />新建文件夹</ContextMenuItem>}
            {!nodeReadOnly && <ContextMenuSeparator />}
            {mode === "notebook" && !nodeReadOnly && <ContextMenuItem onClick={() => requestNotebookSetIcon(node.path, node.iconEmoji)}><Pencil className="h-3.5 w-3.5 mr-2" />设置图标</ContextMenuItem>}
            {mode === "notebook" && !nodeReadOnly && node.iconEmoji && <ContextMenuItem onClick={() => { void requestNotebookClearIcon(node.path) }}><Trash2 className="h-3.5 w-3.5 mr-2" />清除图标</ContextMenuItem>}
            {mode === "notebook" && !nodeReadOnly && <ContextMenuSeparator />}
            {!nodeReadOnly && <ContextMenuItem onClick={() => setRenamingPath(node.path)}><Pencil className="h-3.5 w-3.5 mr-2" />重命名</ContextMenuItem>}
            {!nodeReadOnly && <ContextMenuItem onClick={() => setClipboard({ path: node.path, type: "directory", action: "copy" })}><Copy className="h-3.5 w-3.5 mr-2" />复制</ContextMenuItem>}
            {mode === "default" && <ContextMenuItem onClick={() => { void copyAbsolutePath(node.path) }}><Copy className="h-3.5 w-3.5 mr-2" />复制绝对路径</ContextMenuItem>}
            {!nodeReadOnly && <ContextMenuItem onClick={() => setClipboard({ path: node.path, type: "directory", action: "cut" })}><Scissors className="h-3.5 w-3.5 mr-2" />剪切</ContextMenuItem>}
            {mode === "notebook" && !nodeReadOnly && (
              <ContextMenuItem onClick={() => requestCopyBetween({ path: node.path, type: "directory", name: node.name })}>
                <Copy className="h-3.5 w-3.5 mr-2" />
                {notebookScope === 'personal' ? '复制到团队空间' : '复制到个人空间'}
              </ContextMenuItem>
            )}
            {!nodeReadOnly && clipboard && <ContextMenuItem onClick={handlePaste}><Clipboard className="h-3.5 w-3.5 mr-2" />粘贴</ContextMenuItem>}
            {mode === "default" && (
              <>
                <ContextMenuItem onClick={() => onUpload(node.path, false)}><Upload className="h-3.5 w-3.5 mr-2" />上传文件</ContextMenuItem>
                <ContextMenuItem onClick={() => onUpload(node.path, true)}><Upload className="h-3.5 w-3.5 mr-2" />上传文件夹</ContextMenuItem>
                <ContextMenuItem onClick={handleDownload}><Download className="h-3.5 w-3.5 mr-2" />下载文件夹</ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            {!nodeReadOnly && <ContextMenuItem className="text-destructive" onClick={handleDelete}><Trash2 className="h-3.5 w-3.5 mr-2" />删除</ContextMenuItem>}
          </ContextMenuContent>
        </ContextMenu>
        <DropLine
          active={isInsideDropTarget}
          style={getTreeIndentStyle(depth + 1)}
          onDragOver={(event) => {
            if (!draggingPath || isInvalidDropTarget(draggingPath, node.path)) return
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = "move"
            if (!isDropIntentActive(dropIntent, insideIntent)) setDropIntent(insideIntent)
          }}
          onDragLeave={(event) => {
            const related = event.relatedTarget as Node | null
            if (related && event.currentTarget.contains(related)) return
            if (isDropIntentActive(dropIntent, insideIntent)) setDropIntent(null)
          }}
          onDrop={(event) => {
            const srcPath = event.dataTransfer.getData("text/plain") || draggingPath
            if (!srcPath || isInvalidDropTarget(srcPath, node.path)) return
            event.preventDefault()
            event.stopPropagation()
            setDropIntent(null)
            setDraggingPath(null)
            void applyDropIntent(srcPath, insideIntent)
          }}
        />
        <CollapsibleContent
          onDragOver={(event) => {
            if (!draggingPath || isInvalidDropTarget(draggingPath, node.path)) return
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = "move"
            if (!isDropIntentActive(dropIntent, insideIntent)) setDropIntent(insideIntent)
          }}
          onDragLeave={(event) => {
            const related = event.relatedTarget as Node | null
            if (related && event.currentTarget.contains(related)) return
            if (isDropIntentActive(dropIntent, insideIntent)) setDropIntent(null)
          }}
          onDrop={(event) => {
            const srcPath = event.dataTransfer.getData("text/plain") || draggingPath
            if (!srcPath || isInvalidDropTarget(srcPath, node.path)) return
            event.preventDefault()
            event.stopPropagation()
            setDropIntent(null)
            setDraggingPath(null)
            void applyDropIntent(srcPath, insideIntent)
          }}
        >
          {isCreatingHere && (
            <div style={getTreeIndentStyle(depth + 1)} className="px-2 py-0.5">
              <InlineRenameInput defaultValue="" onConfirm={handleCreateConfirm} onCancel={() => setCreatingIn(null)} />
            </div>
          )}
          {loadingChildren ? (
            <div className="flex items-center gap-2 px-2 py-1" style={getTreeIndentStyle(depth + 1)}>
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">加载中...</span>
            </div>
          ) : (
            children?.map((child) =>
              child.type === "directory" ? (
                <TreeDirItem key={child.path} node={child} selectedFile={selectedFile} depth={depth + 1} />
              ) : (
                <TreeFileItem key={child.path} node={child} selectedFile={selectedFile} depth={depth + 1} />
              )
            )
          )}
        </CollapsibleContent>
      </Collapsible>
      <DropLine
        active={isAfterDropTarget}
        style={getTreeIndentStyle(depth)}
        onDragOver={(event) => {
          if (!draggingPath || isInvalidSiblingDrop(draggingPath, node.path)) return
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = "move"
          if (!isDropIntentActive(dropIntent, afterIntent)) setDropIntent(afterIntent)
        }}
        onDragLeave={(event) => {
          const related = event.relatedTarget as Node | null
          if (related && event.currentTarget.contains(related)) return
          if (isDropIntentActive(dropIntent, afterIntent)) setDropIntent(null)
        }}
        onDrop={(event) => {
          const srcPath = event.dataTransfer.getData("text/plain") || draggingPath
          if (!srcPath || isInvalidSiblingDrop(srcPath, node.path)) return
          event.preventDefault()
          event.stopPropagation()
          setDropIntent(null)
          setDraggingPath(null)
          void applyDropIntent(srcPath, afterIntent)
        }}
      />
    </>
  )
}

/* --- Main Sidebar --- */
export function FileTreeSidebar({
  workspacePath, tree, selectedFile, onSelectFile, onDeletedPath, loading,
  clipboard, setClipboard, onRefresh, mode = "default",
  notebookScope = 'personal',
  notebookShareToken,
  notebookPermission = 'write',
  notebookView = "list",
  onNotebookViewChange,
}: FileTreeSidebarProps) {
  const { toast } = useToast()
  const { confirm, dialogProps } = useConfirmDialog()
  const notebookCanWrite = mode !== 'notebook' || notebookPermission === 'write'
  const isNotebook = mode === "notebook"
  const isNotebookDesktop = isNotebook && notebookView === "desktop"
  const workspaceName = mode === "notebook" ? "Cangjie Notebook" : (workspacePath.split("/").filter(Boolean).pop() || "Workspace")
  const [renamingPath, setRenamingPath] = React.useState<string | null>(null)
  const [creatingIn, setCreatingIn] = React.useState<{ dir: string; type: "file" | "folder" } | null>(null)
  const [contextTarget, setContextTarget] = React.useState<string | null>(null)
  const [draggingPath, setDraggingPath] = React.useState<string | null>(null)
  const [dropIntent, setDropIntent] = React.useState<DropIntent | null>(null)
  const [copyBetweenDialogOpen, setCopyBetweenDialogOpen] = React.useState(false)
  const [copyBetweenSource, setCopyBetweenSource] = React.useState<{ path: string; type: "file" | "directory"; name: string } | null>(null)
  const [copyBetweenScope, setCopyBetweenScope] = React.useState<NotebookScope>(notebookScope === "personal" ? "global" : "personal")
  const [copyBetweenDirectory, setCopyBetweenDirectory] = React.useState("")
  const [copyBetweenDirs, setCopyBetweenDirs] = React.useState<NotebookDirectoryOption[]>([{ path: "", label: "根目录 /" }])
  const [copyBetweenDirsLoading, setCopyBetweenDirsLoading] = React.useState(false)
  const [copyBetweenSaving, setCopyBetweenSaving] = React.useState(false)
  const [iconDialogOpen, setIconDialogOpen] = React.useState(false)
  const [iconTargetPath, setIconTargetPath] = React.useState<string | null>(null)
  const [iconValue, setIconValue] = React.useState("")
  const [iconSaving, setIconSaving] = React.useState(false)
  const [moveConflict, setMoveConflict] = React.useState<MoveConflictState | null>(null)
  const [resolvingConflict, setResolvingConflict] = React.useState(false)
  const [openDirectories, setOpenDirectories] = React.useState<Set<string>>(() => new Set())

  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const folderInputRef = React.useRef<HTMLInputElement>(null)
  const pendingUploadTargetRef = React.useRef("")
  const [transferError, setTransferError] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [downloading, setDownloading] = React.useState(false)
  const capabilities = React.useMemo<TreeCapabilityFlags>(() => ({
    canReorder: mode === "notebook",
  }), [mode])

  const setDirectoryOpen = React.useCallback((path: string, open: boolean) => {
    setOpenDirectories((prev) => {
      const next = new Set(prev)
      if (open) next.add(path)
      else next.delete(path)
      return next
    })
  }, [])

  const handleUploadFiles = React.useCallback(async (fileList: FileList | null, directory: boolean) => {
    const files = Array.from(fileList || [])
    if (files.length === 0) return
    setUploading(true)
    setTransferError(null)
    try {
      const relativePaths = files.map((file) => directory
        ? ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
        : file.name
      )
      const result = await workspaceApi.upload(workspacePath, pendingUploadTargetRef.current, files, { relativePaths })
      toast("success", `已上传 ${result.count} 个文件`)
      onRefresh()
    } catch (error) {
      const message = formatErrorMessage(error, "上传失败")
      setTransferError(message)
      toast("error", message)
    } finally {
      setUploading(false)
    }
  }, [onRefresh, toast, workspacePath])

  const requestUpload = React.useCallback((targetPath: string, directory: boolean) => {
    if (mode !== "default") return
    pendingUploadTargetRef.current = targetPath
    if (directory) {
      folderInputRef.current?.click()
    } else {
      fileInputRef.current?.click()
    }
  }, [mode])

  const handleDownload = React.useCallback(async (targetPath: string) => {
    if (mode !== "default") return
    setDownloading(true)
    setTransferError(null)
    try {
      await workspaceApi.download(workspacePath, targetPath)
    } catch (error) {
      const message = formatErrorMessage(error, "下载失败")
      setTransferError(message)
      toast("error", message)
      throw error
    } finally {
      setDownloading(false)
    }
  }, [mode, toast, workspacePath])

  const copyAbsolutePath = React.useCallback(async (targetPath: string) => {
    if (mode !== "default") return
    const absolutePath = buildWorkspaceAbsolutePath(workspacePath, targetPath)
    try {
      await writeTextToClipboard(absolutePath)
      toast("success", "已复制绝对路径")
    } catch {
      toast("error", "复制绝对路径失败")
    }
  }, [mode, toast, workspacePath])

  const loadCopyBetweenDirectories = React.useCallback(async (scope: NotebookScope) => {
    setCopyBetweenDirsLoading(true)
    try {
      const result = await workspaceApi.getNotebookTree(8, { scope })
      const dirs = collectNotebookDirectories(result.tree || [])
      const options = dirs.length > 0 ? dirs : [{ path: "", label: "根目录 /" }]
      setCopyBetweenDirs(options)
      setCopyBetweenDirectory((prev) => {
        if (prev && options.some((option) => option.path === prev)) return prev
        return options[0]?.path ?? ""
      })
    } catch (error) {
      setCopyBetweenDirs([{ path: "", label: "根目录 /" }])
      setCopyBetweenDirectory("")
      toast("error", formatErrorMessage(error, "加载目标目录失败"))
    } finally {
      setCopyBetweenDirsLoading(false)
    }
  }, [toast])

  const requestCopyBetween = React.useCallback((source: { path: string; type: "file" | "directory"; name: string }) => {
    if (mode !== "notebook" || !notebookCanWrite) return
    const targetScope: NotebookScope = notebookScope === "personal" ? "global" : "personal"
    setCopyBetweenSource(source)
    setCopyBetweenScope(targetScope)
    setCopyBetweenDirectory("")
    setCopyBetweenDialogOpen(true)
    void loadCopyBetweenDirectories(targetScope)
  }, [loadCopyBetweenDirectories, mode, notebookCanWrite, notebookScope])

  const requestNotebookSetIcon = React.useCallback((path: string, currentIcon = "") => {
    if (mode !== "notebook" || !notebookCanWrite) return
    setIconTargetPath(path)
    setIconValue(currentIcon)
    setIconDialogOpen(true)
  }, [mode, notebookCanWrite])

  const requestNotebookClearIcon = React.useCallback(async (path: string) => {
    if (mode !== "notebook" || !notebookCanWrite) return
    try {
      await workspaceApi.manageNotebook("set-icon", { path, icon: "" }, { scope: notebookScope, shareToken: notebookShareToken })
      onRefresh()
    } catch (error) {
      toast("error", formatErrorMessage(error, "清除目录图标失败"))
    }
  }, [mode, notebookCanWrite, notebookScope, notebookShareToken, onRefresh, toast])

  const handleConfirmCopyBetween = React.useCallback(async () => {
    if (!copyBetweenSource || mode !== "notebook") return
    const baseName = copyBetweenSource.path.split("/").pop() || copyBetweenSource.name
    const normalizedDir = copyBetweenDirectory.replace(/^\/+|\/+$/g, "")
    const destPath = normalizedDir ? `${normalizedDir}/${baseName}` : baseName

    setCopyBetweenSaving(true)
    try {
      await workspaceApi.manageNotebook(
        "copy-between",
        {
          srcScope: notebookScope,
          destScope: copyBetweenScope,
          srcPath: copyBetweenSource.path,
          destPath,
        },
        { scope: notebookScope, shareToken: notebookShareToken }
      )
      toast("success", `已复制到${copyBetweenScope === "global" ? "团队" : "个人"}空间：${destPath}`)
      setCopyBetweenDialogOpen(false)
      setCopyBetweenSource(null)
      onRefresh()
    } catch (error) {
      toast("error", formatErrorMessage(error, "跨空间复制失败"))
    } finally {
      setCopyBetweenSaving(false)
    }
  }, [copyBetweenDirectory, copyBetweenScope, copyBetweenSource, mode, notebookScope, notebookShareToken, onRefresh, toast])

  const handleConfirmDirectoryIcon = React.useCallback(async () => {
    if (!iconTargetPath || mode !== "notebook" || !notebookCanWrite) return
    setIconSaving(true)
    try {
      await workspaceApi.manageNotebook("set-icon", { path: iconTargetPath, icon: iconValue }, { scope: notebookScope, shareToken: notebookShareToken })
      setIconDialogOpen(false)
      setIconTargetPath(null)
      onRefresh()
    } catch (error) {
      toast("error", formatErrorMessage(error, "设置目录图标失败"))
    } finally {
      setIconSaving(false)
    }
  }, [iconTargetPath, iconValue, mode, notebookCanWrite, notebookScope, notebookShareToken, onRefresh, toast])

  const handleRootPaste = async () => {
    if (!clipboard) return
    const entries = dedupeTopLevelPaths(getClipboardEntries(clipboard))
    try {
      for (const entry of entries) {
        const name = entry.path.split("/").pop() || "pasted"
        if (clipboard.action === "copy") {
          if (mode === "notebook") {
            if (!notebookCanWrite) return
            await workspaceApi.manageNotebook("copy", { srcPath: entry.path, destPath: name }, { scope: notebookScope, shareToken: notebookShareToken })
          } else {
            await workspaceApi.manage(workspacePath, "copy", { srcPath: entry.path, destPath: name })
          }
        } else {
          if (mode === "notebook") {
            if (!notebookCanWrite) return
            await workspaceApi.manageNotebook("move", { srcPath: entry.path, destPath: name }, { scope: notebookScope, shareToken: notebookShareToken })
          } else {
            await workspaceApi.manage(workspacePath, "move", { srcPath: entry.path, destPath: name })
          }
        }
      }
      if (clipboard.action === "cut") setClipboard(null)
      onRefresh()
    } catch (error) {
      toast("error", formatErrorMessage(error, "粘贴失败"))
    }
  }

  const handleRootCreateConfirm = async (name: string) => {
    if (!creatingIn) return
    try {
      if (mode === "notebook") {
        if (!notebookCanWrite) return
        const normalizedName = creatingIn.type === "file" ? ensureNotebookFileName(name) : name
        await workspaceApi.manageNotebook(creatingIn.type === "file" ? "create-file" : "create-folder", { path: normalizedName }, { scope: notebookScope, shareToken: notebookShareToken })
      } else {
        await workspaceApi.manage(workspacePath, creatingIn.type === "file" ? "create-file" : "create-folder", { path: name })
      }
      onRefresh()
    } catch (error) {
      toast("error", formatErrorMessage(error, `创建${creatingIn.type === "file" ? "文件" : "文件夹"}失败`))
    }
    setCreatingIn(null)
  }

  const pasteIntoDirectory = React.useCallback(async (dir: string) => {
    if (!clipboard) return
    const entries = dedupeTopLevelPaths(getClipboardEntries(clipboard))
    const normalizedDir = dir.replace(/^\/+|\/+$/g, "")
    try {
      for (const entry of entries) {
        const name = entry.path.split("/").pop() || "pasted"
        const destPath = normalizedDir ? `${normalizedDir}/${name}` : name
        if (clipboard.action === "copy") {
          if (mode === "notebook") {
            if (!notebookCanWrite) return
            await workspaceApi.manageNotebook("copy", { srcPath: entry.path, destPath }, { scope: notebookScope, shareToken: notebookShareToken })
          } else {
            await workspaceApi.manage(workspacePath, "copy", { srcPath: entry.path, destPath })
          }
        } else {
          if (mode === "notebook") {
            if (!notebookCanWrite) return
            await workspaceApi.manageNotebook("move", { srcPath: entry.path, destPath }, { scope: notebookScope, shareToken: notebookShareToken })
          } else {
            await workspaceApi.manage(workspacePath, "move", { srcPath: entry.path, destPath })
          }
        }
      }
      if (clipboard.action === "cut") setClipboard(null)
      onRefresh()
    } catch (error) {
      toast("error", formatErrorMessage(error, "粘贴失败"))
    }
  }, [clipboard, mode, notebookCanWrite, notebookScope, notebookShareToken, onRefresh, setClipboard, toast, workspacePath])

  const performMove = React.useCallback(async (
    srcPath: string,
    destPath: string,
    reorder?: { targetPath: string; position: "before" | "after" }
  ) => {
    if (mode === "notebook") {
      if (!notebookCanWrite) return
      await workspaceApi.manageNotebook("move", { srcPath, destPath }, { scope: notebookScope, shareToken: notebookShareToken })
      if (reorder) {
        try {
          await workspaceApi.manageNotebook(
            "reorder",
            { srcPath: destPath, targetPath: reorder.targetPath, position: reorder.position },
            { scope: notebookScope, shareToken: notebookShareToken }
          )
        } catch (error) {
          if (!isSameDirectoryReorderError(error)) throw error
        }
      }
    } else {
      await workspaceApi.manage(workspacePath, "move", { srcPath, destPath })
    }
    if (selectedFile && (selectedFile === srcPath || selectedFile.startsWith(`${srcPath}/`))) {
      const nextSelected = selectedFile === srcPath
        ? destPath
        : `${destPath}${selectedFile.slice(srcPath.length)}`
      onSelectFile(nextSelected)
    }
    onRefresh()
  }, [mode, notebookCanWrite, notebookScope, notebookShareToken, onRefresh, onSelectFile, selectedFile, workspacePath])

  const performDelete = React.useCallback(async (targetPath: string) => {
    if (mode === "notebook") {
      if (!notebookCanWrite) return
      await workspaceApi.manageNotebook("delete", { path: targetPath }, { scope: notebookScope, shareToken: notebookShareToken })
    } else {
      await workspaceApi.manage(workspacePath, "delete", { path: targetPath })
    }
  }, [mode, notebookCanWrite, notebookScope, notebookShareToken, workspacePath])

  const moveTreeItem = React.useCallback(async (srcPath: string, destDir: string) => {
    const normalizedSrcPath = normalizeTreePath(srcPath) || ""
    const normalizedDestDir = normalizeTreePath(destDir) || ""
    if (!normalizedSrcPath || isInvalidDropTarget(normalizedSrcPath, normalizedDestDir)) return
    const name = normalizedSrcPath.split("/").pop() || normalizedSrcPath
    const destPath = normalizedDestDir ? `${normalizedDestDir}/${name}` : name
    if (destPath !== srcPath && treeContainsPath(tree, destPath)) {
      setMoveConflict({ srcPath: normalizedSrcPath, destDir: normalizedDestDir, destPath, name })
      return
    }
    try {
      await performMove(normalizedSrcPath, destPath)
    } catch (error) {
      toast("error", formatErrorMessage(error, "移动失败"))
    }
  }, [performMove, toast, tree])

  const handleConflictRenameMove = React.useCallback(async () => {
    if (!moveConflict) return
    const renamedPath = buildRenamedConflictPath(tree, moveConflict.destDir, moveConflict.name)
    setResolvingConflict(true)
    try {
      await performMove(
        moveConflict.srcPath,
        renamedPath,
        moveConflict.reorderTargetPath && moveConflict.reorderPosition
          ? { targetPath: moveConflict.reorderTargetPath, position: moveConflict.reorderPosition }
          : undefined
      )
      toast("success", `已移动并重命名为：${renamedPath.split("/").pop() || renamedPath}`)
      setMoveConflict(null)
    } catch (error) {
      toast("error", formatErrorMessage(error, "重命名后移动失败"))
    } finally {
      setResolvingConflict(false)
    }
  }, [moveConflict, performMove, toast, tree])

  const handleConflictOverwriteMove = React.useCallback(async () => {
    if (!moveConflict) return
    setResolvingConflict(true)
    try {
      await performDelete(moveConflict.destPath)
      await performMove(
        moveConflict.srcPath,
        moveConflict.destPath,
        moveConflict.reorderTargetPath && moveConflict.reorderPosition
          ? { targetPath: moveConflict.reorderTargetPath, position: moveConflict.reorderPosition }
          : undefined
      )
      toast("success", `已覆盖：${moveConflict.name}`)
      setMoveConflict(null)
    } catch (error) {
      toast("error", formatErrorMessage(error, "覆盖移动失败"))
    } finally {
      setResolvingConflict(false)
    }
  }, [moveConflict, performDelete, performMove, toast])

  const applyDropIntent = React.useCallback(async (srcPath: string, intent: DropIntent) => {
    const normalizedSrcPath = normalizeTreePath(srcPath) || ""
    if (!normalizedSrcPath) return

    if (intent.position === "inside") {
      await moveTreeItem(normalizedSrcPath, intent.targetPath)
      return
    }

    if (intent.position === "root") {
      await moveTreeItem(normalizedSrcPath, "")
      return
    }

    const targetParent = getParentDir(intent.targetPath)
    const sourceParent = getParentDir(normalizedSrcPath)
    const sourceName = normalizedSrcPath.split("/").pop() || normalizedSrcPath
    const movedPath = targetParent ? `${targetParent}/${sourceName}` : sourceName

    if (mode === "notebook" && capabilities.canReorder) {
      if (!notebookCanWrite) return
      if (sourceParent !== targetParent) {
        if (movedPath !== normalizedSrcPath && treeContainsPath(tree, movedPath)) {
          setMoveConflict({
            srcPath: normalizedSrcPath,
            destDir: targetParent,
            destPath: movedPath,
            name: sourceName,
            reorderTargetPath: intent.targetPath,
            reorderPosition: intent.position,
          })
          return
        }
        try {
          await performMove(normalizedSrcPath, movedPath, { targetPath: intent.targetPath, position: intent.position })
        } catch (error) {
          toast("error", formatErrorMessage(error, "移动失败"))
        }
        return
      }
      if (!isSameParentMove(normalizedSrcPath, intent.targetPath)) {
        await moveTreeItem(normalizedSrcPath, targetParent)
        return
      }
      try {
        await workspaceApi.manageNotebook(
          "reorder",
          { srcPath: normalizedSrcPath, targetPath: intent.targetPath, position: intent.position },
          { scope: notebookScope, shareToken: notebookShareToken }
        )
        if (selectedFile && (selectedFile === normalizedSrcPath || selectedFile.startsWith(`${normalizedSrcPath}/`))) {
          const nextSelected = selectedFile === normalizedSrcPath
            ? normalizedSrcPath
            : `${normalizedSrcPath}${selectedFile.slice(normalizedSrcPath.length)}`
          onSelectFile(nextSelected)
        }
        onRefresh()
      } catch (error) {
        if (isSameDirectoryReorderError(error)) {
          const fallbackDir = targetParent
          if (sourceParent !== fallbackDir) {
            await moveTreeItem(normalizedSrcPath, fallbackDir)
            return
          }
          onRefresh()
          return
        }
        toast("error", formatErrorMessage(error, "排序失败"))
      }
      return
    }

    if (sourceParent !== targetParent) {
      await moveTreeItem(srcPath, targetParent)
      return
    }
  }, [
    capabilities.canReorder,
    mode,
    moveTreeItem,
    notebookCanWrite,
    notebookScope,
    notebookShareToken,
    onRefresh,
    onSelectFile,
    performMove,
    selectedFile,
    tree,
    toast,
  ])

  const createQuickNotebook = React.useCallback(async (type: "file" | "folder", dir: string) => {
    if (mode !== "notebook" || !notebookCanWrite) return
    const createdPath = buildUniqueNotebookPath(tree, type, dir)
    try {
      await workspaceApi.manageNotebook(
        type === "file" ? "create-file" : "create-folder",
        { path: createdPath },
        { scope: notebookScope, shareToken: notebookShareToken }
      )
      if (dir) {
        setDirectoryOpen(dir, true)
      }
      onRefresh()
      setRenamingPath(createdPath)
      if (type === "file") {
        onSelectFile(createdPath)
      }
    } catch (error) {
      toast("error", formatErrorMessage(error, `创建${type === "file" ? "文件" : "文件夹"}失败`))
    }
  }, [mode, notebookCanWrite, notebookScope, notebookShareToken, onRefresh, onSelectFile, setDirectoryOpen, toast, tree])

  const handleQuickCreateNotebook = React.useCallback(async (type: "file" | "folder") => {
    await createQuickNotebook(type, "")
  }, [createQuickNotebook])

  const handleExpandTopLevel = React.useCallback(() => {
    const topLevelDirectories = tree.filter((node) => node.type === "directory").map((node) => node.path)
    if (topLevelDirectories.length === 0) return
    const allTopLevelOpen = topLevelDirectories.every((path) => openDirectories.has(path))
    setOpenDirectories((prev) => {
      const next = new Set(prev)
      topLevelDirectories.forEach((path) => {
        if (allTopLevelOpen) next.delete(path)
        else next.add(path)
      })
      return next
    })
  }, [openDirectories, tree])
  const hasTopLevelDirectory = tree.some((node) => node.type === "directory")
  const shouldExpandTopLevel = tree.some((node) => node.type === "directory" && !openDirectories.has(node.path))

  const isCreatingAtRoot = creatingIn?.dir === ""

  return (
    <TreeContext.Provider value={{ workspacePath, mode, clipboard, setClipboard, onRefresh, renamingPath, setRenamingPath, creatingIn, setCreatingIn, onSelectFile, onDeletedPath, contextTarget, setContextTarget, notebookScope, notebookShareToken, notebookPermission, notebookCanWrite, openDirectories, setDirectoryOpen, capabilities, draggingPath, setDraggingPath, dropIntent, setDropIntent, moveTreeItem, applyDropIntent, requestCopyBetween, requestNotebookCreate: (type, dir) => { void createQuickNotebook(type, dir) }, requestNotebookSetIcon, requestNotebookClearIcon, copyAbsolutePath, pasteIntoDirectory, toast, confirm, onUpload: requestUpload, onDownload: handleDownload }}>
      <div className="flex flex-col h-full bg-card">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            void handleUploadFiles(event.currentTarget.files, false)
            event.currentTarget.value = ""
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
          onChange={(event) => {
            void handleUploadFiles(event.currentTarget.files, true)
            event.currentTarget.value = ""
          }}
        />
        <div className={cn("flex items-center gap-2 border-b shrink-0", isNotebook ? "px-4 py-3" : "px-3 py-2")}>
          {!isNotebook ? (
            <>
              <img src={`${FILE_TYPE_ICON_DIR}/folder.svg`} alt="" aria-hidden className="h-4 w-4 shrink-0" />
              <span className="truncate flex-1 text-sm font-semibold">{workspaceName}</span>
            </>
          ) : (
            <div className="flex-1" />
          )}
          {isNotebook && onNotebookViewChange ? (
            <div className="inline-flex items-center rounded-md border bg-background p-0.5">
              <button
                type="button"
                className={cn("inline-flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors", notebookView === "list" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60")}
                onClick={() => onNotebookViewChange("list")}
                aria-pressed={notebookView === "list"}
              >
                <List className="h-3.5 w-3.5" />
                列表
              </button>
              <button
                type="button"
                className={cn("inline-flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors", notebookView === "desktop" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60")}
                onClick={() => onNotebookViewChange("desktop")}
                aria-pressed={notebookView === "desktop"}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                桌面
              </button>
            </div>
          ) : null}
          {mode === "default" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  title="上传"
                  disabled={uploading}
                >
                  <Upload className="mr-1 h-3.5 w-3.5" />
                  上传
                  <ChevronDown className="ml-1 h-3 w-3 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem onClick={() => requestUpload("", false)}>
                  <Upload className="mr-2 h-3.5 w-3.5" />
                  上传文件
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => requestUpload("", true)}>
                  <FolderUp className="mr-2 h-3.5 w-3.5" />
                  上传文件夹
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {mode === "notebook" && (
            <>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border hover:bg-accent disabled:opacity-50"
                onClick={handleExpandTopLevel}
                title={shouldExpandTopLevel ? "展开一层" : "收起一层"}
                aria-label={shouldExpandTopLevel ? "展开一层" : "收起一层"}
                disabled={!hasTopLevelDirectory || isNotebookDesktop}
              >
                {shouldExpandTopLevel ? <ChevronsDown className="h-3.5 w-3.5" /> : <ChevronsUp className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-md border px-2 text-xs hover:bg-accent disabled:opacity-50"
                onClick={() => { void handleQuickCreateNotebook("folder") }}
                title="创建文件夹"
                disabled={!notebookCanWrite}
              >
                <FolderPlus className="mr-1 h-3.5 w-3.5" />文件夹
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-md border px-2 text-xs hover:bg-accent disabled:opacity-50"
                onClick={() => { void handleQuickCreateNotebook("file") }}
                title="创建文档"
                disabled={!notebookCanWrite}
              >
                <FilePlus className="mr-1 h-3.5 w-3.5" />文档
              </button>
            </>
          )}
        </div>
        {isNotebookDesktop ? (
          <>
            {transferError && (
              <div className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {transferError}
              </div>
            )}
            {(uploading || downloading) && (
              <div className="border-b px-3 py-2 text-xs text-muted-foreground">
                {uploading ? "上传中..." : "下载中..."}
              </div>
            )}
            <NotebookDesktopBrowser tree={tree} selectedFile={selectedFile} loading={loading} />
          </>
        ) : (
        <ContextMenu>
          {transferError && (
            <div className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {transferError}
            </div>
          )}
          {(uploading || downloading) && (
            <div className="border-b px-3 py-2 text-xs text-muted-foreground">
              {uploading ? "上传中..." : "下载中..."}
            </div>
          )}
          <ContextMenuTrigger asChild>
            <div
              className={cn(
                "flex-1 overflow-auto",
                isNotebook ? "px-2 py-1" : "py-1",
                isDropIntentActive(dropIntent, { position: "root", targetPath: "" }) && "bg-accent/40"
              )}
              onDragOver={(event) => {
                if (event.target !== event.currentTarget) return
                if (!draggingPath || isInvalidDropTarget(draggingPath, "")) return
                event.preventDefault()
                event.dataTransfer.dropEffect = "move"
                if (!isDropIntentActive(dropIntent, { position: "root", targetPath: "" })) {
                  setDropIntent({ position: "root", targetPath: "" })
                }
              }}
              onDragLeave={(event) => {
                const related = event.relatedTarget as Node | null
                if (related && event.currentTarget.contains(related)) return
                if (isDropIntentActive(dropIntent, { position: "root", targetPath: "" })) setDropIntent(null)
              }}
              onDrop={(event) => {
                if (event.target !== event.currentTarget) return
                const srcPath = event.dataTransfer.getData("text/plain") || draggingPath
                if (!srcPath || isInvalidDropTarget(srcPath, "")) return
                event.preventDefault()
                setDropIntent(null)
                setDraggingPath(null)
                void applyDropIntent(srcPath, { position: "root", targetPath: "" })
              }}
            >
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : tree.length === 0 && !isCreatingAtRoot ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">空目录</div>
              ) : (
                <>
                  {tree.length > 0 && (
                    <DropLine
                      active={isDropIntentActive(dropIntent, { position: "before", targetPath: tree[0].path })}
                      style={{ paddingLeft: "8px" }}
                      onDragOver={(event) => {
                        if (!draggingPath || isInvalidSiblingDrop(draggingPath, tree[0].path)) return
                        event.preventDefault()
                        event.stopPropagation()
                        event.dataTransfer.dropEffect = "move"
                        const nextIntent: DropIntent = { position: "before", targetPath: tree[0].path }
                        if (!isDropIntentActive(dropIntent, nextIntent)) setDropIntent(nextIntent)
                      }}
                      onDragLeave={(event) => {
                        const related = event.relatedTarget as Node | null
                        if (related && event.currentTarget.contains(related)) return
                        const nextIntent: DropIntent = { position: "before", targetPath: tree[0].path }
                        if (isDropIntentActive(dropIntent, nextIntent)) setDropIntent(null)
                      }}
                      onDrop={(event) => {
                        const srcPath = event.dataTransfer.getData("text/plain") || draggingPath
                        if (!srcPath || isInvalidSiblingDrop(srcPath, tree[0].path)) return
                        event.preventDefault()
                        event.stopPropagation()
                        setDropIntent(null)
                        setDraggingPath(null)
                        void applyDropIntent(srcPath, { position: "before", targetPath: tree[0].path })
                      }}
                    />
                  )}
                  {isCreatingAtRoot && (
                    <div className="px-2 py-0.5" style={{ paddingLeft: "8px" }}>
                      <InlineRenameInput defaultValue="" onConfirm={handleRootCreateConfirm} onCancel={() => setCreatingIn(null)} />
                    </div>
                  )}
                  {tree.map((node) =>
                    node.type === "directory" ? (
                      <TreeDirItem key={node.path} node={node} selectedFile={selectedFile} depth={0} />
                    ) : (
                      <TreeFileItem key={node.path} node={node} selectedFile={selectedFile} depth={0} />
                    )
                  )}
                  {tree.length > 0 && (
                    <DropLine
                      active={isDropIntentActive(dropIntent, { position: "after", targetPath: tree[tree.length - 1].path })}
                      style={{ paddingLeft: "8px" }}
                      onDragOver={(event) => {
                        const lastPath = tree[tree.length - 1]?.path
                        if (!lastPath || !draggingPath || isInvalidSiblingDrop(draggingPath, lastPath)) return
                        event.preventDefault()
                        event.stopPropagation()
                        event.dataTransfer.dropEffect = "move"
                        const nextIntent: DropIntent = { position: "after", targetPath: lastPath }
                        if (!isDropIntentActive(dropIntent, nextIntent)) setDropIntent(nextIntent)
                      }}
                      onDragLeave={(event) => {
                        const related = event.relatedTarget as Node | null
                        if (related && event.currentTarget.contains(related)) return
                        const lastPath = tree[tree.length - 1]?.path
                        if (!lastPath) return
                        const nextIntent: DropIntent = { position: "after", targetPath: lastPath }
                        if (isDropIntentActive(dropIntent, nextIntent)) setDropIntent(null)
                      }}
                      onDrop={(event) => {
                        const lastPath = tree[tree.length - 1]?.path
                        const srcPath = event.dataTransfer.getData("text/plain") || draggingPath
                        if (!lastPath || !srcPath || isInvalidSiblingDrop(srcPath, lastPath)) return
                        event.preventDefault()
                        event.stopPropagation()
                        setDropIntent(null)
                        setDraggingPath(null)
                        void applyDropIntent(srcPath, { position: "after", targetPath: lastPath })
                      }}
                    />
                  )}
                </>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {mode === "notebook" && <ContextMenuItem onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-2" />刷新</ContextMenuItem>}
            {mode === "notebook" && <ContextMenuSeparator />}
            <ContextMenuItem onClick={() => mode === "notebook" ? void createQuickNotebook("file", "") : setCreatingIn({ dir: "", type: "file" })}><FilePlus className="h-3.5 w-3.5 mr-2" />新建文件</ContextMenuItem>
            <ContextMenuItem onClick={() => mode === "notebook" ? void createQuickNotebook("folder", "") : setCreatingIn({ dir: "", type: "folder" })}><FolderPlus className="h-3.5 w-3.5 mr-2" />新建文件夹</ContextMenuItem>
            {clipboard && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={handleRootPaste}><Clipboard className="h-3.5 w-3.5 mr-2" />粘贴</ContextMenuItem>
              </>
            )}
            {mode === "default" && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => requestUpload("", false)}><Upload className="h-3.5 w-3.5 mr-2" />上传文件</ContextMenuItem>
                <ContextMenuItem onClick={() => requestUpload("", true)}><Upload className="h-3.5 w-3.5 mr-2" />上传文件夹</ContextMenuItem>
                <ContextMenuItem onClick={() => { void copyAbsolutePath("") }}><Copy className="h-3.5 w-3.5 mr-2" />复制工作区路径</ContextMenuItem>
                <ContextMenuItem onClick={() => { void handleDownload("") }}><Download className="h-3.5 w-3.5 mr-2" />下载根目录</ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
        )}
      </div>
      <NotebookSaveDialog
        open={copyBetweenDialogOpen}
        onOpenChange={(open) => {
          setCopyBetweenDialogOpen(open)
          if (!open) setCopyBetweenSource(null)
        }}
        title={copyBetweenScope === "global" ? "复制到团队空间" : "复制到个人空间"}
        confirmLabel="复制"
        scope={copyBetweenScope}
        onScopeChange={(scope) => {
          setCopyBetweenScope(scope)
          setCopyBetweenDirectory("")
          void loadCopyBetweenDirectories(scope)
        }}
        scopeOptions={[{ value: copyBetweenScope, label: copyBetweenScope === "global" ? "团队" : "个人" }]}
        showScopeSelect={false}
        directory={copyBetweenDirectory}
        onDirectoryChange={setCopyBetweenDirectory}
        directories={copyBetweenDirs}
        loadingDirectories={copyBetweenDirsLoading}
        saving={copyBetweenSaving}
        previewText={
          copyBetweenSource
            ? `源路径：${copyBetweenSource.path}\n目标路径：${copyBetweenDirectory ? `${copyBetweenDirectory}/` : ""}${copyBetweenSource.path.split("/").pop() || copyBetweenSource.name}`
            : undefined
        }
        onConfirm={handleConfirmCopyBetween}
      />
      <Dialog
        open={iconDialogOpen}
        onOpenChange={(open) => {
          if (iconSaving) return
          setIconDialogOpen(open)
          if (!open) {
            setIconTargetPath(null)
            setIconValue("")
          }
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>设置目录图标</DialogTitle>
            <DialogDescription>
              输入一个 emoji 作为目录图标。留空后保存可清除图标。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              目录：{iconTargetPath || "/"}
            </div>
            <input
              value={iconValue}
              onChange={(event) => setIconValue(event.target.value.slice(0, 16))}
              placeholder="例如：📁 ✨ 📚"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              {["📁", "📚", "🧪", "🚀", "📝", "✨", "📦", "🗂️"].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-accent"
                  onClick={() => setIconValue(emoji)}
                >
                  <span className="text-lg leading-none">{emoji}</span>
                </button>
              ))}
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setIconDialogOpen(false)
                setIconTargetPath(null)
                setIconValue("")
              }}
              disabled={iconSaving}
            >
              取消
            </Button>
            <Button variant="outline" onClick={() => setIconValue("")} disabled={iconSaving}>
              清空
            </Button>
            <Button onClick={() => { void handleConfirmDirectoryIcon() }} disabled={iconSaving}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!moveConflict}
        onOpenChange={(open) => {
          if (!open && !resolvingConflict) setMoveConflict(null)
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>发现同名项</DialogTitle>
            <DialogDescription>
              目标目录里已经有“{moveConflict?.name || ""}”。请选择后续操作。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            目标位置：{moveConflict?.destDir ? `${moveConflict.destDir}/` : "/"}
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setMoveConflict(null)} disabled={resolvingConflict}>
              取消
            </Button>
            <Button variant="outline" onClick={() => { void handleConflictRenameMove() }} disabled={resolvingConflict}>
              重命名后移动
            </Button>
            <Button variant="destructive" onClick={() => { void handleConflictOverwriteMove() }} disabled={resolvingConflict}>
              覆盖
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </TreeContext.Provider>
  )
}
