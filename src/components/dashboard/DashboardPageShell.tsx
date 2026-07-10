'use client';

import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties, type DragEvent, type PointerEvent, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from '@/lib/navigation/client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Activity, Building2, Cpu, TrendingUp, Clock, CheckCircle2, XCircle, AlertCircle, Workflow, Bot, Settings, Play, Package, FileText, History, NotebookTabs, Layers3, Loader2, BarChart3, PanelLeftClose, PanelLeftOpen, MessageSquareText, Microchip, ServerCog, Grid2X2, Zap, Bug } from 'lucide-react';

import { useTranslations } from '@/hooks/useTranslations';
import { Button } from '@/components/ui/button';
import { DataCard, DataCardDescription, DataCardHeader, DataCardMeta, DataCardTitle } from '@/components/ui/data-card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { StatusPill } from '@/components/ui/status-pill';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar';
import ThemeTabs from '@/components/ui/theme-tabs';
import LanguageSelectorDropdown from '@/components/ui/language-selector-dropdown';
import NewConfigModal from '@/components/NewConfigModal';
import UserMenu from '@/components/UserMenu';
import { RobotLogo } from '@/components/brand/RobotLogo';
import ChatSidebar, { type SessionDirectoryView } from '@/components/chat/ChatSidebar';
import { WorkspaceEditor } from '@/components/workspace/WorkspaceEditor';
import { systemSettingsApi } from '@/lib/core/api';
import {
  DASHBOARD_DOCK_DRAG_MIME,
  DashboardDockWorkspace,
  type DashboardDockTab,
  type DashboardDockWorkspaceHandle,
} from '@/components/dashboard/DashboardDockWorkspace';
import {
  DashboardShellHeaderProvider,
  useDashboardShellHeaderController,
} from '@/components/dashboard/DashboardShellHeader';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/core/utils';
import { buildLoginHref, getCurrentAuthReturnTo } from '@/lib/navigation/return-target';
import pkgJson from '../../../package.json';

interface DashboardStats {
  totalRuns: number;
  successRate: number;
  avgDuration: number;
  activeWorkflows: number;
  weeklyRuns: number;
  totalTokenUsage: number;
  weeklyTokenUsage: number;
  totalAgents: number;
  runningProcesses: number;
}

interface TokenRankingItem {
  name: string;
  configFile?: string;
  runs: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cost: number;
}

const WORKFLOW_TOKEN_RANKING_HREF = '/run-history?view=token-ranking&dimension=workflow&sortKey=totalTokens&sortDirection=desc&page=1';
const DASHBOARD_CACHE_KEY = 'dashboard-cache';
const DASHBOARD_CACHE_TTL = 5 * 60 * 1000;
const SIDEBAR_COOKIE_NAME = 'sidebar:state';
const DASHBOARD_NAVIGATION_MODE_STORAGE_KEY = 'aceharness:dashboard:navigation-mode';
const DASHBOARD_SIDEBAR_WIDTH_STORAGE_KEY = 'aceharness:dashboard:sidebar-width';
const DASHBOARD_SIDEBAR_WIDTH_DEFAULT = 288;
const DASHBOARD_SIDEBAR_WIDTH_MIN = 224;
const DASHBOARD_SIDEBAR_WIDTH_MAX = 360;
type DashboardPanel = 'chat' | 'overview' | 'agents' | 'skills' | 'settings';
type DashboardDragTab = DashboardDockTab;
type DashboardNavigationMode = 'modern' | 'classic';

type DashboardUser = {
  username: string;
  email: string;
  role: 'admin' | 'user';
  avatar?: string;
};

function DashboardUnifiedHeader({
  currentUser,
  navigationMode,
  onNavigationModeChange,
  activeTabKind,
  onBackToOverview,
  onOpenChat,
}: {
  currentUser: DashboardUser | null;
  navigationMode: DashboardNavigationMode;
  onNavigationModeChange: (mode: DashboardNavigationMode) => void;
  activeTabKind: DashboardDockTab['kind'] | null;
  onBackToOverview: () => void;
  onOpenChat: () => void;
}) {
  const shellHeader = useDashboardShellHeaderController();
  const activeHeader = shellHeader?.activeHeader;
  const { t } = useTranslations();
  useDocumentTitle(activeHeader?.title || t('dashboard.headers.defaultTitle'));

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-4 border-b border-border/60 bg-background/95 px-5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      {navigationMode === 'classic' && activeTabKind !== 'overview' && activeTabKind !== 'chat' ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-2 rounded-full px-3 text-xs"
          onClick={onBackToOverview}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          {t('dashboard.sidebar.backToOverview')}
        </Button>
      ) : null}
      <div className="min-w-0 shrink-0">
        <div className="truncate text-base font-semibold">{activeHeader?.title || t('dashboard.headers.defaultTitle')}</div>
        <div className="truncate text-xs text-muted-foreground">{activeHeader?.subtitle || t('dashboard.headers.defaultSubtitle')}</div>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-start gap-2 overflow-hidden">
        {activeHeader?.leadingActions}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2">
        {activeHeader?.actions}
        {navigationMode === 'classic' && activeTabKind === 'overview' ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-2 rounded-full px-3 text-xs"
              onClick={onOpenChat}
            >
              <MessageSquareText className="h-3.5 w-3.5" />
              {t('dashboard.quickActions.chatMode')}
            </Button>
            <div className="hidden items-center gap-2 sm:flex">
              <ThemeTabs className="shrink-0" />
              <LanguageSelectorDropdown className="w-[112px]" />
            </div>
          </>
        ) : null}
        {navigationMode === 'classic' && activeTabKind === 'chat' ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-2 rounded-full px-3 text-xs"
            onClick={onBackToOverview}
          >
            <Grid2X2 className="h-3.5 w-3.5" />
            {t('dashboard.sidebar.dashboardEntry')}
          </Button>
        ) : null}
        {navigationMode === 'classic' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="hidden h-8 gap-2 rounded-full px-3 text-xs md:inline-flex"
            onClick={() => onNavigationModeChange('modern')}
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
            {t('dashboard.sidebar.modernMode')}
          </Button>
        ) : null}
        <UserMenu user={currentUser} />
      </div>
    </header>
  );
}

const WORKBENCH_OUTER_QUERY_KEYS = [
  'mode',
  'run',
  'runId',
  'workspace',
  'workspaceFile',
  'workspaceLine',
  'workspaceColumn',
  'changes',
  'tab',
  'history',
  'designTab',
  'focus',
  'questionId',
  'section',
  'autoStart',
];

function DashboardSidebarFooter({ onUseClassicMode }: { onUseClassicMode: () => void }) {
  const { state, toggleSidebar } = useSidebar();
  const { t } = useTranslations();
  const collapsed = state === 'collapsed';
  const toggleLabel = collapsed ? t('dashboard.sidebar.expand') : t('dashboard.sidebar.collapse');

  return (
    <SidebarFooter className="border-t border-sidebar-border/70 p-3">
      <div className="flex items-center gap-2 group-data-[collapsible=icon]:hidden">
        <ThemeTabs className="shrink-0" />
        <LanguageSelectorDropdown className="min-w-0 flex-1" />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-9 w-full justify-start gap-2 px-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
        onClick={toggleSidebar}
        title={toggleLabel}
      >
        {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        <span className="group-data-[collapsible=icon]:hidden">{toggleLabel}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-9 w-full justify-start gap-2 px-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
        onClick={onUseClassicMode}
        title={t('dashboard.sidebar.classicMode')}
      >
        <PanelLeftClose className="h-4 w-4" />
        <span className="group-data-[collapsible=icon]:hidden">{t('dashboard.sidebar.classicMode')}</span>
      </Button>
    </SidebarFooter>
  );
}

const EMBEDDED_DASHBOARD_ROUTE_BASES = new Set([
  '/office',
  '/workflows',
  '/models',
  '/engines',
  '/schedules',
  '/run-history',
  '/knowledge',
  '/knowledge/library',
  '/notebook',
  '/account',
  '/account/system-settings',
  '/account/channels',
  '/users',
  '/api-docs',
]);

function getEmbeddedRouteBasePath(route: string): string {
  return route.split(/[?#]/, 1)[0] || '/';
}

function normalizeEmbeddedRoute(route: string | null): string | null {
  if (!route) return null;
  const trimmed = route.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  const basePath = getEmbeddedRouteBasePath(trimmed);
  if (basePath === '/dashboard' || basePath.startsWith('/dashboard/')) return null;
  if (basePath.startsWith('/workbench/')) return trimmed;
  if (EMBEDDED_DASHBOARD_ROUTE_BASES.has(basePath)) return trimmed;
  return null;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value || 0);
}

function formatMoney(value: number): string {
  return `$${(value || 0).toFixed(4)}`;
}

function formatStateName(name: string): string {
  if (name === '__origin__') return '开始';
  if (name === '__human_approval__') return '人工审查';
  return name;
}

function getRunStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'info' | 'danger' | 'accent' {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'crashed') return 'danger';
  if (status === 'running') return 'info';
  if (status === 'stopped') return 'warning';
  return 'neutral';
}

function getRunStatusIcon(status: string) {
  if (status === 'completed') return CheckCircle2;
  if (status === 'failed' || status === 'crashed') return XCircle;
  if (status === 'running') return Play;
  if (status === 'stopped') return AlertCircle;
  return Clock;
}

function readStoredSidebarOpen(): boolean {
  if (typeof document === 'undefined') return true;
  const match = document.cookie
    .split('; ')
    .find((item) => item.startsWith(`${SIDEBAR_COOKIE_NAME}=`));
  if (!match) return true;
  return match.split('=')[1] !== 'false';
}

function readStoredNavigationMode(): DashboardNavigationMode {
  if (typeof window === 'undefined') return 'modern';
  return window.localStorage.getItem(DASHBOARD_NAVIGATION_MODE_STORAGE_KEY) === 'classic' ? 'classic' : 'modern';
}

function clampDashboardSidebarWidth(width: number): number {
  return Math.min(DASHBOARD_SIDEBAR_WIDTH_MAX, Math.max(DASHBOARD_SIDEBAR_WIDTH_MIN, Math.round(width)));
}

function readStoredDashboardSidebarWidth(): number {
  if (typeof window === 'undefined') return DASHBOARD_SIDEBAR_WIDTH_DEFAULT;
  try {
    const stored = Number(window.localStorage.getItem(DASHBOARD_SIDEBAR_WIDTH_STORAGE_KEY));
    return Number.isFinite(stored) ? clampDashboardSidebarWidth(stored) : DASHBOARD_SIDEBAR_WIDTH_DEFAULT;
  } catch {
    return DASHBOARD_SIDEBAR_WIDTH_DEFAULT;
  }
}

function getDashboardRouteOwner(tab: DashboardDockTab | null): string | null {
  if (!tab) return null;
  if (tab.kind === 'workbench' || tab.kind === 'workflows') return '/workflows';
  if (tab.kind === 'knowledge' || tab.kind === 'knowledge-library' || tab.kind === 'notebook') return '/knowledge';
  if (tab.kind === 'run-history') return '/run-history';
  if (tab.kind === 'models') return '/models';
  if (tab.kind === 'engines') return '/engines';
  if (tab.kind === 'schedules') return '/schedules';
  if (tab.kind === 'api-docs') return '/api-docs';
  if (tab.kind === 'office') return '/office';
  return null;
}

export default function DashboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useTranslations();
  const [stats, setStats] = useState<DashboardStats>({
    totalRuns: 0,
    successRate: 0,
    avgDuration: 0,
    activeWorkflows: 0,
    weeklyRuns: 0,
    totalTokenUsage: 0,
    weeklyTokenUsage: 0,
    totalAgents: 0,
    runningProcesses: 0,
  });
  const [configs, setConfigs] = useState<any[]>([]);
  const [recentRuns, setRecentRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [activityData, setActivityData] = useState<any[]>([]);
  const [runningRuns, setRunningRuns] = useState<any[]>([]);
  const [tokenRankingByWorkflow, setTokenRankingByWorkflow] = useState<TokenRankingItem[]>([]);
  const [tokenActivityData, setTokenActivityData] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<DashboardUser | null>(null);
  const [conversationView, setConversationView] = useState<SessionDirectoryView>('conversation');
  const [secondarySidebarOpen, setSecondarySidebarOpen] = useState(true);
  const [mainSidebarOpen, setMainSidebarOpen] = useState(readStoredSidebarOpen);
  const [dashboardSidebarWidth, setDashboardSidebarWidth] = useState(DASHBOARD_SIDEBAR_WIDTH_DEFAULT);
  const [dashboardSidebarResizing, setDashboardSidebarResizing] = useState(false);
  const [navigationMode, setNavigationModeState] = useState<DashboardNavigationMode>(readStoredNavigationMode);
  const [activeDockTab, setActiveDockTab] = useState<DashboardDockTab | null>({ id: 'chat', title: t('dashboard.quickActions.chatMode'), kind: 'chat' });
  const [acpxTraceEnabled, setAcpxTraceEnabled] = useState(false);
  const [acpxTraceDirectory, setAcpxTraceDirectory] = useState('');
  const [acpxTraceWorkspaceOpen, setAcpxTraceWorkspaceOpen] = useState(false);
  const workspaceRef = useRef<DashboardDockWorkspaceHandle | null>(null);
  const suppressSidebarClickRef = useRef(false);
  const sidebarResizeFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setDashboardSidebarWidth(readStoredDashboardSidebarWidth());
  }, []);

  const panelParam = searchParams.get('panel');
  const activeEmbeddedRoute = normalizeEmbeddedRoute(searchParams.get('route'));
  const activePanel: DashboardPanel = panelParam === 'chat' || panelParam === 'agents' || panelParam === 'skills' || panelParam === 'settings'
    ? panelParam
    : panelParam === 'overview'
      ? 'overview'
      : 'chat';
  const shellPath = pathname === '/dashboard' ? '/dashboard' : '/';
  const buildShellUrl = useCallback((params?: URLSearchParams) => {
    const query = params?.toString();
    return query ? `${shellPath}?${query}` : shellPath;
  }, [shellPath]);

  const buildShellUrlForDockTab = useCallback((tab: DashboardDockTab | null, baseSearch?: string) => {
    const params = new URLSearchParams(baseSearch ?? searchParams.toString());
    params.delete('reload');
    params.delete('returnTo');
    if (tab?.kind !== 'workbench') {
      WORKBENCH_OUTER_QUERY_KEYS.forEach((key) => params.delete(key));
    }
    if (!tab || tab.kind === 'chat') {
      params.delete('panel');
      params.delete('route');
      return buildShellUrl(params);
    }

    const panelKindMap: Partial<Record<DashboardDockTab['kind'], DashboardPanel>> = {
      overview: 'overview',
      agents: 'agents',
      skills: 'skills',
      settings: 'settings',
    };
    const panel = panelKindMap[tab.kind];
    if (panel) {
      params.delete('route');
      params.set('panel', panel);
      return buildShellUrl(params);
    }

    const routeByKind: Partial<Record<DashboardDockTab['kind'], string>> = {
      workflows: '/workflows',
      models: '/models',
      engines: '/engines',
      schedules: '/schedules',
      'run-history': '/run-history',
      knowledge: '/knowledge',
      'knowledge-library': '/knowledge/library',
      'api-docs': '/api-docs',
      office: '/office',
      channels: '/account/channels',
      users: '/users',
    };
    let route = routeByKind[tab.kind] || '';
    if (tab.kind === 'run-history') {
      route = `/run-history${tab.search ? `?${tab.search}` : ''}`;
    } else if (tab.kind === 'notebook') {
      route = `/notebook${tab.search ? `?${tab.search}` : ''}`;
    } else if (tab.kind === 'account') {
      route = `/account${tab.search ? `?${tab.search}` : ''}`;
    } else if (tab.kind === 'workbench') {
      WORKBENCH_OUTER_QUERY_KEYS.forEach((key) => params.delete(key));
      if (tab.search) {
        route = `/workbench/${encodeURIComponent(tab.config)}${tab.search.startsWith('?') ? tab.search : `?${tab.search}`}`;
      } else {
      const workbenchParams = new URLSearchParams();
      if (tab.mode) workbenchParams.set('mode', tab.mode);
      if (tab.runId) workbenchParams.set('runId', tab.runId);
      const query = workbenchParams.toString();
      route = `/workbench/${encodeURIComponent(tab.config)}${query ? `?${query}` : ''}`;
      }
    }

    if (route) {
      params.delete('panel');
      params.set('route', route);
    }
    return buildShellUrl(params);
  }, [buildShellUrl, searchParams]);

  const setActivePanel = useCallback((panel: DashboardPanel) => {
    const tabMap: Record<DashboardPanel, DashboardDockTab> = {
      chat: { id: 'chat', title: t('dashboard.quickActions.chatMode'), kind: 'chat' },
      overview: { id: 'overview', title: t('dashboard.overviewTitle'), kind: 'overview' },
      agents: { id: 'agents', title: t('dashboard.quickActions.manageAgents'), kind: 'agents' },
      skills: { id: 'skills', title: t('dashboard.quickActions.skills'), kind: 'skills' },
      settings: { id: 'settings', title: t('dashboard.quickActions.envVars'), kind: 'settings' },
    };
    workspaceRef.current?.openTab(tabMap[panel]);

    const params = new URLSearchParams(searchParams.toString());
    params.delete('route');
    params.delete('reload');
    WORKBENCH_OUTER_QUERY_KEYS.forEach((key) => params.delete(key));
    if (panel === 'chat') {
      params.delete('panel');
    } else {
      params.set('panel', panel);
    }
    router.push(buildShellUrl(params));
  }, [buildShellUrl, router, searchParams, t]);

  const handleFallbackChatOpen = useCallback(() => {
    setSecondarySidebarOpen(true);
    router.push(buildShellUrl());
  }, [buildShellUrl, router]);

  const handleToggleChatSecondarySidebar = useCallback(() => {
    setSecondarySidebarOpen((open) => !open);
  }, []);

  const handleMainSidebarOpenChange = useCallback((open: boolean) => {
    setMainSidebarOpen(open);
  }, []);

  const setNavigationMode = useCallback((mode: DashboardNavigationMode) => {
    setNavigationModeState(mode);
    try {
      window.localStorage.setItem(DASHBOARD_NAVIGATION_MODE_STORAGE_KEY, mode);
    } catch {}
  }, []);

  const buildDockTabForRoute = useCallback((route: string): DashboardDockTab | null => {
    const normalizedRoute = normalizeEmbeddedRoute(route);
    if (!normalizedRoute) return null;
    const basePath = getEmbeddedRouteBasePath(normalizedRoute);
    const [path, queryString = ''] = normalizedRoute.split('?');

    if (basePath.startsWith('/workbench/')) {
      const config = decodeURIComponent(path.replace('/workbench/', ''));
      const params = new URLSearchParams(queryString);
      WORKBENCH_OUTER_QUERY_KEYS.forEach((key) => {
        const outerValue = searchParams.get(key);
        if (outerValue !== null && !params.has(key)) {
          params.set(key, outerValue);
        }
      });
      const mergedSearch = params.toString();
      return {
        id: `workbench:${config}`,
        title: config,
        kind: 'workbench',
        config,
        mode: params.get('mode') || 'run',
        runId: params.get('runId') || params.get('run'),
        search: mergedSearch,
      };
    }

    if (basePath === '/notebook') {
      const params = new URLSearchParams(queryString);
      const scope = params.get('notebookScope') === 'personal' ? 'personal' : 'global';
      const file = params.get('notebookFile') || params.get('notebookShare') || 'root';
      return {
        id: `notebook:${scope}:${file}`,
        title: scope === 'global' ? '全局 Notebook' : 'Cangjie Notebook',
        kind: 'notebook',
        search: queryString,
      };
    }

    if (basePath === '/account/system-settings') {
      return { id: 'settings', title: '系统设置', kind: 'settings' };
    }

    if (basePath === '/account/channels') {
      return { id: 'channels', title: '微信接入', kind: 'channels' };
    }

    if (basePath === '/users') {
      return { id: 'users', title: '用户管理', kind: 'users' };
    }

    if (basePath === '/run-history') {
      return {
        id: 'run-history',
        title: t('dashboard.quickActions.runHistory'),
        kind: 'run-history',
        search: queryString,
      };
    }

    if (basePath === '/account') {
      return {
        id: 'account',
        title: '账户设置',
        kind: 'account',
        search: queryString,
      };
    }

    const routeTabMap: Record<string, DashboardDockTab> = {
      '/workflows': { id: 'workflows', title: t('dashboard.quickActions.workflows'), kind: 'workflows' },
      '/models': { id: 'models', title: t('dashboard.quickActions.models'), kind: 'models' },
      '/engines': { id: 'engines', title: t('dashboard.quickActions.engines'), kind: 'engines' },
      '/schedules': { id: 'schedules', title: t('dashboard.quickActions.schedules'), kind: 'schedules' },
      '/run-history': { id: 'run-history', title: t('dashboard.quickActions.runHistory'), kind: 'run-history' },
      '/knowledge': { id: 'knowledge', title: t('dashboard.quickActions.knowledge'), kind: 'knowledge' },
      '/knowledge/library': { id: 'knowledge-library', title: t('dashboard.quickActions.knowledgeLibrary'), kind: 'knowledge-library' },
      '/api-docs': { id: 'api-docs', title: t('dashboard.quickActions.apiDocs'), kind: 'api-docs' },
      '/office': { id: 'office', title: t('dashboard.quickActions.office'), kind: 'office' },
      '/account/channels': { id: 'channels', title: '微信接入', kind: 'channels' },
      '/users': { id: 'users', title: '用户管理', kind: 'users' },
    };
    return routeTabMap[basePath] || null;
  }, [searchParams, t]);

  const openAcpxTraceWorkspace = useCallback(() => {
    if (!acpxTraceDirectory) return;
    setAcpxTraceWorkspaceOpen(true);
  }, [acpxTraceDirectory]);

  const initialDockTab = useMemo<DashboardDockTab>(() => {
    if (activeEmbeddedRoute) {
      const tab = buildDockTabForRoute(activeEmbeddedRoute);
      if (tab) return tab;
    }
    const tabMap: Record<DashboardPanel, DashboardDockTab> = {
      chat: { id: 'chat', title: t('dashboard.quickActions.chatMode'), kind: 'chat' },
      overview: { id: 'overview', title: t('dashboard.overviewTitle'), kind: 'overview' },
      agents: { id: 'agents', title: t('dashboard.quickActions.manageAgents'), kind: 'agents' },
      skills: { id: 'skills', title: t('dashboard.quickActions.skills'), kind: 'skills' },
      settings: { id: 'settings', title: t('dashboard.quickActions.envVars'), kind: 'settings' },
    };
    return tabMap[activePanel];
  }, [activeEmbeddedRoute, activePanel, buildDockTabForRoute, t]);

  const handleActiveDockTabChange = useCallback((tab: DashboardDockTab | null) => {
    let nextTab = tab || { id: 'chat', title: t('dashboard.quickActions.chatMode'), kind: 'chat' };
    const currentSearch = typeof window !== 'undefined' ? window.location.search.replace(/^\?/, '') : searchParams.toString();
    if (nextTab.kind === 'workbench' && !nextTab.search) {
      const currentParams = new URLSearchParams(currentSearch);
      const currentRoute = normalizeEmbeddedRoute(currentParams.get('route'));
      if (currentRoute) {
        const [currentRoutePath, currentRouteQuery = ''] = currentRoute.split('?');
        const currentConfig = currentRoutePath.startsWith('/workbench/')
          ? decodeURIComponent(currentRoutePath.replace('/workbench/', ''))
          : '';
        if (currentConfig === nextTab.config) {
          const currentWorkbenchParams = new URLSearchParams(currentRouteQuery);
          nextTab = {
            ...nextTab,
            search: currentWorkbenchParams.toString(),
            mode: currentWorkbenchParams.get('mode') || nextTab.mode || 'run',
            runId: currentWorkbenchParams.get('runId') || currentWorkbenchParams.get('run') || null,
          };
        }
      }
    }
    setActiveDockTab(nextTab);
    if (nextTab.kind === 'chat') {
      setSecondarySidebarOpen(true);
    } else {
      setSecondarySidebarOpen(false);
    }
    const nextUrl = buildShellUrlForDockTab(nextTab, currentSearch);
    const currentUrl = `${pathname}${currentSearch ? `?${currentSearch}` : ''}`;
    if (nextUrl !== currentUrl) {
      router.replace(nextUrl);
    }
  }, [buildShellUrlForDockTab, pathname, router, searchParams]);

  const setActiveRoute = useCallback((route: string) => {
    const normalizedRoute = normalizeEmbeddedRoute(route);
    if (!normalizedRoute) return;

    const tab = buildDockTabForRoute(normalizedRoute);
    if (tab) workspaceRef.current?.openTab(tab);

    const params = new URLSearchParams(searchParams.toString());
    params.delete('panel');
    params.set('route', normalizedRoute);
    params.delete('reload');
    router.push(buildShellUrl(params));
  }, [buildDockTabForRoute, buildShellUrl, router, searchParams]);

  const openWorkbenchDesignTab = useCallback((filename: string) => {
    const tab: DashboardDockTab = {
      id: `workbench:${filename}`,
      title: filename,
      kind: 'workbench',
      config: filename,
      mode: 'design',
      runId: null,
    };
    workspaceRef.current?.openTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('panel');
    params.delete('reload');
    params.set('route', `/workbench/${encodeURIComponent(filename)}?mode=design`);
    router.push(buildShellUrl(params));
  }, [buildShellUrl, router, searchParams]);

  const backToOverview = useCallback(() => {
    setSecondarySidebarOpen(false);
    setActivePanel('overview');
  }, [setActivePanel]);

  const openChatPanel = useCallback(() => {
    setSecondarySidebarOpen(true);
    setActivePanel('chat');
  }, [setActivePanel]);

  const startTabDrag = useCallback((event: DragEvent<HTMLElement>, tab: DashboardDragTab) => {
    suppressSidebarClickRef.current = true;
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData(DASHBOARD_DOCK_DRAG_MIME, JSON.stringify(tab));
    event.dataTransfer.setData('text/plain', tab.title);
  }, []);

  const finishTabDrag = useCallback(() => {
    window.setTimeout(() => {
      suppressSidebarClickRef.current = false;
    }, 120);
  }, []);

  const consumeSuppressedSidebarClick = useCallback(() => {
    if (!suppressSidebarClickRef.current) return false;
    suppressSidebarClickRef.current = false;
    return true;
  }, []);

  const handleDashboardSidebarResizeStart = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !mainSidebarOpen) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressSidebarClickRef.current = true;
    setDashboardSidebarResizing(true);
  }, [mainSidebarOpen]);

  const handleDashboardSidebarResizeMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (!dashboardSidebarResizing) return;
    event.preventDefault();
    event.stopPropagation();
    const nextWidth = clampDashboardSidebarWidth(event.clientX);
    if (sidebarResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(sidebarResizeFrameRef.current);
    }
    sidebarResizeFrameRef.current = window.requestAnimationFrame(() => {
      setDashboardSidebarWidth(nextWidth);
      sidebarResizeFrameRef.current = null;
    });
  }, [dashboardSidebarResizing]);

  const handleDashboardSidebarResizeEnd = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (!dashboardSidebarResizing) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
    const nextWidth = clampDashboardSidebarWidth(event.clientX);
    setDashboardSidebarWidth(nextWidth);
    setDashboardSidebarResizing(false);
    try {
      window.localStorage.setItem(DASHBOARD_SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth));
    } catch {}
    window.setTimeout(() => {
      suppressSidebarClickRef.current = false;
    }, 120);
  }, [dashboardSidebarResizing]);

  const handleDashboardSidebarResizeCancel = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (!dashboardSidebarResizing) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
    setDashboardSidebarResizing(false);
    window.setTimeout(() => {
      suppressSidebarClickRef.current = false;
    }, 120);
  }, [dashboardSidebarResizing]);

  useEffect(() => {
    return () => {
      if (sidebarResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarResizeFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!dashboardSidebarResizing) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [dashboardSidebarResizing]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (activeEmbeddedRoute) {
        const tab = buildDockTabForRoute(activeEmbeddedRoute);
        if (tab) workspaceRef.current?.openTab(tab);
      } else {
        const tabMap: Record<DashboardPanel, DashboardDockTab> = {
          chat: { id: 'chat', title: t('dashboard.quickActions.chatMode'), kind: 'chat' },
          overview: { id: 'overview', title: t('dashboard.overviewTitle'), kind: 'overview' },
          agents: { id: 'agents', title: t('dashboard.quickActions.manageAgents'), kind: 'agents' },
          skills: { id: 'skills', title: t('dashboard.quickActions.skills'), kind: 'skills' },
          settings: { id: 'settings', title: t('dashboard.quickActions.envVars'), kind: 'settings' },
        };
        workspaceRef.current?.openTab(tabMap[activePanel]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeEmbeddedRoute, activePanel, buildDockTabForRoute, t]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('auth-user');
      if (stored) setCurrentUser(JSON.parse(stored));
    } catch {}
  }, []);

  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      const weekDays = [0, 1, 2, 3, 4, 5, 6].map((i) => t(`dashboard.weekdays.${i}`));
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
      const res = await fetch('/api/dashboard', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 401) {
        localStorage.removeItem('auth-token');
        localStorage.removeItem('auth-user');
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          router.replace(buildLoginHref(getCurrentAuthReturnTo('/')));
        }
        return;
      }
      if (!res.ok) throw new Error('Dashboard API failed');
      const data = await res.json();

      if (!data || !data.stats) {
        console.warn('Dashboard API returned incomplete data');
        return;
      }

      setStats(data.stats);
      setConfigs(data.configs || []);
      setRecentRuns(data.recentRuns || []);
      setRunningRuns(data.runningRuns || []);
      setTokenRankingByWorkflow(data.tokenRankingByWorkflow || []);
      setTokenActivityData((data.tokenActivityData || []).map((d: any) => ({
        name: weekDays[d.dayOfWeek],
        totalTokens: d.totalTokens || 0,
      })));

      const actData = (data.activityData || []).map((d: any) => ({
        name: weekDays[d.dayOfWeek],
        runs: d.runs,
      }));
      setActivityData(actData);

      try {
        sessionStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
          ts: Date.now(),
          stats: data.stats,
          configs: data.configs || [],
          recentRuns: data.recentRuns || [],
          runningRuns: data.runningRuns || [],
          tokenRankingByWorkflow: data.tokenRankingByWorkflow || [],
          tokenActivityData: (data.tokenActivityData || []).map((d: any) => ({
            name: weekDays[d.dayOfWeek],
            totalTokens: d.totalTokens || 0,
          })),
          activityData: actData,
        }));
      } catch {}
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [router, t]);

  useEffect(() => {
    // Try to load from cache first for instant render
    try {
      const raw = sessionStorage.getItem(DASHBOARD_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (Date.now() - cached.ts < DASHBOARD_CACHE_TTL) {
          setStats(cached.stats);
          setConfigs(cached.configs);
          setRecentRuns(cached.recentRuns);
          setRunningRuns(cached.runningRuns);
          setActivityData(cached.activityData || []);
          setTokenRankingByWorkflow(cached.tokenRankingByWorkflow || []);
          setTokenActivityData(cached.tokenActivityData || []);
          setLoading(false);
        }
      }
    } catch {}
    void loadDashboardData();
  }, [loadDashboardData]);

  const loadAcpxTraceSettings = useCallback(async () => {
    try {
      const settings = await systemSettingsApi.get();
      setAcpxTraceEnabled(Boolean(settings.runtimeDebug?.acpxTraceEnabled));
      setAcpxTraceDirectory(settings.runtimeDebug?.acpxTraceDirectory || '');
    } catch (error) {
      console.warn('Failed to load ACPX trace settings:', error);
      setAcpxTraceEnabled(false);
      setAcpxTraceDirectory('');
    }
  }, []);

  useEffect(() => {
    void loadAcpxTraceSettings();
  }, [loadAcpxTraceSettings]);

  useEffect(() => {
    const handleFocus = () => {
      void loadAcpxTraceSettings();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [loadAcpxTraceSettings]);

  useEffect(() => {
    workspaceRef.current?.refreshActiveTab();
  }, [navigationMode]);

  const StatCard = ({ icon: Icon, label, value, meta }: any) => (
    <DataCard className="min-h-[132px]">
      <DataCardHeader>
        <div className="min-w-0">
          <DataCardTitle className="text-sm font-medium text-muted-foreground">{label}</DataCardTitle>
          <div className="mt-4 text-3xl font-semibold tracking-normal text-foreground">{value}</div>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-accent text-accent-foreground">
          <Icon className="h-5 w-5" />
        </div>
      </DataCardHeader>
      {meta ? <DataCardMeta>{meta}</DataCardMeta> : null}
    </DataCard>
  );

  const TokenRankingList = ({
    title,
    items,
    actionHref,
    actionLabel,
  }: {
    title: string;
    items: TokenRankingItem[];
    actionHref?: string;
    actionLabel?: string;
  }) => (
    <ChartShell
      title={title}
      icon={Cpu}
      description={t('dashboard.tokenRanking.workflowSubtitle')}
      action={actionHref && actionLabel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-3 text-xs"
          onClick={() => setActiveRoute(actionHref)}
        >
          {actionLabel}
        </Button>
      ) : null}
      className="h-full"
    >
      {loading ? (
        <ChartState loading height={180} />
      ) : items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item, index) => {
            const cacheTokens = (item.cacheCreationInputTokens || 0) + (item.cacheReadInputTokens || 0);
            const maxTokens = Math.max(...items.map((entry) => entry.totalTokens || 0), 1);
            return (
              <DataCard key={`${item.configFile || item.name}-${index}`} className="p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-accent text-xs font-semibold text-accent-foreground">
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{item.name || item.configFile || '-'}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t('dashboard.tokenRanking.runs')}: {item.runs} · {t('dashboard.tokenRanking.cost')}: {formatMoney(item.cost)}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold">{formatTokens(item.totalTokens)}</div>
                    <div className="text-xs text-muted-foreground">{t('dashboard.tokenRanking.totalTokens')}</div>
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted/70">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.max(12, Math.round((item.totalTokens / maxTokens) * 100))}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {t('dashboard.tokenRanking.breakdown')
                    .replace('{input}', formatTokens(item.inputTokens))
                    .replace('{output}', formatTokens(item.outputTokens))
                    .replace('{cache}', formatTokens(cacheTokens))}
                </div>
              </DataCard>
            );
          })}
        </div>
      ) : (
        <ChartState loading={false} empty height={180} />
      )}
    </ChartShell>
  );

  const activityChartData = activityData;

  const primaryActions: Array<{
    id: DashboardPanel;
    label: string;
    desc: string;
    icon: any;
  }> = [
    {
      id: 'overview',
      label: t('dashboard.overviewTitle'),
      desc: t('dashboard.subtitle'),
      icon: BarChart3,
    },
    {
      id: 'agents',
      label: t('dashboard.quickActions.manageAgents'),
      desc: t('dashboard.quickActions.manageAgentsDesc'),
      icon: Bot,
    },
    {
      id: 'skills',
      label: t('dashboard.quickActions.skills'),
      desc: t('dashboard.quickActions.skillsDesc'),
      icon: Package,
    },
    {
      id: 'settings',
      label: t('dashboard.quickActions.envVars'),
      desc: t('dashboard.quickActions.envVarsDesc'),
      icon: Settings,
    },
  ];

  const routeActions: Array<{
    label: string;
    desc: string;
    icon: any;
    href: string;
    external?: boolean;
  }> = [
    {
      label: t('dashboard.quickActions.office'),
      desc: t('dashboard.quickActions.officeDesc'),
      icon: Building2,
      href: '/office',
    },
    {
      label: t('dashboard.quickActions.workflows'),
      desc: t('dashboard.quickActions.workflowsDesc'),
      icon: Workflow,
      href: '/workflows',
    },
    {
      label: t('dashboard.quickActions.models'),
      desc: t('dashboard.quickActions.modelsDesc'),
      icon: Microchip,
      href: '/models',
    },
    {
      label: t('dashboard.quickActions.engines'),
      desc: t('dashboard.quickActions.enginesDesc'),
      icon: ServerCog,
      href: '/engines',
    },
    {
      label: t('dashboard.quickActions.schedules'),
      desc: t('dashboard.quickActions.schedulesDesc'),
      icon: Clock,
      href: '/schedules',
    },
    {
      label: t('dashboard.quickActions.runHistory'),
      desc: t('dashboard.quickActions.runHistoryDesc'),
      icon: History,
      href: '/run-history',
    },
    {
      label: t('dashboard.quickActions.knowledge'),
      desc: t('dashboard.quickActions.knowledgeDesc'),
      icon: NotebookTabs,
      href: '/knowledge',
    },
    {
      label: t('dashboard.quickActions.apiDocs'),
      desc: t('dashboard.quickActions.apiDocsDesc'),
      icon: FileText,
      href: '/api-docs',
    },
  ];

  const ChartShell = ({
    title,
    icon: Icon,
    description,
    children,
    action,
    className,
  }: {
    title: string;
    icon: any;
    description?: string;
    children: ReactNode;
    action?: ReactNode;
    className?: string;
  }) => (
    <div className={`rounded-xl border border-border bg-card p-5 shadow-none ${className || ''}`}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-primary/15 bg-accent text-accent-foreground">
              <Icon className="h-4 w-4" />
            </span>
            {title}
          </h3>
          {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      <div>{children}</div>
    </div>
  );

  const ChartState = ({
    loading: isLoading,
    empty,
    height = 220,
  }: {
    loading: boolean;
    empty?: boolean;
    height?: number;
  }) => (
    <div className="flex items-center justify-center" style={{ height }}>
      <div className="flex flex-col items-center gap-3 text-center">
        {isLoading ? (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-background/60">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
            <div className="text-sm font-medium text-foreground">加载中...</div>
            <div className="text-xs text-muted-foreground">正在准备统计数据</div>
          </>
        ) : (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-border/60 bg-background/40">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium text-foreground">{t('common.noData')}</div>
            {empty ? <div className="text-xs text-muted-foreground">当前还没有可展示的统计记录</div> : null}
          </>
        )}
      </div>
    </div>
  );

  const runningRunColumns = useMemo<DataTableColumn<any>[]>(() => [
    {
      id: 'workflow',
      header: '工作流',
      render: (run) => {
        const config = configs.find((item) => item.filename === run.configFile);
        const configName = config?.name || run.configName || run.configFile;
        return (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{configName}</div>
            <div className="mt-1 truncate text-xs text-muted-foreground">{formatStateName(run.currentPhase || '') || t('dashboard.status.starting')}</div>
          </div>
        );
      },
    },
    {
      id: 'progress',
      header: '进度',
      align: 'right',
      width: 96,
      render: (run) => <StatusPill tone="info">{run.completedSteps || 0}/{run.totalSteps || 0}</StatusPill>,
    },
  ], [configs, t]);

  const recentRunColumns = useMemo<DataTableColumn<any>[]>(() => [
    {
      id: 'run',
      header: '运行',
      render: (run) => {
        const StatusIcon = getRunStatusIcon(run.status);
        return (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
              <StatusIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{run.configName || run.configFile}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{formatStateName(run.currentPhase || '') || t('dashboard.status.starting')}</span>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span>{new Date(run.startTime).toLocaleString()}</span>
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'tokens',
      header: 'Token',
      align: 'right',
      width: 96,
      hideBelow: 'md',
      render: (run) => (typeof run.totalTokens === 'number' ? formatTokens(run.totalTokens) : '-'),
      className: 'text-xs text-muted-foreground',
    },
    {
      id: 'status',
      header: '状态',
      align: 'right',
      width: 112,
      render: (run) => <StatusPill tone={getRunStatusTone(run.status)}>{t(`dashboard.status.${run.status}`)}</StatusPill>,
    },
  ], [t]);

  const exceptionRunColumns = useMemo<DataTableColumn<any>[]>(() => [
    {
      id: 'run',
      header: '运行',
      render: (run) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{run.configName || run.configFile}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{formatStateName(run.currentPhase || '') || t('dashboard.status.starting')}</div>
        </div>
      ),
    },
    {
      id: 'status',
      header: '状态',
      align: 'right',
      width: 112,
      render: (run) => <StatusPill tone={getRunStatusTone(run.status)}>{t(`dashboard.status.${run.status}`)}</StatusPill>,
    },
  ], [t]);

  const SectionShell = ({
    title,
    icon: Icon,
    description,
    children,
  }: {
    title: string;
    icon: any;
    description?: string;
    children: ReactNode;
  }) => (
    <section className="rounded-xl border border-border bg-card px-5 py-5 shadow-none">
      <div className="mb-5 flex items-start gap-3">
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-accent text-accent-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <div>{children}</div>
    </section>
  );

  const ClassicQuickActions = () => (
    <section data-tour-step-id="dashboard-quick-actions">
      <div className="mb-4 flex items-center gap-2">
        <Zap className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-semibold">{t('dashboard.quickActions.title')}</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {[
          {
            key: 'new-workflow',
            label: t('dashboard.quickActions.newWorkflow'),
            desc: t('dashboard.quickActions.newWorkflowDesc'),
            icon: Play,
            onClick: () => setShowNewModal(true),
          },
          {
            key: 'chat',
            label: t('dashboard.quickActions.chatMode'),
            desc: t('dashboard.headers.chatSubtitle'),
            icon: MessageSquareText,
            onClick: () => {
              setSecondarySidebarOpen(true);
              setActivePanel('chat');
            },
          },
          ...primaryActions
            .filter((action) => action.id !== 'overview')
            .map((action) => ({
              key: action.id,
              label: action.label,
              desc: action.desc,
              icon: action.icon,
              onClick: () => {
                setSecondarySidebarOpen(false);
                setActivePanel(action.id);
              },
            })),
          ...routeActions.map((action) => ({
            key: action.href,
            label: action.label,
            desc: action.desc,
            icon: action.icon,
            onClick: () => {
              setSecondarySidebarOpen(false);
              if (action.external) {
                router.push(action.href);
              } else {
                setActiveRoute(action.href);
              }
            },
          })),
        ].map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.key}
              type="button"
              className="group relative overflow-hidden rounded-lg border border-border bg-card px-4 py-4 text-left transition-colors hover:border-border/80 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={action.onClick}
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-accent text-accent-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-foreground">{action.label}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{action.desc}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );

  const ModernTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color?: string; payload?: any }>;
    label?: string;
  }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="min-w-[180px] rounded-xl border border-border/60 bg-background/95 px-3 py-2.5 shadow-xl backdrop-blur">
        <div className="mb-2 text-xs font-medium text-foreground">{label}</div>
        <div className="space-y-1.5">
          {payload.map((entry, index) => (
            <div key={`${entry.name}-${index}`} className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-full bg-[#8B5CF6]" style={entry.color ? { backgroundColor: entry.color } : undefined} />
                <span>{entry.name}</span>
              </div>
              <span className="font-medium text-foreground">{formatTokens(Number(entry.value || 0))}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const runningOverviewRuns = runningRuns.slice(0, 5);
  const recentOverviewRuns = recentRuns.slice(0, 6);
  const exceptionRuns = recentRuns
    .filter((run: any) => ['failed', 'crashed', 'stopped'].includes(run.status))
    .slice(0, 4);
  const latestRunnableRun = recentRuns.find((run: any) => run.configFile);
  const topWorkflowTokenItem = tokenRankingByWorkflow[0];

  const taskShortcuts = [
    {
      key: 'start',
      label: t('dashboard.quickActions.newWorkflow'),
      desc: t('dashboard.quickActions.newWorkflowDesc'),
      icon: Play,
      onClick: () => setShowNewModal(true),
    },
    {
      key: 'resume',
      label: '继续运行中工作',
      desc: runningOverviewRuns.length > 0 ? `${runningOverviewRuns.length} 个运行中任务` : t('dashboard.sections.noActiveWorkflows'),
      icon: Workflow,
      onClick: () => {
        const run = runningOverviewRuns[0];
        if (run?.configFile) {
          setActiveRoute(`/workbench/${encodeURIComponent(run.configFile)}?mode=run&runId=${run.id}&history=1`);
        } else {
          setActiveRoute('/workflows');
        }
      },
    },
    {
      key: 'inspect',
      label: '检查最近运行',
      desc: t('dashboard.quickActions.runHistoryDesc'),
      icon: History,
      onClick: () => setActiveRoute('/run-history'),
    },
    {
      key: 'workbench',
      label: '打开最近工作台',
      desc: latestRunnableRun?.configName || latestRunnableRun?.configFile || t('dashboard.quickActions.workflowsDesc'),
      icon: Layers3,
      onClick: () => {
        if (latestRunnableRun?.configFile) {
          setActiveRoute(`/workbench/${encodeURIComponent(latestRunnableRun.configFile)}?mode=run&runId=${latestRunnableRun.id}&history=1`);
        } else {
          setActiveRoute('/workflows');
        }
      },
    },
  ];

  const activeDockTabKind = activeDockTab?.kind || 'chat';
  const isChatWorkspaceActive = activeDockTabKind === 'chat';
  const secondarySidebarVisible = isChatWorkspaceActive && secondarySidebarOpen;
  const isClassicDashboard = navigationMode === 'classic';
  const MainContainer = isClassicDashboard ? 'main' : SidebarInset;
  const dashboardSidebarStyle = useMemo(() => ({
    '--sidebar-width': `${dashboardSidebarWidth}px`,
    '--sidebar-width-icon': '3.5rem',
  }) as CSSProperties, [dashboardSidebarWidth]);
  const renderChatSecondarySidebar = useCallback(() => (
    <aside
      className="ace-dashboard-chat-secondary-sidebar flex h-full w-full min-w-0 flex-col overflow-hidden bg-background/95 backdrop-blur-xl"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ChatSidebar
        compact
        sessionView="conversation"
        onSessionViewChange={() => setConversationView('conversation')}
      />
    </aside>
  ), [conversationView]);
  return (
    <DashboardShellHeaderProvider>
    <SidebarProvider
      open={mainSidebarOpen}
      onOpenChange={handleMainSidebarOpenChange}
      className="min-h-screen bg-[#F4F4F1] dark:bg-[#0D0E14]"
      style={dashboardSidebarStyle}
    >
      {!isClassicDashboard && (
      <Sidebar
        variant="inset"
        collapsible="icon"
        className="border-sidebar-border/70 bg-sidebar/95 backdrop-blur-xl"
        data-tour-step-id="dashboard-shell-sidebar"
      >
        <SidebarHeader className="p-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                tooltip="ACEHarness"
                onClick={() => {
                  setSecondarySidebarOpen(true);
                  setActivePanel('chat');
                }}
                className="h-12"
              >
                <RobotLogo size={30} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">ACEHarness</span>
                  <span className="truncate text-[11px] text-sidebar-foreground/60">v{pkgJson.version}</span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarSeparator />

        <SidebarContent data-tour-step-id="dashboard-quick-actions">
          <SidebarGroup>
            <SidebarGroupLabel>{t('dashboard.sidebar.console')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip={t('dashboard.quickActions.newWorkflow')}
                    onClick={() => setShowNewModal(true)}
                  >
                    <Play />
                    <span>{t('dashboard.quickActions.newWorkflow')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip={t('dashboard.sidebar.openChatHint')}
                    isActive={activeDockTabKind === 'chat'}
                    draggable
                    onDragStart={(event) => startTabDrag(event, { id: 'chat', title: t('dashboard.quickActions.chatMode'), kind: 'chat' })}
                    onDragEnd={finishTabDrag}
                    onClick={() => {
                      if (consumeSuppressedSidebarClick()) return;
                      setSecondarySidebarOpen(true);
                      setActivePanel('chat');
                    }}
                  >
                    <MessageSquareText />
                    <span>{t('dashboard.quickActions.chatMode')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {primaryActions.map((action) => {
                  const Icon = action.icon;
                  const tabMap: Record<DashboardPanel, DashboardDockTab> = {
                    chat: { id: 'chat', title: t('dashboard.quickActions.chatMode'), kind: 'chat' },
                    overview: { id: 'overview', title: t('dashboard.overviewTitle'), kind: 'overview' },
                    agents: { id: 'agents', title: t('dashboard.quickActions.manageAgents'), kind: 'agents' },
                    skills: { id: 'skills', title: t('dashboard.quickActions.skills'), kind: 'skills' },
                    settings: { id: 'settings', title: t('dashboard.quickActions.envVars'), kind: 'settings' },
                  };
                  return (
                    <SidebarMenuItem key={action.id}>
                      <SidebarMenuButton
                        tooltip={action.label}
                        isActive={activeDockTabKind === action.id}
                        draggable
                        onDragStart={(event) => startTabDrag(event, tabMap[action.id])}
                        onDragEnd={finishTabDrag}
                        onClick={() => {
                          if (consumeSuppressedSidebarClick()) return;
                          setSecondarySidebarOpen(false);
                          setActivePanel(action.id);
                        }}
                      >
                        <Icon />
                        <span>{action.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>{t('dashboard.sidebar.features')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {routeActions.map((action) => {
                  const Icon = action.icon;
                  const basePath = getEmbeddedRouteBasePath(action.href);
                  const routeTabMap: Record<string, DashboardDockTab> = {
                    '/workflows': { id: 'workflows', title: t('dashboard.quickActions.workflows'), kind: 'workflows' },
                    '/models': { id: 'models', title: t('dashboard.quickActions.models'), kind: 'models' },
                    '/engines': { id: 'engines', title: t('dashboard.quickActions.engines'), kind: 'engines' },
                    '/schedules': { id: 'schedules', title: t('dashboard.quickActions.schedules'), kind: 'schedules' },
                    '/run-history': { id: 'run-history', title: t('dashboard.quickActions.runHistory'), kind: 'run-history' },
                    '/knowledge': { id: 'knowledge', title: t('dashboard.quickActions.knowledge'), kind: 'knowledge' },
                    '/knowledge/library': { id: 'knowledge-library', title: t('dashboard.quickActions.knowledgeLibrary'), kind: 'knowledge-library' },
                    '/api-docs': { id: 'api-docs', title: t('dashboard.quickActions.apiDocs'), kind: 'api-docs' },
                    '/office': { id: 'office', title: t('dashboard.quickActions.office'), kind: 'office' },
                  };
                  const draggableTab = routeTabMap[basePath];
                  const isActive = getDashboardRouteOwner(activeDockTab) === basePath;
                  return (
                    <SidebarMenuItem key={action.href}>
                      <SidebarMenuButton
                        tooltip={action.label}
                        isActive={action.external ? false : isActive}
                        draggable={Boolean(draggableTab)}
                        onDragStart={(event) => {
                          if (draggableTab) startTabDrag(event, draggableTab);
                        }}
                        onDragEnd={finishTabDrag}
                        onClick={() => {
                          if (consumeSuppressedSidebarClick()) return;
                          setSecondarySidebarOpen(false);
                          if (action.external) {
                            router.push(action.href);
                          } else {
                            setActiveRoute(action.href);
                          }
                        }}
                      >
                        <Icon />
                        <span>{action.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <DashboardSidebarFooter onUseClassicMode={() => {
          setNavigationMode('classic');
          setSecondarySidebarOpen(false);
          setActivePanel('overview');
        }} />
        <button
          type="button"
          aria-label="Resize sidebar"
          tabIndex={-1}
          className={cn(
            "absolute inset-y-0 -right-1 z-30 hidden w-2 cursor-col-resize touch-none select-none md:block",
            "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-sidebar-border/70 after:transition-colors",
            "hover:after:bg-violet-400/70 dark:hover:after:bg-violet-300/60",
            "group-data-[collapsible=icon]:hidden",
            dashboardSidebarResizing && "after:bg-violet-400/80 dark:after:bg-violet-300/70"
          )}
          onPointerDown={handleDashboardSidebarResizeStart}
          onPointerMove={handleDashboardSidebarResizeMove}
          onPointerUp={handleDashboardSidebarResizeEnd}
          onPointerCancel={handleDashboardSidebarResizeCancel}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />
        <SidebarRail />
      </Sidebar>
      )}

      <MainContainer className="relative z-10 flex min-h-svh min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
        <DashboardUnifiedHeader
          currentUser={currentUser}
          navigationMode={navigationMode}
          onNavigationModeChange={setNavigationMode}
          activeTabKind={activeDockTab?.kind || null}
          onBackToOverview={backToOverview}
          onOpenChat={openChatPanel}
        />
        <div
          className="relative min-h-0 flex-1 overflow-hidden"
          data-tour-step-id="dashboard-overview"
        >
          <div className="h-full min-h-0" data-tour-step-id="dashboard-workspace-tabs">
            <DashboardDockWorkspace
              ref={workspaceRef}
              className="min-w-0 flex-1"
              initialTab={initialDockTab}
              onActiveTabChange={handleActiveDockTabChange}
              onFallbackChatOpen={handleFallbackChatOpen}
              onToggleChatSecondarySidebar={handleToggleChatSecondarySidebar}
              chatSecondarySidebarPinned={secondarySidebarOpen}
              showChatSecondarySidebar={secondarySidebarVisible}
              renderChatSecondarySidebar={renderChatSecondarySidebar}
              singlePanelMode={isClassicDashboard}
              renderOverview={() => (
                <div className="min-h-full bg-[#F7F7F4] dark:bg-[#0D0E14]">
                  <PageHeader
                    title={t('dashboard.headers.defaultTitle')}
                    subtitle={t('dashboard.headers.overviewSubtitle')}
                    status={<StatusPill tone={runningOverviewRuns.length > 0 ? 'info' : 'neutral'}>{runningOverviewRuns.length} 个运行中</StatusPill>}
                    primaryAction={(
                      <Button type="button" onClick={() => setShowNewModal(true)}>
                        <Play className="mr-2 h-4 w-4" />
                        {t('dashboard.quickActions.newWorkflow')}
                      </Button>
                    )}
                    secondaryActions={(
                      <>
                        <Button type="button" variant="outline" onClick={() => setActiveRoute('/run-history')}>
                          <History className="mr-2 h-4 w-4" />
                          {t('dashboard.quickActions.runHistory')}
                        </Button>
                        <Button type="button" variant="outline" onClick={loadDashboardData} disabled={loading}>
                          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
                          刷新
                        </Button>
                      </>
                    )}
                  />
                  <PageToolbar
                    actions={(
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setActiveRoute('/workflows')}>{t('dashboard.quickActions.workflows')}</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setActiveRoute('/models')}>{t('dashboard.quickActions.models')}</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setActiveRoute('/schedules')}>{t('dashboard.quickActions.schedules')}</Button>
                      </div>
                    )}
                    activeFilters={(
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>操作概览：优先开始、继续、检查。</span>
                        <span className="h-1 w-1 rounded-full bg-border" />
                        <button type="button" className="font-medium text-foreground hover:text-primary" onClick={() => setActivePanel('agents')}>
                          {t('dashboard.quickActions.manageAgents')}
                        </button>
                        <span className="h-1 w-1 rounded-full bg-border" />
                        <button type="button" className="font-medium text-foreground hover:text-primary" onClick={() => setActiveRoute('/account/system-settings')}>
                          {t('dashboard.quickActions.envVars')}
                        </button>
                      </div>
                    )}
                  />
                  <div className="mx-auto w-full max-w-[1500px] space-y-6 px-6 py-6">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" data-tour-step-id="dashboard-stats">
                      <StatCard icon={Workflow} label={t('dashboard.stats.activeWorkflows')} value={stats.activeWorkflows} meta={`${stats.runningProcesses} 个进程`} />
                      <StatCard icon={Activity} label={t('dashboard.stats.weeklyRuns')} value={stats.weeklyRuns} meta={`${stats.successRate}% 成功率`} />
                      <StatCard icon={Cpu} label={t('dashboard.stats.tokenConsumption')} value={formatTokens(stats.totalTokenUsage)} meta={formatMoney(topWorkflowTokenItem?.cost || 0)} />
                      <StatCard icon={TrendingUp} label={t('dashboard.stats.weeklyTokenConsumption')} value={formatTokens(stats.weeklyTokenUsage)} meta="近 7 天" />
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-4" data-tour-step-id="dashboard-quick-actions">
                      {taskShortcuts.map((action) => {
                        const Icon = action.icon;
                        return (
                          <button
                            key={action.key}
                            type="button"
                            className="group text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={action.onClick}
                          >
                            <DataCard className="h-full cursor-pointer">
                              <DataCardHeader>
                                <div className="min-w-0">
                                  <DataCardTitle>{action.label}</DataCardTitle>
                                  <DataCardDescription className="line-clamp-2">{action.desc}</DataCardDescription>
                                </div>
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-accent text-accent-foreground">
                                  <Icon className="h-4 w-4" />
                                </div>
                              </DataCardHeader>
                            </DataCard>
                          </button>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                      <ChartShell title={t('dashboard.sections.activeWorkflows')} icon={Workflow} description={t('dashboard.sections.activeWorkflowsDesc')} className="xl:col-span-5">
                        <DataTable
                          columns={runningRunColumns}
                          rows={runningOverviewRuns}
                          rowKey="id"
                          density="compact"
                          loading={loading}
                          loadingRowCount={4}
                          onRowClick={(run) => setActiveRoute(`/workbench/${encodeURIComponent(run.configFile)}?mode=run&runId=${run.id}&history=1`)}
                          emptyState={(
                            <EmptyState
                            icon={<Workflow className="h-5 w-5" />}
                            title={t('dashboard.sections.noActiveWorkflows')}
                            description={t('dashboard.quickActions.workflowsDesc')}
                            primaryAction={<Button type="button" onClick={() => setActiveRoute('/workflows')}>{t('dashboard.quickActions.workflows')}</Button>}
                            className="min-h-[240px]"
                            />
                          )}
                          aria-label="运行中的工作流"
                        />
                      </ChartShell>

                      <ChartShell
                        title={t('dashboard.sections.recentRuns')}
                        icon={History}
                        description={t('dashboard.sections.recentRunsDesc')}
                        action={<Button type="button" variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={() => setActiveRoute('/run-history')}>查看全部</Button>}
                        className="xl:col-span-7"
                      >
                        <DataTable
                          columns={recentRunColumns}
                          rows={recentOverviewRuns}
                          rowKey="id"
                          density="compact"
                          loading={loading}
                          loadingRowCount={5}
                          onRowClick={(run) => setActiveRoute(`/workbench/${encodeURIComponent(run.configFile)}?mode=run&runId=${run.id}&history=1`)}
                          emptyState={(
                            <EmptyState
                            icon={<History className="h-5 w-5" />}
                            title={t('common.noData')}
                            description={t('dashboard.sections.recentRunsDesc')}
                            primaryAction={<Button type="button" onClick={() => setActiveRoute('/run-history')}>{t('dashboard.quickActions.runHistory')}</Button>}
                            className="min-h-[240px]"
                            />
                          )}
                          aria-label="最近运行"
                        />
                      </ChartShell>
                    </div>

                    <SectionShell title={t('dashboard.tokenRanking.title')} icon={TrendingUp} description={t('dashboard.tokenRanking.sectionSubtitle')}>
                      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                        <div className="xl:col-span-5">
                          <TokenRankingList
                            title={t('dashboard.tokenRanking.byWorkflow')}
                            items={tokenRankingByWorkflow.slice(0, 5)}
                            actionHref={WORKFLOW_TOKEN_RANKING_HREF}
                            actionLabel={t('dashboard.tokenRanking.viewAll')}
                          />
                        </div>

                        <ChartShell title={t('dashboard.charts.weeklyTokenTrend')} icon={BarChart3} description={t('dashboard.charts.weeklyTokenTrendDesc')} className="xl:col-span-7">
                          {loading ? (
                            <ChartState loading height={220} />
                          ) : tokenActivityData.length > 0 ? (
                            <ResponsiveContainer width="100%" height={220}>
                              <AreaChart data={tokenActivityData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.18} />
                                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                                <YAxis hide />
                                <Tooltip content={<ModernTooltip />} />
                                <Area type="monotone" dataKey="totalTokens" name={t('dashboard.charts.weeklyTokenTrend')} stroke="#8B5CF6" strokeWidth={2} fill="#EEE7FF" />
                              </AreaChart>
                            </ResponsiveContainer>
                          ) : (
                            <ChartState loading={false} empty height={220} />
                          )}
                        </ChartShell>
                      </div>
                    </SectionShell>

                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                      <ChartShell title="异常和建议" icon={AlertCircle} description="失败、停止或需要检查的高信号运行。" className="xl:col-span-7">
                        <DataTable
                          columns={exceptionRunColumns}
                          rows={exceptionRuns}
                          rowKey="id"
                          density="compact"
                          loading={loading}
                          loadingRowCount={4}
                          onRowClick={(run) => setActiveRoute(`/workbench/${encodeURIComponent(run.configFile)}?mode=run&runId=${run.id}&history=1`)}
                          emptyState={<EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="最近运行没有异常" description="最近运行未出现失败、崩溃或停止状态。" className="min-h-[220px]" />}
                          aria-label="异常和建议"
                        />
                      </ChartShell>

                      <ChartShell title={t('dashboard.charts.weeklyActivity')} icon={Activity} description={t('dashboard.charts.weeklyActivityDesc')} className="xl:col-span-5">
                        {loading ? (
                          <ChartState loading height={220} />
                        ) : activityChartData.length > 0 ? (
                          <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={activityChartData}>
                              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.18} />
                              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                              <Tooltip content={<ModernTooltip />} />
                              <Bar dataKey="runs" name={t('dashboard.charts.runs')} fill="#8B5CF6" radius={[8, 8, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        ) : (
                          <ChartState loading={false} empty height={220} />
                        )}
                      </ChartShell>
                    </div>
                  </div>
                </div>
              )}
            />
          </div>
        </div>
      </MainContainer>

      {showNewModal && (
        <NewConfigModal
          isOpen={showNewModal}
          onClose={() => setShowNewModal(false)}
          onSuccess={(filename) => {
            setShowNewModal(false);
            openWorkbenchDesignTab(filename);
          }}
        />
      )}
      {acpxTraceEnabled && acpxTraceDirectory ? (
        <div className="fixed bottom-44 right-0 z-[50] translate-x-[calc(100%-22px)] transition-transform duration-200 hover:translate-x-0 focus-within:translate-x-0">
          <div className="relative flex items-center pl-4">
            <div className="pointer-events-none absolute left-0 top-1/2 flex h-10 w-5 -translate-y-1/2 items-center justify-center rounded-l-full border border-r-0 border-border/70 bg-background/94 text-muted-foreground shadow-sm backdrop-blur">
              <Bug className="h-3.5 w-3.5" />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-14 w-14 rounded-full border-violet-200 bg-background/94 text-violet-600 shadow-lg backdrop-blur hover:bg-violet-50 hover:text-violet-700 dark:border-white/10 dark:bg-[#191A20]/95 dark:text-violet-200 dark:hover:bg-[#22232B]"
              onClick={openAcpxTraceWorkspace}
              title="ACPX 调试日志"
            >
              <Bug className="h-5 w-5" />
              <span className="sr-only">ACPX 调试日志</span>
            </Button>
          </div>
        </div>
      ) : null}
      {acpxTraceEnabled && acpxTraceDirectory && acpxTraceWorkspaceOpen ? (
        <WorkspaceEditor
          open={acpxTraceWorkspaceOpen}
          onOpenChange={setAcpxTraceWorkspaceOpen}
          workspacePath={acpxTraceDirectory}
          title="ACPX 调试日志"
          defaultTreeSortMode="modified-desc"
        />
      ) : null}
    </SidebarProvider>
    </DashboardShellHeaderProvider>
  );
}
