'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from '@/lib/navigation/client';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Download,
  FolderOpen,
  Loader2,
  Pencil,
  Play,
  Puzzle,
  Plus,
  Search,
  Server,
  Store,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  DataCard,
  DataCardActions,
  DataCardDescription,
  DataCardHeader,
  DataCardMeta,
  DataCardTitle,
} from '@/components/ui/data-card';
import { ActionMenu, type ActionMenuGroup } from '@/components/ui/action-menu';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import {
  DetailDrawer,
  DetailDrawerBody,
  DetailDrawerContent,
  DetailDrawerDescription,
  DetailDrawerFooter,
  DetailDrawerHeader,
  DetailDrawerTitle,
} from '@/components/ui/detail-drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { StatusPill } from '@/components/ui/status-pill';
import { ObjectEditDrawer } from '@/components/ui/object-edit-drawer';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useToast } from '@/components/ui/toast';
import Markdown from '@/components/Markdown';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSidebarPluginPreferences } from '@/hooks/useSidebarPluginPreferences';
import { WorkspaceEditor } from '@/components/workspace/WorkspaceEditor';
import { PaginationBar } from '@/components/PaginationBar';
import { getAllPlugins, unregisterPlugin, type HomePlugin } from '@/lib/sidebar-plugins';
import { cn } from '@/lib/core/utils';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import type { ReturnTarget } from '@/lib/navigation/return-target';
import {
  SkillSearch,
  InstallProgress,
} from '@/components/marketplace';
import type { MarketplaceSkill, InstallProgress as InstallProgressType } from '@/types/marketplace';
import type { ManagedMcpServer, McpTransportType } from '@/lib/mcp/types';
import { DEFAULT_PAGE_SIZE } from '@/constants/marketplace';
import { apiFetch } from '@/client/query/api-client';
import { queryKeys } from '@/client/query/query-keys';
import {
  useDeleteSkillsMutation,
  useExportSkillsMutation,
  useSyncSkillsMutation,
  useSkillsQuery,
  useUploadSkillZipMutation,
  type LocalSkill,
} from '@/client/query/skills';
import {
  useMarketplaceCategoriesQuery,
  useMarketplaceSearchQuery,
} from '@/client/query/marketplace';
import { useLocalSkillRows, useSyncLocalSkillsToDb } from '@/client/db/collections';

interface SyncStatus {
  inInstall: boolean;
  aceharnessBuiltin: boolean;
}

type TabType = 'local' | 'online' | 'mcp' | 'plugins';
type ViewMode = 'gallery' | 'table';
type LocalSortKey = 'name' | 'updatedAt' | 'source';
type SortDirection = 'asc' | 'desc';

interface SkillsManagerProps {
  embedded?: boolean;
  returnTarget?: ReturnTarget;
  initialTab?: TabType;
}

const LOCAL_VIEW_MODE_KEY = 'aceharness:skills:local-view-mode';
const ONLINE_VIEW_MODE_KEY = 'aceharness:skills:online-view-mode';
const MCP_VIEW_MODE_KEY = 'aceharness:skills:mcp-view-mode';
const LOCAL_PAGE_SIZE_KEY = 'aceharness:skills:local-page-size';
const ONLINE_PAGE_SIZE_KEY = 'aceharness:skills:online-page-size';
const MCP_PAGE_SIZE_KEY = 'aceharness:skills:mcp-page-size';
const ACTIVE_TAB_KEY = 'aceharness:skills:active-tab';
const PAGE_SIZE_OPTIONS = [12, 24, 48, 96];

const SOURCE_LABELS: Record<string, string> = {
  'ace-custom': 'ACE 自定义',
  anthropics: 'Anthropics',
};

const SOURCE_ORDER = ['ace-custom', 'anthropics'];

function normalizeSkillSource(skill: Pick<LocalSkill, 'source'>): string {
  return skill.source?.trim() === 'anthropics' ? 'anthropics' : 'ace-custom';
}

function getSourceLabel(source: string): string {
  return SOURCE_LABELS[source] || source;
}

function getSourceTone(source: string): React.ComponentProps<typeof StatusPill>['tone'] {
  if (source === 'anthropics') return 'warning';
  if (source === 'ace-custom') return 'accent';
  return 'neutral';
}

function formatLocalUpdatedAt(value?: string): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatOnlineUpdatedAt(value?: string): string {
  if (!value) return '-';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function normalizeMarketplaceSkillKey(value?: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.git$/i, '')
    .replace(/[_\s]+/g, '-');
}

function PluginsTab() {
  const { toast } = useToast();
  const [plugins, setPlugins] = useState<HomePlugin[]>([]);
  const [deletePluginTarget, setDeletePluginTarget] = useState<HomePlugin | null>(null);
  const { disabledPluginIds, enabledPluginIds, loading, save, version } = useSidebarPluginPreferences();

  useEffect(() => {
    setPlugins(getAllPlugins({ includeDisabled: true }));
  }, [version]);

  const handleToggle = async (pluginId: string) => {
    const plugin = plugins.find((p) => p.id === pluginId);
    if (!plugin) return;

    const pluginEnabled = plugin.enabled !== false;
    let nextDisabledIds = [...disabledPluginIds];
    let nextEnabledIds = [...enabledPluginIds];

    if (pluginEnabled) {
      if (nextEnabledIds.includes(pluginId)) {
        nextEnabledIds = nextEnabledIds.filter((id) => id !== pluginId);
      } else if (!nextDisabledIds.includes(pluginId)) {
        nextDisabledIds.push(pluginId);
      }
    } else if (nextDisabledIds.includes(pluginId)) {
      nextDisabledIds = nextDisabledIds.filter((id) => id !== pluginId);
    } else if (!nextEnabledIds.includes(pluginId)) {
      nextEnabledIds.push(pluginId);
    }

    const nextEnabledSet = new Set(nextEnabledIds);
    nextDisabledIds = nextDisabledIds.filter((id) => !nextEnabledSet.has(id));

    try {
      await save({ disabledPluginIds: nextDisabledIds, enabledPluginIds: nextEnabledIds });
      const next = getAllPlugins({ includeDisabled: true });
      setPlugins(next);
      const nextPlugin = next.find((item) => item.id === pluginId);
      toast('success', `${plugin.name} 已${nextPlugin?.enabled === false ? '禁用' : '启用'}`);
    } catch (error: any) {
      toast('error', error?.message || '保存插件状态失败');
    }
  };

  const confirmDelete = () => {
    const plugin = deletePluginTarget;
    if (!plugin) return;
    unregisterPlugin(plugin.id);
    const next = getAllPlugins({ includeDisabled: true });
    setPlugins(next);
    toast('success', `${plugin.name} 已删除`);
    setDeletePluginTarget(null);
  };
  const pluginColumns: DataTableColumn<HomePlugin>[] = [
    {
      id: 'name',
      header: '插件',
      width: '32%',
      render: (plugin) => (
        <div className="min-w-[180px]">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{plugin.name}</span>
            {plugin.version ? <StatusPill tone="neutral" className="text-xs">{plugin.version}</StatusPill> : null}
            {plugin.enabled === false ? <StatusPill tone="neutral" className="text-xs">已禁用</StatusPill> : null}
          </div>
          {plugin.tab ? <div className="mt-1 text-xs text-muted-foreground">Tab: {plugin.tab.label}</div> : null}
        </div>
      ),
    },
    {
      id: 'capabilities',
      header: '能力',
      render: (plugin) => (
        <div className="flex flex-wrap gap-1.5">
          {plugin.capabilities.map((cap) => (
            <StatusPill key={cap} tone="neutral" dot={false} className="h-5 px-1.5 py-0 text-[10px]">{cap}</StatusPill>
          ))}
        </div>
      ),
      priority: 2,
    },
    {
      id: 'actions',
      header: '快捷操作',
      accessor: (plugin) => plugin.actions?.items?.map((action) => action.label).join('、') || '-',
      className: 'text-sm text-muted-foreground',
      priority: 3,
    },
  ];
  const getPluginActions = (plugin: HomePlugin): ActionMenuGroup[] => [
    {
      actions: [
        {
          id: 'toggle',
          label: plugin.enabled !== false ? '禁用' : '启用',
          primary: plugin.enabled === false,
          inline: plugin.enabled === false,
          disabled: loading,
          onSelect: () => void handleToggle(plugin.id),
        },
        {
          id: 'delete',
          label: '删除',
          icon: <Trash2 className="h-4 w-4" />,
          destructive: true,
          onSelect: () => setDeletePluginTarget(plugin),
        },
      ],
    },
  ];

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-none">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold">侧边栏插件</h3>
          <p className="text-sm text-muted-foreground mt-1">管理首页侧边栏的功能插件，包括快捷操作、Tab 面板和主题</p>
        </div>
      </div>

      <DataTable
        aria-label="侧边栏插件列表"
        columns={pluginColumns}
        rows={plugins}
        rowKey="id"
        density="comfortable"
        rowActions={(plugin) => getPluginActions(plugin)}
        emptyState={{
          icon: <Puzzle className="h-5 w-5" />,
          title: '暂无已注册的侧边栏插件',
          description: '侧边栏插件会在这里统一管理启用、禁用和删除。',
        }}
      />

      <div className="mt-6 rounded-xl border border-dashed border-border bg-background p-4 text-xs text-muted-foreground leading-6">
        <p className="font-medium text-foreground mb-1">如何添加新插件</p>
        <p>1. 在 <code className="bg-muted px-1 rounded">src/plugins/</code> 下创建插件目录</p>
        <p>2. 使用 <code className="bg-muted px-1 rounded">definePlugin()</code> 定义插件配置</p>
        <p>3. 在 <code className="bg-muted px-1 rounded">src/lib/sidebar-plugins/registry.ts</code> 中注册</p>
        <p>4. 详见 <code className="bg-muted px-1 rounded">docs/sidebar-plugins/README.md</code></p>
      </div>
      <ConfirmModal
        open={Boolean(deletePluginTarget)}
        variant="delete"
        title="删除侧边栏插件"
        objectName={deletePluginTarget?.name}
        consequence="删除后该插件会从侧边栏注册表中移除。"
        confirmLabel="删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeletePluginTarget(null)}
        onOpenChange={(open) => {
          if (!open) setDeletePluginTarget(null);
        }}
      />
    </section>
  );
}

type McpServerDraft = {
  name: string;
  type: McpTransportType;
  command: string;
  url: string;
  envText: string;
  headersText: string;
};

type McpToolSummary = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type McpPromptSummary = {
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
};

type McpResourceSummary = {
  name?: string;
  uri?: string;
  description?: string;
  mimeType?: string;
};

type McpResourceTemplateSummary = {
  name?: string;
  uriTemplate?: string;
  description?: string;
  mimeType?: string;
};

type McpDiscoverResponse = {
  success: true;
  mode: 'discover';
  server: {
    name: string;
    type?: McpTransportType;
    command?: string;
    url?: string;
  };
  workingDirectory: string;
  serverInfo?: {
    name?: string;
    version?: string;
  };
  capabilities: {
    tools: boolean;
    prompts: boolean;
    resources: boolean;
  };
  tools: McpToolSummary[];
  prompts: McpPromptSummary[];
  resources: McpResourceSummary[];
  resourceTemplates: McpResourceTemplateSummary[];
  stderr?: string;
  durationMs: number;
};

type McpTestErrorDetails = {
  message?: string;
  hint?: string;
  phase?: string;
  code?: string;
  command?: string;
  args?: string[];
  url?: string;
  cwd?: string;
  stderr?: string;
};

type McpTestErrorState = string | McpTestErrorDetails;

function formatMcpEnv(env?: Record<string, string>): string {
  return env && Object.keys(env).length > 0 ? JSON.stringify(env, null, 2) : '';
}

function toMcpDraft(server?: Partial<ManagedMcpServer>): McpServerDraft {
  return {
    name: server?.name || '',
    type: server?.type || 'stdio',
    command: server?.command || '',
    url: server?.url || '',
    envText: formatMcpEnv(server?.env),
    headersText: formatMcpEnv(server?.headers),
  };
}

function normalizeMcpServer(server: McpServerDraft): ManagedMcpServer {
  if (server.type === 'stdio') {
    const env = parseMcpRecord(server.envText, 'ENV');
    return {
      name: server.name.trim(),
      type: server.type,
      command: server.command.trim(),
      ...(env ? { env } : {}),
    };
  }
  const headers = parseMcpRecord(server.headersText, '请求头');
  return {
    name: server.name.trim(),
    type: server.type,
    url: server.url.trim(),
    ...(headers ? { headers } : {}),
  };
}

function parseMcpRecord(text: string, label: string): Record<string, string> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([key]) => key.trim().length > 0)
      .map(([key, value]) => [key.trim(), String(value)]),
  );
}

function getMcpRecordStatus(text: string, label: string): { count: number; valid: boolean } {
  if (!text.trim()) return { count: 0, valid: true };
  try {
    return { count: Object.keys(parseMcpRecord(text, label) || {}).length, valid: true };
  } catch {
    return { count: 0, valid: false };
  }
}

function getMcpEndpoint(server: ManagedMcpServer): string {
  return server.type === 'stdio' ? server.command || '' : server.url || '';
}

function getMcpTransportLabel(type?: McpTransportType): string {
  if (type === 'streamable-http') return 'Streamable HTTP';
  if (type === 'sse') return 'SSE';
  return 'stdio';
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getMcpEnvPreview(env?: Record<string, string>): string {
  const keys = Object.keys(env || {});
  if (keys.length === 0) return '未设置';
  if (keys.length <= 3) return keys.join(', ');
  return `${keys.slice(0, 3).join(', ')} +${keys.length - 3}`;
}

function McpServerEditorDialog({
  open,
  mode,
  draft,
  saving,
  onOpenChange,
  onDraftChange,
  onSubmit,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  draft: McpServerDraft;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (patch: Partial<McpServerDraft>) => void;
  onSubmit: () => void;
}) {
  const envStatus = getMcpRecordStatus(draft.envText, 'ENV');
  const headersStatus = getMcpRecordStatus(draft.headersText, '请求头');
  const isStdio = draft.type === 'stdio';

  return (
    <ObjectEditDrawer
      open={open}
      mode={mode}
      title={mode === 'create' ? '新增 MCP Server' : '编辑 MCP Server'}
      subtitle="这里只维护 MCP 服务本身的定义。工作目录会在聊天、工作流或测试时按调用上下文提供。"
      saving={saving}
      onOpenChange={(nextOpen) => {
        if (!saving) onOpenChange(nextOpen);
      }}
      cancelAction={{ label: '取消', onClick: () => onOpenChange(false), disabled: saving }}
      saveAction={{
        label: saving ? '保存中...' : mode === 'create' ? '创建' : '保存',
        onClick: onSubmit,
        disabled: saving,
      }}
      sections={[
        {
          id: 'identity',
          title: '基础信息',
          content: (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">名称</label>
                <Input value={draft.name} onChange={(event) => onDraftChange({ name: event.target.value })} placeholder="filesystem" />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">连接类型</label>
                <Select
                  value={draft.type}
                  onValueChange={(value) => onDraftChange({ type: value as McpTransportType })}
                  disabled={saving}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdio">stdio 本地命令</SelectItem>
                    <SelectItem value="streamable-http">Streamable HTTP</SelectItem>
                    <SelectItem value="sse">SSE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isStdio ? (
                <div className="grid gap-2">
                  <label className="text-sm font-medium">启动命令</label>
                  <Input
                    value={draft.command}
                    onChange={(event) => onDraftChange({ command: event.target.value })}
                    placeholder="npx -y @modelcontextprotocol/server-filesystem ."
                    className="font-mono"
                  />
                </div>
              ) : (
                <div className="grid gap-2">
                  <label className="text-sm font-medium">服务地址</label>
                  <Input
                    value={draft.url}
                    onChange={(event) => onDraftChange({ url: event.target.value })}
                    placeholder={draft.type === 'sse' ? 'http://localhost:3001/sse' : 'http://localhost:3001/mcp'}
                    className="font-mono"
                  />
                </div>
              )}
            </div>
          ),
        },
        isStdio ? {
          id: 'env',
          title: '环境变量',
          description: envStatus.valid
            ? envStatus.count > 0 ? `共 ${envStatus.count} 个变量` : '未设置环境变量'
            : 'JSON 格式无效',
          content: (
            <Textarea
              value={draft.envText}
              onChange={(event) => onDraftChange({ envText: event.target.value })}
              placeholder='{"API_KEY":"..."}'
              className="min-h-32 font-mono text-xs"
            />
          ),
        } : {
          id: 'headers',
          title: '请求头',
          description: headersStatus.valid
            ? headersStatus.count > 0 ? `共 ${headersStatus.count} 个请求头` : '未设置请求头'
            : 'JSON 格式无效',
          content: (
            <Textarea
              value={draft.headersText}
              onChange={(event) => onDraftChange({ headersText: event.target.value })}
              placeholder='{"Authorization":"Bearer ..."}'
              className="min-h-32 font-mono text-xs"
            />
          ),
        },
      ]}
    />
  );
}

function McpServerTestDialog({
  open,
  server,
  workingDirectory,
  testing,
  result,
  error,
  onOpenChange,
  onWorkingDirectoryChange,
  onRunTest,
}: {
  open: boolean;
  server: ManagedMcpServer | null;
  workingDirectory: string;
  testing: boolean;
  result: McpDiscoverResponse | null;
  error: McpTestErrorState | null;
  onOpenChange: (open: boolean) => void;
  onWorkingDirectoryChange: (value: string) => void;
  onRunTest: () => void;
}) {
  const tools = result?.tools || [];
  const prompts = result?.prompts || [];
  const resources = result?.resources || [];
  const resourceTemplates = result?.resourceTemplates || [];
  const errorDetails = error && typeof error === 'object' ? error : null;
  const errorMessage = typeof error === 'string' ? error : errorDetails?.message;
  const errorArgs = errorDetails?.args?.length ? errorDetails.args.join(' ') : null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!testing) onOpenChange(nextOpen);
    }}>
      <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>测试 MCP Server</DialogTitle>
          <DialogDescription>
            这里只做 MCP 连接、自检和能力发现，用于确认服务定义是否可用。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(88vh-146px)] overflow-y-auto px-6 py-5">
          <div className="grid gap-4">
            <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{server?.name || '未选择 Server'}</div>
                  <div className="mt-2 break-all rounded-xl bg-background/80 px-3 py-2 font-mono text-xs text-muted-foreground">
                    {server ? getMcpEndpoint(server) || '-' : '-'}
                  </div>
                </div>
                <Badge variant="outline" className="text-xs">{getMcpTransportLabel(server?.type)}</Badge>
              </div>

              {server?.type === 'stdio' ? (
                <div className="mt-4 grid gap-2">
                  <label className="text-sm font-medium">测试工作目录</label>
                  <Input
                    value={workingDirectory}
                    onChange={(event) => onWorkingDirectoryChange(event.target.value)}
                    placeholder="留空则使用当前 workspace 根目录"
                    className="font-mono"
                    disabled={testing}
                  />
                  <p className="text-xs text-muted-foreground">
                    这里模拟实际调用时的上下文目录。MCP 本身不再存项目目录配置。
                  </p>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={onRunTest} disabled={testing || !server}>
                {testing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    测试中...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    开始测试
                  </>
                )}
              </Button>
              {result ? (
                <span className="text-xs text-muted-foreground">
                  最近一次完成耗时 {result.durationMs} ms
                </span>
              ) : null}
            </div>

            {error ? (
              <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                <div className="font-medium">测试失败</div>
                {errorDetails ? (
                  <div className="mt-3 grid gap-3 text-xs">
                    <div>
                      <div className="font-medium">消息</div>
                      <div className="mt-1 whitespace-pre-wrap break-words text-destructive/90">
                        {errorMessage || 'MCP 测试失败'}
                      </div>
                      {(errorDetails.phase || errorDetails.code) ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {errorDetails.phase ? <Badge variant="outline" className="text-[10px]">phase {errorDetails.phase}</Badge> : null}
                          {errorDetails.code ? <Badge variant="outline" className="text-[10px]">code {errorDetails.code}</Badge> : null}
                        </div>
                      ) : null}
                    </div>
                    {errorDetails.hint ? (
                      <div>
                        <div className="font-medium">建议</div>
                        <div className="mt-1 whitespace-pre-wrap break-words text-destructive/90">{errorDetails.hint}</div>
                      </div>
                    ) : null}
                    {errorDetails.command ? (
                      <div>
                        <div className="font-medium">命令</div>
                        <pre className="mt-1 whitespace-pre-wrap break-words rounded-xl bg-background/80 p-3 font-mono text-[11px] text-foreground">
                          {errorDetails.command}
                        </pre>
                      </div>
                    ) : null}
                    {errorDetails.url ? (
                      <div>
                        <div className="font-medium">服务地址</div>
                        <pre className="mt-1 whitespace-pre-wrap break-words rounded-xl bg-background/80 p-3 font-mono text-[11px] text-foreground">
                          {errorDetails.url}
                        </pre>
                      </div>
                    ) : null}
                    {errorArgs ? (
                      <div>
                        <div className="font-medium">参数</div>
                        <pre className="mt-1 whitespace-pre-wrap break-words rounded-xl bg-background/80 p-3 font-mono text-[11px] text-foreground">
                          {errorArgs}
                        </pre>
                      </div>
                    ) : null}
                    {errorDetails.cwd ? (
                      <div>
                        <div className="font-medium">工作目录</div>
                        <pre className="mt-1 whitespace-pre-wrap break-words rounded-xl bg-background/80 p-3 font-mono text-[11px] text-foreground">
                          {errorDetails.cwd}
                        </pre>
                      </div>
                    ) : null}
                    {errorDetails.stderr ? (
                      <div>
                        <div className="font-medium">stderr</div>
                        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-background/80 p-3 font-mono text-[11px] text-foreground">
                          {errorDetails.stderr}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs">{errorMessage}</pre>
                )}
              </div>
            ) : null}

            {result ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                    <div className="text-xs text-muted-foreground">工作目录</div>
                    <div className="mt-2 break-all font-mono text-xs">{result.workingDirectory}</div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                    <div className="text-xs text-muted-foreground">服务端信息</div>
                    <div className="mt-2 text-sm font-medium">
                      {result.serverInfo?.name || server?.name || '-'}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {result.serverInfo?.version || '未返回版本'}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                    <div className="text-xs text-muted-foreground">能力</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge variant={result.capabilities.tools ? 'outline' : 'secondary'} className="text-xs">Tools</Badge>
                      <Badge variant={result.capabilities.prompts ? 'outline' : 'secondary'} className="text-xs">Prompts</Badge>
                      <Badge variant={result.capabilities.resources ? 'outline' : 'secondary'} className="text-xs">Resources</Badge>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                    <div className="text-xs text-muted-foreground">发现结果</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-xs">Tools {tools.length}</Badge>
                      <Badge variant="outline" className="text-xs">Prompts {prompts.length}</Badge>
                      <Badge variant="outline" className="text-xs">Resources {resources.length}</Badge>
                      <Badge variant="outline" className="text-xs">Templates {resourceTemplates.length}</Badge>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold">Tools</h4>
                      <Badge variant="outline" className="text-xs">{tools.length}</Badge>
                    </div>
                    {tools.length === 0 ? (
                      <div className="text-sm text-muted-foreground">未暴露可发现的工具。</div>
                    ) : (
                      <div className="space-y-3">
                        {tools.map((tool) => (
                          <div key={tool.name} className="rounded-xl border border-border/60 bg-muted/15 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-sm font-medium">{tool.name}</span>
                              {tool.title ? (
                                <Badge variant="secondary" className="text-[10px]">{tool.title}</Badge>
                              ) : null}
                            </div>
                            {tool.description ? (
                              <p className="mt-2 text-xs leading-5 text-muted-foreground">{tool.description}</p>
                            ) : null}
                            {tool.inputSchema ? (
                              <pre className="mt-3 overflow-auto rounded-xl border bg-background/80 p-3 font-mono text-[11px] leading-5">
                                {safeJsonStringify(tool.inputSchema)}
                              </pre>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid gap-4">
                    <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold">Prompts</h4>
                        <Badge variant="outline" className="text-xs">{prompts.length}</Badge>
                      </div>
                      {prompts.length === 0 ? (
                        <div className="text-sm text-muted-foreground">未暴露 Prompt 列表。</div>
                      ) : (
                        <div className="space-y-3">
                          {prompts.map((prompt) => (
                            <div key={prompt.name} className="rounded-xl border border-border/60 bg-muted/15 p-3">
                              <div className="font-mono text-sm font-medium">{prompt.name}</div>
                              {prompt.description ? (
                                <p className="mt-2 text-xs leading-5 text-muted-foreground">{prompt.description}</p>
                              ) : null}
                              {prompt.arguments && prompt.arguments.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {prompt.arguments.map((arg) => (
                                    <Badge key={arg.name} variant="outline" className="text-[10px]">
                                      {arg.name}{arg.required ? ' *' : ''}
                                    </Badge>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold">Resources</h4>
                        <Badge variant="outline" className="text-xs">{resources.length}</Badge>
                      </div>
                      {resources.length === 0 ? (
                        <div className="text-sm text-muted-foreground">未暴露 Resource 列表。</div>
                      ) : (
                        <div className="space-y-3">
                          {resources.map((resource, index) => (
                            <div key={`${resource.uri || resource.name || 'resource'}-${index}`} className="rounded-xl border border-border/60 bg-muted/15 p-3">
                              <div className="font-mono text-sm font-medium">{resource.name || resource.uri || '未命名资源'}</div>
                              {resource.uri ? (
                                <div className="mt-2 break-all text-xs text-muted-foreground">{resource.uri}</div>
                              ) : null}
                              {resource.description ? (
                                <p className="mt-2 text-xs leading-5 text-muted-foreground">{resource.description}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold">Resource Templates</h4>
                        <Badge variant="outline" className="text-xs">{resourceTemplates.length}</Badge>
                      </div>
                      {resourceTemplates.length === 0 ? (
                        <div className="text-sm text-muted-foreground">未暴露 Resource Template 列表。</div>
                      ) : (
                        <div className="space-y-3">
                          {resourceTemplates.map((template, index) => (
                            <div key={`${template.uriTemplate || template.name || 'template'}-${index}`} className="rounded-xl border border-border/60 bg-muted/15 p-3">
                              <div className="font-mono text-sm font-medium">{template.name || template.uriTemplate || '未命名模板'}</div>
                              {template.uriTemplate ? (
                                <div className="mt-2 break-all text-xs text-muted-foreground">{template.uriTemplate}</div>
                              ) : null}
                              {template.description ? (
                                <p className="mt-2 text-xs leading-5 text-muted-foreground">{template.description}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {result.stderr ? (
                  <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                    <div className="text-sm font-semibold">stderr</div>
                    <pre className="mt-3 overflow-auto rounded-xl border bg-background/80 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
                      {result.stderr}
                    </pre>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={testing}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function McpServersTab() {
  const { toast } = useToast();
  const [servers, setServers] = useState<ManagedMcpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editorDraft, setEditorDraft] = useState<McpServerDraft>(toMcpDraft());
  const [editingServerName, setEditingServerName] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testingServer, setTestingServer] = useState<ManagedMcpServer | null>(null);
  const [testWorkingDirectory, setTestWorkingDirectory] = useState('');
  const [lastTestWorkingDirectory, setLastTestWorkingDirectory] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<McpDiscoverResponse | null>(null);
  const [testError, setTestError] = useState<McpTestErrorState | null>(null);
  const [pendingEnvSave, setPendingEnvSave] = useState<ManagedMcpServer[] | null>(null);
  const [pendingEnvSaveMessage, setPendingEnvSaveMessage] = useState('');
  const [deleteServerTarget, setDeleteServerTarget] = useState<ManagedMcpServer | null>(null);

  useEffect(() => {
    try {
      const savedViewMode = localStorage.getItem(MCP_VIEW_MODE_KEY);
      if (savedViewMode === 'gallery' || savedViewMode === 'table') {
        setViewMode(savedViewMode);
      }
      const savedPageSize = Number(localStorage.getItem(MCP_PAGE_SIZE_KEY) || DEFAULT_PAGE_SIZE);
      if (PAGE_SIZE_OPTIONS.includes(savedPageSize)) setPageSize(savedPageSize);
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(MCP_VIEW_MODE_KEY, viewMode); } catch {}
  }, [viewMode]);

  useEffect(() => {
    try { localStorage.setItem(MCP_PAGE_SIZE_KEY, String(pageSize)); } catch {}
  }, [pageSize]);

  const loadServers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/mcp');
      const data = await response.json();
      setServers(Array.isArray(data.servers) ? data.servers : []);
    } catch {
      toast('error', '加载 MCP 配置失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize]);

  const persistServers = useCallback(async (nextServers: ManagedMcpServer[], successMessage: string) => {
    setSaving(true);
    try {
      const response = await fetch('/api/mcp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers: nextServers }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        toast('error', data.error || '保存 MCP 配置失败');
        return false;
      }
      const savedServers = Array.isArray(data.servers) ? data.servers : [];
      setServers(savedServers);
      toast('success', successMessage);
      return true;
    } catch (error: any) {
      toast('error', error?.message || '保存 MCP 配置失败');
      return false;
    } finally {
      setSaving(false);
    }
  }, [toast]);

  const openCreateDialog = () => {
    setEditorMode('create');
    setEditingServerName(null);
    setEditorDraft(toMcpDraft());
    setEditorOpen(true);
  };

  const openEditDialog = (server: ManagedMcpServer) => {
    setEditorMode('edit');
    setEditingServerName(server.name);
    setEditorDraft(toMcpDraft(server));
    setEditorOpen(true);
  };

  const handleEditorSubmit = async () => {
    const trimmedName = editorDraft.name.trim();
    const trimmedCommand = editorDraft.command.trim();
    const trimmedUrl = editorDraft.url.trim();
    if (!trimmedName) {
      toast('error', '请先填写 MCP Server 名称');
      return;
    }
    if (editorDraft.type === 'stdio' && !trimmedCommand) {
      toast('error', '请先填写启动命令');
      return;
    }
    if (editorDraft.type !== 'stdio') {
      if (!trimmedUrl) {
        toast('error', '请先填写服务地址');
        return;
      }
      try {
        const parsedUrl = new URL(trimmedUrl);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          toast('error', '服务地址需要使用 http:// 或 https://');
          return;
        }
      } catch {
        toast('error', '服务地址格式无效');
        return;
      }
    }

    let normalized: ManagedMcpServer;
    try {
      normalized = normalizeMcpServer(editorDraft);
    } catch (error: any) {
      toast('error', error?.message || 'MCP 配置无效');
      return;
    }

    const duplicated = servers.some((server) => server.name === trimmedName && server.name !== editingServerName);
    if (duplicated) {
      toast('error', `已存在同名 MCP Server: ${trimmedName}`);
      return;
    }

    const secretCount = Object.keys(normalized.env || normalized.headers || {}).length;
    const nextServers = editorMode === 'create'
      ? [...servers, normalized]
      : servers.some((server) => server.name === editingServerName)
        ? servers.map((server) => (server.name === editingServerName ? normalized : server))
        : [...servers, normalized];

    if (secretCount > 0) {
      setPendingEnvSave(nextServers);
      setPendingEnvSaveMessage(editorMode === 'create' ? 'MCP Server 已添加' : 'MCP Server 已更新');
      return;
    }

    const success = await persistServers(
      nextServers,
      editorMode === 'create' ? 'MCP Server 已添加' : 'MCP Server 已更新',
    );
    if (success) {
      setEditorOpen(false);
    }
  };

  const confirmDeleteServer = async () => {
    if (!deleteServerTarget) return;
    await persistServers(
      servers.filter((item) => item.name !== deleteServerTarget.name),
      'MCP Server 已删除',
    );
    setDeleteServerTarget(null);
  };

  const openTestDialog = (server: ManagedMcpServer) => {
    setTestingServer(server);
    setTestWorkingDirectory(lastTestWorkingDirectory);
    setTestResult(null);
    setTestError(null);
    setTestOpen(true);
  };

  const runServerTest = async () => {
    if (!testingServer) return;
    setTesting(true);
    setTestError(null);
    setTestResult(null);

    const workingDirectory = testWorkingDirectory.trim();
    try {
      const response = await fetch('/api/mcp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: testingServer.name,
          ...(workingDirectory ? { workingDirectory } : {}),
        }),
      });
      const responseText = await response.text();
      let data: any = null;
      if (responseText.trim()) {
        try {
          data = JSON.parse(responseText);
        } catch {
          const preview = responseText.trim().slice(0, 600);
          setTestError({
            message: `HTTP ${response.status} ${response.statusText || '响应解析失败'}`,
            hint: '服务返回了文本响应，请查看摘要并检查开发服务器或 API 路由日志。',
            phase: 'connect',
            code: 'NON_JSON_RESPONSE',
            stderr: preview,
          });
          return;
        }
      }
      if (!response.ok || data.error) {
        setTestError(data?.error || {
          message: `HTTP ${response.status} ${response.statusText || 'MCP 测试失败'}`,
          hint: '查看 API 路由日志，并确认 MCP Server 配置和测试工作目录。',
          phase: 'connect',
          code: 'HTTP_ERROR',
        });
        return;
      }
      if (!data) {
        setTestError({
          message: `HTTP ${response.status} 返回了空响应`,
          hint: '查看 API 路由日志，并确认 MCP 测试接口完成后返回 JSON 结果。',
          phase: 'connect',
          code: 'EMPTY_RESPONSE',
        });
        return;
      }
      setTestResult(data as McpDiscoverResponse);
      if (workingDirectory) {
        setLastTestWorkingDirectory(workingDirectory);
      }
      toast('success', 'MCP 测试完成');
    } catch (error: any) {
      setTestError(error?.message || 'MCP 测试失败');
    } finally {
      setTesting(false);
    }
  };

  const filteredServers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return servers
      .map((server) => ({ server }))
      .filter(({ server }) => {
        if (!query) return true;
        return [
          server.name,
          server.type,
          getMcpEndpoint(server),
          formatMcpEnv(server.env),
          formatMcpEnv(server.headers),
        ].join(' ').toLowerCase().includes(query);
      });
  }, [searchQuery, servers]);

  const pagination = useMemo(() => {
    const total = filteredServers.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const end = start + pageSize;
    return {
      total,
      totalPages,
      page: safePage,
      pageSize,
      items: filteredServers.slice(start, end),
    };
  }, [filteredServers, page, pageSize]);

  useEffect(() => {
    if (page !== pagination.page) {
      setPage(pagination.page);
    }
  }, [page, pagination.page]);

  const handleApplySearch = () => {
    setSearchQuery(searchDraft);
  };
  const mcpTableColumns: DataTableColumn<{ server: ManagedMcpServer }>[] = [
    {
      id: 'name',
      header: '名称',
      width: '18%',
      render: ({ server }) => <div className="font-medium">{server.name}</div>,
    },
    {
      id: 'endpoint',
      header: '连接信息',
      width: '42%',
      render: ({ server }) => <div className="break-all font-mono text-xs text-muted-foreground">{getMcpEndpoint(server)}</div>,
    },
    {
      id: 'secrets',
      header: 'ENV / 请求头',
      priority: 2,
      render: ({ server }) => {
        const record = server.type === 'stdio' ? server.env : server.headers;
        const recordCount = Object.keys(record || {}).length;
        return (
          <div className="space-y-2">
            <StatusPill tone={recordCount > 0 ? 'warning' : 'neutral'} className="text-xs">
              {recordCount > 0 ? `${server.type === 'stdio' ? 'ENV' : 'Headers'} ${recordCount}` : '未设置'}
            </StatusPill>
            <div className="text-xs text-muted-foreground">{getMcpEnvPreview(record)}</div>
          </div>
        );
      },
    },
    {
      id: 'type',
      header: '类型',
      render: ({ server }) => <StatusPill tone="info" className="text-xs">{getMcpTransportLabel(server.type)}</StatusPill>,
      priority: 3,
    },
  ];
  const getMcpRowActions = (server: ManagedMcpServer): ActionMenuGroup[] => [
    {
      actions: [
        { id: 'edit', label: '编辑', icon: <Pencil className="h-4 w-4" />, disabled: saving, onSelect: () => openEditDialog(server) },
        { id: 'test', label: '测试', icon: <Play className="h-4 w-4" />, primary: true, disabled: saving, onSelect: () => openTestDialog(server) },
        { id: 'delete', label: '删除', icon: <Trash2 className="h-4 w-4" />, destructive: true, disabled: saving, onSelect: () => setDeleteServerTarget(server) },
      ],
    },
  ];

  return (
    <>
      <PageToolbar
        className="rounded-xl border border-border bg-card px-4"
        search={(
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索 MCP Servers..."
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleApplySearch();
                  }
                }}
                className="h-10 w-full bg-background pl-10"
              />
            </div>
            <Button size="sm" onClick={handleApplySearch} className="h-10 shrink-0" variant="outline">
              <Search className="mr-1 h-4 w-4" />
              搜索
            </Button>
          </div>
        )}
        viewToggle={(
          <div className="inline-flex rounded-lg border border-border bg-background p-1">
              <Button
                size="sm"
                variant={viewMode === 'gallery' ? 'secondary' : 'ghost'}
                className="h-8 px-3"
                onClick={() => setViewMode('gallery')}
              >
                <span className="material-symbols-outlined text-sm">grid_view</span>
              </Button>
              <Button
                size="sm"
                variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                className="h-8 px-3"
                onClick={() => setViewMode('table')}
              >
                <span className="material-symbols-outlined text-sm">table_rows</span>
              </Button>
          </div>
        )}
        actions={(
            <Button size="sm" onClick={openCreateDialog} disabled={saving} variant="outline">
              <Plus className="mr-1 h-4 w-4" />
              添加
            </Button>
        )}
      />

      <section className="rounded-xl border border-border bg-card p-4 shadow-none">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">MCP Servers</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              已配置 {servers.length} 个，当前列表 {pagination.total} 个。工作目录在聊天、工作流或测试时按调用上下文提供。
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">加载中...</div>
        ) : servers.length === 0 ? (
          <EmptyState
            icon={<Server className="h-5 w-5" />}
            title="暂无 MCP Server"
            description="添加 stdio MCP Server 后，可在聊天、工作流或测试时按上下文调用。"
            primaryAction={<Button size="sm" variant="outline" onClick={openCreateDialog}>添加 Server</Button>}
          />
        ) : pagination.total === 0 ? (
          <EmptyState icon={<Server className="h-5 w-5" />} title="没有匹配的 MCP Server" />
        ) : viewMode === 'table' ? (
          <DataTable
            aria-label="MCP Server 列表"
            columns={mcpTableColumns}
            rows={pagination.items}
            rowKey={({ server }) => server.name}
            density="comfortable"
            onRowClick={({ server }) => openEditDialog(server)}
            rowActions={({ server }) => getMcpRowActions(server)}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {pagination.items.map(({ server }) => {
              const record = server.type === 'stdio' ? server.env : server.headers;
              const recordCount = Object.keys(record || {}).length;
              return (
                <DataCard
                  key={server.name}
                >
                  <DataCardHeader className="mb-4">
                    <div className="flex min-w-0 items-start gap-2">
                      <Server className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <DataCardTitle>{server.name}</DataCardTitle>
                        <DataCardMeta className="mt-1">
                          <StatusPill tone="info" className="text-xs">{getMcpTransportLabel(server.type)}</StatusPill>
                          <StatusPill tone={recordCount > 0 ? 'warning' : 'neutral'} className="text-xs">
                            {recordCount > 0 ? `${server.type === 'stdio' ? 'ENV' : 'Headers'} ${recordCount}` : '无凭据'}
                          </StatusPill>
                        </DataCardMeta>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="h-8 w-8 shrink-0 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteServerTarget(server)} title="删除" disabled={saving}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </DataCardHeader>
                  <div className="space-y-4">
                    <div className="rounded-xl border border-border bg-background p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {server.type === 'stdio' ? 'Command' : 'URL'}
                      </div>
                      <div className="mt-2 break-all font-mono text-xs text-muted-foreground">{getMcpEndpoint(server)}</div>
                    </div>
                    <div className="rounded-xl border border-border bg-background p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {server.type === 'stdio' ? 'ENV' : 'Headers'}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">{getMcpEnvPreview(record)}</div>
                    </div>
                    <DataCardActions className="justify-start">
                      <Button size="sm" variant="outline" className="h-8" onClick={() => openEditDialog(server)} disabled={saving}>
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                        编辑
                      </Button>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => openTestDialog(server)} disabled={saving}>
                        <Play className="mr-1.5 h-3.5 w-3.5" />
                        测试
                      </Button>
                    </DataCardActions>
                  </div>
                </DataCard>
              );
            })}
          </div>
        )}
      </section>

      {pagination.total > 0 ? (
        <PaginationBar
          current={pagination.page}
          total={pagination.total}
          pageSize={pagination.pageSize}
          onPageChange={setPage}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          itemLabel="MCP Server"
        />
      ) : null}

      <McpServerEditorDialog
        open={editorOpen}
        mode={editorMode}
        draft={editorDraft}
        saving={saving}
        onOpenChange={setEditorOpen}
        onDraftChange={(patch) => setEditorDraft((prev) => ({ ...prev, ...patch }))}
        onSubmit={() => void handleEditorSubmit()}
      />

      <McpServerTestDialog
        open={testOpen}
        server={testingServer}
        workingDirectory={testWorkingDirectory}
        testing={testing}
        result={testResult}
        error={testError}
        onOpenChange={setTestOpen}
        onWorkingDirectoryChange={setTestWorkingDirectory}
        onRunTest={() => void runServerTest()}
      />

      <ConfirmModal
        open={Boolean(pendingEnvSave)}
        variant="credential"
        title={editorDraft.type === 'stdio' ? '确认保存 MCP ENV' : '确认保存 MCP 请求头'}
        objectName={editorDraft.name.trim()}
        consequence={`该 MCP Server 将保存 ${
          editorDraft.type === 'stdio'
            ? getMcpRecordStatus(editorDraft.envText, 'ENV').count
            : getMcpRecordStatus(editorDraft.headersText, '请求头').count
        } 个${editorDraft.type === 'stdio' ? '环境变量' : '请求头'}。请确认其中包含的凭据只用于本机配置。`}
        confirmLabel="确认保存"
        loading={saving}
        onConfirm={async () => {
          if (!pendingEnvSave) return;
          const success = await persistServers(pendingEnvSave, pendingEnvSaveMessage);
          if (success) {
            setEditorOpen(false);
            setPendingEnvSave(null);
          }
        }}
        onCancel={() => setPendingEnvSave(null)}
        onOpenChange={(open) => {
          if (!open) setPendingEnvSave(null);
        }}
      />
      <ConfirmModal
        open={Boolean(deleteServerTarget)}
        variant="delete"
        title="删除 MCP Server"
        objectName={deleteServerTarget?.name}
        consequence="删除后将移除该 MCP Server 配置，此操作无法撤销。"
        confirmLabel="删除"
        loading={saving}
        onConfirm={confirmDeleteServer}
        onCancel={() => setDeleteServerTarget(null)}
        onOpenChange={(open) => {
          if (!open) setDeleteServerTarget(null);
        }}
      />
    </>
  );
}

export default function SkillsManager({
  embedded = false,
  returnTarget = { href: '/dashboard', label: '返回仪表盘' },
  initialTab = 'local',
}: SkillsManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  useDocumentTitle(embedded ? null : 'Skills/MCP 管理');

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  const [searchQuery, setSearchQuery] = useState('');
  const [embeddedSearchDraft, setEmbeddedSearchDraft] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<LocalSkill | null>(null);
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [syncingAllBuiltin, setSyncingAllBuiltin] = useState(false);
  const [syncingSkillNames, setSyncingSkillNames] = useState<Set<string>>(new Set());
  const [localViewMode, setLocalViewMode] = useState<ViewMode>('table');
  const [localSortKey, setLocalSortKey] = useState<LocalSortKey>('updatedAt');
  const [localSortDirection, setLocalSortDirection] = useState<SortDirection>('desc');
  const [localPage, setLocalPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(DEFAULT_PAGE_SIZE);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [onlineSkills, setOnlineSkills] = useState<MarketplaceSkill[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [onlineViewMode, setOnlineViewMode] = useState<ViewMode>('gallery');
  const [onlinePage, setOnlinePage] = useState(1);
  const [onlinePageSize, setOnlinePageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalItems, setTotalItems] = useState(0);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<InstallProgressType>({
    skillName: '',
    status: 'downloading',
    progress: 0,
    message: '',
  });
  const [selectedOnlineSkill, setSelectedOnlineSkill] = useState<MarketplaceSkill | null>(null);
  const [deleteSkillNames, setDeleteSkillNames] = useState<string[]>([]);
  const [installSkillName, setInstallSkillName] = useState<string | null>(null);
  const skillsQuery = useSkillsQuery({ enabled: activeTab === 'local' || activeTab === 'online' });
  const marketplaceSearchParams = useMemo(() => ({
    keyword: searchKeyword,
    category: selectedCategory,
    pageNum: onlinePage,
    pageSize: onlinePageSize,
  }), [onlinePage, onlinePageSize, searchKeyword, selectedCategory]);
  const marketplaceSearchQuery = useMarketplaceSearchQuery(marketplaceSearchParams, { enabled: activeTab === 'online' });
  const marketplaceCategoriesQuery = useMarketplaceCategoriesQuery();
  const uploadSkillZipMutation = useUploadSkillZipMutation();
  const deleteSkillsMutation = useDeleteSkillsMutation();
  const syncSkillsMutation = useSyncSkillsMutation();
  const exportSkillsMutation = useExportSkillsMutation();
  const queriedSkills = skillsQuery.data?.skills || [];
  const installSkills = skillsQuery.data?.installSkills || [];
  useSyncLocalSkillsToDb(queriedSkills);
  const skills = useLocalSkillRows({
    keyword: '',
    source: 'all',
    tags: [],
    sortKey: 'name',
    sortDirection: 'asc',
  }) as LocalSkill[];
  const sortedLocalSkills = useLocalSkillRows({
    keyword: searchQuery,
    source: selectedSource,
    tags: selectedTags,
    sortKey: localSortKey,
    sortDirection: localSortDirection,
  }) as LocalSkill[];
  const runtimeSkillsDir = skillsQuery.data?.runtimeSkillsDir || '';
  const loading = activeTab === 'local' && skillsQuery.isLoading;
  const error = activeTab === 'local' && skillsQuery.error
    ? (skillsQuery.error instanceof Error ? skillsQuery.error.message : '加载 skills 失败')
    : null;
  const refreshSkills = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.skills() });
  }, [queryClient]);

  useEffect(() => {
    try {
      const savedActiveTab = initialTab === 'local' ? localStorage.getItem(ACTIVE_TAB_KEY) : null;
      if (savedActiveTab === 'local' || savedActiveTab === 'online' || savedActiveTab === 'mcp' || savedActiveTab === 'plugins') {
        setActiveTab(savedActiveTab);
      }
      const savedLocalViewMode = localStorage.getItem(LOCAL_VIEW_MODE_KEY);
      if (savedLocalViewMode === 'gallery' || savedLocalViewMode === 'table') {
        setLocalViewMode(savedLocalViewMode);
      }
      const savedOnlineViewMode = localStorage.getItem(ONLINE_VIEW_MODE_KEY);
      if (savedOnlineViewMode === 'gallery' || savedOnlineViewMode === 'table') {
        setOnlineViewMode(savedOnlineViewMode);
      }
      const savedLocalPageSize = Number(localStorage.getItem(LOCAL_PAGE_SIZE_KEY) || DEFAULT_PAGE_SIZE);
      if (PAGE_SIZE_OPTIONS.includes(savedLocalPageSize)) setLocalPageSize(savedLocalPageSize);
      const savedOnlinePageSize = Number(localStorage.getItem(ONLINE_PAGE_SIZE_KEY) || DEFAULT_PAGE_SIZE);
      if (PAGE_SIZE_OPTIONS.includes(savedOnlinePageSize)) setOnlinePageSize(savedOnlinePageSize);
    } catch {}
  }, [initialTab]);

  useEffect(() => {
    try { localStorage.setItem(ACTIVE_TAB_KEY, activeTab); } catch {}
  }, [activeTab]);

  useEffect(() => {
    try { localStorage.setItem(LOCAL_VIEW_MODE_KEY, localViewMode); } catch {}
  }, [localViewMode]);

  useEffect(() => {
    try { localStorage.setItem(ONLINE_VIEW_MODE_KEY, onlineViewMode); } catch {}
  }, [onlineViewMode]);

  useEffect(() => {
    try { localStorage.setItem(LOCAL_PAGE_SIZE_KEY, String(localPageSize)); } catch {}
  }, [localPageSize]);

  useEffect(() => {
    try { localStorage.setItem(ONLINE_PAGE_SIZE_KEY, String(onlinePageSize)); } catch {}
  }, [onlinePageSize]);

  useEffect(() => {
    setLocalPage(1);
  }, [searchQuery, selectedSource, selectedTags, localSortKey, localSortDirection, localPageSize]);

  useEffect(() => {
    setOnlinePage(1);
  }, [searchKeyword, selectedCategory, onlinePageSize]);

  useEffect(() => {
    if (activeTab !== 'online') return;
    setOnlineLoading(marketplaceSearchQuery.isFetching);
    if (marketplaceSearchQuery.data?.success) {
      setOnlineSkills(marketplaceSearchQuery.data.data?.skills || []);
      setTotalItems(marketplaceSearchQuery.data.data?.total || 0);
      setOnlineError(null);
    } else if (marketplaceSearchQuery.data && !marketplaceSearchQuery.data.success) {
      setOnlineError(marketplaceSearchQuery.data.error || '加载应用市场失败');
    } else if (marketplaceSearchQuery.isError) {
      setOnlineError(marketplaceSearchQuery.error instanceof Error ? marketplaceSearchQuery.error.message : '加载应用市场失败');
    }
  }, [activeTab, marketplaceSearchQuery.data, marketplaceSearchQuery.error, marketplaceSearchQuery.isError, marketplaceSearchQuery.isFetching]);

  useEffect(() => {
    if (marketplaceCategoriesQuery.data?.success) {
      setCategories(marketplaceCategoriesQuery.data.data?.categories || []);
    }
  }, [marketplaceCategoriesQuery.data]);

  const handleUploadZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const data = await uploadSkillZipMutation.mutateAsync(file);
      if (data.success) {
        toast('success', data.message || '导入成功');
      } else {
        toast('error', data.error || '导入失败');
      }
    } catch (error: any) {
      toast('error', error?.message || '导入失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const requestDeleteSkills = (skillNames: string[]) => {
    if (skillNames.length === 0) {
      toast('error', '请先选择要删除的 Skill');
      return;
    }
    setDeleteSkillNames(skillNames);
  };

  const confirmDeleteSkills = async () => {
    if (deleteSkillNames.length === 0) return;
    try {
      const data = await deleteSkillsMutation.mutateAsync(deleteSkillNames);
      if (!data.success) {
        toast('error', data.error || '删除失败');
        return;
      }
      toast('success', data.message || `已删除 ${data.deleted?.length || 0} 个 Skill`);
      setSelectedForExport((prev) => {
        const next = new Set(prev);
        deleteSkillNames.forEach((name) => next.delete(name));
        return next;
      });
      setSelectedSkill(null);
      setDeleteSkillNames([]);
    } catch (error: any) {
      toast('error', error?.message || '删除失败');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedForExport.size === 0) {
      toast('error', '请先选择要删除的 Skill');
      return;
    }
    requestDeleteSkills(Array.from(selectedForExport));
  };

  const handleExport = async () => {
    if (selectedForExport.size === 0) {
      toast('error', '请先选择要导出的 Skill');
      return;
    }
    setExporting(true);
    try {
      const blob = await exportSkillsMutation.mutateAsync(Array.from(selectedForExport));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'skills-export.zip';
      a.click();
      URL.revokeObjectURL(url);
      toast('success', `已导出 ${selectedForExport.size} 个 Skill`);
    } catch (error: any) {
      toast('error', error?.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const toggleExportSelection = (name: string) => {
    setSelectedForExport((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleSelectAllLocalPage = () => {
    const allNames = localPagination.items.map((s) => s.name);
    const allSelected = allNames.length > 0 && allNames.every((n) => selectedForExport.has(n));
    setSelectedForExport((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        allNames.forEach((n) => next.delete(n));
      } else {
        allNames.forEach((n) => next.add(n));
      }
      return next;
    });
  };

  const syncInstalledSkills = async (skillNames: string[], successMessage?: string) => {
    const names = Array.from(new Set(skillNames.filter(Boolean)));
    if (names.length === 0) {
      toast('warning', '安装目录中没有可同步的 Skill');
      return false;
    }

    setSyncingSkillNames((prev) => {
      const next = new Set(prev);
      names.forEach((name) => next.add(name));
      return next;
    });

    try {
      const data = await syncSkillsMutation.mutateAsync(names);
      if (!data.success) {
        toast('error', data.error || '同步失败');
        return false;
      }

      toast('success', successMessage || data.message || '同步成功');
      return true;
    } catch (error: any) {
      toast('error', error?.message || '同步失败');
      return false;
    } finally {
      setSyncingSkillNames((prev) => {
        const next = new Set(prev);
        names.forEach((name) => next.delete(name));
        return next;
      });
    }
  };

  const handleSyncBuiltinAceharnessSkills = async () => {
    const targetNames = installSkills
      .map((skill) => skill.path)
      .filter((name) => name.startsWith('aceharness-'));
    setSyncingAllBuiltin(true);
    try {
      await syncInstalledSkills(targetNames, `已同步 ${targetNames.length} 个 aceharness 内置 Skill`);
    } finally {
      setSyncingAllBuiltin(false);
    }
  };

  const requestInstall = (skillName: string) => {
    setInstallSkillName(skillName);
  };

  const confirmInstall = async () => {
    const skillName = installSkillName;
    if (!skillName) return;
    setInstallSkillName(null);
    setSelectedOnlineSkill(null);
    setInstalling(skillName);
    setInstallProgress({
      skillName,
      status: 'downloading',
      progress: 0,
      message: '开始下载...',
    });

    try {
      setInstallProgress((prev) => ({
        ...prev,
        progress: 30,
        message: '正在下载...',
      }));

      const response = await apiFetch('/api/marketplace/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillName }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok && data.success) {
        setInstallProgress({
          skillName,
          status: 'success',
          progress: 100,
          message: '安装成功！',
        });
        setOnlineSkills((prev) =>
          prev.map((skill) => {
            const installName = skill.enName || skill.name;
            return installName === skillName ? { ...skill, installed: true } : skill;
          }),
        );
        setSelectedOnlineSkill((prev) => {
          if (!prev) return prev;
          const installName = prev.enName || prev.name;
          return installName === skillName ? { ...prev, installed: true } : prev;
        });
        toast('success', `Skill "${skillName}" 已成功安装`);
        await refreshSkills();
      } else {
        setInstallProgress({
          skillName,
          status: 'error',
          progress: 100,
          message: data.error || '安装失败',
        });
      }
    } catch {
      setInstallProgress({
        skillName,
        status: 'error',
        progress: 100,
        message: '网络错误',
      });
    }
  };

  const allTags = useMemo(
    () => Array.from(new Set(skills.flatMap((skill) => skill.tags || []))).sort(),
    [skills],
  );

  const sourceKeys = useMemo(() => {
    return Array.from(new Set(skills.map(normalizeSkillSource))).sort((a, b) => {
      const aIndex = SOURCE_ORDER.indexOf(a);
      const bIndex = SOURCE_ORDER.indexOf(b);
      if (aIndex >= 0 || bIndex >= 0) {
        return (aIndex >= 0 ? aIndex : SOURCE_ORDER.length) - (bIndex >= 0 ? bIndex : SOURCE_ORDER.length);
      }
      return a.localeCompare(b);
    });
  }, [skills]);

  const sourceCounts = useMemo(() => {
    return skills.reduce<Record<string, number>>((acc, skill) => {
      const source = normalizeSkillSource(skill);
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {});
  }, [skills]);

  const installSkillPathSet = useMemo(() => new Set(installSkills.map((skill) => skill.path)), [installSkills]);
  const installedSkillKeySet = useMemo(() => {
    const keys = new Set<string>();
    for (const skill of skills) {
      keys.add(normalizeMarketplaceSkillKey(skill.name));
      if (skill.path) {
        const normalizedPath = skill.path.replace(/\\/g, '/');
        const folderName = normalizedPath.split('/').filter(Boolean).pop();
        if (folderName) keys.add(normalizeMarketplaceSkillKey(folderName));
      }
    }
    for (const skill of installSkills) {
      keys.add(normalizeMarketplaceSkillKey(skill.name));
      if (skill.path) {
        const normalizedPath = skill.path.replace(/\\/g, '/');
        const folderName = normalizedPath.split('/').filter(Boolean).pop();
        if (folderName) keys.add(normalizeMarketplaceSkillKey(folderName));
      }
    }
    return keys;
  }, [installSkills, skills]);

  const syncStatusByName = useMemo(() => {
    return skills.reduce<Record<string, SyncStatus>>((acc, skill) => {
      const inInstall = installSkillPathSet.has(skill.path);
      acc[skill.name] = {
        inInstall,
        aceharnessBuiltin: inInstall && skill.path.startsWith('aceharness-'),
      };
      return acc;
    }, {});
  }, [skills, installSkillPathSet]);

  const builtinAceharnessInstallCount = useMemo(
    () => installSkills.filter((skill) => skill.path.startsWith('aceharness-')).length,
    [installSkills],
  );

  const localPagination = useMemo(() => {
    const total = sortedLocalSkills.length;
    const totalPages = Math.max(1, Math.ceil(total / localPageSize));
    const safePage = Math.min(localPage, totalPages);
    const start = (safePage - 1) * localPageSize;
    const end = start + localPageSize;
    return {
      total,
      totalPages,
      page: safePage,
      pageSize: localPageSize,
      items: sortedLocalSkills.slice(start, end),
    };
  }, [localPage, localPageSize, sortedLocalSkills]);
  const allLocalPageSelected = localPagination.items.length > 0
    && localPagination.items.every((skill) => selectedForExport.has(skill.name));
  const hasPartialLocalPageSelection = localPagination.items.some((skill) => selectedForExport.has(skill.name))
    && !allLocalPageSelected;

  useEffect(() => {
    if (localPage !== localPagination.page) {
      setLocalPage(localPagination.page);
    }
  }, [localPage, localPagination.page]);

  const sortedOnlineSkills = useMemo(() => {
    return onlineSkills.map((skill) => ({
      ...skill,
      installed: skill.installed || installedSkillKeySet.has(normalizeMarketplaceSkillKey(skill.enName || skill.name)),
    }));
  }, [installedSkillKeySet, onlineSkills]);

  const getDisplayDescription = (skill: LocalSkill) => skill.descriptionZh || skill.description;

  const handleLocalSearchInputChange = (value: string) => {
    setEmbeddedSearchDraft(value);
  };

  const handleApplyLocalSearch = () => {
    setSearchQuery(embeddedSearchDraft);
  };

  const handleLocalSort = (key: LocalSortKey) => {
    if (localSortKey === key) {
      setLocalSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setLocalSortKey(key);
    setLocalSortDirection(key === 'updatedAt' ? 'desc' : 'asc');
  };

  const SortIcon = ({
    active,
    direction,
  }: {
    active: boolean;
    direction: SortDirection;
  }) => {
    if (!active) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    return direction === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5 text-primary" />
      : <ArrowDown className="h-3.5 w-3.5 text-primary" />;
  };

  const localSkillColumns: DataTableColumn<LocalSkill>[] = [
    {
      id: 'name',
      header: '名称',
      sortable: true,
      width: '40%',
      render: (skill) => (
        <div className="min-w-[220px] space-y-1">
          <div className="truncate font-medium" title={skill.name}>{skill.name}</div>
          <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">{getDisplayDescription(skill)}</div>
        </div>
      ),
    },
    {
      id: 'source',
      header: '标签 / 来源',
      sortable: true,
      width: '28%',
      render: (skill) => (
        <div className="flex flex-wrap gap-1.5">
          <StatusPill tone={getSourceTone(normalizeSkillSource(skill))} className="shrink-0 whitespace-nowrap">
            {getSourceLabel(normalizeSkillSource(skill))}
          </StatusPill>
          {(skill.tags || []).slice(0, 4).map((tag) => (
            <Badge key={tag} variant="outline" className="shrink-0 whitespace-nowrap text-xs">{tag}</Badge>
          ))}
        </div>
      ),
    },
    {
      id: 'status',
      header: '状态',
      priority: 2,
      render: (skill) => (
        <div className="flex flex-wrap gap-1">
          {syncStatusByName[skill.name]?.aceharnessBuiltin ? <StatusPill tone="accent" className="text-xs">内置可同步</StatusPill> : null}
          {skill.hasPromptMd ? <StatusPill tone="success" className="text-xs">PROMPT</StatusPill> : null}
        </div>
      ),
    },
  ];
  const getLocalSkillActions = (skill: LocalSkill): ActionMenuGroup[] => [
    {
      actions: [
        { id: 'detail', label: '详情', primary: true, onSelect: () => setSelectedSkill(skill) },
        ...(syncStatusByName[skill.name]?.inInstall
          ? [{ id: 'sync', label: '同步', inline: false, disabled: syncingSkillNames.has(skill.path), onSelect: () => void syncInstalledSkills([skill.path], `已同步 ${skill.name}`) }]
          : []),
        { id: 'delete', label: '删除', icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: () => requestDeleteSkills([skill.name]) },
      ],
    },
  ];
  const marketplaceColumns: DataTableColumn<MarketplaceSkill>[] = [
    {
      id: 'name',
      header: '名称',
      width: '24%',
      render: (skill) => (
        <div className="min-w-[180px] space-y-1">
          <div className="truncate font-medium">{skill.enName || skill.name}</div>
          {skill.enName && skill.name !== skill.enName ? <div className="truncate text-xs text-muted-foreground">{skill.name}</div> : null}
          <div className="line-clamp-2 text-xs text-muted-foreground">{skill.description}</div>
        </div>
      ),
    },
    { id: 'organization', header: '组织', accessor: (skill) => skill.organization || '-', priority: 2 },
    { id: 'author', header: '作者', accessor: (skill) => skill.author || '-', priority: 3 },
    { id: 'downloads', header: '下载量', accessor: (skill) => skill.downloads, priority: 3 },
    { id: 'score', header: '评分', accessor: (skill) => skill.overallScore || '-', priority: 3 },
    { id: 'updatedAt', header: '更新时间', accessor: (skill) => formatOnlineUpdatedAt(skill.updatedAt), priority: 3 },
    {
      id: 'tags',
      header: '标签',
      render: (skill) => (
        <div className="flex gap-1 overflow-hidden whitespace-nowrap">
          {skill.tags.slice(0, 4).map((tag) => <Badge key={tag} variant="outline" className="shrink-0 text-xs">{tag}</Badge>)}
        </div>
      ),
      priority: 2,
    },
  ];
  const getMarketplaceActions = (skill: MarketplaceSkill): ActionMenuGroup[] => {
    const installName = skill.enName || skill.name;
    return [{
      actions: [
        { id: 'detail', label: '详情', primary: skill.installed, onSelect: () => setSelectedOnlineSkill(skill) },
        ...(skill.installed ? [{ id: 'installed', label: '已安装', disabled: true, disabledReason: '本地已安装同名 Skill' }] : []),
        { id: 'install', label: skill.installed ? '重新安装' : '安装', primary: !skill.installed, inline: !skill.installed, onSelect: () => requestInstall(installName) },
      ],
    }];
  };

  const activeTabLabel = activeTab === 'local'
    ? 'Installed Skills'
    : activeTab === 'online'
      ? 'Marketplace'
      : activeTab === 'mcp'
        ? 'MCP Servers'
        : 'Plugins';

  const renderTabStrip = (className: string, ref?: any) => (
    <section ref={ref} className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={activeTab === 'local' ? 'secondary' : 'ghost'}
          className="rounded-lg"
          onClick={() => setActiveTab('local')}
        >
          <Puzzle className="w-4 h-4 mr-2" />
          本地管理
        </Button>
        <Button
          size="sm"
          variant={activeTab === 'online' ? 'secondary' : 'ghost'}
          className="rounded-lg"
          onClick={() => setActiveTab('online')}
        >
          <Store className="w-4 h-4 mr-2" />
          Skill 广场
        </Button>
        <Button
          size="sm"
          variant={activeTab === 'mcp' ? 'secondary' : 'ghost'}
          className="rounded-lg"
          onClick={() => setActiveTab('mcp')}
        >
          <Server className="w-4 h-4 mr-2" />
          MCP 管理
        </Button>
        <Button
          size="sm"
          variant={activeTab === 'plugins' ? 'secondary' : 'ghost'}
          className="rounded-lg"
          onClick={() => setActiveTab('plugins')}
        >
          <Puzzle className="w-4 h-4 mr-2" />
          侧边栏插件
        </Button>
      </div>
    </section>
  );

  const renderLocalToolbar = (className: string) => (
    <PageToolbar className={className}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={handleUploadZip}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-3 xl:flex-nowrap">
        <div className={cn('flex shrink-0 items-center gap-2', embedded ? 'min-w-0 flex-1' : 'w-full max-w-sm')}>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索 Skills..."
              value={embeddedSearchDraft}
              onChange={(e) => handleLocalSearchInputChange(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleApplyLocalSearch();
                }
              }}
              className="h-11 w-full rounded-2xl border-border/70 bg-background/80 pl-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            />
          </div>
          <Button size="sm" onClick={handleApplyLocalSearch} className="h-11 shrink-0">
            <Search className="mr-1 h-4 w-4" />
            搜索
          </Button>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
          {!embedded && localViewMode === 'gallery' ? (
            <>
              <Select value={localSortKey} onValueChange={(value) => setLocalSortKey(value as LocalSortKey)}>
                <SelectTrigger className="h-9 w-[140px] bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updatedAt">按更新时间</SelectItem>
                  <SelectItem value="name">按名称</SelectItem>
                  <SelectItem value="source">按来源</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLocalSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
              >
                {localSortDirection === 'asc' ? '升序' : '降序'}
              </Button>
            </>
          ) : null}
          <div className="inline-flex rounded-full border border-border/60 bg-muted/40 p-1">
            <Button
              size="sm"
              variant={localViewMode === 'gallery' ? 'default' : 'ghost'}
              className="h-8 rounded-full px-3"
              onClick={() => setLocalViewMode('gallery')}
            >
              <span className="material-symbols-outlined text-sm">grid_view</span>
            </Button>
            <Button
              size="sm"
              variant={localViewMode === 'table' ? 'default' : 'ghost'}
              className="h-8 rounded-full px-3"
              onClick={() => setLocalViewMode('table')}
            >
              <span className="material-symbols-outlined text-sm">table_rows</span>
            </Button>
          </div>
          {!embedded ? (
            <Button
              size="sm"
              variant="secondary"
              className="whitespace-nowrap"
              onClick={handleSyncBuiltinAceharnessSkills}
              disabled={syncingAllBuiltin || builtinAceharnessInstallCount === 0}
            >
              {syncingAllBuiltin ? '同步中...' : `同步内置 (${builtinAceharnessInstallCount})`}
            </Button>
          ) : null}
        </div>
      </div>
    </PageToolbar>
  );

  const renderOnlineToolbar = (className: string) => (
    <PageToolbar className={className}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-col gap-3">
          <SkillSearch
            onSearch={setSearchKeyword}
            onCategoryChange={setSelectedCategory}
            categories={categories}
          />
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="inline-flex rounded-full border border-border/60 bg-muted/40 p-1">
            <Button
              size="sm"
              variant={onlineViewMode === 'gallery' ? 'default' : 'ghost'}
              className="h-8 rounded-full px-3"
              onClick={() => setOnlineViewMode('gallery')}
            >
              <span className="material-symbols-outlined text-sm">grid_view</span>
            </Button>
            <Button
              size="sm"
              variant={onlineViewMode === 'table' ? 'default' : 'ghost'}
              className="h-8 rounded-full px-3"
              onClick={() => setOnlineViewMode('table')}
            >
              <span className="material-symbols-outlined text-sm">table_rows</span>
            </Button>
          </div>
        </div>
      </div>
    </PageToolbar>
  );
  const { isDashboardShell } = useDashboardShellHeader({
    title: 'Skills/MCP 管理',
    subtitle: '统一管理本地 Skills、MCP 与应用市场安装',
    actions: activeTab === 'local' ? (
      <>
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <Upload className={`w-4 h-4 mr-1 ${uploading ? 'animate-bounce' : ''}`} />
          <span className="hidden xl:inline">{uploading ? '导入中...' : '上传 Skill'}</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleExport}
          disabled={exporting || selectedForExport.size === 0}
        >
          <Download className={`w-4 h-4 mr-1 ${exporting ? 'animate-bounce' : ''}`} />
          <span className="hidden xl:inline">{exporting ? '导出中...' : '导出'}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setWorkspaceOpen(true)} disabled={!runtimeSkillsDir}>
          <FolderOpen className="w-4 h-4 mr-1" />
          <span className="hidden xl:inline">工作目录</span>
        </Button>
      </>
    ) : null,
  }, [activeTab, uploading, exporting, selectedForExport, runtimeSkillsDir]);

  return (
    <div
      className={cn(
        'relative bg-background',
        embedded ? 'flex h-full min-h-0 flex-col overflow-hidden' : 'min-h-screen',
      )}
    >
      {!embedded && !isDashboardShell ? (
        <PageHeader
          className="sticky top-0 z-40 bg-card"
          eyebrow="Resources"
          title="Resources"
          subtitle="统一管理 Installed Skills、MCP Servers、Marketplace 与运行时插件。"
          status={<StatusPill tone="accent">{activeTabLabel}</StatusPill>}
          leading={(
            <Button variant="ghost" size="sm" asChild>
              <Link href={returnTarget.href}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                {returnTarget.label}
              </Link>
            </Button>
          )}
          secondaryActions={(
            <>
              {activeTab === 'local' ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={handleUploadZip}
                  />
                  <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    <Upload className={`w-4 h-4 mr-1 ${uploading ? 'animate-bounce' : ''}`} />
                    {uploading ? '导入中...' : '上传 Skill'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setWorkspaceOpen(true)} disabled={!runtimeSkillsDir}>
                    <FolderOpen className="w-4 h-4 mr-1" />
                    工作目录
                  </Button>
                </>
              ) : null}
            </>
          )}
          overflowActions={(
            <>
            <LanguageToggle />
            <ThemeToggle />
            </>
          )}
        />
      ) : null}

      <div
        data-skills-manager-scroll-root
        className={cn(
          'container mx-auto flex flex-col gap-6 px-6',
          embedded
            ? 'min-h-0 max-w-none flex-1 overflow-auto px-4 py-4 pb-24'
            : 'py-8 pb-28',
        )}
      >
        {embedded ? (
          renderTabStrip('rounded-xl border border-border bg-card p-3 shadow-none')
        ) : (
          renderTabStrip('rounded-xl border border-border bg-card p-3 shadow-none')
        )}

        {!embedded && activeTab !== 'plugins' && activeTab !== 'mcp' ? (
          <>
            <section
              className="sticky top-[4.5rem] z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
            >
              <div>
                <div
                  className={cn(
                    'rounded-xl border border-border bg-card p-4 shadow-none',
                    activeTab === 'online'
                      ? ''
                      : '',
                  )}
                >
                  {activeTab === 'local'
                    ? renderLocalToolbar('p-0')
                    : renderOnlineToolbar('p-0')}
                </div>
              </div>
            </section>
          </>
        ) : null}

        {activeTab === 'local' ? (
          <>
            {embedded ? renderLocalToolbar('sticky top-0 z-20 rounded-xl border border-border bg-card p-4 shadow-none') : null}

            <section className="rounded-xl border border-border bg-card p-4 shadow-none">
              <div className="rounded-xl border border-border bg-background p-4">
                <div className="flex flex-wrap items-center gap-2 overflow-x-hidden">
                  <span className="shrink-0 text-sm text-muted-foreground">标签筛选</span>
                  {allTags.length > 0 ? (
                    allTags.map((tag) => (
                      <Badge
                        key={tag}
                        variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                        className="shrink-0 cursor-pointer whitespace-nowrap px-3 py-1"
                        onClick={() => {
                          setSelectedTags((prev) =>
                            prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
                          );
                        }}
                      >
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">暂无标签</span>
                  )}
                </div>
              </div>
            </section>

            {runtimeSkillsDir ? (
              <WorkspaceEditor
                open={workspaceOpen}
                onOpenChange={setWorkspaceOpen}
                workspacePath={runtimeSkillsDir}
                title="Runtime Skills"
              />
            ) : null}

            <section className="rounded-xl border border-border bg-card p-4 shadow-none">
              {loading ? (
                <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center h-64 gap-4">
                  <p className="text-destructive">{error}</p>
                  <Button onClick={() => void skillsQuery.refetch()}>重试</Button>
                </div>
              ) : localPagination.total === 0 ? (
                <EmptyState
                  icon={<Puzzle className="h-5 w-5" />}
                  title={searchQuery ? '没有匹配的 Skills' : '暂无 Skills'}
                  description="可通过上传 zip、同步内置 Skill 或从 Marketplace 安装来补充资源。"
                />
              ) : localViewMode === 'table' ? (
                <DataTable
                  aria-label="本地 Skill 列表"
                  columns={localSkillColumns}
                  rows={localPagination.items}
                  rowKey="name"
                  density="comfortable"
                  onRowClick={setSelectedSkill}
                  rowActions={(skill) => getLocalSkillActions(skill)}
                  selection={{
                    selectedKeys: Array.from(selectedForExport),
                    onSelectedKeysChange: (keys) => setSelectedForExport(new Set(keys.map(String))),
                  }}
                  sort={{
                    columnId: localSortKey,
                    direction: localSortDirection,
                    onSortChange: ({ columnId, direction }) => {
                      if (columnId === 'name' || columnId === 'source') {
                        setLocalSortKey(columnId);
                        setLocalSortDirection(direction);
                      }
                    },
                  }}
                />
              ) : (
                <>
                {localPagination.items.length > 0 && (
                  <div className="mb-3 flex items-center">
                    <div
                      className="inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                      role="button"
                      tabIndex={0}
                      onClick={toggleSelectAllLocalPage}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleSelectAllLocalPage();
                        }
                      }}
                    >
                      <Checkbox
                        checked={allLocalPageSelected ? true : hasPartialLocalPageSelection ? 'indeterminate' : false}
                        aria-label={
                          allLocalPageSelected
                            ? '取消全选当前页技能'
                            : '全选当前页技能'
                        }
                        className="h-4 w-4 rounded-[5px]"
                        onCheckedChange={toggleSelectAllLocalPage}
                      />
                      {allLocalPageSelected ? '取消全选' : '全选当前页'}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {localPagination.items.map((skill) => {
                    const updatedAtLabel = formatLocalUpdatedAt(skill.updatedAt);
                    const syncStatus = syncStatusByName[skill.name];
                    const isSyncing = syncingSkillNames.has(skill.path);
                    return (
                      <DataCard
                        key={skill.name}
                        selected={selectedForExport.has(skill.name)}
                        className="relative cursor-pointer"
                        onClick={() => setSelectedSkill(skill)}
                      >
                        <div className="absolute top-3 right-3 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="w-5 h-5 rounded flex items-center justify-center text-destructive transition-colors hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => requestDeleteSkills([skill.name])}
                            title="删除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <div onClick={() => toggleExportSelection(skill.name)} className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer ${
                            selectedForExport.has(skill.name) ? 'bg-primary border-primary' : 'border-muted-foreground/40'
                          }`}>
                            {selectedForExport.has(skill.name) ? <span className="text-white text-xs">✓</span> : null}
                          </div>
                        </div>
                        <DataCardHeader className="pr-8">
                          <div className="min-w-0">
                            <DataCardTitle>{skill.name}</DataCardTitle>
                            <DataCardDescription className="line-clamp-3 text-xs">{getDisplayDescription(skill)}</DataCardDescription>
                          </div>
                        </DataCardHeader>
                        <DataCardMeta>
                          <StatusPill tone={getSourceTone(normalizeSkillSource(skill))}>
                            {getSourceLabel(normalizeSkillSource(skill))}
                          </StatusPill>
                          {syncStatusByName[skill.name]?.aceharnessBuiltin ? (
                            <StatusPill tone="accent" className="text-xs">内置可同步</StatusPill>
                          ) : null}
                          {skill.hasPromptMd ? (
                            <StatusPill tone="success" className="text-xs">PROMPT</StatusPill>
                          ) : null}
                        </DataCardMeta>
                        <div className="mt-4 flex min-h-12 flex-wrap gap-1.5">
                          {(skill.tags || []).slice(0, 4).map((tag) => (
                            <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                          ))}
                        </div>
                        <div
                          className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="min-w-0 truncate">
                            {updatedAtLabel || '本地 Skill'}
                          </span>
                          <div className="ml-auto flex items-center gap-1.5">
                            {syncStatus?.inInstall ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                disabled={isSyncing}
                                onClick={() => syncInstalledSkills([skill.path], `已同步 ${skill.name}`)}
                              >
                                {isSyncing ? '同步中...' : '同步'}
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => setSelectedSkill(skill)}
                            >
                              详情
                            </Button>
                          </div>
                        </div>
                      </DataCard>
                    );
                  })}
                </div>
                </>
              )}
            </section>

            {localPagination.total > 0 ? (
              <PaginationBar
                current={localPagination.page}
                total={localPagination.total}
                pageSize={localPagination.pageSize}
                onPageChange={setLocalPage}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                onPageSizeChange={(size) => {
                  setLocalPageSize(size);
                  setLocalPage(1);
                }}
                itemLabel="Skill"
              />
            ) : null}

            <DetailDrawer open={Boolean(selectedSkill)} onOpenChange={(open) => !open && setSelectedSkill(null)}>
              <DetailDrawerContent widthClassName="w-[min(520px,calc(100vw-1rem))]">
                {selectedSkill ? (
                  <>
                    <DetailDrawerHeader>
                      <DetailDrawerTitle>{selectedSkill.name}</DetailDrawerTitle>
                      <DetailDrawerDescription>{getDisplayDescription(selectedSkill)}</DetailDrawerDescription>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <StatusPill tone={getSourceTone(normalizeSkillSource(selectedSkill))}>
                          {getSourceLabel(normalizeSkillSource(selectedSkill))}
                        </StatusPill>
                        {selectedSkill.hasPromptMd ? (
                          <StatusPill tone="success">PROMPT.md</StatusPill>
                        ) : null}
                      </div>
                    </DetailDrawerHeader>
                    <DetailDrawerBody className="space-y-6">
                      {selectedSkill.tags?.length ? (
                        <div>
                          <h4 className="mb-2 text-sm font-medium">标签</h4>
                          <div className="flex flex-wrap gap-2">
                            {selectedSkill.tags.map((tag) => (
                              <StatusPill key={tag} tone="neutral" dot={false}>{tag}</StatusPill>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {selectedSkill.detailedDescription ? (
                        <div>
                          <h4 className="mb-2 text-sm font-medium">详细说明</h4>
                          <div className="rounded-xl border border-border bg-background p-4 text-sm">
                            <Markdown>{selectedSkill.detailedDescription}</Markdown>
                          </div>
                        </div>
                      ) : null}
                    </DetailDrawerBody>
                    <DetailDrawerFooter>
                      {syncStatusByName[selectedSkill.name]?.inInstall ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={syncingSkillNames.has(selectedSkill.path)}
                          onClick={() => syncInstalledSkills([selectedSkill.path], `已同步 ${selectedSkill.name}`)}
                        >
                          {syncingSkillNames.has(selectedSkill.path) ? '同步中...' : '同步'}
                        </Button>
                      ) : null}
                      <Button size="sm" variant="destructive" onClick={() => requestDeleteSkills([selectedSkill.name])}>
                        删除
                      </Button>
                    </DetailDrawerFooter>
                  </>
                ) : null}
              </DetailDrawerContent>
            </DetailDrawer>
          </>
        ) : activeTab === 'online' ? (
          <>
            {embedded ? renderOnlineToolbar('sticky top-0 z-20 rounded-xl border border-border bg-card p-4 shadow-none') : null}

            <section className="rounded-xl border border-border bg-card p-4 shadow-none">
              {onlineError ? (
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                  {onlineError}
                </div>
              ) : onlineLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  加载中...
                </div>
              ) : sortedOnlineSkills.length === 0 ? (
                <EmptyState
                  icon={<Store className="h-5 w-5" />}
                  title={searchKeyword ? '没有找到匹配的 Skill' : '暂无 Skill'}
                  description="调整搜索关键词或分类后重试。"
                />
              ) : onlineViewMode === 'table' ? (
                <DataTable
                  aria-label="Marketplace Skill 列表"
                  columns={marketplaceColumns}
                  rows={sortedOnlineSkills}
                  rowKey="id"
                  density="comfortable"
                  onRowClick={setSelectedOnlineSkill}
                  rowActions={(skill) => getMarketplaceActions(skill)}
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedOnlineSkills.map((skill) => {
                    const displayName = skill.enName || skill.name;
                    const installName = skill.enName || skill.name;
                    return (
                      <DataCard key={skill.id} className="cursor-pointer" onClick={() => setSelectedOnlineSkill(skill)}>
                        <DataCardHeader>
                          <div className="min-w-0">
                            <DataCardTitle>{displayName}</DataCardTitle>
                            {skill.enName && skill.name !== skill.enName ? (
                              <DataCardDescription className="truncate text-xs">{skill.name}</DataCardDescription>
                            ) : null}
                          </div>
                          {skill.installed ? <StatusPill tone="success">已安装</StatusPill> : <StatusPill tone="neutral">未安装</StatusPill>}
                        </DataCardHeader>
                        <DataCardDescription className="line-clamp-3">{skill.description}</DataCardDescription>
                        <DataCardMeta>
                          {skill.organization ? <StatusPill tone="info">{skill.organization}</StatusPill> : null}
                          <span>下载 {skill.downloads}</span>
                          <span>评分 {skill.overallScore || 'N/A'}</span>
                        </DataCardMeta>
                        <DataCardActions onClick={(event) => event.stopPropagation()}>
                          <Button size="sm" variant="outline" onClick={() => setSelectedOnlineSkill(skill)}>
                            详情
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => requestInstall(installName)}>
                            {skill.installed ? '重新安装' : '安装'}
                          </Button>
                        </DataCardActions>
                      </DataCard>
                    );
                  })}
                </div>
              )}
            </section>

            {totalItems > 0 ? (
              <PaginationBar
                current={onlinePage}
                total={totalItems}
                pageSize={onlinePageSize}
                onPageChange={setOnlinePage}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                onPageSizeChange={(size) => {
                  setOnlinePageSize(size);
                  setOnlinePage(1);
                }}
                itemLabel="Skill"
              />
            ) : null}

            {installing ? (
              <InstallProgress
                progress={installProgress}
                onClose={() => setInstalling(null)}
              />
            ) : null}

            <DetailDrawer open={Boolean(selectedOnlineSkill)} onOpenChange={(open) => !open && setSelectedOnlineSkill(null)}>
              <DetailDrawerContent widthClassName="w-[min(520px,calc(100vw-1rem))]">
                {selectedOnlineSkill ? (
                  <>
                    <DetailDrawerHeader>
                      <DetailDrawerTitle>{selectedOnlineSkill.enName || selectedOnlineSkill.name}</DetailDrawerTitle>
                      <DetailDrawerDescription>{selectedOnlineSkill.description}</DetailDrawerDescription>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedOnlineSkill.installed ? <StatusPill tone="success">已安装</StatusPill> : <StatusPill tone="neutral">未安装</StatusPill>}
                        {selectedOnlineSkill.organization ? <StatusPill tone="info">{selectedOnlineSkill.organization}</StatusPill> : null}
                      </div>
                    </DetailDrawerHeader>
                    <DetailDrawerBody className="space-y-6">
                      <div className="grid grid-cols-2 gap-3">
                        <DataCard>
                          <DataCardTitle>综合评分</DataCardTitle>
                          <DataCardDescription>{selectedOnlineSkill.overallScore || 'N/A'}</DataCardDescription>
                        </DataCard>
                        <DataCard>
                          <DataCardTitle>下载量</DataCardTitle>
                          <DataCardDescription>{selectedOnlineSkill.downloads}</DataCardDescription>
                        </DataCard>
                        <DataCard>
                          <DataCardTitle>作者</DataCardTitle>
                          <DataCardDescription>{selectedOnlineSkill.author || '-'}</DataCardDescription>
                        </DataCard>
                        <DataCard>
                          <DataCardTitle>更新时间</DataCardTitle>
                          <DataCardDescription>{formatOnlineUpdatedAt(selectedOnlineSkill.updatedAt)}</DataCardDescription>
                        </DataCard>
                      </div>
                      {selectedOnlineSkill.tags?.length ? (
                        <div>
                          <h4 className="mb-2 text-sm font-medium">标签</h4>
                          <div className="flex flex-wrap gap-2">
                            {selectedOnlineSkill.tags.map((tag) => (
                              <StatusPill key={tag} tone="neutral" dot={false}>{tag}</StatusPill>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </DetailDrawerBody>
                    <DetailDrawerFooter>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => requestInstall(selectedOnlineSkill.enName || selectedOnlineSkill.name)}
                      >
                        {selectedOnlineSkill.installed ? '重新安装' : '安装'}
                      </Button>
                    </DetailDrawerFooter>
                  </>
                ) : null}
              </DetailDrawerContent>
            </DetailDrawer>
          </>
        ) : activeTab === 'mcp' ? (
          <McpServersTab />
        ) : activeTab === 'plugins' ? (
          <PluginsTab />
        ) : null}
      </div>
      {activeTab === 'local' && localPagination.items.length > 0 ? (
        <div
          className={cn(
            'pointer-events-none left-1/2 z-40 w-full max-w-fit -translate-x-1/2 px-4',
            embedded ? 'absolute bottom-4' : 'fixed bottom-6',
          )}
        >
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-full border border-border/70 bg-background/95 px-3 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.18)] backdrop-blur">
            <div
              className="flex items-center rounded-full border border-border/70 bg-background px-4 py-2 text-sm shadow-sm"
              role="button"
              tabIndex={0}
              onClick={toggleSelectAllLocalPage}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleSelectAllLocalPage();
                }
              }}
            >
              <Checkbox
                checked={allLocalPageSelected ? true : hasPartialLocalPageSelection ? 'indeterminate' : false}
                aria-label={
                  allLocalPageSelected
                    ? '取消全选当前页技能'
                    : '全选当前页技能'
                }
                className="mr-2 h-4 w-4 rounded-[5px] border-border bg-background"
                onCheckedChange={toggleSelectAllLocalPage}
              />
              {allLocalPageSelected ? '取消全选' : '全选当前页'}
            </div>
            <div className="px-3 text-sm font-medium text-foreground/80">
              已选 {selectedForExport.size} 项
            </div>
            {selectedForExport.size > 0 ? (
              <>
                <Button size="sm" variant="outline" className="rounded-full px-4" onClick={handleExport} disabled={exporting}>
                  <Download className={`mr-2 h-4 w-4 ${exporting ? 'animate-bounce' : ''}`} />
                  {exporting ? '导出中...' : '导出'}
                </Button>
                <Button size="sm" variant="destructive" className="rounded-full px-4" onClick={handleBatchDelete}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  批量删除
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      <ConfirmModal
        open={deleteSkillNames.length > 0}
        variant="delete"
        title="删除 Skill"
        objectName={`${deleteSkillNames.length} 个 Skill`}
        consequence="删除后将移除所选 Skill，本地文件可能无法恢复。"
        confirmLabel={`删除 ${deleteSkillNames.length} 个`}
        loading={deleteSkillsMutation.isPending}
        affectedItems={deleteSkillNames.map((name) => ({ id: name, label: name }))}
        onConfirm={confirmDeleteSkills}
        onCancel={() => setDeleteSkillNames([])}
        onOpenChange={(open) => {
          if (!open) setDeleteSkillNames([]);
        }}
      />
      <ConfirmModal
        open={Boolean(installSkillName)}
        title="确认安装 Skill"
        objectName={installSkillName}
        consequence="将从 Marketplace 下载并安装该 Skill。如果本地已有同名 Skill，安装过程可能覆盖或更新相关文件。"
        confirmLabel="安装"
        onConfirm={confirmInstall}
        onCancel={() => setInstallSkillName(null)}
        onOpenChange={(open) => {
          if (!open) setInstallSkillName(null);
        }}
      />
    </div>
  );
}
