"use client"

import * as React from "react"
import { File } from "lucide-react"
import { type TreeNode } from "@/lib/core/api"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

interface FileSearchCommandProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tree: TreeNode[]
  onSelectFile: (filePath: string) => void
}

function flattenTree(nodes: TreeNode[], maxDepth = 50, depth = 0): TreeNode[] {
  if (depth >= maxDepth) return []
  const result: TreeNode[] = []
  for (const node of nodes) {
    if (node.type === "file") {
      result.push(node)
    }
    if (node.children) {
      result.push(...flattenTree(node.children, maxDepth, depth + 1))
    }
  }
  return result
}

export function FileSearchCommand({
  open,
  onOpenChange,
  tree,
  onSelectFile,
}: FileSearchCommandProps) {
  const files = React.useMemo(() => flattenTree(tree), [tree])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="搜索文件..." />
      <CommandList>
        <CommandEmpty>未找到文件</CommandEmpty>
        <CommandGroup heading="文件">
          {files.map((file) => (
            <CommandItem
              key={file.path}
              value={file.path}
              onSelect={() => {
                onSelectFile(file.path)
                onOpenChange(false)
              }}
            >
              <File className="mr-2 h-4 w-4 shrink-0" />
              <span className="truncate">{file.path}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
