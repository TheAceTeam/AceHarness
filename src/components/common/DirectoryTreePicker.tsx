'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ChevronRight, Folder, FolderOpen, HardDrive, House, Loader2, LocateFixed } from 'lucide-react';
import type { TreeNode } from '@/lib/core/api';
import { cn } from '@/lib/core/utils';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

type PathResolution = string | { root?: string; path: string };

interface DirectoryTreePickerProps {
  value: string;
  onChange: (path: string) => void;
  loadRoot: () => Promise<TreeNode[]>;
  loadChildren: (path: string) => Promise<TreeNode[]>;
  rootLabel?: string;
  homeLabel?: string;
  quickAccessRoots?: string[];
  disabled?: boolean;
  className?: string;
  onResolvePath?: (input: string) => Promise<PathResolution> | PathResolution;
  onNavigateUp?: (currentPath: string) => Promise<PathResolution> | PathResolution;
  onNavigateHome?: () => Promise<PathResolution> | PathResolution;
}

function normalizePickerPath(rawPath: string): string {
  return (rawPath || '').replace(/^\/+|\/+$/g, '');
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  const dirs = nodes
    .filter((node) => node.type === 'directory')
    .map((node) => ({
      ...node,
      children: node.children ? sortTree(node.children) : node.children,
    }));
  return dirs.sort((a, b) => a.name.localeCompare(b.name));
}

function replaceNodeChildren(nodes: TreeNode[], targetPath: string, children: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.type !== 'directory') return node;
    if (node.path === targetPath) {
      return { ...node, children: sortTree(children) };
    }
    if (!node.children) return node;
    return { ...node, children: replaceNodeChildren(node.children, targetPath, children) };
  });
}

async function normalizeResolution(
  input: string,
  resolver?: (input: string) => Promise<PathResolution> | PathResolution,
): Promise<{ root?: string; path: string }> {
  const resolved = await Promise.resolve(resolver ? resolver(input) : input);
  if (typeof resolved === 'string') {
    return { path: resolved };
  }
  return resolved;
}

export default function DirectoryTreePicker({
  value,
  onChange,
  loadRoot,
  loadChildren,
  rootLabel = '根目录 /',
  quickAccessRoots = [],
  disabled = false,
  className,
  onResolvePath,
  onNavigateUp,
  onNavigateHome,
}: DirectoryTreePickerProps) {
  const [open, setOpen] = useState(false);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locatingPath, setLocatingPath] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [pathInput, setPathInput] = useState(value);
  const [draftValue, setDraftValue] = useState(value);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const latestValueRef = useRef(value);
  const openRef = useRef(open);
  const initializedOpenRef = useRef(false);
  const refreshRootRef = useRef<((options?: { resetExpanded?: boolean }) => Promise<void>) | null>(null);
  const expandPathRef = useRef<((rawPath: string) => Promise<void>) | null>(null);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    openRef.current = open;
    if (!open) {
      initializedOpenRef.current = false;
    }
  }, [open]);

  const handleLoadChildren = useCallback(async (path: string) => {
    setLoadingPaths((prev) => new Set(prev).add(path));
    try {
      const children = await loadChildren(path);
      setLoadError(null);
      setTree((prev) => replaceNodeChildren(prev, path, children || []));
    } catch (error: any) {
      setLoadError(error?.message || '加载目录失败');
    } finally {
      setLoadingPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, [loadChildren]);

  const refreshRoot = useCallback(async (options?: { resetExpanded?: boolean }) => {
    const resetExpanded = options?.resetExpanded ?? false;
    setLoadingRoot(true);
    try {
      const nodes = await loadRoot();
      setLoadError(null);
      setTree(sortTree(nodes || []));
      if (resetExpanded) {
        setExpanded(new Set(['']));
      }
    } catch (error: any) {
      setTree([]);
      setExpanded(new Set(['']));
      setLoadError(error?.message || '加载目录失败');
    } finally {
      setLoadingRoot(false);
    }
  }, [loadRoot]);

  const expandPath = useCallback(async (rawPath: string) => {
    const normalized = normalizePickerPath(rawPath);
    setLocatingPath(true);
    try {
      if (!normalized) {
        setExpanded(new Set(['']));
        return;
      }
      const segments = normalized.split('/').filter(Boolean);
      let current = '';
      const nextExpanded = new Set<string>(['']);
      for (const seg of segments) {
        current = current ? `${current}/${seg}` : seg;
        nextExpanded.add(current);
        await handleLoadChildren(current);
      }
      setExpanded(nextExpanded);
    } finally {
      setLocatingPath(false);
    }
  }, [handleLoadChildren]);

  useEffect(() => {
    refreshRootRef.current = refreshRoot;
    expandPathRef.current = expandPath;
  }, [expandPath, refreshRoot]);

  const applyPath = useCallback(async (input: string, resolver?: (input: string) => Promise<PathResolution> | PathResolution) => {
    const resolved = await normalizeResolution(input, resolver);
    const normalizedPath = normalizePickerPath(resolved.path || '');
    setDraftValue(normalizedPath);
    setPathInput(resolved.root ? `${resolved.root}${normalizedPath ? `/${normalizedPath}` : ''}` : (resolved.path || ''));
    await refreshRoot({ resetExpanded: true });
    if (normalizedPath) {
      await expandPath(normalizedPath);
    } else {
      setExpanded(new Set(['']));
    }
  }, [expandPath, refreshRoot]);

  useEffect(() => {
    void refreshRoot();
    // Only do the initial preload once. Re-rendering parents should not collapse the tree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (openRef.current) return;
    setPathInput(value);
    setDraftValue(value);
  }, [value]);

  useEffect(() => {
    if (!open || initializedOpenRef.current) return;
    initializedOpenRef.current = true;
    let cancelled = false;

    const syncOnOpen = async () => {
      const latestValue = latestValueRef.current;
      setPathInput(latestValue);
      setDraftValue(latestValue);
      await refreshRootRef.current?.({ resetExpanded: true });
      if (cancelled) return;
      if (latestValue) {
        await expandPathRef.current?.(latestValue);
      } else {
        setExpanded(new Set(['']));
      }
    };

    void syncOnOpen();

    return () => {
      cancelled = true;
      setLocatingPath(false);
    };
  }, [open]);

  const hasNodeInTree = useMemo(() => {
    if (!draftValue) return true;
    const queue: TreeNode[] = [...tree];
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || node.type !== 'directory') continue;
      if (node.path === draftValue) return true;
      if (node.children?.length) queue.push(...node.children);
    }
    return false;
  }, [draftValue, tree]);

  useEffect(() => {
    if (loadingRoot || !draftValue || hasNodeInTree) return;
    void expandPath(draftValue);
  }, [draftValue, expandPath, hasNodeInTree, loadingRoot]);

  useEffect(() => {
    if (loadingRoot) return;
    const target = nodeRefs.current.get(draftValue || '');
    if (!target) return;
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }, [draftValue, expanded, loadingPaths, loadingRoot, tree]);

  const toggleExpand = useCallback((path: string, hasLoadedChildren: boolean | undefined) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (path && !hasLoadedChildren) {
          void handleLoadChildren(path);
        }
      }
      return next;
    });
  }, [handleLoadChildren]);

  const renderTree = useCallback((nodes: TreeNode[], depth: number): React.ReactNode => {
    return nodes
      .filter((node) => node.type === 'directory')
      .map((node) => {
        const isExpanded = expanded.has(node.path);
        const isSelected = draftValue === node.path;
        const isLoading = loadingPaths.has(node.path);
        const hasLoadedChildren = Array.isArray(node.children);
        const children = Array.isArray(node.children) ? node.children : [];
        const canExpand = isLoading || (hasLoadedChildren ? children.length > 0 : true);

        return (
          <div key={node.path}>
            <button
              type="button"
              ref={(element) => {
                if (element) nodeRefs.current.set(node.path, element);
                else nodeRefs.current.delete(node.path);
              }}
              className={cn(
                'inline-flex h-7 w-full min-w-0 items-center gap-1 overflow-hidden rounded px-1 text-left text-sm hover:bg-accent',
                isSelected && 'bg-accent text-accent-foreground ring-2 ring-primary/35 outline outline-1 outline-primary/60 outline-offset-[-1px]',
              )}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              disabled={disabled}
              onClick={() => setDraftValue(node.path)}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (canExpand) toggleExpand(node.path, hasLoadedChildren);
              }}
            >
              <span
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (canExpand) toggleExpand(node.path, hasLoadedChildren);
                }}
              >
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : hasLoadedChildren && children.length === 0 ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70" />
                ) : (
                  <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', isExpanded && 'rotate-90')} />
                )}
              </span>
              {isExpanded ? (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
            </button>
            {isExpanded && hasLoadedChildren && children.length > 0 ? <div>{renderTree(children, depth + 1)}</div> : null}
          </div>
        );
      });
  }, [disabled, draftValue, expanded, loadingPaths, toggleExpand]);

  const displayValue = value || rootLabel.replace(/\s\/$/, '') || '/';
  const displayDraftValue = draftValue || rootLabel.replace(/\s\/$/, '') || '/';

  return (
    <>
      <div className={cn('flex min-w-0 items-center gap-2', className)}>
        <Input value={displayValue} readOnly disabled={disabled} className="flex-1" />
        <Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)} className="shrink-0">
          选择目录
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>选择目录</DialogTitle>
          </DialogHeader>

          <div className="h-[min(76vh,720px)] min-h-[520px] overflow-hidden">
            <ResizablePanelGroup direction="horizontal" className="h-full rounded-lg border">
              <ResizablePanel defaultSize={72} minSize={45}>
                <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
                  <div className="flex flex-wrap items-center gap-2 border-b p-3">
                    <Input
                      value={pathInput}
                      onChange={(event) => setPathInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void applyPath(pathInput, onResolvePath);
                        }
                      }}
                      placeholder="输入目录路径后回车定位，支持绝对路径"
                      disabled={disabled}
                      className="h-9 min-w-[240px] flex-1"
                    />
                    <Button type="button" variant="outline" disabled={disabled} onClick={() => void applyPath(pathInput, onResolvePath)}>
                      <LocateFixed className="mr-1 h-4 w-4" />
                      定位
                    </Button>
                    {onNavigateUp ? (
                      <Button type="button" variant="outline" disabled={disabled} onClick={() => void applyPath(draftValue, onNavigateUp)}>
                        <ArrowUp className="mr-1 h-4 w-4" />
                        上一级
                      </Button>
                    ) : null}
                    {onNavigateHome ? (
                      <Button type="button" variant="outline" disabled={disabled} onClick={() => void applyPath('', () => onNavigateHome())}>
                        <House className="mr-1 h-4 w-4" />
                        回到起点
                      </Button>
                    ) : null}
                    {quickAccessRoots.length > 0 ? (
                      <div className="flex w-full flex-wrap items-center gap-2 pt-1">
                        {quickAccessRoots.map((root) => (
                          <Button
                            key={root}
                            type="button"
                            variant={pathInput === root || rootLabel === root ? 'default' : 'outline'}
                            size="sm"
                            disabled={disabled}
                            onClick={() => void applyPath(root, onResolvePath)}
                          >
                            <HardDrive className="mr-1 h-3.5 w-3.5" />
                            {root}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {locatingPath ? (
                    <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      正在展开并定位当前目录...
                    </div>
                  ) : null}

                  <button
                    type="button"
                    ref={(element) => {
                      if (element) nodeRefs.current.set('', element);
                      else nodeRefs.current.delete('');
                    }}
                    className={cn(
                      'flex h-10 w-full min-w-0 items-center gap-2 border-b px-3 text-left text-sm hover:bg-accent',
                      draftValue === '' && 'bg-accent text-accent-foreground ring-2 ring-primary/35 outline outline-1 outline-primary/60 outline-offset-[-1px]',
                    )}
                    disabled={disabled}
                    onClick={() => setDraftValue('')}
                  >
                    <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{rootLabel}</span>
                  </button>

                  <div className="min-h-0 flex-1 overflow-auto p-2">
                    {loadingRoot ? (
                      <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        正在加载目录...
                      </div>
                    ) : loadError ? (
                      <div className="px-2 py-3 text-sm text-muted-foreground">{loadError}</div>
                    ) : tree.length === 0 ? (
                      <div className="px-2 py-3 text-sm text-muted-foreground">暂无可用目录</div>
                    ) : (
                      renderTree(tree, 0)
                    )}
                  </div>
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={28} minSize={20}>
                <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto bg-muted/10 p-4">
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <div className="text-sm font-medium">当前选中</div>
                    <div className="mt-3 flex items-start gap-2 rounded-md border bg-background p-3">
                      <Folder className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1 break-all text-sm">{displayDraftValue}</div>
                    </div>
                  </div>

                  <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                    <div className="font-medium text-foreground">使用说明</div>
                    <div className="mt-3 space-y-2 leading-6">
                      <div>单击目录即可选中。</div>
                      <div>双击目录名或点击箭头可以展开子目录。</div>
                      <div>支持直接输入绝对路径，比如 `C:/`、`D:/work`、`/home/user`。</div>
                      <div>“上一级”会向父目录切换，“回到起点”会回到页面提供的默认起点。</div>
                    </div>
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => {
              setDraftValue(value);
              setPathInput(value);
              setOpen(false);
            }}>
              取消
            </Button>
            <Button type="button" onClick={() => {
              onChange(draftValue);
              setPathInput(draftValue);
              setOpen(false);
            }}>
              确认选择
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
