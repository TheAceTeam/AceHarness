"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CommitAuthorAvatar,
  CommitCopyButton,
  CommitFileStatus,
  CommitHash,
  CommitMetadata,
  CommitMessage,
  CommitSeparator,
  CommitTimestamp,
} from "@/components/ai-elements/commit";
import { FileTree, FileTreeFile, FileTreeFolder } from "@/components/ai-elements/file-tree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  workspaceApi,
  type GitBrowserCommitDetailResponse,
  type GitBrowserCommitSummary,
  type GitBrowserFileDetail,
  type GitBrowserScope,
  type GitBrowserSummaryResponse,
  type GitDiffSummaryFile,
} from "@/lib/core/api";
import { cn } from "@/lib/core/utils";

const MonacoDiffEditor = dynamic(
  async () => {
    const monaco = await import("monaco-editor");
    const { loader, DiffEditor } = await import("@monaco-editor/react");
    loader.config({ monaco });
    return DiffEditor;
  },
  {
    ssr: false,
    loading: () => <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-muted-foreground">正在加载差异编辑器...</div>,
  },
);

type DiffTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  status?: GitDiffSummaryFile["status"];
  additions?: number;
  deletions?: number;
  children?: DiffTreeNode[];
};

type BrowserMode = GitBrowserScope | "commits";
type DetailViewMode = "commit-patch" | "file-diff" | "file-patch";
const INITIAL_COMMIT_LIMIT = 40;
const LOAD_MORE_COMMITS = 40;

const scopeMeta: Record<BrowserMode, { label: string; subtitle: string; icon: string }> = {
  unstaged: { label: "未暂存", subtitle: "Working tree 对 Index", icon: "edit_note" },
  staged: { label: "已暂存", subtitle: "Index 对 HEAD", icon: "inventory_2" },
  untracked: { label: "未跟踪", subtitle: "新增但尚未纳入 Git", icon: "note_add" },
  commits: { label: "提交历史", subtitle: "选择一次提交后再看文件差异", icon: "history" },
};

function getInitials(name: string) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "GH";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || trimmed.slice(0, 2).toUpperCase();
}

function inferLanguage(filePath: string) {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    yml: "yaml",
    yaml: "yaml",
    css: "css",
    html: "html",
    sh: "shell",
    ps1: "powershell",
    py: "python",
    cj: "plaintext",
    toml: "toml",
  };
  return map[ext] || "plaintext";
}

function buildChangedFileTree(files: GitDiffSummaryFile[]) {
  const roots: DiffTreeNode[] = [];
  const directoryMap = new Map<string, DiffTreeNode>();

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    let currentChildren = roots;
    let currentPath = "";

    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isFile = index === segments.length - 1;

      if (isFile) {
        currentChildren.push({
          name: segment,
          path: file.path,
          type: "file",
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
        });
        return;
      }

      let node = directoryMap.get(currentPath);
      if (!node) {
        node = {
          name: segment,
          path: currentPath,
          type: "directory",
          children: [],
        };
        directoryMap.set(currentPath, node);
        currentChildren.push(node);
      }
      currentChildren = node.children || [];
    });
  }

  const sortNodes = (nodes: DiffTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
    nodes.forEach((node) => {
      if (node.children) sortNodes(node.children);
    });
  };
  sortNodes(roots);

  const expanded = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let current = "";
    parts.slice(0, -1).forEach((part, index) => {
      current = current ? `${current}/${part}` : part;
      if (index < 2) expanded.add(current);
    });
  }

  return { roots, expanded };
}

function renderTreeNodes(nodes: DiffTreeNode[], depth = 0): ReactNode {
  return nodes.map((node) => {
    if (node.type === "directory") {
      return (
        <FileTreeFolder
          key={node.path}
          path={node.path}
          name={node.name}
          depth={depth}
          icon={<span className="material-symbols-outlined text-[16px] text-muted-foreground">folder</span>}
        >
          {renderTreeNodes(node.children || [], depth + 1)}
        </FileTreeFolder>
      );
    }

    return (
      <FileTreeFile
        key={node.path}
        path={node.path}
        name={node.name}
        depth={depth}
        icon={<span className="material-symbols-outlined text-[16px] text-muted-foreground">description</span>}
        actions={
          <span className="inline-flex items-center gap-2 text-[10px]">
            <CommitFileStatus status={node.status} />
            <span className="text-emerald-600 dark:text-emerald-400">+{node.additions || 0}</span>
            <span className="text-red-600 dark:text-red-400">-{node.deletions || 0}</span>
          </span>
        }
      />
    );
  });
}

function buildModeOrder(summary: GitBrowserSummaryResponse | null): BrowserMode[] {
  if (!summary) return ["unstaged", "staged", "untracked", "commits"];
  const ordered: BrowserMode[] = [];
  if (summary.workingTree.unstaged.length) ordered.push("unstaged");
  if (summary.workingTree.staged.length) ordered.push("staged");
  if (summary.workingTree.untracked.length) ordered.push("untracked");
  if (summary.commits.length) ordered.push("commits");
  return ordered.length ? ordered : ["commits", "unstaged", "staged", "untracked"];
}

function getModeCount(summary: GitBrowserSummaryResponse | null, mode: BrowserMode) {
  if (!summary) return 0;
  if (mode === "commits") return summary.commits.length;
  return summary.workingTree[mode].length;
}

function formatStatLine(additions: number, deletions: number) {
  return (
    <>
      <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>
      <span className="text-red-600 dark:text-red-400">-{deletions}</span>
    </>
  );
}

function FileListSkeleton() {
  return (
    <div className="space-y-2 p-3">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-[92%]" />
      <Skeleton className="h-8 w-[82%]" />
    </div>
  );
}

export function GitWorkspaceDiffPanel({
  workspacePath,
  isRunning = false,
}: {
  workspacePath?: string | null;
  isRunning?: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const [summary, setSummary] = useState<GitBrowserSummaryResponse | null>(null);
  const [mode, setMode] = useState<BrowserMode>("commits");
  const [selectedCommit, setSelectedCommit] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [detailViewMode, setDetailViewMode] = useState<DetailViewMode>("commit-patch");
  const [commitDetail, setCommitDetail] = useState<GitBrowserCommitDetailResponse | null>(null);
  const [detail, setDetail] = useState<GitBrowserFileDetail | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingCommit, setLoadingCommit] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingMoreCommits, setLoadingMoreCommits] = useState(false);
  const [error, setError] = useState<string>("");
  const [open, setOpen] = useState(false);

  const loadSummary = useCallback(async (options?: { appendCommits?: boolean; commitOffset?: number; commitLimit?: number }) => {
    const targetWorkspace = String(workspacePath || "").trim();
    if (!targetWorkspace) return;
    const appendCommits = !!options?.appendCommits;
    if (appendCommits) {
      setLoadingMoreCommits(true);
    } else {
      setLoadingSummary(true);
    }
    try {
      const next = await workspaceApi.getGitBrowserSummary(targetWorkspace, {
        commitOffset: options?.commitOffset,
        commitLimit: options?.commitLimit ?? INITIAL_COMMIT_LIMIT,
      });
      setSummary((prev) => {
        if (!appendCommits || !prev) return next;
        return {
          ...next,
          commits: [...prev.commits, ...next.commits],
          commitOffset: next.commitOffset,
        };
      });
      setError("");
    } catch (nextError: any) {
      setError(nextError?.message || "获取 Git 浏览数据失败");
      if (!appendCommits) setSummary(null);
    } finally {
      if (appendCommits) {
        setLoadingMoreCommits(false);
      } else {
        setLoadingSummary(false);
      }
    }
  }, [workspacePath]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!summary) return;
    const ordered = buildModeOrder(summary);
    if (getModeCount(summary, mode) === 0 && ordered[0] && ordered[0] !== mode) {
      setMode(ordered[0]);
      return;
    }
    if (mode === "commits") {
      if (!selectedCommit || !summary.commits.some((item) => item.hash === selectedCommit)) {
        setSelectedCommit(summary.commits[0]?.hash || "");
      }
      return;
    }
    const files = summary.workingTree[mode];
    if (!selectedFile || !files.some((item) => item.path === selectedFile)) {
      setSelectedFile(files[0]?.path || "");
    }
  }, [mode, selectedCommit, selectedFile, summary]);

  useEffect(() => {
    const targetWorkspace = String(workspacePath || "").trim();
    if (!targetWorkspace || mode !== "commits" || !selectedCommit) {
      setCommitDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingCommit(true);
    workspaceApi.getGitBrowserCommitDetail(targetWorkspace, selectedCommit)
      .then((next) => {
        if (cancelled) return;
        setCommitDetail(next);
        setError("");
        if (!selectedFile || !next.files.some((item) => item.path === selectedFile)) {
          setSelectedFile(next.files[0]?.path || "");
        }
      })
      .catch((nextError: any) => {
        if (cancelled) return;
        setError(nextError?.message || "获取提交详情失败");
        setCommitDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingCommit(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, selectedCommit, selectedFile, workspacePath]);

  useEffect(() => {
    const targetWorkspace = String(workspacePath || "").trim();
    if (!targetWorkspace) return;

    if (mode === "commits") {
      if (!selectedCommit || !selectedFile) {
        setDetail(null);
        return;
      }
      let cancelled = false;
      setLoadingDetail(true);
      workspaceApi.getGitBrowserCommitFileDetail(targetWorkspace, selectedCommit, selectedFile)
        .then((next) => {
          if (cancelled) return;
          setDetail(next.file);
          setError("");
        })
        .catch((nextError: any) => {
          if (cancelled) return;
          setError(nextError?.message || "获取提交文件差异失败");
          setDetail(null);
        })
        .finally(() => {
          if (!cancelled) setLoadingDetail(false);
        });
      return () => {
        cancelled = true;
      };
    }

    if (!selectedFile) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    workspaceApi.getGitBrowserScopeFileDetail(targetWorkspace, mode, selectedFile)
      .then((next) => {
        if (cancelled) return;
        setDetail(next.file);
        setError("");
      })
      .catch((nextError: any) => {
        if (cancelled) return;
        setError(nextError?.message || "获取文件差异失败");
        setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, selectedCommit, selectedFile, workspacePath]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      void loadSummary();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isRunning, loadSummary]);

  const handleLoadMoreCommits = useCallback(() => {
    if (!summary?.hasMoreCommits || loadingMoreCommits) return;
    void loadSummary({
      appendCommits: true,
      commitOffset: summary.commits.length,
      commitLimit: LOAD_MORE_COMMITS,
    });
  }, [loadSummary, loadingMoreCommits, summary]);

  const currentCommit = useMemo(
    () => summary?.commits.find((item) => item.hash === selectedCommit) || commitDetail?.commit || null,
    [commitDetail?.commit, selectedCommit, summary?.commits],
  );

  const currentFiles = useMemo(() => {
    if (!summary) return [] as GitDiffSummaryFile[];
    return mode === "commits" ? (commitDetail?.files || []) : summary.workingTree[mode];
  }, [commitDetail?.files, mode, summary]);

  const { roots, expanded } = useMemo(
    () => buildChangedFileTree(currentFiles),
    [currentFiles],
  );

  const currentFile = useMemo(
    () => currentFiles.find((item) => item.path === selectedFile) || null,
    [currentFiles, selectedFile],
  );

  const canShowCommitPatch = mode === "commits" && !!currentCommit;
  const canShowFileViews = !!currentFile;

  const detailViewTabs = mode === "commits"
    ? [
        { key: "commit-patch" as const, label: "提交 Patch", disabled: !canShowCommitPatch },
        { key: "file-diff" as const, label: "文件 Diff", disabled: !canShowFileViews },
        { key: "file-patch" as const, label: "文件 Patch", disabled: !canShowFileViews },
      ]
    : [
        { key: "file-diff" as const, label: "文件 Diff", disabled: !canShowFileViews },
        { key: "file-patch" as const, label: "文件 Patch", disabled: !canShowFileViews },
      ];

  if (!workspacePath) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => setOpen(true)}
        title="打开 Git 历史浏览器"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>history</span>
        <span className="hidden sm:inline">Git</span>
        {summary ? (
          <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
            {summary.commits.length}
          </Badge>
        ) : null}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[88vh] w-[96vw] max-w-[96vw] overflow-hidden p-0">
          <DialogTitle className="sr-only">Git 历史浏览器</DialogTitle>
          <div className="flex h-full min-h-0 flex-col bg-background">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-foreground">history</span>
                  <div className="text-sm font-semibold">Git 历史浏览器</div>
                  {summary?.branch ? <Badge variant="outline" className="text-[10px]">{summary.branch}</Badge> : null}
                  {summary?.head ? <Badge variant="secondary" className="text-[10px]">HEAD {summary.head.shortHash}</Badge> : null}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{workspacePath}</div>
              </div>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void loadSummary()} disabled={loadingSummary}>
                <span className="material-symbols-outlined text-sm">refresh</span>
                刷新
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {loadingSummary && !summary ? (
                <div className="grid h-full min-h-[520px] grid-cols-1 lg:grid-cols-[320px_320px_minmax(0,1fr)]">
                  <div className="border-r p-3 space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-[92%]" />
                    <Skeleton className="h-10 w-[82%]" />
                    <Skeleton className="h-10 w-[88%]" />
                  </div>
                  <div className="border-r"><FileListSkeleton /></div>
                  <div className="p-4 space-y-3">
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-[420px] w-full" />
                  </div>
                </div>
              ) : error && !summary ? (
                <div className="p-6 text-sm text-red-500">{error}</div>
              ) : summary && !summary.available ? (
                <div className="p-6 text-sm text-muted-foreground">{summary.reason || "当前工作区不在 Git 仓库中"}</div>
              ) : (
                <div className="grid h-full min-h-[520px] grid-cols-1 lg:grid-cols-[320px_320px_minmax(0,1fr)]">
                  <div className="overflow-auto border-r">
                    <div className="border-b px-4 py-2 text-xs text-muted-foreground">范围 / 提交</div>
                    <div className="p-2 space-y-2">
                      {(["unstaged", "staged", "untracked"] as GitBrowserScope[]).map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => {
                            setMode(item);
                            setSelectedCommit("");
                            setSelectedFile("");
                            setDetailViewMode("file-diff");
                          }}
                          className={cn(
                            "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                            mode === item ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/30",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[16px] text-muted-foreground">{scopeMeta[item].icon}</span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-foreground">{scopeMeta[item].label}</span>
                                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{summary?.workingTree[item].length || 0}</Badge>
                              </div>
                              <div className="mt-0.5 text-[11px] text-muted-foreground">{scopeMeta[item].subtitle}</div>
                            </div>
                          </div>
                        </button>
                      ))}

                      <div className="rounded-lg border border-border/60">
                        <button
                          type="button"
                          onClick={() => {
                            setMode("commits");
                            setDetailViewMode("commit-patch");
                          }}
                          className={cn(
                            "w-full border-b px-3 py-3 text-left transition-colors",
                            mode === "commits" ? "bg-primary/5" : "hover:bg-muted/30",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[16px] text-muted-foreground">history</span>
                            <span className="text-sm font-medium text-foreground">提交历史</span>
                            <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">{summary?.commits.length || 0}</Badge>
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">先选提交，再看该提交内的文件差异</div>
                        </button>

                        <div className="max-h-[340px] overflow-auto p-2">
                          {summary?.commits.length ? summary.commits.map((commit) => (
                            <button
                              key={commit.hash}
                              type="button"
                              onClick={() => {
                                setMode("commits");
                                setSelectedCommit(commit.hash);
                                setDetailViewMode("commit-patch");
                              }}
                              className={cn(
                                "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                                selectedCommit === commit.hash && mode === "commits"
                                  ? "border-primary bg-primary/5"
                                  : "border-transparent hover:border-border/60 hover:bg-muted/30",
                              )}
                            >
                              <div className="flex items-start gap-3">
                                <CommitAuthorAvatar initials={getInitials(commit.authorName)} className="h-8 w-8" />
                                <div className="min-w-0 flex-1">
                                  <CommitMessage>{commit.message || "无提交说明"}</CommitMessage>
                                  <CommitMetadata className="mt-1">
                                    <span>{commit.authorName}</span>
                                    <CommitSeparator />
                                    <CommitHash>{commit.shortHash}</CommitHash>
                                    <CommitSeparator />
                                    <CommitTimestamp date={new Date(commit.authoredAt)} />
                                  </CommitMetadata>
                                  <div className="mt-1 flex items-center gap-2 text-[11px]">
                                    <span className="text-muted-foreground">{commit.fileCount} 文件</span>
                                    <CommitSeparator />
                                    {formatStatLine(commit.additions, commit.deletions)}
                                  </div>
                                </div>
                              </div>
                            </button>
                          )) : (
                            <div className="px-2 py-4 text-sm text-muted-foreground">当前范围没有提交历史。</div>
                          )}
                        </div>
                        {summary?.hasMoreCommits ? (
                          <div className="border-t px-2 py-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full text-xs"
                              onClick={handleLoadMoreCommits}
                              disabled={loadingMoreCommits}
                            >
                              <span className="material-symbols-outlined text-[14px]">expand_more</span>
                              {loadingMoreCommits ? "正在加载更多提交..." : "加载更多提交"}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-auto border-r">
                    <div className="border-b px-4 py-2 text-xs text-muted-foreground">
                      {mode === "commits" ? "提交文件" : `${scopeMeta[mode].label} 文件`}
                    </div>
                    {mode === "commits" && loadingCommit && !commitDetail ? (
                      <FileListSkeleton />
                    ) : currentFiles.length ? (
                      <div className="p-2">
                        <FileTree
                          className="gap-0.5"
                          selectedPath={selectedFile}
                          onSelect={(path) => {
                            setSelectedFile(path);
                            setDetailViewMode("file-diff");
                          }}
                          defaultExpanded={expanded}
                        >
                          {renderTreeNodes(roots)}
                        </FileTree>
                      </div>
                    ) : (
                      <div className="px-4 py-6 text-sm text-muted-foreground">
                        {mode === "commits" ? "这个提交没有可展示的文件变更。" : "这个分组当前没有文件。"}
                      </div>
                    )}
                  </div>

                  <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]">
                    <div className="border-b bg-muted/20 px-4 py-3">
                      {mode === "commits" && currentCommit ? (
                        <div className="flex flex-wrap items-start gap-3">
                          <CommitAuthorAvatar initials={getInitials(currentCommit.authorName)} className="h-9 w-9" />
                          <div className="min-w-0 flex-1">
                            <CommitMessage className="text-[15px]">{currentCommit.message || "无提交说明"}</CommitMessage>
                            <CommitMetadata className="mt-1">
                              <span>{currentCommit.authorName}</span>
                              <CommitSeparator />
                              <CommitHash>{currentCommit.shortHash}</CommitHash>
                              <CommitSeparator />
                              <CommitTimestamp date={new Date(currentCommit.authoredAt)}>{new Date(currentCommit.authoredAt).toLocaleString("zh-CN")}</CommitTimestamp>
                              <CommitSeparator />
                              <span>{currentCommit.fileCount} 文件</span>
                              <CommitSeparator />
                              {formatStatLine(currentCommit.additions, currentCommit.deletions)}
                            </CommitMetadata>
                          </div>
                          <CommitCopyButton hash={currentCommit.hash} title="复制提交哈希" />
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="text-sm font-semibold text-foreground">{scopeMeta[mode].label}</div>
                          <div className="text-xs text-muted-foreground">
                            {mode === "unstaged" ? "当前工作区相对 Index 的改动" : mode === "staged" ? "当前 Index 相对 HEAD 的改动" : "尚未纳入版本控制的文件"}
                          </div>
                          {summary?.head ? (
                            <div className="text-xs text-muted-foreground">基线提交：{summary.head.shortHash} · {summary.head.message}</div>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2 text-xs">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      {detailViewMode === "commit-patch" && currentCommit ? (
                        <>
                          <Badge variant="outline">commit</Badge>
                          <span className="font-medium text-foreground">{currentCommit.message || currentCommit.shortHash}</span>
                          <CommitSeparator />
                          <CommitHash>{currentCommit.shortHash}</CommitHash>
                        </>
                      ) : currentFile ? (
                        <>
                          <Badge variant="outline">{currentFile.status}</Badge>
                          <span className="font-medium text-foreground">{currentFile.path}</span>
                          {currentFile.previousPath && currentFile.previousPath !== currentFile.path ? (
                            <span className="text-muted-foreground">from {currentFile.previousPath}</span>
                          ) : null}
                          {detail ? (
                            <>
                              <CommitSeparator />
                              <span className="text-muted-foreground">{detail.baseLabel}</span>
                              <span className="text-muted-foreground">→</span>
                              <span className="text-muted-foreground">{detail.targetLabel}</span>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">{mode === "commits" ? "可先看整次提交 Patch，或在中间列选择文件" : "先在中间列选择一个文件"}</span>
                      )}
                      </div>
                      <div className="ml-auto flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 p-1">
                        {detailViewTabs.map((tab) => (
                          <button
                            key={tab.key}
                            type="button"
                            disabled={tab.disabled}
                            onClick={() => setDetailViewMode(tab.key)}
                            className={cn(
                              "rounded px-2.5 py-1 text-[11px] transition-colors",
                              detailViewMode === tab.key
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                              tab.disabled && "cursor-not-allowed opacity-40 hover:text-muted-foreground",
                            )}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="min-h-0">
                      {detailViewMode === "commit-patch" ? (
                        mode === "commits" && currentCommit ? (
                          commitDetail?.patch ? (
                            <pre className="h-full overflow-auto bg-background p-4 font-mono text-[12px] leading-6 text-foreground">
                              <code>{commitDetail.patch}</code>
                            </pre>
                          ) : (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">当前提交没有可展示的 patch。</div>
                          )
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选择一个提交查看整次 patch。</div>
                        )
                      ) : loadingDetail && !detail ? (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在加载文件差异...</div>
                      ) : error && !detail ? (
                        <div className="p-4 text-sm text-red-500">{error}</div>
                      ) : detail ? (
                        detailViewMode === "file-patch" ? (
                          detail.patch ? (
                            <pre className="h-full overflow-auto bg-background p-4 font-mono text-[12px] leading-6 text-foreground">
                              <code>{detail.patch}</code>
                            </pre>
                          ) : (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">当前文件没有可展示的 patch。</div>
                          )
                        ) : detail.currentTooLarge || detail.originalTooLarge ? (
                          <div className="p-4 text-sm text-muted-foreground">文件过大，已跳过 Monaco 差异渲染。</div>
                        ) : (
                          <MonacoDiffEditor
                            height="100%"
                            keepCurrentOriginalModel
                            keepCurrentModifiedModel
                            original={detail.originalContent}
                            modified={detail.currentContent}
                            language={inferLanguage(detail.path)}
                            theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
                            options={{
                              readOnly: true,
                              renderSideBySide: true,
                              minimap: { enabled: false },
                              scrollBeyondLastLine: false,
                              wordWrap: "off",
                              diffWordWrap: "off",
                              automaticLayout: true,
                              lineNumbersMinChars: 3,
                            }}
                          />
                        )
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选择一个文件查看差异</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
