'use client';

import { useState, useEffect, useMemo, useRef, useCallback, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from '@/lib/navigation/client';
import Link from '@/lib/navigation/client';
import { motion } from 'framer-motion';
import { configApi, runsApi, specCodingApi, usersApi } from '@/lib/core/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { BulkActionBar } from '@/components/ui/bulk-action-bar';
import { ActionMenu, type ActionMenuGroup } from '@/components/ui/action-menu';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { DataTable, type DataTableColumn, type DataTableSortDirection } from '@/components/ui/data-table';
import {
  DataCard,
  DataCardActions,
  DataCardDescription,
  DataCardHeader,
  DataCardMeta,
  DataCardTitle,
} from '@/components/ui/data-card';
import {
  DetailDrawer,
  DetailDrawerBody,
  DetailDrawerContent,
  DetailDrawerDescription,
  DetailDrawerFooter,
  DetailDrawerHeader,
  DetailDrawerTitle,
} from '@/components/ui/detail-drawer';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { MultiCombobox } from '@/components/ui/combobox';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { Plus, LogIn, Edit, Trash2, ArrowLeft, FileText, ArrowDown, ArrowUp, ArrowUpDown, History, Copy, Globe, Lock, Share2, Upload, Download, RefreshCw } from 'lucide-react';
import NewConfigModal from '@/components/NewConfigModal';
import { useToast } from '@/components/ui/toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { PaginationBar } from '@/components/PaginationBar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/core/utils';
import { getOfficeAwareReturnTarget } from '@/lib/navigation/return-target';
import { useDashboardDockWorkspace } from '@/components/dashboard/DashboardDockWorkspace';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { useConfigsQuery } from '@/client/query/configs';
import { useRunDocumentsQuery } from '@/client/query/documents';
import { useSchedulesQuery, useTriggerScheduleMutation } from '@/client/query/schedules';
import { useDeleteConfigMutation } from '@/client/query/workflow-mutations';
import { useSyncWorkflowConfigsToDb, useWorkflowConfigRows } from '@/client/db/collections';
import { buildWorkbenchPath, buildWorkbenchSearch } from '@/client/navigation/workbench-links';
import type { WorkflowsSearch } from '@/routes/workflows';
import type { RunRecord } from '@/lib/run/store';

interface WorkflowConfig {
  filename: string;
  name: string;
  description?: string;
  mode?: 'phase-based' | 'state-machine';
  phaseCount?: number;
  stepCount?: number;
  agentCount?: number;
  phases?: number;
  steps?: number;
  createdAt?: number | string;
  visibility?: 'private' | 'shared' | 'public';
  sharedWithUserIds?: string[];
  ownerName?: string;
}

interface ShareableUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
}

type WorkflowSortKey = 'name' | 'createdAt';
type SortDirection = 'asc' | 'desc';
type WorkflowModeFilter = 'all' | 'state-machine' | 'phase-based';
type WorkflowsPageTab = 'workflows' | 'drafts';
type DraftViewMode = 'gallery' | 'table';
type DraftSortDirection = 'desc' | 'asc';
type StatusTone = 'neutral' | 'success' | 'warning' | 'info' | 'danger' | 'accent';
type NewWorkflowModalPreset = {
  initialMode?: 'phase-based' | 'state-machine' | 'ai-guided';
  initialWorkflowName?: string;
  initialReferenceWorkflow?: string;
  initialRequirements?: string;
  initialDescription?: string;
  initialWorkingDirectory?: string;
  initialWorkspaceMode?: 'isolated-copy' | 'in-place';
  hideAiGuided?: boolean;
  focusRequirementsOnOpen?: boolean;
};

const VIEW_MODE_KEY = 'aceharness:workflows:view-mode';
const DRAFT_VIEW_MODE_KEY = 'aceharness:workflows:drafts:view-mode';
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100];
const WORKBENCH_SHELL_QUERY_KEYS = [
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

type WorkflowsPageProps = {
  routeSearch?: WorkflowsSearch;
  onRouteSearchChange?: (next: Partial<WorkflowsSearch>) => void;
};

interface WorkflowPagination {
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
  unfilteredTotal: number;
}

type CreationDraftSession = {
  id: string;
  filename?: string;
  workflowName?: string;
  status: string;
  mode?: 'phase-based' | 'state-machine' | 'ai-guided';
  planningEngine?: string;
  planningModel?: string;
  createdAt?: number | string;
  updatedAt?: number | string;
  uiState?: {
    formStep?: number;
    planningStage?: string;
  };
};

type ImportAuditItem = {
  filename: string;
  name?: string;
  path?: string;
  location?: string;
  value?: string;
};

type WorkflowImportNotice = {
  imported: string[];
  audit?: {
    pathReminders?: ImportAuditItem[];
    removedSkills?: ImportAuditItem[];
    removedAgentDefinitions?: ImportAuditItem[];
    removedAgentOverrides?: ImportAuditItem[];
    unsupportedAgentRefs?: ImportAuditItem[];
  };
};

function countImportAuditItems(notice: WorkflowImportNotice | null | undefined) {
  const audit = notice?.audit || {};
  return {
    pathReminders: audit.pathReminders?.length || 0,
    removedSkills: audit.removedSkills?.length || 0,
    removedAgentDefinitions: audit.removedAgentDefinitions?.length || 0,
    removedAgentOverrides: audit.removedAgentOverrides?.length || 0,
    unsupportedAgentRefs: audit.unsupportedAgentRefs?.length || 0,
  };
}

function ImportAuditList({ items, emptyText }: { items?: ImportAuditItem[]; emptyText: string }) {
  if (!items?.length) {
    return <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{emptyText}</div>;
  }
  return (
    <div className="max-h-36 overflow-auto rounded-lg border">
      {items.map((item, index) => (
        <div key={`${item.filename}-${item.path || item.location}-${item.name || item.value}-${index}`} className="border-b px-3 py-2 text-xs last:border-b-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">{item.filename}</Badge>
            <span className="font-medium">{item.name || item.value}</span>
          </div>
          <div className="mt-1 break-all text-[11px] text-muted-foreground">{item.path || item.location}</div>
        </div>
      ))}
    </div>
  );
}

function normalizeWorkflowsSearch(input: WorkflowsSearch | URLSearchParams): Required<WorkflowsSearch> {
  const read = (key: keyof WorkflowsSearch) => input instanceof URLSearchParams ? input.get(key) : input[key];
  const mode = read('mode');
  const sortKey = read('sortKey');
  const sortDirection = read('sortDirection');
  const pageSize = Number(read('pageSize') || DEFAULT_PAGE_SIZE);
  const page = Number(read('page') || 1);
  return {
    keyword: String(read('keyword') || ''),
    mode: mode === 'state-machine' || mode === 'phase-based' ? mode : 'all',
    sortKey: sortKey === 'name' ? 'name' : 'createdAt',
    sortDirection: sortDirection === 'asc' ? 'asc' : 'desc',
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    pageSize: PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
  };
}

export default function WorkflowsPage({ routeSearch, onRouteSearchChange }: WorkflowsPageProps = {}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const dockWorkspace = useDashboardDockWorkspace();
  const searchParams = useSearchParams();
  const returnTarget = getOfficeAwareReturnTarget(searchParams.get('from'));
  const { toast } = useToast();
  const initialSearch = useMemo(() => normalizeWorkflowsSearch(routeSearch || searchParams), [routeSearch, searchParams]);
  const [searchQuery, setSearchQuery] = useState(initialSearch.keyword);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(initialSearch.keyword);
  const [selectedMode, setSelectedModeState] = useState<WorkflowModeFilter>(initialSearch.mode);
  const [sortKey, setSortKeyState] = useState<WorkflowSortKey>(initialSearch.sortKey);
  const [sortDirection, setSortDirectionState] = useState<SortDirection>(initialSearch.sortDirection);
  const [page, setPageState] = useState(initialSearch.page);
  const [pageSize, setPageSizeState] = useState(initialSearch.pageSize);
  const [showNewModal, setShowNewModal] = useState(false);
  const [resumeCreationDraftId, setResumeCreationDraftId] = useState<string | null>(null);
  const [newWorkflowModalPreset, setNewWorkflowModalPreset] = useState<NewWorkflowModalPreset | null>(null);
  const [creationDrafts, setCreationDrafts] = useState<CreationDraftSession[]>([]);
  const [creationDraftsLoading, setCreationDraftsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'gallery' | 'table'>('table');
  const [draftViewMode, setDraftViewMode] = useState<DraftViewMode>('table');
  const [draftSortDirection, setDraftSortDirection] = useState<DraftSortDirection>('desc');
  const [activeTab, setActiveTab] = useState<WorkflowsPageTab>('workflows');
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<string>>(new Set());
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowConfig | null>(null);
  const [drawerWorkflow, setDrawerWorkflow] = useState<WorkflowConfig | null>(null);
  const [copyFilename, setCopyFilename] = useState('');
  const [copyWorkflowName, setCopyWorkflowName] = useState('');
  const [sharingVisibility, setSharingVisibility] = useState<'private' | 'shared' | 'public'>('private');
  const [sharingUserIds, setSharingUserIds] = useState<string[]>([]);
  const [shareableUsers, setShareableUsers] = useState<ShareableUser[]>([]);
  const [shareableUsersLoading, setShareableUsersLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [archiveImporting, setArchiveImporting] = useState(false);
  const [workflowImportNotice, setWorkflowImportNotice] = useState<WorkflowImportNotice | null>(null);
  const [archiveExporting, setArchiveExporting] = useState(false);
  const [deleteWorkflowTarget, setDeleteWorkflowTarget] = useState<WorkflowConfig | null>(null);
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);
  const [deleteDraftTarget, setDeleteDraftTarget] = useState<CreationDraftSession | null>(null);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const applyWorkflowSearchState = useCallback((next: Partial<WorkflowsSearch>) => {
    const merged = normalizeWorkflowsSearch({
      keyword: debouncedSearchQuery,
      mode: selectedMode,
      sortKey,
      sortDirection,
      page,
      pageSize,
      ...next,
    });
    setDebouncedSearchQuery(merged.keyword);
    setSearchQuery(merged.keyword);
    setSelectedModeState(merged.mode);
    setSortKeyState(merged.sortKey);
    setSortDirectionState(merged.sortDirection);
    setPageState(merged.page);
    setPageSizeState(merged.pageSize);
  }, [debouncedSearchQuery, page, pageSize, selectedMode, sortDirection, sortKey]);
  const updateWorkflowSearch = useCallback((next: Partial<WorkflowsSearch>) => {
    const merged = normalizeWorkflowsSearch({
      keyword: debouncedSearchQuery,
      mode: selectedMode,
      sortKey,
      sortDirection,
      page,
      pageSize,
      ...next,
    });
    applyWorkflowSearchState(merged);
    if (onRouteSearchChange) {
      onRouteSearchChange(merged);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set('keyword', merged.keyword);
    params.set('mode', merged.mode);
    params.set('sortKey', merged.sortKey);
    params.set('sortDirection', merged.sortDirection);
    params.set('page', String(merged.page));
    params.set('pageSize', String(merged.pageSize));
    router.replace(`/workflows?${params.toString()}`, { scroll: false });
  }, [applyWorkflowSearchState, debouncedSearchQuery, onRouteSearchChange, page, pageSize, router, searchParams, selectedMode, sortDirection, sortKey]);
  const configsQueryParams = useMemo(() => ({
    page: 1,
    pageSize: 500,
    sortKey: 'name' as WorkflowSortKey,
    sortDirection: 'asc' as SortDirection,
  }), []);
  const configsQuery = useConfigsQuery(configsQueryParams);
  const schedulesQuery = useSchedulesQuery();
  const triggerScheduleMutation = useTriggerScheduleMutation();
  const deleteConfigMutation = useDeleteConfigMutation();
  useSyncWorkflowConfigsToDb(configsQuery.data?.configs || []);
  const allWorkflowRows = useWorkflowConfigRows({
    keyword: '',
    mode: 'all',
    sortKey: 'name',
    sortDirection: 'asc',
  }) as WorkflowConfig[];
  const filteredWorkflowRows = useWorkflowConfigRows({
    keyword: debouncedSearchQuery,
    mode: selectedMode,
    sortKey,
    sortDirection,
  }) as WorkflowConfig[];
  const totalPages = Math.max(1, Math.ceil(filteredWorkflowRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const workflows = filteredWorkflowRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const loading = configsQuery.isLoading && allWorkflowRows.length === 0;
  const pagination: WorkflowPagination = {
    total: filteredWorkflowRows.length,
    totalPages,
    page: currentPage,
    pageSize,
    unfilteredTotal: allWorkflowRows.length,
  };
  const recentRunsQuery = useQuery({
    queryKey: ['workflows', 'detail', 'runs', drawerWorkflow?.filename || ''],
    queryFn: () => runsApi.listByConfig(drawerWorkflow?.filename || ''),
    enabled: Boolean(drawerWorkflow?.filename),
    staleTime: 15_000,
  });
  const recentRuns = useMemo(() => (recentRunsQuery.data?.runs || []).slice(0, 5), [recentRunsQuery.data?.runs]);
  const latestRun = recentRuns[0];
  const drawerDocumentParams = useMemo(() => ({
    summaryOnly: true,
    pageSize: 5,
    sortDirection: 'desc' as const,
  }), []);
  const latestRunDocumentsQuery = useRunDocumentsQuery(latestRun?.id, drawerDocumentParams);
  const drawerSchedules = useMemo(() => {
    const filename = drawerWorkflow?.filename;
    if (!filename) return [];
    return (schedulesQuery.data?.jobs || [])
      .filter((job) => job.configFile === filename)
      .sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        const aTime = a.nextRunTime ? Date.parse(a.nextRunTime) : Number.POSITIVE_INFINITY;
        const bTime = b.nextRunTime ? Date.parse(b.nextRunTime) : Number.POSITIVE_INFINITY;
        return aTime - bTime;
      })
      .slice(0, 5);
  }, [drawerWorkflow?.filename, schedulesQuery.data?.jobs]);

  useDocumentTitle('工作流管理');

  useEffect(() => {
    if (!routeSearch) return;
    applyWorkflowSearchState(routeSearch);
  }, [applyWorkflowSearchState, routeSearch]);

  const openWorkbench = useCallback((filename: string, mode: 'run' | 'design' = 'run', runId?: string) => {
    const route = buildWorkbenchPath(filename, mode, runId);
    if (dockWorkspace) {
      const search = buildWorkbenchSearch(runId ? 'run' : mode, runId);
      dockWorkspace.openTab({
        id: `workbench:${filename}:${runId ? 'run' : mode}:${runId || ''}`,
        title: filename,
        kind: 'workbench',
        config: filename,
        mode: runId ? 'run' : mode,
        runId,
        search,
      });
      const params = new URLSearchParams(searchParams.toString());
      params.delete('panel');
      params.delete('reload');
      WORKBENCH_SHELL_QUERY_KEYS.forEach((key) => params.delete(key));
      params.set('route', route);
      const shellPath = typeof window !== 'undefined' && window.location.pathname === '/dashboard' ? '/dashboard' : '/';
      router.push(`${shellPath}?${params.toString()}`, { scroll: false });
      return;
    }
    router.push(route);
  }, [dockWorkspace, router, searchParams]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_MODE_KEY);
      if (saved === 'gallery' || saved === 'table') setViewMode(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_VIEW_MODE_KEY);
      if (saved === 'gallery' || saved === 'table') setDraftViewMode(saved);
    } catch {}
  }, []);

  useEffect(() => {
    if (searchQuery.trim() === debouncedSearchQuery) return;
    const timer = window.setTimeout(() => {
      updateWorkflowSearch({ keyword: searchQuery.trim(), page: 1 });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [debouncedSearchQuery, searchQuery, updateWorkflowSearch]);

  useEffect(() => {
    if (page !== currentPage) updateWorkflowSearch({ page: currentPage });
  }, [currentPage, page, updateWorkflowSearch]);

  const toggleViewMode = (mode: 'gallery' | 'table') => {
    setViewMode(mode);
    try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch {}
  };

  const toggleDraftViewMode = (mode: DraftViewMode) => {
    setDraftViewMode(mode);
    try { localStorage.setItem(DRAFT_VIEW_MODE_KEY, mode); } catch {}
  };

  const refreshWorkflows = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['configs'] });
    await configsQuery.refetch();
  }, [configsQuery, queryClient]);

  useEffect(() => {
    if (configsQuery.isError) toast('error', '无法加载工作流列表');
  }, [configsQuery.isError, toast]);

  useEffect(() => {
    setSelectedWorkflows((prev) => {
      if (prev.size === 0) return prev;
      const visibleFiles = new Set(workflows.map((workflow) => workflow.filename));
      const next = new Set([...prev].filter((filename) => visibleFiles.has(filename)));
      return next.size === prev.size ? prev : next;
    });
  }, [workflows]);

  const loadCreationDrafts = useCallback(async () => {
    setCreationDraftsLoading(true);
    try {
      const data = await specCodingApi.listCreationSessions();
      setCreationDrafts(Array.isArray(data?.sessions) ? data.sessions : []);
    } catch {
      setCreationDrafts([]);
    } finally {
      setCreationDraftsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCreationDrafts();
  }, [loadCreationDrafts]);

  const loadShareableUsers = useCallback(async () => {
    if (shareableUsersLoading || shareableUsers.length > 0) return;
    setShareableUsersLoading(true);
    try {
      const users = await usersApi.listShareableUsers();
      setShareableUsers(users);
    } catch {
      toast('error', '无法加载可共享用户列表');
    } finally {
      setShareableUsersLoading(false);
    }
  }, [shareableUsers.length, shareableUsersLoading, toast]);

  const openNewWorkflowModal = useCallback((preset?: NewWorkflowModalPreset) => {
    setResumeCreationDraftId(null);
    setNewWorkflowModalPreset(preset || null);
    setShowNewModal(true);
  }, []);

  const resumeCreationDraft = useCallback((sessionId: string) => {
    setNewWorkflowModalPreset(null);
    setResumeCreationDraftId(sessionId);
    setShowNewModal(true);
  }, []);

  const openCopyDialog = useCallback((workflow: WorkflowConfig) => {
    const nextFilename = workflow.filename.endsWith('.yaml')
      ? workflow.filename.replace(/\.yaml$/i, '-copy.yaml')
      : `${workflow.filename}-copy.yaml`;
    setActiveWorkflow(workflow);
    setCopyFilename(nextFilename);
    setCopyWorkflowName(`${workflow.name} (副本)`);
    setSharingVisibility('private');
    setSharingUserIds([]);
    setCopyDialogOpen(true);
    void loadShareableUsers();
  }, [loadShareableUsers]);

  const openAiCopyWorkflow = useCallback((workflow: WorkflowConfig) => {
    openNewWorkflowModal({
      initialMode: 'ai-guided',
      initialWorkflowName: `${workflow.name} AI 副本`,
      initialReferenceWorkflow: workflow.filename,
      initialRequirements: '',
      initialDescription: workflow.description || '',
      hideAiGuided: false,
      focusRequirementsOnOpen: true,
    });
  }, [openNewWorkflowModal]);

  const openShareDialog = useCallback((workflow: WorkflowConfig) => {
    setActiveWorkflow(workflow);
    setSharingVisibility((workflow.visibility as 'private' | 'shared' | 'public') || 'private');
    setSharingUserIds(workflow.sharedWithUserIds || []);
    setShareDialogOpen(true);
    void loadShareableUsers();
  }, [loadShareableUsers]);

  const handleAICreate = () => {
    openNewWorkflowModal({
      initialMode: 'ai-guided',
      hideAiGuided: false,
      focusRequirementsOnOpen: true,
    });
  };

  const handleDelete = (workflow: WorkflowConfig) => {
    setDeleteWorkflowTarget(workflow);
  };

  const confirmDeleteWorkflow = async () => {
    if (!deleteWorkflowTarget) return;
    try {
      await deleteConfigMutation.mutateAsync(deleteWorkflowTarget.filename);
      toast('success', `工作流 "${deleteWorkflowTarget.filename}" 已删除`);
      setSelectedWorkflows((prev) => { const next = new Set(prev); next.delete(deleteWorkflowTarget.filename); return next; });
      setDeleteWorkflowTarget(null);
      if (drawerWorkflow?.filename === deleteWorkflowTarget.filename) setDrawerWorkflow(null);
    } catch (error) {
      toast('error', '无法删除工作流');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedWorkflows.size === 0) return;
    setBatchDeleteConfirmOpen(true);
  };

  const confirmBatchDelete = async () => {
    if (selectedWorkflows.size === 0) return;
    try {
      const result = await configApi.batchDeleteConfigs([...selectedWorkflows]);
      toast('success', `已删除 ${result.deletedCount} 个工作流`);
      setSelectedWorkflows(new Set());
      setBatchDeleteConfirmOpen(false);
      void refreshWorkflows();
    } catch (error) {
      toast('error', '批量删除失败');
    }
  };

  const handleImportWorkflowZip = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setArchiveImporting(true);
    try {
      const result = await configApi.importConfigZip(file);
      toast('success', result.message || `已导入 ${result.imported?.length || 0} 个工作流`);
      setWorkflowImportNotice({
        imported: result.imported || [],
        audit: result.audit,
      });
      setSelectedWorkflows(new Set());
      await refreshWorkflows();
    } catch (error: any) {
      toast('error', error?.message || '导入工作流失败');
    } finally {
      setArchiveImporting(false);
      if (archiveInputRef.current) archiveInputRef.current.value = '';
    }
  }, [refreshWorkflows, toast]);

  const handleExportSelectedWorkflows = useCallback(async () => {
    if (selectedWorkflows.size === 0) {
      toast('error', '请先选择要导出的工作流');
      return;
    }
    setArchiveExporting(true);
    try {
      const selected = Array.from(selectedWorkflows);
      const blob = await configApi.exportConfigs(selected);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'workflows-export.zip';
      link.click();
      URL.revokeObjectURL(url);
      toast('success', `已导出 ${selected.length} 个工作流`);
    } catch (error: any) {
      toast('error', error?.message || '导出工作流失败');
    } finally {
      setArchiveExporting(false);
    }
  }, [selectedWorkflows, toast]);

  const handleConfirmCopy = useCallback(async () => {
    if (!activeWorkflow) return;
    const filename = copyFilename.trim();
    const workflowName = copyWorkflowName.trim();
    if (!/^[a-zA-Z0-9_-]+\.yaml$/.test(filename)) {
      toast('error', '复制文件名必须以 .yaml 结尾，且只包含字母、数字、下划线和连字符');
      return;
    }
    if (!workflowName) {
      toast('error', '请输入副本工作流名称');
      return;
    }
    if (sharingVisibility === 'shared' && sharingUserIds.length === 0) {
      toast('error', '共享给指定用户时，至少选择一个用户');
      return;
    }
    try {
      setActionLoading(true);
      await configApi.copyConfig(activeWorkflow.filename, filename, {
        workflowName,
        visibility: sharingVisibility,
        sharedWithUserIds: sharingVisibility === 'shared' ? sharingUserIds : [],
      });
      toast('success', '工作流已复制');
      setCopyDialogOpen(false);
      setActiveWorkflow(null);
      await refreshWorkflows();
    } catch (error: any) {
      toast('error', error?.message || '复制工作流失败');
    } finally {
      setActionLoading(false);
    }
  }, [activeWorkflow, copyFilename, copyWorkflowName, refreshWorkflows, sharingUserIds, sharingVisibility, toast]);

  const handleConfirmShare = useCallback(async () => {
    if (!activeWorkflow) return;
    if (sharingVisibility === 'shared' && sharingUserIds.length === 0) {
      toast('error', '共享给指定用户时，至少选择一个用户');
      return;
    }
    try {
      setActionLoading(true);
      const detail = await configApi.getConfig(activeWorkflow.filename);
      await configApi.saveConfigWithMeta(activeWorkflow.filename, detail.config, {
        visibility: sharingVisibility,
        sharedWithUserIds: sharingVisibility === 'shared' ? sharingUserIds : [],
      });
      toast('success', '工作流可见性已更新');
      setShareDialogOpen(false);
      setActiveWorkflow(null);
      await refreshWorkflows();
    } catch (error: any) {
      toast('error', error?.message || '更新工作流可见性失败');
    } finally {
      setActionLoading(false);
    }
  }, [activeWorkflow, refreshWorkflows, sharingUserIds, sharingVisibility, toast]);

  const handleDeleteCreationDraft = useCallback((session: CreationDraftSession) => {
    setDeleteDraftTarget(session);
  }, []);

  const confirmDeleteCreationDraft = useCallback(async () => {
    if (!deleteDraftTarget) return;
    try {
      await specCodingApi.deleteCreationSession(deleteDraftTarget.id);
      toast('success', '创建草稿已删除');
      if (resumeCreationDraftId === deleteDraftTarget.id) {
        setResumeCreationDraftId(null);
      }
      setDeleteDraftTarget(null);
      void loadCreationDrafts();
    } catch (error) {
      toast('error', '删除创建草稿失败');
    }
  }, [deleteDraftTarget, loadCreationDrafts, resumeCreationDraftId, toast]);

  const toggleSelect = (filename: string) => {
    setSelectedWorkflows((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const allDisplayedSelected = displayedWorkflows.length > 0
      && displayedWorkflows.every((workflow) => selectedWorkflows.has(workflow.filename));
    if (allDisplayedSelected) {
      setSelectedWorkflows((prev) => {
        const next = new Set(prev);
        displayedWorkflows.forEach((workflow) => next.delete(workflow.filename));
        return next;
      });
    } else {
      setSelectedWorkflows((prev) => {
        const next = new Set(prev);
        displayedWorkflows.forEach((workflow) => next.add(workflow.filename));
        return next;
      });
    }
  };

  const formatWorkflowCreatedAt = (value?: number | string) => {
    let timestamp = 0;
    if (typeof value === 'number') timestamp = Number.isFinite(value) ? value : 0;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      timestamp = Number.isFinite(parsed) ? parsed : 0;
    }
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleSort = (key: WorkflowSortKey) => {
    if (sortKey === key) {
      updateWorkflowSearch({ sortDirection: sortDirection === 'asc' ? 'desc' : 'asc', page: 1 });
      return;
    }
    updateWorkflowSearch({ sortKey: key, sortDirection: key === 'createdAt' ? 'desc' : 'asc', page: 1 });
  };
  const formatDrawerTime = (value?: number | string | null) => {
    if (value === null || value === undefined || value === '') return '-';
    return formatWorkflowCreatedAt(value);
  };
  const runStatusTone = (status?: string): StatusTone => {
    if (status === 'completed') return 'success';
    if (status === 'running' || status === 'preparing') return 'info';
    if (status === 'pending') return 'warning';
    if (status === 'failed' || status === 'stopped' || status === 'crashed' || status === 'error') return 'danger';
    return 'neutral';
  };
  const scheduleStatusTone = (enabled?: boolean): StatusTone => enabled ? 'success' : 'neutral';
  const getRunEntryLabel = (run: RunRecord) => {
    const steps = Number.isFinite(run.totalSteps) ? `${run.completedSteps ?? 0}/${run.totalSteps}` : '';
    return steps ? `${run.configName || run.configFile} · ${steps}` : (run.configName || run.configFile || run.id);
  };
  const handleTriggerSchedule = async (jobId: string, name: string) => {
    try {
      await triggerScheduleMutation.mutateAsync(jobId);
      toast('success', `已触发计划 "${name}"`);
    } catch {
      toast('error', '触发计划失败');
    }
  };

  const SortIcon = ({ column }: { column: WorkflowSortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    return sortDirection === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5 text-primary" />
      : <ArrowDown className="h-3.5 w-3.5 text-primary" />;
  };

  const displayedWorkflows = workflows;
  const creationDraftGroups = useMemo(() => {
    const visibleDrafts = creationDrafts
      .filter((session) => session?.id && session.status !== 'archived')
      .sort((a, b) => {
        const aTime = Number(new Date(a.updatedAt || a.createdAt || 0));
        const bTime = Number(new Date(b.updatedAt || b.createdAt || 0));
        return draftSortDirection === 'desc' ? bTime - aTime : aTime - bTime;
      });
    const inProgress = visibleDrafts.filter((session) => session.status === 'draft' || session.status === 'confirmed');
    const completed = visibleDrafts.filter((session) => session.status === 'config-generated' || session.status === 'run-bound');
    return { inProgress, completed };
  }, [creationDrafts, draftSortDirection]);
  const allDisplayedWorkflowsSelected = displayedWorkflows.length > 0
    && displayedWorkflows.every((workflow) => selectedWorkflows.has(workflow.filename));
  const hasPartialDisplayedWorkflowSelection = displayedWorkflows.some((workflow) => selectedWorkflows.has(workflow.filename))
    && !allDisplayedWorkflowsSelected;
  const modeLabel = (mode?: string) => mode === 'state-machine' ? '状态机' : '阶段模式';
  const modePillTone = (mode?: string): StatusTone => mode === 'state-machine' ? 'info' : 'warning';
  const visibilityLabel = (workflow: WorkflowConfig) => {
    if (workflow.visibility === 'public') return '公开';
    if (workflow.visibility === 'shared') return `共享 ${workflow.sharedWithUserIds?.length || 0}`;
    return '个人';
  };
  const visibilityPillTone = (workflow: WorkflowConfig): StatusTone => (
    workflow.visibility === 'public' ? 'success' : workflow.visibility === 'shared' ? 'accent' : 'neutral'
  );
  const importAuditCounts = countImportAuditItems(workflowImportNotice);
  const importAutoRemovedCount = importAuditCounts.removedSkills
    + importAuditCounts.removedAgentDefinitions
    + importAuditCounts.removedAgentOverrides;
  const getWorkflowActions = (workflow: WorkflowConfig): ActionMenuGroup[] => [
    {
      actions: [
        {
          id: 'open',
          label: '打开运行工作台',
          icon: <LogIn className="h-4 w-4" />,
          primary: true,
          onSelect: () => openWorkbench(workflow.filename),
        },
        {
          id: 'design',
          label: '打开设计工作台',
          icon: <Edit className="h-4 w-4" />,
          onSelect: () => openWorkbench(workflow.filename, 'design'),
        },
      ],
    },
    {
      actions: [
        {
          id: 'copy',
          label: '直接复制',
          icon: <Copy className="h-4 w-4" />,
          onSelect: () => openCopyDialog(workflow),
        },
        {
          id: 'ai-copy',
          label: 'AI 复制',
          icon: <span className="material-symbols-outlined text-[16px]">auto_awesome</span>,
          onSelect: () => openAiCopyWorkflow(workflow),
        },
        {
          id: 'share',
          label: '分享',
          icon: <Share2 className="h-4 w-4" />,
          onSelect: () => openShareDialog(workflow),
        },
        {
          id: 'delete',
          label: '删除',
          icon: <Trash2 className="h-4 w-4" />,
          destructive: true,
          onSelect: () => handleDelete(workflow),
        },
      ],
    },
  ];
  const renderCopyMenu = (workflow: WorkflowConfig) => (
    <ActionMenu
      actions={[{ actions: getWorkflowActions(workflow)[1].actions.filter((action) => action.id === 'copy' || action.id === 'ai-copy') }]}
      triggerLabel="复制工作流"
      trigger={(
        <Button size="sm" variant="outline" title="复制工作流" onClick={(event) => event.stopPropagation()}>
          <Copy className="w-3 h-3" />
        </Button>
      )}
    />
  );
  const workflowTableColumns: DataTableColumn<WorkflowConfig>[] = [
    {
      id: 'name',
      header: '名称',
      sortable: true,
      width: '25%',
      render: (workflow) => (
        <div className="min-w-[200px]">
          <div className="font-medium">{workflow.name}</div>
          {workflow.description ? (
            <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{workflow.description}</div>
          ) : null}
        </div>
      ),
    },
    {
      id: 'filename',
      header: '文件名',
      accessor: (workflow) => workflow.filename,
      className: 'font-mono text-sm text-muted-foreground',
      priority: 3,
    },
    {
      id: 'mode',
      header: '模式',
      priority: 2,
      render: (workflow) => (
        <StatusPill tone={modePillTone(workflow.mode)} className="min-w-[72px] justify-center whitespace-nowrap">
          {modeLabel(workflow.mode)}
        </StatusPill>
      ),
    },
    {
      id: 'phaseCount',
      header: '阶段/状态',
      accessor: (workflow) => workflow.phaseCount ?? 0,
      priority: 3,
    },
    {
      id: 'stepCount',
      header: '步骤',
      accessor: (workflow) => workflow.stepCount ?? 0,
      priority: 3,
    },
    {
      id: 'visibility',
      header: '可见性',
      priority: 2,
      render: (workflow) => (
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={visibilityPillTone(workflow)} className="whitespace-nowrap">
            {visibilityLabel(workflow)}
          </StatusPill>
          {workflow.ownerName ? <span className="text-xs text-muted-foreground">{workflow.ownerName}</span> : null}
        </div>
      ),
    },
    {
      id: 'createdAt',
      header: '创建时间',
      sortable: true,
      accessor: (workflow) => formatWorkflowCreatedAt(workflow.createdAt),
      className: 'whitespace-nowrap text-sm text-muted-foreground',
      priority: 3,
    },
  ];
  const draftTableColumns: DataTableColumn<CreationDraftSession>[] = [
    {
      id: 'name',
      header: '名称',
      render: (session) => <span className="font-medium">{session.workflowName || '未命名工作流'}</span>,
    },
    {
      id: 'filename',
      header: '文件名',
      accessor: (session) => session.filename || '未命名配置',
      className: 'font-mono text-sm text-muted-foreground',
      priority: 3,
    },
    {
      id: 'stage',
      header: '当前阶段',
      accessor: (session) => getCreationStageLabel(session),
      priority: 2,
    },
    {
      id: 'status',
      header: '状态',
      render: (session) => (
        <StatusPill tone={getCreationProgressTone(session)}>
          {session.status === 'config-generated' || session.status === 'run-bound' ? '已完成' : '进行中'}
        </StatusPill>
      ),
      priority: 2,
    },
    {
      id: 'updatedAt',
      header: '最近更新',
      sortable: true,
      accessor: (session) => formatWorkflowCreatedAt(session.updatedAt || session.createdAt),
      className: 'whitespace-nowrap text-sm text-muted-foreground',
      priority: 3,
    },
  ];
  const getDraftActions = (session: CreationDraftSession): ActionMenuGroup[] => [
    {
      actions: [
        session.status === 'config-generated' || session.status === 'run-bound'
          ? {
              id: 'open',
              label: '打开工作流',
              icon: <LogIn className="h-4 w-4" />,
              primary: true,
              disabled: !session.filename,
              disabledReason: '草稿未关联工作流文件',
              onSelect: () => openWorkbench(session.filename || '', 'design'),
            }
          : {
              id: 'resume',
              label: '继续创建',
              icon: <Edit className="h-4 w-4" />,
              primary: true,
              onSelect: () => resumeCreationDraft(session.id),
            },
        {
          id: 'delete',
          label: '删除',
          icon: <Trash2 className="h-4 w-4" />,
          destructive: true,
          onSelect: () => handleDeleteCreationDraft(session),
        },
      ],
    },
  ];
  const renderDraftTable = (rows: CreationDraftSession[], emptyTitle: string) => (
    <DataTable
      aria-label={emptyTitle}
      columns={draftTableColumns}
      rows={rows}
      rowKey="id"
      density="comfortable"
      sort={{
        columnId: 'updatedAt',
        direction: draftSortDirection,
        onSortChange: ({ direction }) => setDraftSortDirection(direction),
      }}
      rowActions={(session) => getDraftActions(session)}
      onRowClick={(session) => {
        if (session.status === 'config-generated' || session.status === 'run-bound') {
          if (session.filename) openWorkbench(session.filename, 'design');
          return;
        }
        resumeCreationDraft(session.id);
      }}
      emptyState={{
        title: emptyTitle,
        description: '创建草稿会在新建工作流和 AI 生成流程中自动保存。',
      }}
    />
  );
  const getCreationStageLabel = (session: CreationDraftSession) => {
    if (session.status === 'run-bound') return '已生成工作流并启动运行';
    if (session.status === 'config-generated') return '已生成工作流';
    const step = session.uiState?.formStep;
    const labels: Record<number, string> = {
      1: '填写基础信息',
      2: '补充问答',
      3: '生成计划',
      4: '确认计划',
      5: '生成工作流',
    };
    return labels[step || 1] || '填写基础信息';
  };
  const getCreationProgressTone = (session: CreationDraftSession): StatusTone => (
    session.status === 'config-generated' || session.status === 'run-bound'
      ? 'success'
      : 'warning'
  );
  const renderCreationDraftCard = (session: CreationDraftSession) => (
    <DataCard key={session.id}>
      <DataCardHeader>
        <div className="min-w-0">
          <DataCardTitle>
            {session.workflowName || '未命名工作流'}
          </DataCardTitle>
          <DataCardDescription className="truncate font-mono text-xs">
            {session.filename || '未命名配置'}
          </DataCardDescription>
        </div>
        <StatusPill tone={getCreationProgressTone(session)} className="shrink-0">
          {session.status === 'config-generated' || session.status === 'run-bound' ? '已完成' : '进行中'}
        </StatusPill>
      </DataCardHeader>
      <DataCardMeta>
        <StatusPill tone="neutral" dot={false}>
          当前阶段: {getCreationStageLabel(session)}
        </StatusPill>
        <StatusPill tone="neutral" dot={false}>
          {session.status === 'config-generated' || session.status === 'run-bound' ? '已完成创建工作流' : '未完成创建'}
        </StatusPill>
        {session.mode ? (
          <StatusPill tone={session.mode === 'state-machine' ? 'info' : session.mode === 'ai-guided' ? 'accent' : 'warning'}>
            {session.mode === 'state-machine' ? '状态机' : session.mode === 'ai-guided' ? 'AI 引导' : '阶段模式'}
          </StatusPill>
        ) : null}
      </DataCardMeta>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {session.planningEngine ? <span>引擎: {session.planningEngine}</span> : null}
        {session.planningModel ? <span>模型: {session.planningModel}</span> : null}
        {session.updatedAt || session.createdAt ? <span>更新于 {formatWorkflowCreatedAt(session.updatedAt || session.createdAt)}</span> : null}
      </div>
      <DataCardActions className="justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => void handleDeleteCreationDraft(session)}
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          删除
        </Button>
        {session.status === 'config-generated' || session.status === 'run-bound' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => openWorkbench(session.filename || '', 'design')}
            disabled={!session.filename}
          >
            打开工作流
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              resumeCreationDraft(session.id);
            }}
          >
            继续创建
          </Button>
        )}
      </DataCardActions>
    </DataCard>
  );
  const headerSecondaryActions = (
    <>
      {activeTab === 'workflows' ? (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => archiveInputRef.current?.click()}
            disabled={archiveImporting}
            title="导入 workflow ZIP"
          >
            <Upload className={`h-4 w-4 xl:mr-2 ${archiveImporting ? 'animate-bounce' : ''}`} />
            <span className="hidden xl:inline">{archiveImporting ? '导入中...' : '导入 ZIP'}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExportSelectedWorkflows}
            disabled={archiveExporting || selectedWorkflows.size === 0}
            title="导出选中的 workflow ZIP"
          >
            <Download className={`h-4 w-4 xl:mr-2 ${archiveExporting ? 'animate-bounce' : ''}`} />
            <span className="hidden xl:inline">{archiveExporting ? '导出中...' : '导出'}</span>
          </Button>
        </>
      ) : null}
      <Button size="sm" variant="outline" onClick={handleAICreate}>
        <span className="material-symbols-outlined mr-1 text-sm">auto_awesome</span>
        AI 创建
      </Button>
    </>
  );
  const headerPrimaryAction = (
    <Button size="sm" onClick={() => openNewWorkflowModal({ hideAiGuided: true })}>
      <Plus className="mr-2 h-4 w-4" />
      新建工作流
    </Button>
  );
  const { isDashboardShell } = useDashboardShellHeader({
    title: '工作流管理',
    subtitle: '管理和配置工作流 · 代码生产黑灯车间',
    actions: (
      <>
        {headerSecondaryActions}
        {headerPrimaryAction}
      </>
    ),
  }, [activeTab, archiveImporting, archiveExporting, selectedWorkflows]);

  return (
    <div className={cn('bg-background', isDashboardShell ? 'flex min-h-full flex-col' : 'min-h-screen')}>
      <input
        ref={archiveInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={handleImportWorkflowZip}
      />
      {/* Header */}
      {!isDashboardShell ? (
        <PageHeader
          title="工作流管理"
          subtitle="管理和配置工作流 · 代码生产黑灯车间"
          leading={(
            <Button variant="ghost" size="sm" asChild>
              <Link href={returnTarget.href}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {returnTarget.label}
              </Link>
            </Button>
          )}
          secondaryActions={(
            <>
              <LanguageToggle />
              <ThemeToggle />
              {headerSecondaryActions}
            </>
          )}
          primaryAction={headerPrimaryAction}
          className="sticky top-0 z-20"
        >
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={activeTab === 'workflows' ? 'secondary' : 'ghost'}
              onClick={() => setActiveTab('workflows')}
            >
              工作流列表
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'drafts' ? 'secondary' : 'ghost'}
              onClick={() => setActiveTab('drafts')}
            >
              创建草稿箱
            </Button>
          </div>
        </PageHeader>
      ) : (
        <div className="border-b border-border bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={activeTab === 'workflows' ? 'secondary' : 'ghost'}
              onClick={() => setActiveTab('workflows')}
            >
              工作流列表
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'drafts' ? 'secondary' : 'ghost'}
              onClick={() => setActiveTab('drafts')}
            >
              创建草稿箱
            </Button>
          </div>
        </div>
      )}

      <div className={cn(
        'container mx-auto flex flex-col gap-4 px-6 py-6 pb-28',
        isDashboardShell && 'min-h-0 max-w-none flex-1 overflow-auto px-4 py-4 pb-28',
      )}>
        {activeTab === 'drafts' ? (
          <PageToolbar
            sort={(
              <Select value={draftSortDirection} onValueChange={(value: DraftSortDirection) => setDraftSortDirection(value)}>
                <SelectTrigger className="h-9 w-[132px] bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">最近更新</SelectItem>
                  <SelectItem value="asc">最早更新</SelectItem>
                </SelectContent>
              </Select>
            )}
            viewToggle={(
              <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1">
                <Button
                  size="sm"
                  variant={draftViewMode === 'gallery' ? 'secondary' : 'ghost'}
                  className="h-8 px-3"
                  onClick={() => toggleDraftViewMode('gallery')}
                >
                  <span className="material-symbols-outlined text-sm">grid_view</span>
                </Button>
                <Button
                  size="sm"
                  variant={draftViewMode === 'table' ? 'secondary' : 'ghost'}
                  className="h-8 px-3"
                  onClick={() => toggleDraftViewMode('table')}
                >
                  <span className="material-symbols-outlined text-sm">table_rows</span>
                </Button>
              </div>
            )}
            refresh={(
              <Button variant="outline" size="sm" onClick={() => void loadCreationDrafts()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                刷新
              </Button>
            )}
          />
        ) : null}

        {/* Filter bar */}
        {activeTab === 'workflows' ? (
        <PageToolbar
          className="sticky top-0 z-20"
          data-tour-step-id="workflow-filter"
          search={(
            <Input
              placeholder="搜索工作流..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9"
            />
          )}
          filters={(
            <Select value={selectedMode} onValueChange={(mode: WorkflowModeFilter) => updateWorkflowSearch({ mode, page: 1 })}>
              <SelectTrigger className="h-9 w-[132px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部模式</SelectItem>
                <SelectItem value="state-machine">状态机</SelectItem>
                <SelectItem value="phase-based">阶段模式</SelectItem>
              </SelectContent>
            </Select>
          )}
          sort={(
            <Select
              value={`${sortKey}:${sortDirection}`}
              onValueChange={(value) => {
                const [nextKey, nextDirection] = value.split(':') as [WorkflowSortKey, SortDirection];
                updateWorkflowSearch({ sortKey: nextKey, sortDirection: nextDirection, page: 1 });
              }}
            >
              <SelectTrigger className="h-9 w-[148px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="createdAt:desc">最新创建</SelectItem>
                <SelectItem value="createdAt:asc">最早创建</SelectItem>
                <SelectItem value="name:asc">名称 A-Z</SelectItem>
                <SelectItem value="name:desc">名称 Z-A</SelectItem>
              </SelectContent>
            </Select>
          )}
          viewToggle={(
            <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1">
              <Button
                size="sm"
                variant={viewMode === 'gallery' ? 'secondary' : 'ghost'}
                className="h-8 px-3"
                onClick={() => toggleViewMode('gallery')}
              >
                <span className="material-symbols-outlined text-sm">grid_view</span>
              </Button>
              <Button
                size="sm"
                variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                className="h-8 px-3"
                onClick={() => toggleViewMode('table')}
              >
                <span className="material-symbols-outlined text-sm">table_rows</span>
              </Button>
              </div>
          )}
          refresh={(
            <Button variant="outline" size="sm" onClick={() => void refreshWorkflows()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              刷新
            </Button>
          )}
        />
        ) : null}
        {/* Content */}
        {activeTab === 'workflows' ? (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-muted-foreground">加载中...</div>
              </div>
            ) : displayedWorkflows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <FileText className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  {pagination.unfilteredTotal === 0 ? '还没有工作流' : '没有匹配的工作流'}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {pagination.unfilteredTotal === 0 ? '创建你的第一个工作流配置' : '尝试调整搜索条件'}
                </p>
                {pagination.unfilteredTotal === 0 && (
                  <div className="flex items-center gap-3">
                    <Button size="sm" variant="outline" onClick={handleAICreate}>
                      <span className="material-symbols-outlined text-sm mr-1">auto_awesome</span>
                      AI 创建
                    </Button>
                    <Button onClick={() => openNewWorkflowModal({ hideAiGuided: true })}>
                      <Plus className="w-4 h-4 mr-2" />
                      新建工作流
                    </Button>
                  </div>
                )}
              </div>
            ) : viewMode === 'table' ? (
              <DataTable
                aria-label="工作流列表"
                columns={workflowTableColumns}
                rows={displayedWorkflows}
                rowKey="filename"
                density="comfortable"
                onRowClick={(workflow) => setDrawerWorkflow(workflow)}
                rowActions={(workflow) => getWorkflowActions(workflow)}
                selection={{
                  selectedKeys: Array.from(selectedWorkflows),
                  onSelectedKeysChange: (keys) => setSelectedWorkflows(new Set(keys.map(String))),
                  ariaLabel: allDisplayedWorkflowsSelected ? '取消全选当前页工作流' : '全选当前页工作流',
                }}
                sort={{
                  columnId: sortKey,
                  direction: sortDirection as DataTableSortDirection,
                  onSortChange: ({ columnId, direction }) => {
                    if (columnId === 'name' || columnId === 'createdAt') {
                      updateWorkflowSearch({ sortKey: columnId, sortDirection: direction, page: 1 });
                    }
                  },
                }}
                emptyState={{
                  title: '没有匹配的工作流',
                  description: '尝试调整搜索条件或模式过滤。',
                }}
              />
            ) : (
              <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {displayedWorkflows.map((workflow, index) => (
              <motion.div
                key={workflow.filename}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 12) * 0.03 }}
              >
                <DataCard
                  selected={selectedWorkflows.has(workflow.filename)}
                  className="relative cursor-pointer"
                  onClick={() => setDrawerWorkflow(workflow)}
                >
                  <div className="absolute left-3 top-3 z-10" onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={selectedWorkflows.has(workflow.filename)}
                      onCheckedChange={() => toggleSelect(workflow.filename)}
                    />
                  </div>

                <div className="pl-6">
                  <DataCardHeader className="mb-3">
                    <div className="min-w-0 flex-1">
                      <DataCardTitle>{workflow.name}</DataCardTitle>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{workflow.filename}</p>
                    </div>
                    <StatusPill tone={modePillTone(workflow.mode)} className="ml-2 shrink-0">
                      {modeLabel(workflow.mode)}
                    </StatusPill>
                  </DataCardHeader>

                  {workflow.description && (
                    <DataCardDescription className="mb-3 line-clamp-2">{workflow.description}</DataCardDescription>
                  )}

                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
                    <span>{workflow.phaseCount ?? 0} 个{workflow.mode === 'state-machine' ? '状态' : '阶段'}</span>
                    <span>{workflow.stepCount ?? 0} 个步骤</span>
                  </div>

                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <StatusPill tone={visibilityPillTone(workflow)}>{visibilityLabel(workflow)}</StatusPill>
                    {workflow.ownerName ? <span className="text-xs text-muted-foreground">所有者：{workflow.ownerName}</span> : null}
                  </div>

                  <DataCardActions className="justify-start" onClick={(event) => event.stopPropagation()}>
                    <Button size="sm" variant="outline" onClick={() => openWorkbench(workflow.filename)}>
                        <LogIn className="w-3 h-3 mr-1" />
                        打开运行工作台
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openWorkbench(workflow.filename, 'design')}>
                        <Edit className="w-3 h-3 mr-1" />
                        打开设计工作台
                    </Button>
                    {renderCopyMenu(workflow)}
                    <Button size="sm" variant="outline" onClick={() => openShareDialog(workflow)}>
                      <Share2 className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="destructive" aria-label={`删除工作流 ${workflow.name || workflow.filename}`} onClick={() => handleDelete(workflow)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </DataCardActions>
                </div>
                </DataCard>
              </motion.div>
            ))}
              </div>
              </>
            )}

            {!loading && pagination.total > 0 ? (
              <PaginationBar
                current={pagination.page}
                total={pagination.total}
                pageSize={pageSize}
                onPageChange={(nextPage) => updateWorkflowSearch({ page: nextPage })}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                onPageSizeChange={(size) => updateWorkflowSearch({ pageSize: size, page: 1 })}
                itemLabel="工作流"
                paginationStyle="numbered"
              />
            ) : null}
          </>
        ) : (
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[18px]">inventory_2</span>
                  <h2 className="text-lg font-semibold">创建草稿箱</h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  还没创建完的 workflow 草稿、补充问答和 Spec 规划会先落在这里，按需恢复继续做。
                </p>
              </div>
            </div>

            <div className="mt-4">
              {creationDraftsLoading ? (
                <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  正在读取创建草稿...
                </div>
              ) : creationDraftGroups.inProgress.length > 0 || creationDraftGroups.completed.length > 0 ? (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium">进行中</h3>
                      <Badge variant="outline" className="text-[10px]">{creationDraftGroups.inProgress.length}</Badge>
                    </div>
                    {creationDraftGroups.inProgress.length > 0 ? (
                      draftViewMode === 'table' ? (
                        renderDraftTable(creationDraftGroups.inProgress, '当前没有进行中的创建草稿')
                      ) : (
                        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                          {creationDraftGroups.inProgress.map(renderCreationDraftCard)}
                        </div>
                      )
                    ) : (
                      <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                        当前没有进行中的创建草稿。
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium">已完成创建</h3>
                      <Badge variant="outline" className="text-[10px]">{creationDraftGroups.completed.length}</Badge>
                    </div>
                    {creationDraftGroups.completed.length > 0 ? (
                      draftViewMode === 'table' ? (
                        renderDraftTable(creationDraftGroups.completed, '还没有已完成创建的工作流草稿记录')
                      ) : (
                        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                          {creationDraftGroups.completed.map(renderCreationDraftCard)}
                        </div>
                      )
                    ) : (
                      <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                        还没有已完成创建的工作流草稿记录。
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  暂无创建草稿记录。
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {showNewModal && (
        <NewConfigModal
          isOpen={showNewModal}
          onClose={() => {
            setShowNewModal(false);
            setResumeCreationDraftId(null);
            setNewWorkflowModalPreset(null);
            void loadCreationDrafts();
          }}
          onSuccess={(filename) => {
            setShowNewModal(false);
            setResumeCreationDraftId(null);
            setNewWorkflowModalPreset(null);
            void refreshWorkflows();
            void loadCreationDrafts();
            openWorkbench(filename, 'design');
          }}
          resumeCreationSessionId={resumeCreationDraftId}
          initialMode={newWorkflowModalPreset?.initialMode}
          initialWorkflowName={newWorkflowModalPreset?.initialWorkflowName}
          initialReferenceWorkflow={newWorkflowModalPreset?.initialReferenceWorkflow}
          initialRequirements={newWorkflowModalPreset?.initialRequirements}
          initialDescription={newWorkflowModalPreset?.initialDescription}
          initialWorkingDirectory={newWorkflowModalPreset?.initialWorkingDirectory}
          initialWorkspaceMode={newWorkflowModalPreset?.initialWorkspaceMode}
          hideAiGuided={newWorkflowModalPreset?.hideAiGuided ?? true}
          focusRequirementsOnOpen={newWorkflowModalPreset?.focusRequirementsOnOpen}
        />
      )}

      <Dialog open={copyDialogOpen} onOpenChange={(open) => { if (!actionLoading) setCopyDialogOpen(open); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>复制工作流</DialogTitle>
            <DialogDescription>创建一个新副本，并设置它的初始可见性。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">副本名称</label>
              <Input value={copyWorkflowName} onChange={(e) => setCopyWorkflowName(e.target.value)} placeholder="输入副本工作流名称" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">副本文件名</label>
              <Input value={copyFilename} onChange={(e) => setCopyFilename(e.target.value)} placeholder="example-copy.yaml" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">可见性</label>
              <Select value={sharingVisibility} onValueChange={(value: 'private' | 'shared' | 'public') => setSharingVisibility(value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">个人可见</SelectItem>
                  <SelectItem value="shared">指定用户可见</SelectItem>
                  <SelectItem value="public">公开可见</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {sharingVisibility === 'shared' ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">共享给用户</label>
                <MultiCombobox
                  value={sharingUserIds}
                  onValueChange={setSharingUserIds}
                  options={shareableUsers.map((user) => ({
                    value: user.id,
                    label: user.username,
                    description: user.email,
                  }))}
                  placeholder={shareableUsersLoading ? '加载用户中...' : '选择可访问该副本的用户'}
                />
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCopyDialogOpen(false)} disabled={actionLoading}>取消</Button>
              <Button onClick={() => void handleConfirmCopy()} disabled={actionLoading}>复制</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={shareDialogOpen} onOpenChange={(open) => { if (!actionLoading) setShareDialogOpen(open); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>设置工作流可见性</DialogTitle>
            <DialogDescription>管理员始终可访问全部工作流；不做设置时保持旧行为兼容。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <button type="button" onClick={() => setSharingVisibility('private')} className={cn('rounded-xl border p-3 text-left', sharingVisibility === 'private' && 'border-primary bg-primary/5')}>
                <div className="flex items-center gap-2 text-sm font-medium"><Lock className="h-4 w-4" />个人可见</div>
                <div className="mt-1 text-xs text-muted-foreground">仅创建者和管理员可访问</div>
              </button>
              <button type="button" onClick={() => setSharingVisibility('shared')} className={cn('rounded-xl border p-3 text-left', sharingVisibility === 'shared' && 'border-primary bg-primary/5')}>
                <div className="flex items-center gap-2 text-sm font-medium"><Share2 className="h-4 w-4" />指定用户</div>
                <div className="mt-1 text-xs text-muted-foreground">共享给明确指定的用户</div>
              </button>
              <button type="button" onClick={() => setSharingVisibility('public')} className={cn('rounded-xl border p-3 text-left', sharingVisibility === 'public' && 'border-primary bg-primary/5')}>
                <div className="flex items-center gap-2 text-sm font-medium"><Globe className="h-4 w-4" />公开可见</div>
                <div className="mt-1 text-xs text-muted-foreground">所有登录用户都可访问</div>
              </button>
            </div>
            {sharingVisibility === 'shared' ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">共享给用户</label>
                <MultiCombobox
                  value={sharingUserIds}
                  onValueChange={setSharingUserIds}
                  options={shareableUsers.map((user) => ({
                    value: user.id,
                    label: user.username,
                    description: user.email,
                  }))}
                  placeholder={shareableUsersLoading ? '加载用户中...' : '选择可访问该工作流的用户'}
                />
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShareDialogOpen(false)} disabled={actionLoading}>取消</Button>
              <Button onClick={() => void handleConfirmShare()} disabled={actionLoading}>保存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={Boolean(deleteWorkflowTarget)}
        variant="delete"
        title="删除工作流"
        objectName={deleteWorkflowTarget?.name || deleteWorkflowTarget?.filename}
        consequence="删除后将移除该工作流配置，此操作无法撤销。"
        confirmLabel="删除"
        loading={deleteConfigMutation.isPending}
        onConfirm={confirmDeleteWorkflow}
        onCancel={() => setDeleteWorkflowTarget(null)}
        onOpenChange={(open) => {
          if (!open) setDeleteWorkflowTarget(null);
        }}
      />

      <ConfirmModal
        open={batchDeleteConfirmOpen}
        variant="delete"
        title="批量删除工作流"
        objectName={`${selectedWorkflows.size} 个工作流`}
        consequence="删除后将移除所选工作流配置，此操作无法撤销。"
        confirmLabel={`删除 ${selectedWorkflows.size} 个`}
        affectedItems={Array.from(selectedWorkflows).map((filename) => ({ id: filename, label: filename }))}
        onConfirm={confirmBatchDelete}
        onCancel={() => setBatchDeleteConfirmOpen(false)}
        onOpenChange={setBatchDeleteConfirmOpen}
      />

      <ConfirmModal
        open={Boolean(deleteDraftTarget)}
        variant="delete"
        title="删除创建草稿"
        objectName={deleteDraftTarget?.workflowName || deleteDraftTarget?.filename || deleteDraftTarget?.id}
        consequence="删除后将移除该创建草稿，此操作无法撤销。"
        confirmLabel="删除"
        onConfirm={confirmDeleteCreationDraft}
        onCancel={() => setDeleteDraftTarget(null)}
        onOpenChange={(open) => {
          if (!open) setDeleteDraftTarget(null);
        }}
      />

      <Dialog open={!!workflowImportNotice} onOpenChange={(open) => { if (!open) setWorkflowImportNotice(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>导入工作流提醒</DialogTitle>
            <DialogDescription>
              已导入 {workflowImportNotice?.imported.length || 0} 个工作流。运行前请检查下面这些迁移相关事项。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="text-sm font-medium">1. 检查需求和步骤任务里的本机路径</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                导入包可能来自另一台机器。请检查 workflow 的需求说明、工作目录和每个步骤的任务描述里是否包含旧机器路径，例如用户目录、仓库路径、临时目录或脚本路径。
              </p>
              <div className="mt-3">
                <ImportAuditList
                  items={workflowImportNotice?.audit?.pathReminders}
                  emptyText="未扫描到明显不存在的绝对路径；仍建议检查需求和步骤任务描述。"
                />
              </div>
            </div>

            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">2. 不支持的 Skills / Agent 清理</div>
                <Badge variant={importAutoRemovedCount > 0 ? 'secondary' : 'outline'} className="text-[10px]">
                  已自动移除 {importAutoRemovedCount} 项
                </Badge>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                导入时已按本机可用的 Skill 和 Agent 配置做清理。下面列出的项在本机不可用，已经从可安全清理的位置移除。
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1.5 text-xs font-medium">已移除 Skills</div>
                  <ImportAuditList
                    items={workflowImportNotice?.audit?.removedSkills}
                    emptyText="没有移除 Skill。"
                  />
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-medium">已移除 Agent 配置/覆盖</div>
                  <ImportAuditList
                    items={[
                      ...(workflowImportNotice?.audit?.removedAgentDefinitions || []),
                      ...(workflowImportNotice?.audit?.removedAgentOverrides || []),
                    ]}
                    emptyText="没有移除 Agent 配置或执行覆盖。"
                  />
                </div>
              </div>
            </div>

            {importAuditCounts.unsupportedAgentRefs > 0 ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                <div className="text-sm font-medium text-amber-800 dark:text-amber-200">需要手动替换的 Agent 引用</div>
                <p className="mt-1 text-xs leading-5 text-amber-800/80 dark:text-amber-100/80">
                  这些字段是执行身份，系统不能直接删除，否则会破坏步骤结构。请在设计页把它们替换成本机存在的 Agent。
                </p>
                <div className="mt-3">
                  <ImportAuditList
                    items={workflowImportNotice?.audit?.unsupportedAgentRefs}
                    emptyText="没有需要手动替换的 Agent 引用。"
                  />
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button onClick={() => setWorkflowImportNotice(null)}>知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DetailDrawer open={!!drawerWorkflow} onOpenChange={(open) => { if (!open) setDrawerWorkflow(null); }}>
        <DetailDrawerContent>
          <DetailDrawerHeader>
            <DetailDrawerTitle>{drawerWorkflow?.name || '工作流详情'}</DetailDrawerTitle>
            <DetailDrawerDescription>{drawerWorkflow?.filename}</DetailDrawerDescription>
          </DetailDrawerHeader>
          {drawerWorkflow ? (
            <DetailDrawerBody className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={modePillTone(drawerWorkflow.mode)}>{modeLabel(drawerWorkflow.mode)}</StatusPill>
                <StatusPill tone={visibilityPillTone(drawerWorkflow)}>{visibilityLabel(drawerWorkflow)}</StatusPill>
              </div>
              {drawerWorkflow.description ? (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">描述</div>
                  <p className="mt-2 text-sm leading-6 text-foreground">{drawerWorkflow.description}</p>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border bg-card px-3 py-2">
                  <div className="text-xs text-muted-foreground">{drawerWorkflow.mode === 'state-machine' ? '状态' : '阶段'}</div>
                  <div className="mt-1 text-lg font-semibold">{drawerWorkflow.phaseCount ?? 0}</div>
                </div>
                <div className="rounded-lg border border-border bg-card px-3 py-2">
                  <div className="text-xs text-muted-foreground">步骤</div>
                  <div className="mt-1 text-lg font-semibold">{drawerWorkflow.stepCount ?? 0}</div>
                </div>
                <div className="rounded-lg border border-border bg-card px-3 py-2">
                  <div className="text-xs text-muted-foreground">Agent</div>
                  <div className="mt-1 text-lg font-semibold">{drawerWorkflow.agentCount ?? 0}</div>
                </div>
                <div className="rounded-lg border border-border bg-card px-3 py-2">
                  <div className="text-xs text-muted-foreground">所有者</div>
                  <div className="mt-1 truncate text-sm font-medium">{drawerWorkflow.ownerName || '-'}</div>
                </div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">配置元数据</div>
                <div className="mt-2 space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">文件名</span>
                    <span className="truncate font-mono">{drawerWorkflow.filename}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">创建时间</span>
                    <span>{formatWorkflowCreatedAt(drawerWorkflow.createdAt)}</span>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">关联数据</div>
                <div className="mt-2 grid gap-2">
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">最近运行</span>
                      {recentRunsQuery.isLoading ? (
                        <span className="text-xs text-muted-foreground">加载中...</span>
                      ) : (
                        <span className="font-medium">{recentRuns.length}</span>
                      )}
                    </div>
                    {recentRuns.length > 0 ? (
                      <div className="mt-2 space-y-2">
                        {recentRuns.map((run) => (
                          <div key={run.id} className="rounded-md border border-border/70 bg-muted/20 px-2 py-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium">{getRunEntryLabel(run)}</div>
                                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                                  {formatDrawerTime(run.startTime)} · {run.id}
                                </div>
                              </div>
                              <StatusPill tone={runStatusTone(run.status)} className="shrink-0 text-[10px]">
                                {run.status || 'unknown'}
                              </StatusPill>
                            </div>
                            <div className="mt-2 flex justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => openWorkbench(run.configFile || drawerWorkflow.filename, 'run', run.id)}
                              >
                                打开
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : recentRunsQuery.isLoading ? null : (
                      <div className="mt-2 text-xs text-muted-foreground">暂无运行记录。</div>
                    )}
                  </div>
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Agents</span>
                      <span className="font-medium">{drawerWorkflow.agentCount ?? 0}</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">文档</span>
                      {latestRunDocumentsQuery.isLoading ? (
                        <span className="text-xs text-muted-foreground">加载中...</span>
                      ) : (
                        <span className="font-medium">{latestRunDocumentsQuery.data?.pagination?.total ?? latestRunDocumentsQuery.data?.files?.length ?? 0}</span>
                      )}
                    </div>
                    {latestRun ? (
                      latestRunDocumentsQuery.data?.files?.length ? (
                        <div className="mt-2 space-y-2">
                          {latestRunDocumentsQuery.data.files.slice(0, 5).map((file) => (
                            <div key={`${file.sourceRunId || latestRun.id}:${file.filename}`} className="rounded-md border border-border/70 bg-muted/20 px-2 py-2">
                              <div className="truncate text-xs font-medium">{file.logicalName || file.baseName || file.filename}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                                <span>{file.documentKind || 'document'}</span>
                                {file.phaseName ? <span>{file.phaseName}</span> : null}
                                <span>{formatDrawerTime(file.modifiedTime)}</span>
                              </div>
                            </div>
                          ))}
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => openWorkbench(drawerWorkflow.filename, 'run', latestRun.id)}
                            >
                              打开运行工作台
                            </Button>
                          </div>
                        </div>
                      ) : latestRunDocumentsQuery.isLoading ? null : (
                        <div className="mt-2 text-xs text-muted-foreground">最新运行暂无文档。</div>
                      )
                    ) : (
                      <div className="mt-2 text-xs text-muted-foreground">暂无运行记录，无法关联运行文档。</div>
                    )}
                  </div>
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Schedules</span>
                      {schedulesQuery.isLoading ? (
                        <span className="text-xs text-muted-foreground">加载中...</span>
                      ) : (
                        <span className="font-medium">{drawerSchedules.length}</span>
                      )}
                    </div>
                    {drawerSchedules.length > 0 ? (
                      <div className="mt-2 space-y-2">
                        {drawerSchedules.map((job) => (
                          <div key={job.id} className="rounded-md border border-border/70 bg-muted/20 px-2 py-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium">{job.name}</div>
                                <div className="mt-1 text-[11px] text-muted-foreground">
                                  Next run: {job.enabled ? formatDrawerTime(job.nextRunTime) : '-'}
                                </div>
                              </div>
                              <StatusPill tone={scheduleStatusTone(job.enabled)} className="shrink-0 text-[10px]">
                                {job.enabled ? 'enabled' : 'disabled'}
                              </StatusPill>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <Link href="/schedules" className="text-xs text-primary hover:underline">计划页</Link>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={triggerScheduleMutation.isPending}
                                onClick={() => void handleTriggerSchedule(job.id, job.name)}
                              >
                                触发
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : schedulesQuery.isLoading ? null : (
                      <div className="mt-2 text-xs text-muted-foreground">暂无关联计划。</div>
                    )}
                  </div>
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Activity</span>
                      <span>{formatWorkflowCreatedAt(drawerWorkflow.createdAt)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </DetailDrawerBody>
          ) : null}
          {drawerWorkflow ? (
            <DetailDrawerFooter className="flex-wrap justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={async () => {
                  handleDelete(drawerWorkflow);
                  setDrawerWorkflow(null);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                删除
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => openShareDialog(drawerWorkflow)}>
                  <Share2 className="mr-2 h-4 w-4" />
                  共享
                </Button>
                <Button variant="outline" size="sm" onClick={() => openWorkbench(drawerWorkflow.filename, 'run')}>
                  <History className="mr-2 h-4 w-4" />
                  打开运行工作台
                </Button>
                <Button size="sm" onClick={() => openWorkbench(drawerWorkflow.filename, 'design')}>
                  <Edit className="mr-2 h-4 w-4" />
                  打开设计工作台
                </Button>
              </div>
            </DetailDrawerFooter>
          ) : null}
        </DetailDrawerContent>
      </DetailDrawer>

      {activeTab === 'workflows' && displayedWorkflows.length > 0 ? (
        <BulkActionBar
          selectedCount={selectedWorkflows.size}
          onClear={() => setSelectedWorkflows(new Set())}
          actions={(
            <>
              <Button size="sm" variant="outline" onClick={toggleSelectAll}>
                {allDisplayedWorkflowsSelected ? '取消全选当前页' : '全选当前页'}
              </Button>
              <Button size="sm" variant="destructive" onClick={handleBatchDelete}>
                <Trash2 className="mr-2 h-4 w-4" />
                批量删除
              </Button>
            </>
          )}
        />
      ) : null}
    </div>
  );
}

