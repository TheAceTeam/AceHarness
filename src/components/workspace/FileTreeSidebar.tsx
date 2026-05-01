"use client"

import * as React from "react"
import { ChevronRight, Loader2, FilePlus, FolderPlus, Pencil, Copy, Scissors, Clipboard, Trash2, Upload, Download } from "lucide-react"
import { workspaceApi, type NotebookScope, type TreeNode, type WorkspaceMode } from "@/lib/api"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@radix-ui/react-collapsible"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { useToast } from "@/components/ui/toast"
import { useConfirmDialog } from "@/hooks/useConfirmDialog"
import ConfirmDialog from "@/components/ConfirmDialog"
import NotebookSaveDialog, { type NotebookDirectoryOption } from "@/components/notebook/NotebookSaveDialog"

export interface ClipboardItem {
  path: string
  type: "file" | "directory"
  action: "copy" | "cut"
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
}

function formatErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error.trim()) return error
  return fallback
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
  requestCopyBetween: (source: { path: string; type: "file" | "directory"; name: string }) => void
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
  const parts = filePath.split("/")
  return parts.length > 1 ? parts.slice(0, -1).join("/") : ""
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
  }, [node.path, node.name, node.type])

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
    requestCopyBetween,
    toast,
    confirm,
    onDownload,
  } = useTreeCtx()

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
      <div style={{ paddingLeft: `${depth * 12 + 8}px` }} className="px-2 py-0.5">
        <InlineRenameInput
          defaultValue={mode === "notebook" ? stripNotebookSuffix(node.name) : node.name}
          onConfirm={handleRename}
          onCancel={() => setRenamingPath(null)}
        />
      </div>
    )
  }

  const isContextActive = contextTarget === node.path

  return (
    <ContextMenu onOpenChange={(open) => { if (open) setContextTarget(node.path); else setContextTarget(null) }}>
      <ContextMenuTrigger asChild>
        <button
          onClick={() => onSelectFile(node.path)}
          className={cn(
            "flex items-center gap-2 w-full px-2 py-1 text-sm rounded-sm",
            "hover:bg-accent hover:text-accent-foreground",
            selectedFile === node.path && "bg-accent text-accent-foreground font-medium",
            isContextActive && "bg-accent/70 ring-1 ring-primary/40"
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <FileTypeIcon node={node} className="h-4 w-4 shrink-0" />
          <span className="truncate">{mode === "notebook" ? stripNotebookSuffix(node.name) : node.name}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => setRenamingPath(node.path)}><Pencil className="h-3.5 w-3.5 mr-2" />重命名</ContextMenuItem>
        <ContextMenuItem onClick={() => setClipboard({ path: node.path, type: "file", action: "copy" })}><Copy className="h-3.5 w-3.5 mr-2" />复制</ContextMenuItem>
        <ContextMenuItem onClick={() => setClipboard({ path: node.path, type: "file", action: "cut" })}><Scissors className="h-3.5 w-3.5 mr-2" />剪切</ContextMenuItem>
        {mode === "notebook" && (
          <ContextMenuItem onClick={() => requestCopyBetween({ path: node.path, type: "file", name: node.name })}>
            <Copy className="h-3.5 w-3.5 mr-2" />
            {notebookScope === 'personal' ? '复制到团队空间' : '复制到个人空间'}
          </ContextMenuItem>
        )}
        {mode === "default" && <ContextMenuItem onClick={handleDownload}><Download className="h-3.5 w-3.5 mr-2" />下载</ContextMenuItem>}
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive" onClick={handleDelete}><Trash2 className="h-3.5 w-3.5 mr-2" />删除</ContextMenuItem>
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
    requestCopyBetween,
    toast,
    confirm,
    onUpload,
    onDownload,
  } = useTreeCtx()
  const isCreatingHere = creatingIn?.dir === node.path
  const [children, setChildren] = React.useState<TreeNode[] | undefined>(node.children)
  const [loadingChildren, setLoadingChildren] = React.useState(false)
  const shouldAutoOpen = Boolean(
    selectedFile && (selectedFile === node.path || selectedFile.startsWith(`${node.path}/`))
  )
  const [open, setOpen] = React.useState(isCreatingHere || shouldAutoOpen)

  React.useEffect(() => { setChildren(node.children) }, [node.children])
  React.useEffect(() => {
    if (isCreatingHere || shouldAutoOpen) setOpen(true)
  }, [isCreatingHere, shouldAutoOpen])

  const handleOpenChange = React.useCallback(async (nextOpen: boolean) => {
    setOpen(nextOpen)
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
  }, [children, loadingChildren, workspacePath, node.path, mode, notebookScope, notebookShareToken, toast, node.name])

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
      <div style={{ paddingLeft: `${depth * 12 + 8}px` }} className="px-2 py-0.5">
        <InlineRenameInput defaultValue={node.name} onConfirm={handleRename} onCancel={() => setRenamingPath(null)} />
      </div>
    )
  }

  const isContextActive = contextTarget === node.path

  return (
    <Collapsible className="group/collapsible" onOpenChange={handleOpenChange} open={open}>
      <ContextMenu onOpenChange={(open) => { if (open) setContextTarget(node.path); else setContextTarget(null) }}>
        <ContextMenuTrigger asChild>
          <CollapsibleTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-2 w-full px-2 py-1 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground",
                isContextActive && "bg-accent/70 ring-1 ring-primary/40"
              )}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90" />
              <FileTypeIcon node={node} className="h-4 w-4 shrink-0" />
              <span className="truncate">{node.name}</span>
            </button>
          </CollapsibleTrigger>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => setCreatingIn({ dir: node.path, type: "file" })}><FilePlus className="h-3.5 w-3.5 mr-2" />新建文件</ContextMenuItem>
          <ContextMenuItem onClick={() => setCreatingIn({ dir: node.path, type: "folder" })}><FolderPlus className="h-3.5 w-3.5 mr-2" />新建文件夹</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => setRenamingPath(node.path)}><Pencil className="h-3.5 w-3.5 mr-2" />重命名</ContextMenuItem>
          <ContextMenuItem onClick={() => setClipboard({ path: node.path, type: "directory", action: "copy" })}><Copy className="h-3.5 w-3.5 mr-2" />复制</ContextMenuItem>
          <ContextMenuItem onClick={() => setClipboard({ path: node.path, type: "directory", action: "cut" })}><Scissors className="h-3.5 w-3.5 mr-2" />剪切</ContextMenuItem>
          {mode === "notebook" && (
            <ContextMenuItem onClick={() => requestCopyBetween({ path: node.path, type: "directory", name: node.name })}>
              <Copy className="h-3.5 w-3.5 mr-2" />
              {notebookScope === 'personal' ? '复制到团队空间' : '复制到个人空间'}
            </ContextMenuItem>
          )}
          {clipboard && <ContextMenuItem onClick={handlePaste}><Clipboard className="h-3.5 w-3.5 mr-2" />粘贴</ContextMenuItem>}
          {mode === "default" && (
            <>
              <ContextMenuItem onClick={() => onUpload(node.path, false)}><Upload className="h-3.5 w-3.5 mr-2" />上传文件</ContextMenuItem>
              <ContextMenuItem onClick={() => onUpload(node.path, true)}><Upload className="h-3.5 w-3.5 mr-2" />上传文件夹</ContextMenuItem>
              <ContextMenuItem onClick={handleDownload}><Download className="h-3.5 w-3.5 mr-2" />下载文件夹</ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem className="text-destructive" onClick={handleDelete}><Trash2 className="h-3.5 w-3.5 mr-2" />删除</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <CollapsibleContent>
        {isCreatingHere && (
          <div style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }} className="px-2 py-0.5">
            <InlineRenameInput defaultValue="" onConfirm={handleCreateConfirm} onCancel={() => setCreatingIn(null)} />
          </div>
        )}
        {loadingChildren ? (
          <div className="flex items-center gap-2 px-2 py-1" style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
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
  )
}

/* --- Main Sidebar --- */
export function FileTreeSidebar({
  workspacePath, tree, selectedFile, onSelectFile, onDeletedPath, loading,
  clipboard, setClipboard, onRefresh, mode = "default",
  notebookScope = 'personal',
  notebookShareToken,
  notebookPermission = 'write',
}: FileTreeSidebarProps) {
  const { toast } = useToast()
  const { confirm, dialogProps } = useConfirmDialog()
  const notebookCanWrite = mode !== 'notebook' || notebookPermission === 'write'
  const workspaceName = mode === "notebook" ? "Cangjie Notebook" : (workspacePath.split("/").filter(Boolean).pop() || "Workspace")
  const [renamingPath, setRenamingPath] = React.useState<string | null>(null)
  const [creatingIn, setCreatingIn] = React.useState<{ dir: string; type: "file" | "folder" } | null>(null)
  const [contextTarget, setContextTarget] = React.useState<string | null>(null)
  const [copyBetweenDialogOpen, setCopyBetweenDialogOpen] = React.useState(false)
  const [copyBetweenSource, setCopyBetweenSource] = React.useState<{ path: string; type: "file" | "directory"; name: string } | null>(null)
  const [copyBetweenScope, setCopyBetweenScope] = React.useState<NotebookScope>(notebookScope === "personal" ? "global" : "personal")
  const [copyBetweenDirectory, setCopyBetweenDirectory] = React.useState("")
  const [copyBetweenDirs, setCopyBetweenDirs] = React.useState<NotebookDirectoryOption[]>([{ path: "", label: "根目录 /" }])
  const [copyBetweenDirsLoading, setCopyBetweenDirsLoading] = React.useState(false)
  const [copyBetweenSaving, setCopyBetweenSaving] = React.useState(false)

  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const folderInputRef = React.useRef<HTMLInputElement>(null)
  const pendingUploadTargetRef = React.useRef("")
  const [transferError, setTransferError] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [downloading, setDownloading] = React.useState(false)

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

  const handleRootPaste = async () => {
    if (!clipboard) return
    const name = clipboard.path.split("/").pop() || "pasted"
    try {
      if (clipboard.action === "copy") {
        if (mode === "notebook") {
          if (!notebookCanWrite) return
          await workspaceApi.manageNotebook("copy", { srcPath: clipboard.path, destPath: name }, { scope: notebookScope, shareToken: notebookShareToken })
        } else {
          await workspaceApi.manage(workspacePath, "copy", { srcPath: clipboard.path, destPath: name })
        }
      } else {
        if (mode === "notebook") {
          if (!notebookCanWrite) return
          await workspaceApi.manageNotebook("move", { srcPath: clipboard.path, destPath: name }, { scope: notebookScope, shareToken: notebookShareToken })
        } else {
          await workspaceApi.manage(workspacePath, "move", { srcPath: clipboard.path, destPath: name })
        }
        setClipboard(null)
      }
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

  const isCreatingAtRoot = creatingIn?.dir === ""

  return (
    <TreeContext.Provider value={{ workspacePath, mode, clipboard, setClipboard, onRefresh, renamingPath, setRenamingPath, creatingIn, setCreatingIn, onSelectFile, onDeletedPath, contextTarget, setContextTarget, notebookScope, notebookShareToken, notebookPermission, notebookCanWrite, requestCopyBetween, toast, confirm, onUpload: requestUpload, onDownload: handleDownload }}>
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
        <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
          <img src={`${FILE_TYPE_ICON_DIR}/folder.svg`} alt="" aria-hidden className="h-4 w-4 shrink-0" />
          <span className="text-sm font-semibold truncate flex-1">{workspaceName}</span>
          {mode === "default" && (
            <>
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-md border px-2 text-xs hover:bg-accent disabled:opacity-50"
                onClick={() => requestUpload("", false)}
                title="上传文件"
                disabled={uploading}
              >
                <Upload className="mr-1 h-3.5 w-3.5" />上传
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-md border px-2 text-xs hover:bg-accent disabled:opacity-50"
                onClick={() => requestUpload("", true)}
                title="上传文件夹"
                disabled={uploading}
              >
                文件夹
              </button>
            </>
          )}
          {mode === "notebook" && (
            <button
              type="button"
              className="inline-flex h-7 items-center rounded-md border px-2 text-xs hover:bg-accent"
              onClick={() => setCreatingIn({ dir: "", type: "file" })}
              title="新建 Notebook"
              disabled={!notebookCanWrite}
            >
              <FilePlus className="mr-1 h-3.5 w-3.5" />新建
            </button>
          )}
        </div>
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
            <div className="flex-1 overflow-auto py-1">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : tree.length === 0 && !isCreatingAtRoot ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">空目录</div>
              ) : (
                <>
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
                </>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => setCreatingIn({ dir: "", type: "file" })}><FilePlus className="h-3.5 w-3.5 mr-2" />新建文件</ContextMenuItem>
            <ContextMenuItem onClick={() => setCreatingIn({ dir: "", type: "folder" })}><FolderPlus className="h-3.5 w-3.5 mr-2" />新建文件夹</ContextMenuItem>
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
                <ContextMenuItem onClick={() => { void handleDownload("") }}><Download className="h-3.5 w-3.5 mr-2" />下载根目录</ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
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
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </TreeContext.Provider>
  )
}
