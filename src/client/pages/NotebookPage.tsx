'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from '@/lib/navigation/client';
import { useRouter, useSearchParams } from '@/lib/navigation/client';
import { ArrowLeft, Clock3, FileText, FolderTree, GitBranch, Globe2, History, Link2, NotebookTabs, PanelRightOpen, Share2, User } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { WorkspaceEditor, type WorkspaceEditorInspectorState } from '@/components/workspace/WorkspaceEditor';
import { workspaceApi, type NotebookScope } from '@/lib/core/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import type { NotebookSearch } from '@/routes/notebook';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { StatusPill } from '@/components/ui/status-pill';
import {
  DataCard,
  DataCardDescription,
  DataCardHeader,
  DataCardMeta,
  DataCardTitle,
} from '@/components/ui/data-card';
import { EmptyState } from '@/components/ui/empty-state';

interface UserInfo {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  personalDir: string;
  avatar?: string;
  createdAt: number;
}

export function NotebookPageContent({
  embedded = false,
  embeddedSearch = '',
  routeSearch,
  onEmbeddedSearchChange,
}: {
  embedded?: boolean;
  embeddedSearch?: string;
  routeSearch?: NotebookSearch;
  onEmbeddedSearchChange?: (search: string) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const effectiveSearchParams = useMemo(
    () => routeSearch && !embedded
      ? notebookSearchToParams(routeSearch)
      : new URLSearchParams(embedded ? embeddedSearch : searchParams.toString()),
    [embedded, embeddedSearch, routeSearch, searchParams]
  );
  const [user, setUser] = useState<UserInfo | null>(null);
  const scope: NotebookScope = effectiveSearchParams.get('notebookScope') === 'personal' ? 'personal' : 'global';
  const returnTo = effectiveSearchParams.get('returnTo') || '/dashboard';
  const selectedFile = effectiveSearchParams.get('notebookFile') || '';
  const selectedLineNumber = Number.parseInt(effectiveSearchParams.get('notebookLine') || '', 10);
  const selectedColumn = Number.parseInt(effectiveSearchParams.get('notebookColumn') || '', 10);
  const [shareToken, setShareToken] = useState<string | undefined>(undefined);
  const [permission, setPermission] = useState<'read' | 'write'>('write');
  const [open, setOpen] = useState(true);
  const [inspectorState, setInspectorState] = useState<WorkspaceEditorInspectorState>({
    selectedFile: selectedFile || null,
    fileSize: null,
    fileType: selectedFile ? selectedFile.split('.').pop()?.toLowerCase() : undefined,
    loading: false,
    error: null,
    readOnly: false,
    oversize: false,
    node: null,
    treeCount: 0,
  });
  const pageTitle = scope === 'global' ? '全局 Notebook' : 'Cangjie Notebook';
  const scopeLabel = scope === 'global' ? '团队共享' : '个人';
  const scopeDescription = scope === 'global'
    ? '团队可共享的 Resources Notebook，文件分享链接仅在此范围可用。'
    : '个人 Resources Notebook，使用账号个人目录保存内容。';
  const canWrite = permission === 'write';
  const activeFile = inspectorState.selectedFile || selectedFile || '';
  const activeFileName = activeFile.split('/').filter(Boolean).pop() || activeFile;
  const activeFileDirectory = activeFile.includes('/') ? activeFile.split('/').slice(0, -1).join('/') : '根目录';
  const fileExtension = inspectorState.fileType || (activeFile.includes('.') ? activeFile.split('.').pop()?.toLowerCase() : '') || 'unknown';
  const fileModifiedTime = inspectorState.node?.modifiedTime
    ? new Date(inspectorState.node.modifiedTime).toLocaleString()
    : null;
  const fileModeLabel = inspectorState.readOnly || !canWrite ? 'read' : 'write';
  const fileStatusTone = inspectorState.error
    ? 'danger'
    : inspectorState.loading
      ? 'info'
      : activeFile
        ? 'success'
        : 'neutral';
  const shareStatus = shareToken
    ? `分享链接：${permission === 'read' ? '只读' : '可编辑'}`
    : scope === 'global'
      ? '可从编辑器工具栏创建团队分享链接'
      : '个人空间文件不暴露团队分享入口';
  const handleInspectorChange = useCallback((state: WorkspaceEditorInspectorState) => {
    setInspectorState(state);
  }, []);
  const updateNotebookSearch = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(effectiveSearchParams.toString());
    params.set('notebook', '1');
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const search = params.toString();
    if (embedded) {
      onEmbeddedSearchChange?.(search);
      return;
    }
    router.replace(`/notebook?${search}`);
  }, [effectiveSearchParams, embedded, onEmbeddedSearchChange, router]);
  const handleFileLocationChange = useCallback((filePath: string | null, lineNumber?: number | null, column?: number | null) => {
    updateNotebookSearch({
      notebookFile: filePath,
      notebookScope: scope,
      notebookLine: lineNumber && lineNumber > 0 ? String(lineNumber) : null,
      notebookColumn: column && column > 0 ? String(column) : null,
    });
  }, [scope, updateNotebookSearch]);

  useDocumentTitle(embedded ? null : pageTitle);
  useDashboardShellHeader({
    title: pageTitle,
    subtitle: scope === 'global' ? '团队共享 Notebook' : '个人 Notebook',
  }, [pageTitle, scope]);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
    fetch('/api/auth/me', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => res.json())
      .then((data) => setUser(data.user || null))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    const share = effectiveSearchParams.get('notebookShare') || '';
    if (!share) {
      setShareToken(undefined);
      setPermission('write');
      return;
    }
    let cancelled = false;
    workspaceApi.resolveNotebookShare(share)
      .then((resolved) => {
        if (cancelled) return;
        if (resolved.scope !== 'global') {
          setShareToken(undefined);
          setPermission('write');
          return;
        }
        setShareToken(share);
        setPermission(resolved.permission);
        const file = effectiveSearchParams.get('notebookFile');
        if (!file) {
          const params = new URLSearchParams(effectiveSearchParams.toString());
          params.set('notebook', '1');
          params.set('notebookScope', resolved.scope);
          params.set('notebookFile', resolved.path);
          params.set('notebookShare', share);
          params.set('notebookPermission', resolved.permission);
          const search = params.toString();
          if (embedded) onEmbeddedSearchChange?.(search);
          else router.replace(`/notebook?${search}`);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setShareToken(undefined);
        setPermission('write');
      });
    return () => { cancelled = true; };
  }, [effectiveSearchParams, embedded, onEmbeddedSearchChange, router]);

  if (!user) {
    return (
      <EmptyState
        icon={<NotebookTabs className="h-5 w-5" />}
        title="加载 Notebook..."
        description="正在读取账号信息和可用目录。"
        className="h-full min-h-[320px] rounded-none border-0 bg-background"
      />
    );
  }

  return (
    <div className={`${embedded ? 'h-full' : 'h-dvh'} flex flex-col overflow-hidden bg-background text-foreground`}>
      {!embedded ? (
        <PageHeader
          className="shrink-0 bg-card"
          title={pageTitle}
          subtitle={scopeDescription}
          eyebrow="RESOURCES"
          leading={(
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted/40 text-foreground">
              <NotebookTabs className="h-5 w-5" />
            </div>
          )}
          status={<StatusPill tone={scope === 'global' ? 'accent' : 'neutral'}>{scopeLabel}</StatusPill>}
          secondaryActions={(
            <Button variant="outline" size="sm" asChild>
              <Link href={returnTo}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回
              </Link>
            </Button>
          )}
        />
      ) : null}
      <PageToolbar
        className="shrink-0 bg-card"
        search={(
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
              <FolderTree className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">文件树 / 编辑器 / 元数据 inspector</div>
              <div className="truncate text-xs text-muted-foreground">
                文件操作在左侧文件树，保存、历史、分享与 AI 操作保留在编辑器工具栏。
              </div>
            </div>
          </div>
        )}
        filters={(
          <div className="flex items-center gap-2">
            <ScopeButton targetScope="personal" currentScope={scope} href={buildNotebookScopeHref(effectiveSearchParams, 'personal')} />
            <ScopeButton targetScope="global" currentScope={scope} href={buildNotebookScopeHref(effectiveSearchParams, 'global')} />
          </div>
        )}
        actions={(
          <StatusPill tone={canWrite ? 'success' : 'warning'}>
            {canWrite ? '可编辑' : '只读分享'}
          </StatusPill>
        )}
      />
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_292px]">
          <div className="min-h-0 overflow-hidden rounded-xl border border-border bg-card">
            <WorkspaceEditor
              open={open}
              onOpenChange={(next) => {
                if (embedded) return;
                setOpen(next);
                if (!next) router.push(returnTo);
              }}
              workspacePath={user.personalDir || '/'}
              initialFilePath={selectedFile || null}
              initialLineNumber={selectedLineNumber > 0 ? selectedLineNumber : null}
              initialColumn={selectedColumn > 0 ? selectedColumn : null}
              mode="notebook"
              title={pageTitle}
              presentation="page"
              notebookScope={scope}
              notebookShareToken={shareToken}
              notebookPermission={permission}
              onNotebookInspectorChange={handleInspectorChange}
              onFileLocationChange={handleFileLocationChange}
            />
          </div>
          <aside className="hidden min-h-0 flex-col gap-3 overflow-auto xl:flex">
            <DataCard>
              <DataCardHeader>
                <div className="min-w-0">
                  <DataCardTitle>当前范围</DataCardTitle>
                  <DataCardDescription>{scopeDescription}</DataCardDescription>
                </div>
                {scope === 'global' ? <Globe2 className="h-4 w-4 text-muted-foreground" /> : <User className="h-4 w-4 text-muted-foreground" />}
              </DataCardHeader>
              <DataCardMeta>
                <StatusPill tone={scope === 'global' ? 'accent' : 'neutral'}>{scopeLabel}</StatusPill>
                <StatusPill tone={canWrite ? 'success' : 'warning'}>{canWrite ? 'write' : 'read'}</StatusPill>
              </DataCardMeta>
            </DataCard>

            <DataCard>
              <DataCardHeader>
                <div className="min-w-0">
                  <DataCardTitle>当前文件</DataCardTitle>
                  <DataCardDescription className="break-all font-mono text-xs">
                    {activeFile || '尚未选择文件'}
                  </DataCardDescription>
                </div>
                <PanelRightOpen className="h-4 w-4 text-muted-foreground" />
              </DataCardHeader>
              <DataCardMeta>
                <StatusPill tone={fileStatusTone}>{inspectorState.loading ? '读取中' : inspectorState.error ? '读取失败' : activeFile ? '已选择' : '等待选择'}</StatusPill>
                {activeFile ? <StatusPill tone={fileModeLabel === 'write' ? 'success' : 'warning'}>{fileModeLabel}</StatusPill> : null}
              </DataCardMeta>
              {activeFile ? (
                <div className="mt-4 space-y-2 text-sm">
                  <InspectorRow label="文件名" value={activeFileName} />
                  <InspectorRow label="目录" value={activeFileDirectory} />
                  <InspectorRow label="类型" value={fileExtension} />
                  <InspectorRow label="大小" value={formatBytes(inspectorState.fileSize)} />
                  <InspectorRow label="修改时间" value={fileModifiedTime || '树节点未返回'} />
                  {inspectorState.error ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{inspectorState.error}</div> : null}
                  {inspectorState.oversize ? <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">文件超过在线编辑限制，可继续使用预览/下载等编辑器能力。</div> : null}
                </div>
              ) : (
                <DataCardDescription className="mt-3">
                  从左侧文件树选择文档后，这里会显示路径、类型、大小、只读状态和分享状态。
                </DataCardDescription>
              )}
            </DataCard>

            <DataCard>
              <DataCardHeader>
                <div className="min-w-0">
                  <DataCardTitle>分享与历史</DataCardTitle>
                  <DataCardDescription>{shareStatus}</DataCardDescription>
                </div>
                <Share2 className="h-4 w-4 text-muted-foreground" />
              </DataCardHeader>
              <div className="mt-3 grid gap-2 text-sm">
                <InspectorCallout icon={<Link2 className="h-3.5 w-3.5" />} label="分享" value={scope === 'global' ? '在编辑器工具栏管理链接和权限' : '切到团队范围后可分享'} />
                <InspectorCallout icon={<History className="h-3.5 w-3.5" />} label="历史" value="快照、Diff 和恢复仍由编辑器历史入口承载" />
                <InspectorCallout icon={<Clock3 className="h-3.5 w-3.5" />} label="树规模" value={`${inspectorState.treeCount.toLocaleString()} 个已加载节点`} />
              </div>
            </DataCard>

            <DataCard>
              <DataCardHeader>
                <div className="min-w-0">
                  <DataCardTitle>关联知识</DataCardTitle>
                  <DataCardDescription>基于当前文件路径的轻量上下文提示。</DataCardDescription>
                </div>
                <GitBranch className="h-4 w-4 text-muted-foreground" />
              </DataCardHeader>
              <div className="mt-3 space-y-2">
                {(activeFile ? buildRelatedNotebookHints(activeFile, fileExtension) : ['选择文件后显示相关目录、类型和知识入口']).map((hint) => (
                  <div key={hint} className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    {hint}
                  </div>
                ))}
              </div>
            </DataCard>

            <DataCard>
              <DataCardHeader>
                <div className="min-w-0">
                  <DataCardTitle>操作分层</DataCardTitle>
                  <DataCardDescription>
                    文件树负责新建、上传、删除、重命名、复制和移动；编辑器负责保存、历史、分享、下载、目录保存与 AI。
                  </DataCardDescription>
                </div>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </DataCardHeader>
            </DataCard>
          </aside>
        </div>
      </div>
    </div>
  );
}

function formatBytes(value: number | null): string {
  if (value == null) return '未知';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`;
}

function buildRelatedNotebookHints(filePath: string, fileType: string): string[] {
  const directory = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : '根目录';
  const hints = [`同目录上下文：${directory}`, `文件类型：${fileType || 'unknown'}`];
  if (filePath.toLowerCase().endsWith('.cj.md')) hints.push('Cangjie Notebook 文档，可继续使用富文本块、快照和 AI 插入能力');
  if (filePath.startsWith('__builtin__/')) hints.push('内置 Notebook 内容为只读知识入口');
  return hints;
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{value}</span>
    </div>
  );
}

function InspectorCallout({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2 text-xs font-medium">
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{value}</div>
    </div>
  );
}

export default function NotebookPage(props: {
  embedded?: boolean;
  embeddedSearch?: string;
  routeSearch?: NotebookSearch;
  onEmbeddedSearchChange?: (search: string) => void;
} = {}) {
  return (
    <AuthGuard>
      <NotebookPageContent {...props} />
    </AuthGuard>
  );
}

function notebookSearchToParams(search: NotebookSearch): URLSearchParams {
  const params = new URLSearchParams();
  if (search.notebook) params.set('notebook', search.notebook);
  if (search.notebookScope) params.set('notebookScope', search.notebookScope);
  if (search.notebookFile) params.set('notebookFile', search.notebookFile);
  if (search.notebookShare) params.set('notebookShare', search.notebookShare);
  if (search.notebookPermission) params.set('notebookPermission', search.notebookPermission);
  if (search.returnTo) params.set('returnTo', search.returnTo);
  return params;
}

function buildNotebookScopeHref(currentParams: URLSearchParams, scope: NotebookScope): string {
  const params = new URLSearchParams(currentParams.toString());
  params.set('notebook', '1');
  params.set('notebookScope', scope);
  params.delete('notebookFile');
  params.delete('notebookShare');
  params.delete('notebookPermission');
  return `/notebook?${params.toString()}`;
}

function ScopeButton({
  targetScope,
  currentScope,
  href,
}: {
  targetScope: NotebookScope;
  currentScope: NotebookScope;
  href: string;
}) {
  const active = targetScope === currentScope;
  const label = targetScope === 'global' ? '团队' : '个人';
  const Icon = targetScope === 'global' ? Globe2 : User;

  if (active) {
    return (
      <Button variant="secondary" size="sm" disabled className="gap-2">
        <Icon className="h-4 w-4" />
        {label}
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" asChild>
      <Link href={href}>
        <Icon className="mr-2 h-4 w-4" />
        {label}
      </Link>
    </Button>
  );
}
