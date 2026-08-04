'use client';

import dynamic from '@/lib/navigation/dynamic';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from 'dockview-react';
import type { Direction, IDockviewPanel } from 'dockview';
import { X } from 'lucide-react';
import { KeepAlive } from 'keepalive-for-react';

import { ChatPageContent } from '@/components/chat/ChatPageContent';
import AgentsManager from '@/components/agents/AgentsManager';
import SkillsManager from '@/components/skills/SkillsManager';
import SystemSettingsContent from '@/components/settings/SystemSettingsContent';
import ChannelIntegrationsContent from '@/components/settings/ChannelIntegrationsContent';
import { DashboardShellHeaderScope, useDashboardShellHeader, useDashboardShellHeaderController } from '@/components/dashboard/DashboardShellHeader';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/core/utils';
import { buildWorkbenchSearch as buildWorkbenchSearchParams, type WorkbenchMode } from '@/client/navigation/workbench-links';
import {
  groupDockviewContextActions,
  resolveDockviewTabPolicy,
  shouldReuseDockviewTab,
  type DockviewContextAction,
  type DockviewTabPolicy,
  type DockviewTabPolicyInput,
} from '@/lib/navigation/dockview-tab-policy';
import {
  DashboardDockWorkspaceContext,
  useDashboardDockWorkspace,
  type DashboardDockOpenOptions,
  type DashboardDockTab,
  type DashboardDockWorkspaceContextValue,
  type DashboardDockWorkspaceHandle,
} from './dashboard-dock-workspace-context';

export { useDashboardDockWorkspace } from './dashboard-dock-workspace-context';
export type {
  DashboardDockOpenOptions,
  DashboardDockTab,
  DashboardDockWorkspaceHandle,
} from './dashboard-dock-workspace-context';

export const DASHBOARD_DOCK_DRAG_MIME = 'application/x-aceharness-dashboard-tab';
const CHAT_SECONDARY_SIDEBAR_WIDTH_STORAGE_KEY = 'aceharness:dashboard-chat-secondary-sidebar-width';
const CHAT_SECONDARY_SIDEBAR_DEFAULT_PERCENT = 24;
const CHAT_SECONDARY_SIDEBAR_MIN_PERCENT = 14;
const CHAT_SECONDARY_SIDEBAR_MAX_PERCENT = 42;
const clampChatSecondarySidebarPercent = (value: number) =>
  Math.min(CHAT_SECONDARY_SIDEBAR_MAX_PERCENT, Math.max(CHAT_SECONDARY_SIDEBAR_MIN_PERCENT, value));
const formatPanelPercent = (value: number) => `${Number(clampChatSecondarySidebarPercent(value).toFixed(2))}%`;
const parseStoredChatSecondarySidebarPercent = (value: string | null): number => {
  const raw = String(value || '').trim();
  if (!raw) return CHAT_SECONDARY_SIDEBAR_DEFAULT_PERCENT;
  const numeric = Number(raw.endsWith('%') ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(numeric)) return CHAT_SECONDARY_SIDEBAR_DEFAULT_PERCENT;
  if (!raw.endsWith('%') && numeric > 100) return CHAT_SECONDARY_SIDEBAR_DEFAULT_PERCENT;
  return clampChatSecondarySidebarPercent(numeric);
};

const WorkflowsPage = dynamic(() => import('@/client/pages/WorkflowsPage'), { ssr: false });
const ModelsPage = dynamic(() => import('@/client/pages/ModelsPage'), { ssr: false });
const EnginesPage = dynamic(() => import('@/client/pages/EnginesPage'), { ssr: false });
const SchedulesPage = dynamic(() => import('@/client/pages/SchedulesPage'), { ssr: false });
const RunHistoryPage = dynamic(() => import('@/client/pages/RunHistoryPage'), { ssr: false });
const KnowledgePage = dynamic(() => import('@/client/pages/KnowledgePage'), { ssr: false });
const KnowledgeLibraryPage = dynamic(() => import('@/client/pages/KnowledgeLibraryPage'), { ssr: false });
const ApiDocsPage = dynamic(() => import('@/client/pages/ApiDocsPage'), { ssr: false });
const OfficePage = dynamic(() => import('@/client/pages/OfficePage'), { ssr: false });
const NotebookPageContent = dynamic(() => import('@/client/pages/NotebookPage').then((m) => m.NotebookPageContent), { ssr: false });
const AccountContent = dynamic(() => import('@/client/pages/AccountPage').then((m) => m.AccountContent), { ssr: false });
const UsersContent = dynamic(() => import('@/client/pages/UsersPage').then((m) => m.UsersContent), { ssr: false });
const WorkbenchClient = dynamic(() => import('@/client/pages/workbench/WorkbenchClient'), { ssr: false });

type DashboardDockWorkspaceProps = {
  className?: string;
  renderOverview: () => ReactNode;
  initialTab?: DashboardDockTab;
  onFallbackChatOpen?: () => void;
  onActiveTabChange?: (tab: DashboardDockTab | null) => void;
  onToggleChatSecondarySidebar?: () => void;
  chatSecondarySidebarPinned?: boolean;
  showChatSecondarySidebar?: boolean;
  renderChatSecondarySidebar?: () => ReactNode;
  singlePanelMode?: boolean;
};

type WorkspacePanelParams = DashboardDockTab & {
  renderOverview: () => ReactNode;
  onToggleChatSecondarySidebar?: () => void;
  chatSecondarySidebarPinned?: boolean;
  showChatSecondarySidebar?: boolean;
  renderChatSecondarySidebar?: () => ReactNode;
  dockviewPolicy: DockviewTabPolicy;
};

const DEFAULT_SHELL_HEADERS: Record<DashboardDockTab['kind'], { title: string; subtitle: string }> = {
  chat: { title: '对话', subtitle: '首页对话、议场与工作流协作' },
  overview: { title: '数据中心', subtitle: '运行状态、Token 消耗与工作流洞察' },
  agents: { title: 'Agent 管理', subtitle: '管理可调度角色与运行时 Agent 编队' },
  skills: { title: 'Skills/MCP 管理', subtitle: '统一管理本地 Skills、MCP 与应用市场安装' },
  settings: { title: '系统设置', subtitle: '环境变量、账户与系统参数' },
  channels: { title: '微信接入', subtitle: '生成地址、接桥接器并在线测试工作流运行时消息' },
  users: { title: '用户管理', subtitle: '管理用户、权限与注册审核' },
  workflows: { title: '工作流管理', subtitle: '管理和配置工作流' },
  models: { title: '模型中心', subtitle: '模型配置与智能探针监控' },
  engines: { title: '引擎管理', subtitle: '选择和配置 AI 编程引擎' },
  schedules: { title: '定时任务', subtitle: '管理自动运行计划' },
  'run-history': { title: '运行记录', subtitle: '查看历史运行和 Token 排行' },
  knowledge: { title: '知识库', subtitle: '知识库与全局 Notebook' },
  'knowledge-library': { title: '知识库', subtitle: 'ACEHarness 原生 RAG 容器' },
  'api-docs': { title: 'API 文档', subtitle: '接口示例、请求参数与在线调试' },
  office: { title: '一人公司', subtitle: '办公室、协作、记忆和工作流聚合桌面' },
  notebook: { title: 'Cangjie Notebook', subtitle: '编辑、整理和运行 Notebook' },
  account: { title: '账户设置', subtitle: '个人资料、目录和账户偏好' },
  workbench: { title: '工作流工作台', subtitle: '设计、运行和调试工作流' },
};

function useDashboardDockHeader(tab: DashboardDockTab): { title: string; subtitle: string } {
  const { t } = useTranslations();
  const headers: Record<DashboardDockTab['kind'], { title: string; subtitle: string }> = {
    chat: { title: t('dashboard.quickActions.chatMode'), subtitle: t('dashboard.headers.chatSubtitle') },
    overview: { title: t('dashboard.headers.defaultTitle'), subtitle: t('dashboard.headers.overviewSubtitle') },
    agents: { title: t('dashboard.quickActions.manageAgents'), subtitle: t('dashboard.headers.agentsSubtitle') },
    skills: { title: t('dashboard.quickActions.skills'), subtitle: t('dashboard.headers.skillsSubtitle') },
    settings: { title: t('dashboard.quickActions.envVars'), subtitle: t('dashboard.headers.settingsSubtitle') },
    channels: { title: t('dashboard.headers.channels'), subtitle: t('dashboard.headers.channelsSubtitle') },
    users: { title: t('dashboard.headers.users'), subtitle: t('dashboard.headers.usersSubtitle') },
    workflows: { title: t('dashboard.quickActions.workflows'), subtitle: t('dashboard.quickActions.workflowsDesc') },
    models: { title: t('dashboard.quickActions.models'), subtitle: t('dashboard.quickActions.modelsDesc') },
    engines: { title: t('dashboard.quickActions.engines'), subtitle: t('dashboard.quickActions.enginesDesc') },
    schedules: { title: t('dashboard.quickActions.schedules'), subtitle: t('dashboard.quickActions.schedulesDesc') },
    'run-history': { title: t('dashboard.quickActions.runHistory'), subtitle: t('dashboard.quickActions.runHistoryDesc') },
    knowledge: { title: t('dashboard.quickActions.knowledge'), subtitle: t('dashboard.quickActions.knowledgeDesc') },
    'knowledge-library': { title: t('dashboard.quickActions.knowledgeLibrary'), subtitle: t('dashboard.quickActions.knowledgeDesc') },
    'api-docs': { title: t('dashboard.quickActions.apiDocs'), subtitle: t('dashboard.quickActions.apiDocsDesc') },
    office: { title: t('dashboard.quickActions.office'), subtitle: t('dashboard.quickActions.officeDesc') },
    notebook: { title: t('dashboard.headers.notebook'), subtitle: t('dashboard.headers.notebookSubtitle') },
    account: { title: t('dashboard.headers.account'), subtitle: t('dashboard.headers.accountSubtitle') },
    workbench: { title: t('dashboard.headers.workbench'), subtitle: t('dashboard.headers.workbenchSubtitle') },
  };
  if (tab.kind === 'workbench') return { title: tab.title, subtitle: headers.workbench.subtitle };
  return headers[tab.kind] || DEFAULT_SHELL_HEADERS[tab.kind] || { title: tab.title, subtitle: '' };
}

function normalizeDockSearch(search?: string) {
  if (typeof search !== 'string') return undefined;
  return search.startsWith('?') ? search.slice(1) : search;
}

function getWorkbenchSearchState(tab: Extract<DashboardDockTab, { kind: 'workbench' }>) {
  const search = normalizeDockSearch(tab.search);
  const params = typeof search === 'string' ? new URLSearchParams(search) : null;
  const runId = params?.get('runId') || params?.get('run') || (typeof search === 'string' ? null : tab.runId || null);
  const mode: WorkbenchMode = runId ? 'run' : params?.get('mode') === 'design' || tab.mode === 'design' ? 'design' : 'run';

  return {
    search,
    mode,
    runId,
  };
}

function buildWorkbenchSearch(tab: Extract<DashboardDockTab, { kind: 'workbench' }>) {
  const state = getWorkbenchSearchState(tab);
  if (typeof state.search === 'string') return state.search;
  return buildWorkbenchSearchParams(state.mode, state.runId);
}

function PageFrame({
  children,
  padded = false,
  scrollable = false,
}: {
  children: ReactNode;
  padded?: boolean;
  scrollable?: boolean;
}) {
  return (
    <div className={cn(
      'h-full min-h-0 bg-background text-foreground',
      scrollable || padded ? 'overflow-auto' : 'overflow-hidden',
      padded && 'p-6'
    )}>
      {children}
    </div>
  );
}

function WorkspacePanel(props: IDockviewPanelProps<WorkspacePanelParams>) {
  const tab = props.params;
  const dockWorkspace = useDashboardDockWorkspace();
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const [chatSecondarySidebarPercent, setChatSecondarySidebarPercent] = useState(() => {
    if (typeof window === 'undefined') return CHAT_SECONDARY_SIDEBAR_DEFAULT_PERCENT;
    return parseStoredChatSecondarySidebarPercent(window.localStorage.getItem(CHAT_SECONDARY_SIDEBAR_WIDTH_STORAGE_KEY));
  });
  const handleChatSecondarySidebarLayout = useCallback((layout: number[] | Record<string, number>) => {
    if (!tab.showChatSecondarySidebar) return;
    const nextSize = Number(Array.isArray(layout) ? layout[0] : layout['chat-secondary-sidebar-panel']);
    if (!Number.isFinite(nextSize)) return;
    const nextPercent = clampChatSecondarySidebarPercent(nextSize);
    setChatSecondarySidebarPercent((prev) => Math.abs(prev - nextPercent) < 0.1 ? prev : nextPercent);
    try {
      window.localStorage.setItem(CHAT_SECONDARY_SIDEBAR_WIDTH_STORAGE_KEY, `${Number(nextPercent.toFixed(2))}%`);
    } catch {}
  }, [tab.showChatSecondarySidebar]);
  const defaultHeader = useDashboardDockHeader(tab);
  let content: ReactNode;
  let scrollable = false;

  switch (tab.kind) {
    case 'chat':
      content = (
        <div ref={chatPanelRef} className="ace-dashboard-chat-panel-content relative h-full min-h-0 w-full min-w-0 overflow-hidden">
          <ResizablePanelGroup
            orientation="horizontal"
            className="h-full min-w-0"
            onLayoutChanged={handleChatSecondarySidebarLayout}
          >
            {tab.showChatSecondarySidebar && tab.renderChatSecondarySidebar ? (
              <>
                <ResizablePanel
                  id="chat-secondary-sidebar-panel"
                  defaultSize={formatPanelPercent(chatSecondarySidebarPercent)}
                  minSize={formatPanelPercent(CHAT_SECONDARY_SIDEBAR_MIN_PERCENT)}
                  maxSize={formatPanelPercent(CHAT_SECONDARY_SIDEBAR_MAX_PERCENT)}
                  className="hidden min-w-0 border-r border-border/70 lg:block"
                >
                  {tab.renderChatSecondarySidebar()}
                </ResizablePanel>
                <ResizableHandle withHandle className="hidden lg:flex" />
              </>
            ) : null}
            <ResizablePanel id="chat-main-panel" defaultSize={`${100 - chatSecondarySidebarPercent}%`} minSize="35%" className="min-w-0">
              <div className="ace-dashboard-chat-panel-main h-full min-w-0">
                <ChatPageContent
                  embedded
                  hideSidebar
                  onOpenSecondarySidebar={tab.onToggleChatSecondarySidebar}
                  secondarySidebarPinned={Boolean(tab.showChatSecondarySidebar)}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      );
      break;
    case 'overview':
      content = tab.renderOverview();
      scrollable = true;
      break;
    case 'agents':
      content = <AgentsManager embedded returnTarget={{ href: '/dashboard', label: '返回仪表盘' }} />;
      break;
    case 'skills':
      content = <SkillsManager embedded returnTarget={{ href: '/dashboard', label: '返回仪表盘' }} />;
      break;
    case 'settings':
      content = (
        <PageFrame padded>
          <div className="mx-auto w-full max-w-5xl">
            <SystemSettingsContent />
          </div>
        </PageFrame>
      );
      break;
    case 'channels':
      content = (
        <PageFrame padded>
          <div className="mx-auto w-full max-w-6xl">
            <ChannelIntegrationsContent />
          </div>
        </PageFrame>
      );
      break;
    case 'users':
      content = <UsersContent embedded />;
      scrollable = true;
      break;
    case 'workflows':
      content = <WorkflowsPage />;
      scrollable = true;
      break;
    case 'models':
      content = <ModelsPage />;
      scrollable = true;
      break;
    case 'engines':
      content = <EnginesPage />;
      scrollable = true;
      break;
    case 'schedules':
      content = <SchedulesPage />;
      scrollable = true;
      break;
    case 'run-history':
      content = (
        <RunHistoryPage
          embeddedSearch={tab.search || ''}
          onEmbeddedSearchChange={(search: string) => dockWorkspace?.updateActiveRunHistorySearch(search)}
        />
      );
      scrollable = true;
      break;
    case 'knowledge':
      content = <KnowledgePage />;
      scrollable = true;
      break;
    case 'knowledge-library':
      content = <KnowledgeLibraryPage />;
      break;
    case 'api-docs':
      content = <ApiDocsPage />;
      scrollable = true;
      break;
    case 'office':
      content = (
        <div className="h-full overflow-auto">
          <OfficePage embedded />
        </div>
      );
      break;
    case 'notebook':
      content = (
        <NotebookPageContent
          embedded
          embeddedSearch={tab.search || ''}
          onEmbeddedSearchChange={(search: string) => dockWorkspace?.updateActiveNotebookSearch(search)}
        />
      );
      break;
    case 'account':
      content = <AccountContent embedded embeddedSearch={tab.search || ''} />;
      break;
    case 'workbench':
      content = (
        <WorkbenchClient
          embeddedConfig={tab.config}
          embeddedSearch={buildWorkbenchSearch(tab)}
          embeddedInDashboard
        />
      );
      break;
    default:
      content = null;
  }

  return (
    <DashboardShellHeaderScope scopeId={props.api.id}>
      <WorkspacePanelBody
        panelId={props.api.id}
        header={defaultHeader}
        content={content}
        scrollable={scrollable}
        keepAlive={tab.kind !== 'workbench'}
        registerDefaultHeader={tab.kind !== 'workbench'}
      />
    </DashboardShellHeaderScope>
  );
}

function WorkspacePanelBody({
  panelId,
  header,
  content,
  scrollable = false,
  keepAlive = true,
  registerDefaultHeader = true,
}: {
  panelId: string;
  header: { title: string; subtitle: string };
  content: ReactNode;
  scrollable?: boolean;
  keepAlive?: boolean;
  registerDefaultHeader?: boolean;
}) {
  useDashboardShellHeader(registerDefaultHeader ? header : undefined, [registerDefaultHeader, header.title, header.subtitle]);

  if (!keepAlive) {
    return <PageFrame scrollable={scrollable}>{content}</PageFrame>;
  }

  return (
    <KeepAlive activeCacheKey={panelId} max={4} cacheNodeClassName="h-full min-h-0">
      <PageFrame scrollable={scrollable}>{content}</PageFrame>
    </KeepAlive>
  );
}

const components = {
  workspace: WorkspacePanel,
};

function shouldAlwaysRenderTab(tab: DashboardDockTab) {
  return tab.kind === 'chat';
}

function getDockviewPolicyInputForTab(tab: DashboardDockTab): DockviewTabPolicyInput {
  if (tab.kind === 'workbench') {
    const mode = tab.mode === 'design' ? 'design' : 'run';
    const runId = tab.runId || '';
    const workbenchIdentity = tab.config;
    return {
      resourceType: 'workflow-workbench',
      resourceId: workbenchIdentity,
      resourceTitle: tab.title,
      resourceSubtitle: runId ? `Mode: ${mode} · ${runId}` : `Mode: ${mode}`,
      openMode: 'canonical',
      preferredGroup: 'main',
      restoreKey: workbenchIdentity,
      contextActions: [],
    };
  }

  if (tab.kind === 'notebook' || tab.kind === 'account') {
    return {
      resourceType: tab.kind,
      resourceId: tab.id,
      resourceTitle: tab.title,
      openMode: 'canonical',
      preferredGroup: 'main',
      restoreKey: tab.id,
    };
  }

  return {
    resourceType: 'dashboard-destination',
    resourceId: tab.kind,
    resourceTitle: tab.title,
    openMode: 'canonical',
    preferredGroup: 'main',
    restoreKey: tab.kind,
  };
}

function resolvePolicyForDashboardTab(tab: DashboardDockTab) {
  return resolveDockviewTabPolicy(getDockviewPolicyInputForTab(tab));
}

function withWorkspaceParams(tab: DashboardDockTab): DashboardDockTab & { dockviewPolicy: DockviewTabPolicy } {
  return {
    ...tab,
    dockviewPolicy: resolvePolicyForDashboardTab(tab),
  };
}

function normalizeDashboardDockTab(tab: DashboardDockTab): DashboardDockTab & { dockviewPolicy: DockviewTabPolicy } {
  if (tab.kind !== 'workbench') return withWorkspaceParams(tab);
  const state = getWorkbenchSearchState(tab);
  return withWorkspaceParams({
    ...tab,
    search: state.search,
    mode: state.mode,
    runId: state.runId,
    id: `workbench:${encodeURIComponent(tab.config)}`,
  });
}

function hasSameReusablePanelParams(current: WorkspacePanelParams, next: DashboardDockTab) {
  if (current.id !== next.id || current.kind !== next.kind || current.title !== next.title) {
    return false;
  }

  if (current.kind === 'workbench' && next.kind === 'workbench') {
    const currentState = getWorkbenchSearchState(current);
    const nextState = getWorkbenchSearchState(next);
    return current.config === next.config
      && (currentState.search || '') === (nextState.search || '')
      && currentState.mode === nextState.mode
      && (currentState.runId || '') === (nextState.runId || '');
  }

  if (current.kind === 'run-history' && next.kind === 'run-history') {
    return (normalizeDockSearch(current.search) || '') === (normalizeDockSearch(next.search) || '');
  }

  if ((current.kind === 'notebook' && next.kind === 'notebook')
    || (current.kind === 'account' && next.kind === 'account')) {
    return (normalizeDockSearch(current.search) || '') === (normalizeDockSearch(next.search) || '');
  }

  return true;
}

function findReusableDockPanel(api: DockviewApi, tab: DashboardDockTab & { dockviewPolicy: DockviewTabPolicy }) {
  const exact = api.getPanel(tab.id);
  if (exact) return exact;

  if (!tab.dockviewPolicy.reuseExisting) return undefined;

  return api.panels.find((panel) => {
    const params = panel.params as WorkspacePanelParams | undefined;
    if (!params?.dockviewPolicy) return false;
    return shouldReuseDockviewTab(params.dockviewPolicy, {
      resourceType: tab.dockviewPolicy.resourceType,
      resourceId: tab.dockviewPolicy.resourceId,
      openMode: tab.dockviewPolicy.openMode,
      restoreKey: tab.dockviewPolicy.restoreKey,
    });
  });
}

function getDropDirection(event: DragEvent<HTMLDivElement>, element: HTMLDivElement): Exclude<Direction, 'within'> | null {
  const rect = element.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const edgeX = rect.width * 0.24;
  const edgeY = rect.height * 0.24;
  if (x < edgeX) return 'left';
  if (x > rect.width - edgeX) return 'right';
  if (y < edgeY) return 'above';
  if (y > rect.height - edgeY) return 'below';
  return null;
}

function readDraggedTab(event: DragEvent<HTMLDivElement>): DashboardDockTab | null {
  const raw = event.dataTransfer.getData(DASHBOARD_DOCK_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DashboardDockTab;
    if (parsed?.id && parsed?.title && parsed?.kind) return parsed;
  } catch {}
  return null;
}

function refreshDockPanel(panel: IDockviewPanel | undefined) {
  if (!panel) return;
  const params = panel.params as WorkspacePanelParams | undefined;
  if (!params) return;
  panel.api.setTitle(`${panel.api.title || params.title}`);
  panel.update({ params: { ...params } });
}

function closeDockPanels(panels: IDockviewPanel[]) {
  for (const panel of panels) {
    panel.api.close();
  }
}

function getContextActionGroups(actions: readonly DockviewContextAction[]) {
  return groupDockviewContextActions(actions);
}

function DashboardDockTabComponent({ api, containerApi, tabLocation }: IDockviewPanelHeaderProps) {
  const currentPanel = containerApi.getPanel(api.id);
  const currentParams = currentPanel?.params as WorkspacePanelParams | undefined;
  const policyActionGroups = getContextActionGroups(currentParams?.dockviewPolicy?.contextActions || []);
  const policyActions = [
    ...policyActionGroups.run,
    ...policyActionGroups.edit,
    ...policyActionGroups.view,
    ...policyActionGroups.export,
    ...policyActionGroups.danger,
  ];
  const groupPanels = api.group.panels;
  const currentIndex = groupPanels.findIndex((panel) => panel.id === api.id);
  const leftPanels = currentIndex > 0 ? groupPanels.slice(0, currentIndex) : [];
  const rightPanels = currentIndex >= 0 ? groupPanels.slice(currentIndex + 1) : [];
  const otherPanels = groupPanels.filter((panel) => panel.id !== api.id);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="ace-dock-tab" data-location={tabLocation}>
          <button
            type="button"
            className="ace-dock-tab__title"
            onClick={() => api.setActive()}
            title={api.title}
          >
            {api.title}
          </button>
          <button
            type="button"
            className="ace-dock-tab__close"
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              api.close();
            }}
            aria-label={`关闭 ${api.title}`}
            title="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onSelect={() => refreshDockPanel(currentPanel)}>
          刷新
        </ContextMenuItem>
        <ContextMenuSeparator />
        {policyActions.length > 0 ? (
          <>
            {policyActions.map((action) => (
              <ContextMenuItem
                key={action.id}
                disabled
                className={cn((action.danger || action.group === 'danger') && 'text-destructive')}
                title={action.disabledReason || '该 Dockview 策略动作由页面内部控件执行'}
              >
                {action.label}
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
          </>
        ) : null}
        <ContextMenuItem onSelect={() => api.close()}>
          关闭
        </ContextMenuItem>
        <ContextMenuItem
          disabled={otherPanels.length === 0}
          onSelect={() => closeDockPanels(otherPanels)}
        >
          关闭其他
        </ContextMenuItem>
        <ContextMenuItem
          disabled={leftPanels.length === 0}
          onSelect={() => closeDockPanels(leftPanels)}
        >
          关闭左侧
        </ContextMenuItem>
        <ContextMenuItem
          disabled={rightPanels.length === 0}
          onSelect={() => closeDockPanels(rightPanels)}
        >
          关闭右侧
        </ContextMenuItem>
        <ContextMenuItem
          disabled={groupPanels.length === 0}
          onSelect={() => closeDockPanels([...groupPanels])}
        >
          关闭全部
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export const DashboardDockWorkspace = forwardRef<DashboardDockWorkspaceHandle, DashboardDockWorkspaceProps>(
  function DashboardDockWorkspace({
    className,
    renderOverview,
    initialTab,
    onFallbackChatOpen,
    onActiveTabChange,
    onToggleChatSecondarySidebar,
    chatSecondarySidebarPinned,
    showChatSecondarySidebar,
    renderChatSecondarySidebar,
    singlePanelMode,
  }, ref) {
    const apiRef = useRef<DockviewApi | null>(null);
    const renderOverviewRef = useRef(renderOverview);
    const initialTabRef = useRef(initialTab);
    const toggleChatSecondarySidebarRef = useRef(onToggleChatSecondarySidebar);
    const chatSecondarySidebarPinnedRef = useRef(chatSecondarySidebarPinned);
    const showChatSecondarySidebarRef = useRef(showChatSecondarySidebar);
    const renderChatSecondarySidebarRef = useRef(renderChatSecondarySidebar);
    const singlePanelModeRef = useRef(singlePanelMode);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const shellHeader = useDashboardShellHeaderController();
    const replacingSinglePanelRef = useRef(false);
    const tabDragRef = useRef<{
      previousPanelId: string | null;
      startX: number;
      startY: number;
      dragging: boolean;
    } | null>(null);

    useEffect(() => {
      renderOverviewRef.current = renderOverview;
    }, [renderOverview]);

    useEffect(() => {
      initialTabRef.current = initialTab;
    }, [initialTab]);

    useEffect(() => {
      singlePanelModeRef.current = singlePanelMode;
    }, [singlePanelMode]);

    useEffect(() => {
      toggleChatSecondarySidebarRef.current = onToggleChatSecondarySidebar;
    }, [onToggleChatSecondarySidebar]);

    useEffect(() => {
      chatSecondarySidebarPinnedRef.current = chatSecondarySidebarPinned;
      showChatSecondarySidebarRef.current = showChatSecondarySidebar;
      renderChatSecondarySidebarRef.current = renderChatSecondarySidebar;
      const chatPanel = apiRef.current?.getPanel('chat');
      const params = chatPanel?.params as WorkspacePanelParams | undefined;
      if (chatPanel && params) {
        chatPanel.update({
          params: {
            ...params,
            chatSecondarySidebarPinned,
            showChatSecondarySidebar,
            renderChatSecondarySidebar,
          },
        });
      }
    }, [chatSecondarySidebarPinned, renderChatSecondarySidebar, showChatSecondarySidebar]);

    const openTab = useCallback((tab: DashboardDockTab, options?: DashboardDockOpenOptions) => {
      const api = apiRef.current;
      if (!api) return;
      const normalizedTab = normalizeDashboardDockTab(tab);

      const existing = findReusableDockPanel(api, normalizedTab);
      if (existing) {
        const params = existing.params as WorkspacePanelParams | undefined;
        if (params && !hasSameReusablePanelParams(params, normalizedTab)) {
          if (existing.api.title !== normalizedTab.title) {
            existing.api.setTitle(normalizedTab.title);
          }
          existing.update({
            params: {
              ...params,
              ...normalizedTab,
              renderOverview: () => renderOverviewRef.current(),
              onToggleChatSecondarySidebar: () => toggleChatSecondarySidebarRef.current?.(),
              chatSecondarySidebarPinned: chatSecondarySidebarPinnedRef.current,
              showChatSecondarySidebar: showChatSecondarySidebarRef.current,
              renderChatSecondarySidebar: () => renderChatSecondarySidebarRef.current?.(),
              dockviewPolicy: normalizedTab.dockviewPolicy,
            },
          });
        }
        existing.api.setActive();
        if (singlePanelModeRef.current) {
          for (const panel of [...api.panels]) {
            if (panel.id !== existing.id) panel.api.close();
          }
        }
        return;
      }

      if (singlePanelModeRef.current) {
        replacingSinglePanelRef.current = true;
        for (const panel of [...api.panels]) {
          panel.api.close();
        }
      }

      const addedPanel = api.addPanel<WorkspacePanelParams>({
        id: normalizedTab.id,
        title: normalizedTab.title,
        component: 'workspace',
        renderer: shouldAlwaysRenderTab(normalizedTab) ? 'always' : undefined,
        floating: false,
        position: options?.position,
        params: {
          ...normalizedTab,
          renderOverview: () => renderOverviewRef.current(),
          onToggleChatSecondarySidebar: () => toggleChatSecondarySidebarRef.current?.(),
          chatSecondarySidebarPinned: chatSecondarySidebarPinnedRef.current,
          showChatSecondarySidebar: showChatSecondarySidebarRef.current,
          renderChatSecondarySidebar: () => renderChatSecondarySidebarRef.current?.(),
          dockviewPolicy: normalizedTab.dockviewPolicy,
        },
      });
      if (singlePanelModeRef.current) {
        replacingSinglePanelRef.current = false;
      }
      addedPanel.api.setActive();
    }, []);

    const updateActiveWorkbenchSearch = useCallback((config: string, search: string) => {
      const api = apiRef.current;
      const activePanel = api?.activePanel;
      if (!activePanel) return;
      const params = activePanel.params as WorkspacePanelParams | undefined;
      if (!params || params.kind !== 'workbench' || params.config !== config) return;

      const normalizedSearch = search.startsWith('?') ? search.slice(1) : search;
      const searchParams = new URLSearchParams(normalizedSearch);
      const nextParams = {
        ...params,
        search: normalizedSearch,
        mode: searchParams.get('mode') || params.mode || 'run',
        runId: searchParams.get('runId') || searchParams.get('run') || null,
      };
      activePanel.update({
        params: nextParams,
      });
      onActiveTabChange?.(nextParams);
    }, [onActiveTabChange]);

    const updateActiveRunHistorySearch = useCallback((search: string) => {
      const api = apiRef.current;
      const activePanel = api?.activePanel;
      if (!activePanel) return;
      const params = activePanel.params as WorkspacePanelParams | undefined;
      if (!params || params.kind !== 'run-history') return;

      const normalizedSearch = search.startsWith('?') ? search.slice(1) : search;
      activePanel.update({
        params: {
          ...params,
          search: normalizedSearch,
        },
      });
    }, []);

    const updateActiveNotebookSearch = useCallback((search: string) => {
      const api = apiRef.current;
      const activePanel = api?.activePanel;
      if (!activePanel) return;
      const params = activePanel.params as WorkspacePanelParams | undefined;
      if (!params || params.kind !== 'notebook') return;

      const normalizedSearch = search.startsWith('?') ? search.slice(1) : search;
      const searchParams = new URLSearchParams(normalizedSearch);
      const scope = searchParams.get('notebookScope') === 'personal' ? 'personal' : 'global';
      const file = searchParams.get('notebookFile') || searchParams.get('notebookShare') || 'root';
      activePanel.update({
        params: {
          ...params,
          id: `notebook:${scope}:${file}`,
          search: normalizedSearch,
        },
      });
    }, []);

    useImperativeHandle(ref, () => ({
      openTab,
      updateActiveWorkbenchSearch,
      refreshActiveTab: () => {
        const panel = apiRef.current?.activePanel;
        if (!panel) return;
        const params = panel.params as WorkspacePanelParams | undefined;
        if (params) {
          panel.api.setTitle(`${panel.api.title || params.title}`);
          panel.update({ params: { ...params } });
        }
      },
    }), [openTab, updateActiveWorkbenchSearch]);

    const handleReady = useCallback((event: DockviewReadyEvent) => {
      apiRef.current = event.api;
      const openFallbackChatPanel = () => event.api.addPanel<WorkspacePanelParams>({
        id: 'chat',
        title: '对话',
        component: 'workspace',
        renderer: 'always',
        params: {
          id: 'chat',
          title: '对话',
          kind: 'chat',
          dockviewPolicy: resolvePolicyForDashboardTab({ id: 'chat', title: '对话', kind: 'chat' }),
          renderOverview: () => renderOverviewRef.current(),
          onToggleChatSecondarySidebar: () => toggleChatSecondarySidebarRef.current?.(),
          chatSecondarySidebarPinned: chatSecondarySidebarPinnedRef.current,
          showChatSecondarySidebar: showChatSecondarySidebarRef.current,
          renderChatSecondarySidebar: () => renderChatSecondarySidebarRef.current?.(),
        },
      });
      const initial = initialTabRef.current ? normalizeDashboardDockTab(initialTabRef.current) : undefined;
      const panel = initial
        ? event.api.addPanel<WorkspacePanelParams>({
            id: initial.id,
            title: initial.title,
            component: 'workspace',
            renderer: shouldAlwaysRenderTab(initial) ? 'always' : undefined,
            params: {
              ...initial,
              renderOverview: () => renderOverviewRef.current(),
              onToggleChatSecondarySidebar: () => toggleChatSecondarySidebarRef.current?.(),
              chatSecondarySidebarPinned: chatSecondarySidebarPinnedRef.current,
              showChatSecondarySidebar: showChatSecondarySidebarRef.current,
              renderChatSecondarySidebar: () => renderChatSecondarySidebarRef.current?.(),
              dockviewPolicy: initial.dockviewPolicy,
            },
          })
        : openFallbackChatPanel();
      shellHeader?.setActiveScopeId(panel.id);
      onActiveTabChange?.(panel.params as WorkspacePanelParams);
      const activePanelDisposable = event.api.onDidActivePanelChange(({ panel: activePanel }) => {
        shellHeader?.setActiveScopeId(activePanel?.id || null);
        onActiveTabChange?.((activePanel?.params as WorkspacePanelParams | undefined) || null);
      });
      const removePanelDisposable = event.api.onDidRemovePanel(() => {
        window.setTimeout(() => {
          if (replacingSinglePanelRef.current) return;
          if (event.api.panels.length > 0) return;
          const fallbackPanel = openFallbackChatPanel();
          shellHeader?.setActiveScopeId(fallbackPanel.id);
          onActiveTabChange?.(fallbackPanel.params as WorkspacePanelParams);
          onFallbackChatOpen?.();
        }, 0);
      });
      return () => {
        activePanelDisposable.dispose();
        removePanelDisposable.dispose();
      };
    }, [onActiveTabChange, onFallbackChatOpen, shellHeader]);

    const dockviewComponents = useMemo(() => components, []);

    const restorePreDragActivePanel = useCallback(() => {
      const previousPanelId = tabDragRef.current?.previousPanelId;
      const previousPanel = previousPanelId ? apiRef.current?.getPanel(previousPanelId) : null;
      previousPanel?.api.setActive();
    }, []);

    const handlePointerDownCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (event.button !== 0 || !target?.closest('.dv-tab')) return;
      tabDragRef.current = {
        previousPanelId: apiRef.current?.activePanel?.id || null,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
      };
    }, []);

    const handlePointerMoveCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      const pending = tabDragRef.current;
      if (!pending || pending.dragging) return;
      const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
      if (distance < 6) return;
      pending.dragging = true;
    }, []);

    const handlePointerUpCapture = useCallback(() => {
      window.setTimeout(() => {
        tabDragRef.current = null;
      }, 0);
    }, []);

    const handleTabDragStartCapture = useCallback((event: DragEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.dv-tab')) return;
      const pending = tabDragRef.current;
      if (!pending) return;
      const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
      if (distance < 6) return;
      pending.dragging = true;
      window.requestAnimationFrame(restorePreDragActivePanel);
    }, [restorePreDragActivePanel]);

    const handleTabDragEndCapture = useCallback((event: DragEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.dv-tab')) return;
      if (tabDragRef.current?.dragging) {
        window.setTimeout(restorePreDragActivePanel, 0);
      }
      window.setTimeout(() => {
        tabDragRef.current = null;
      }, 0);
    }, [restorePreDragActivePanel]);

    const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes(DASHBOARD_DOCK_DRAG_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }, []);

    const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
      const tab = readDraggedTab(event);
      if (!tab || !rootRef.current) return;
      event.preventDefault();
      const direction = getDropDirection(event, rootRef.current);
      const activePanel = apiRef.current?.activePanel;
      openTab(tab, direction && activePanel ? {
        position: {
          referencePanel: activePanel,
          direction,
        },
      } : undefined);
    }, [openTab]);

    const workspaceContextValue = useMemo<DashboardDockWorkspaceContextValue>(() => ({
      openTab,
      updateActiveWorkbenchSearch,
      updateActiveRunHistorySearch,
      updateActiveNotebookSearch,
    }), [openTab, updateActiveNotebookSearch, updateActiveRunHistorySearch, updateActiveWorkbenchSearch]);

    return (
      <div
        ref={rootRef}
        className={cn(
          'ace-dashboard-dockview dockview-theme-light h-full min-h-0 overflow-hidden',
          singlePanelMode && 'ace-dashboard-dockview--single-panel',
          className
        )}
        onPointerDownCapture={handlePointerDownCapture}
        onPointerMoveCapture={handlePointerMoveCapture}
        onPointerUpCapture={handlePointerUpCapture}
        onDragStartCapture={handleTabDragStartCapture}
        onDragEndCapture={handleTabDragEndCapture}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <DashboardDockWorkspaceContext.Provider value={workspaceContextValue}>
          <DockviewReact
            className="h-full min-h-0"
            components={dockviewComponents}
            defaultTabComponent={DashboardDockTabComponent}
            onReady={handleReady}
            disableFloatingGroups
          />
        </DashboardDockWorkspaceContext.Provider>
      </div>
    );
  }
);
