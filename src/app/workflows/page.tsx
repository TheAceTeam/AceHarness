'use client';

import { useState, useEffect, useMemo, useRef, useCallback, type ChangeEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { configApi, specCodingApi, usersApi } from '@/lib/core/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MultiCombobox } from '@/components/ui/combobox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { Plus, LogIn, Edit, Trash2, ArrowLeft, FileText, ArrowDown, ArrowUp, ArrowUpDown, History, Copy, Globe, Lock, Share2, Upload, Download } from 'lucide-react';
import NewConfigModal from '@/components/NewConfigModal';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import ConfirmDialog from '@/components/ConfirmDialog';
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
type WorkflowsPageTab = 'workflows' | 'drafts';
type DraftViewMode = 'gallery' | 'table';
type DraftSortDirection = 'desc' | 'asc';
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

export default function WorkflowsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTarget = getOfficeAwareReturnTarget(searchParams.get('from'));
  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedMode, setSelectedMode] = useState<string>('all');
  const [sortKey, setSortKey] = useState<WorkflowSortKey>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pagination, setPagination] = useState<WorkflowPagination>({
    total: 0,
    totalPages: 1,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    unfilteredTotal: 0,
  });
  const [showNewModal, setShowNewModal] = useState(false);
  const [resumeCreationDraftId, setResumeCreationDraftId] = useState<string | null>(null);
  const [newWorkflowModalPreset, setNewWorkflowModalPreset] = useState<NewWorkflowModalPreset | null>(null);
  const [creationDrafts, setCreationDrafts] = useState<CreationDraftSession[]>([]);
  const [creationDraftsLoading, setCreationDraftsLoading] = useState(false);
  const [showAIGuide, setShowAIGuide] = useState(false);
  const [viewMode, setViewMode] = useState<'gallery' | 'table'>('table');
  const [draftViewMode, setDraftViewMode] = useState<DraftViewMode>('table');
  const [draftSortDirection, setDraftSortDirection] = useState<DraftSortDirection>('desc');
  const [activeTab, setActiveTab] = useState<WorkflowsPageTab>('workflows');
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<string>>(new Set());
  const [floatingFilterBar, setFloatingFilterBar] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowConfig | null>(null);
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
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const filterBarAnchorRef = useRef<HTMLDivElement | null>(null);
  const filterBarMeasureRef = useRef<HTMLDivElement | null>(null);
  const [filterBarHeight, setFilterBarHeight] = useState(0);

  useDocumentTitle('工作流管理');

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
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [selectedMode, sortKey, sortDirection, pageSize]);

  useEffect(() => {
    const updateFloatingState = () => {
      const anchor = filterBarAnchorRef.current;
      if (!anchor) return;
      setFloatingFilterBar(anchor.getBoundingClientRect().top <= 8);
    };
    const updateMeasure = () => {
      if (filterBarMeasureRef.current) {
        setFilterBarHeight(filterBarMeasureRef.current.getBoundingClientRect().height);
      }
    };
    updateMeasure();
    updateFloatingState();
    window.addEventListener('scroll', updateFloatingState, { passive: true });
    window.addEventListener('resize', updateMeasure);
    window.addEventListener('resize', updateFloatingState);
    return () => {
      window.removeEventListener('scroll', updateFloatingState);
      window.removeEventListener('resize', updateMeasure);
      window.removeEventListener('resize', updateFloatingState);
    };
  }, []);

  const toggleViewMode = (mode: 'gallery' | 'table') => {
    setViewMode(mode);
    try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch {}
  };

  const toggleDraftViewMode = (mode: DraftViewMode) => {
    setDraftViewMode(mode);
    try { localStorage.setItem(DRAFT_VIEW_MODE_KEY, mode); } catch {}
  };

  const loadWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      const data = await configApi.listConfigs({
        page,
        pageSize,
        keyword: debouncedSearchQuery,
        mode: selectedMode,
        sortKey,
        sortDirection,
      });
      setWorkflows(data.configs || []);
      if (data.pagination?.page && data.pagination.page !== page) {
        setPage(data.pagination.page);
      }
      setPagination(data.pagination || {
        total: data.configs?.length || 0,
        totalPages: 1,
        page,
        pageSize,
        unfilteredTotal: data.configs?.length || 0,
      });
      setSelectedWorkflows((prev) => {
        if (prev.size === 0) return prev;
        const visibleFiles = new Set((data.configs || []).map((workflow) => workflow.filename));
        const next = new Set([...prev].filter((filename) => visibleFiles.has(filename)));
        return next.size === prev.size ? prev : next;
      });
    } catch (error) {
      toast('error', '无法加载工作流列表');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearchQuery, page, pageSize, selectedMode, sortDirection, sortKey, toast]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

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
    setShowAIGuide(true);
  };

  const AI_GUIDE_SAMPLE_MESSAGE = '我想围绕【目标】创建一个工作流，工作目录是【路径】，请先帮我梳理需求、阶段、候选 Agent 和任务拆分。';

  const handleAIGuideConfirm = () => {
    setShowAIGuide(false);
    const encoded = encodeURIComponent(AI_GUIDE_SAMPLE_MESSAGE);
    router.push(`/?starterPrompt=${encoded}&sidebarTab=workflow&sessionTitle=创建工作流`);
  };

  const handleDelete = async (filename: string) => {
    const confirmed = await confirm({
      title: '删除工作流',
      description: `确定要删除工作流 "${filename}" 吗？此操作无法撤销。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (confirmed) {
      try {
        await configApi.deleteConfig(filename);
        toast('success', `工作流 "${filename}" 已删除`);
        setSelectedWorkflows((prev) => { const next = new Set(prev); next.delete(filename); return next; });
        loadWorkflows();
      } catch (error) {
        toast('error', '无法删除工作流');
      }
    }
  };

  const handleBatchDelete = async () => {
    if (selectedWorkflows.size === 0) return;
    const confirmed = await confirm({
      title: '批量删除工作流',
      description: `确定要删除选中的 ${selectedWorkflows.size} 个工作流吗？此操作无法撤销。`,
      confirmLabel: `删除 ${selectedWorkflows.size} 个`,
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (confirmed) {
      try {
        const result = await configApi.batchDeleteConfigs([...selectedWorkflows]);
        toast('success', `已删除 ${result.deletedCount} 个工作流`);
        setSelectedWorkflows(new Set());
        loadWorkflows();
      } catch (error) {
        toast('error', '批量删除失败');
      }
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
      await loadWorkflows();
    } catch (error: any) {
      toast('error', error?.message || '导入工作流失败');
    } finally {
      setArchiveImporting(false);
      if (archiveInputRef.current) archiveInputRef.current.value = '';
    }
  }, [loadWorkflows, toast]);

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
      await loadWorkflows();
    } catch (error: any) {
      toast('error', error?.message || '复制工作流失败');
    } finally {
      setActionLoading(false);
    }
  }, [activeWorkflow, copyFilename, copyWorkflowName, loadWorkflows, sharingUserIds, sharingVisibility, toast]);

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
      await loadWorkflows();
    } catch (error: any) {
      toast('error', error?.message || '更新工作流可见性失败');
    } finally {
      setActionLoading(false);
    }
  }, [activeWorkflow, loadWorkflows, sharingUserIds, sharingVisibility, toast]);

  const handleDeleteCreationDraft = useCallback(async (session: CreationDraftSession) => {
    const confirmed = await confirm({
      title: '删除创建草稿',
      description: `确定要删除草稿 "${session.workflowName || session.filename || session.id}" 吗？此操作无法撤销。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!confirmed) return;
    try {
      await specCodingApi.deleteCreationSession(session.id);
      toast('success', '创建草稿已删除');
      if (resumeCreationDraftId === session.id) {
        setResumeCreationDraftId(null);
      }
      void loadCreationDrafts();
    } catch (error) {
      toast('error', '删除创建草稿失败');
    }
  }, [confirm, loadCreationDrafts, resumeCreationDraftId, toast]);

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
      setSortDirection((prev) => prev === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(key);
    setSortDirection(key === 'createdAt' ? 'desc' : 'asc');
  };

  const SortIcon = ({ column }: { column: WorkflowSortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    return sortDirection === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5 text-primary" />
      : <ArrowDown className="h-3.5 w-3.5 text-primary" />;
  };

  const toggleDraftSortDirection = useCallback(() => {
    setDraftSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
  }, []);

  const DraftSortIcon = () => (
    draftSortDirection === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5 text-primary" />
      : <ArrowDown className="h-3.5 w-3.5 text-primary" />
  );

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
  const modeBadgeClass = (mode?: string) =>
    mode === 'state-machine'
      ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
      : 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  const visibilityLabel = (workflow: WorkflowConfig) => {
    if (workflow.visibility === 'public') return '公开';
    if (workflow.visibility === 'shared') return `共享 ${workflow.sharedWithUserIds?.length || 0}`;
    return '个人';
  };
  const visibilityBadgeClass = (workflow: WorkflowConfig) => (
    workflow.visibility === 'public'
      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : workflow.visibility === 'shared'
        ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300'
        : 'bg-slate-500/10 text-slate-700 dark:text-slate-300'
  );
  const importAuditCounts = countImportAuditItems(workflowImportNotice);
  const importAutoRemovedCount = importAuditCounts.removedSkills
    + importAuditCounts.removedAgentDefinitions
    + importAuditCounts.removedAgentOverrides;
  const renderCopyMenu = (workflow: WorkflowConfig) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" title="复制工作流">
          <Copy className="w-3 h-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => openCopyDialog(workflow)}>
          <Copy className="mr-2 h-3.5 w-3.5" />
          直接复制
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openAiCopyWorkflow(workflow)}>
          <span className="material-symbols-outlined mr-2 text-[16px]">auto_awesome</span>
          AI 复制
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const getCreationProgressTone = (session: CreationDraftSession) => (
    session.status === 'config-generated' || session.status === 'run-bound'
      ? 'secondary'
      : 'default'
  );
  const renderCreationDraftCard = (session: CreationDraftSession) => (
    <div key={session.id} className="rounded-2xl border bg-background/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {session.workflowName || '未命名工作流'}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {session.filename || '未命名配置'}
          </div>
        </div>
        <Badge variant={getCreationProgressTone(session)} className="shrink-0 text-[10px]">
          {session.status === 'config-generated' || session.status === 'run-bound' ? '已完成' : '进行中'}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <Badge variant="outline" className="text-[10px]">
          当前阶段: {getCreationStageLabel(session)}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {session.status === 'config-generated' || session.status === 'run-bound' ? '已完成创建工作流' : '未完成创建'}
        </Badge>
        {session.mode ? (
          <Badge variant="outline" className="text-[10px]">
            {session.mode === 'state-machine' ? '状态机' : session.mode === 'ai-guided' ? 'AI 引导' : '阶段模式'}
          </Badge>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {session.planningEngine ? <span>引擎: {session.planningEngine}</span> : null}
        {session.planningModel ? <span>模型: {session.planningModel}</span> : null}
        {session.updatedAt || session.createdAt ? <span>更新于 {formatWorkflowCreatedAt(session.updatedAt || session.createdAt)}</span> : null}
      </div>
      <div className="mt-4 flex justify-between gap-2">
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
            onClick={() => router.push(`/workbench/${encodeURIComponent(session.filename || '')}?mode=design`)}
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
      </div>
    </div>
  );
  return (
    <div className="min-h-screen bg-background">
      <input
        ref={archiveInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={handleImportWorkflowZip}
      />
      {/* Header */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/85 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href={returnTarget.href}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              {returnTarget.label}
            </Link>
          </Button>
          <div className="h-6 w-px bg-border" />
          <div>
            <h1 className="text-2xl font-bold">工作流管理</h1>
            <p className="text-xs text-muted-foreground">管理和配置工作流 · 代码生产黑灯车间</p>
          </div>
        </div>
        <div className="flex items-center gap-3" data-tour-step-id="workflow-create-actions">
          <LanguageToggle />
          <ThemeToggle />
          {activeTab === 'workflows' ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => archiveInputRef.current?.click()}
                disabled={archiveImporting}
                title="导入 workflow ZIP"
              >
                <Upload className={`w-4 h-4 xl:mr-2 ${archiveImporting ? 'animate-bounce' : ''}`} />
                <span className="hidden xl:inline">{archiveImporting ? '导入中...' : '导入 ZIP'}</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportSelectedWorkflows}
                disabled={archiveExporting || selectedWorkflows.size === 0}
                title="导出选中的 workflow ZIP"
              >
                <Download className={`w-4 h-4 xl:mr-2 ${archiveExporting ? 'animate-bounce' : ''}`} />
                <span className="hidden xl:inline">{archiveExporting ? '导出中...' : '导出'}</span>
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="outline" onClick={handleAICreate}>
            <span className="material-symbols-outlined text-sm mr-1">auto_awesome</span>
            AI 创建
          </Button>
          <Button onClick={() => openNewWorkflowModal({ hideAiGuided: true })}>
            <Plus className="w-4 h-4 mr-2" />
            手动创建
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8 pb-28 flex flex-col gap-6">
        {/* Floating filter anchor */}
        <div ref={filterBarAnchorRef} className="h-px" />
        {floatingFilterBar && activeTab === 'workflows' ? <div style={{ height: filterBarHeight }} /> : null}

        <section className="flex items-center justify-between gap-4">
          <div className="inline-flex rounded-full border border-border/60 bg-card/70 p-1 shadow-sm backdrop-blur">
            <Button
              size="sm"
              variant={activeTab === 'workflows' ? 'default' : 'ghost'}
              className="rounded-full px-4"
              onClick={() => setActiveTab('workflows')}
            >
              工作流列表
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'drafts' ? 'default' : 'ghost'}
              className="rounded-full px-4"
              onClick={() => setActiveTab('drafts')}
            >
              创建草稿箱
            </Button>
          </div>
          {activeTab === 'drafts' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={draftSortDirection} onValueChange={(value: DraftSortDirection) => setDraftSortDirection(value)}>
                <SelectTrigger className="h-9 w-[132px] bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">最近更新</SelectItem>
                  <SelectItem value="asc">最早更新</SelectItem>
                </SelectContent>
              </Select>
              <div className="inline-flex rounded-full border border-border/60 bg-muted/40 p-1">
                <Button
                  size="sm"
                  variant={draftViewMode === 'gallery' ? 'default' : 'ghost'}
                  className="h-8 rounded-full px-3"
                  onClick={() => toggleDraftViewMode('gallery')}
                >
                  <span className="material-symbols-outlined text-sm">grid_view</span>
                </Button>
                <Button
                  size="sm"
                  variant={draftViewMode === 'table' ? 'default' : 'ghost'}
                  className="h-8 rounded-full px-3"
                  onClick={() => toggleDraftViewMode('table')}
                >
                  <span className="material-symbols-outlined text-sm">table_rows</span>
                </Button>
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadCreationDrafts()}>
                刷新
              </Button>
            </div>
          ) : null}
        </section>

        {/* Filter bar */}
        {activeTab === 'workflows' ? (
        <section
          className={cn(
            floatingFilterBar
              ? 'fixed inset-x-0 top-2 z-40 px-6'
              : 'relative z-10'
          )}
          data-tour-step-id="workflow-filter"
        >
          <div className={cn(floatingFilterBar && 'mx-auto max-w-[1680px]')}>
            <div ref={filterBarMeasureRef} className="relative rounded-[24px] border border-border/70 bg-card/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85">
              <div className="pointer-events-none absolute inset-0 rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_55%)]" />
              <div className="relative flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:items-center">
                  <Input
                    placeholder="搜索工作流..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-11 w-full max-w-sm"
                  />
                  {viewMode === 'gallery' ? (
                    <div className="flex flex-wrap gap-2">
                      {(['all', 'state-machine', 'phase-based'] as const).map((mode) => (
                        <Button
                          key={mode}
                          size="sm"
                          variant={selectedMode === mode ? 'default' : 'outline'}
                          className={cn(
                            'rounded-full',
                            selectedMode === mode && mode === 'state-machine' && 'bg-sky-500 text-white hover:bg-sky-400',
                            selectedMode === mode && mode === 'phase-based' && 'bg-amber-500 text-white hover:bg-amber-400',
                          )}
                          onClick={() => setSelectedMode(mode)}
                        >
                          {mode === 'all' ? '全部' : mode === 'state-machine' ? '状态机' : '阶段模式'}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-4">
                  {/* View mode toggle */}
                  <div className="inline-flex rounded-full border border-border/60 bg-muted/40 p-1">
                    <Button
                      size="sm"
                      variant={viewMode === 'gallery' ? 'default' : 'ghost'}
                      className="h-8 rounded-full px-3"
                      onClick={() => toggleViewMode('gallery')}
                    >
                      <span className="material-symbols-outlined text-sm">grid_view</span>
                    </Button>
                    <Button
                      size="sm"
                      variant={viewMode === 'table' ? 'default' : 'ghost'}
                      className="h-8 rounded-full px-3"
                      onClick={() => toggleViewMode('table')}
                    >
                      <span className="material-symbols-outlined text-sm">table_rows</span>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
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
                      手动创建
                    </Button>
                  </div>
                )}
              </div>
            ) : viewMode === 'table' ? (
              <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card/80 shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={allDisplayedWorkflowsSelected ? true : hasPartialDisplayedWorkflowSelection ? 'indeterminate' : false}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead className="min-w-[220px]">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-ml-3 h-8 gap-1.5 px-2"
                          onClick={() => handleSort('name')}
                        >
                          名称
                          <SortIcon column="name" />
                        </Button>
                      </TableHead>
                      <TableHead>文件名</TableHead>
                      <TableHead className="min-w-[132px] whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>模式</span>
                          <Select value={selectedMode} onValueChange={setSelectedMode}>
                            <SelectTrigger className="h-8 w-[96px] bg-background">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">全部</SelectItem>
                              <SelectItem value="state-machine">状态机</SelectItem>
                              <SelectItem value="phase-based">阶段模式</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </TableHead>
                      <TableHead className="min-w-[72px] whitespace-normal leading-tight">阶段/状态</TableHead>
                      <TableHead>步骤</TableHead>
                      <TableHead className="min-w-[120px]">可见性</TableHead>
                      <TableHead className="min-w-[160px] whitespace-nowrap">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-ml-3 h-8 gap-1.5 px-2"
                          onClick={() => handleSort('createdAt')}
                        >
                          创建时间
                          <SortIcon column="createdAt" />
                        </Button>
                      </TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedWorkflows.map((wf) => (
                      <TableRow key={wf.filename} data-state={selectedWorkflows.has(wf.filename) ? 'selected' : undefined}>
                        <TableCell>
                          <Checkbox
                            checked={selectedWorkflows.has(wf.filename)}
                            onCheckedChange={() => toggleSelect(wf.filename)}
                          />
                        </TableCell>
                        <TableCell className="min-w-[200px]">
                          <div className="font-medium">{wf.name}</div>
                          {wf.description && (
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{wf.description}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground font-mono">{wf.filename}</TableCell>
                        <TableCell className="min-w-[92px] whitespace-nowrap">
                          <Badge className={cn('min-w-[72px] justify-center whitespace-nowrap', modeBadgeClass(wf.mode))}>{modeLabel(wf.mode)}</Badge>
                        </TableCell>
                        <TableCell className="min-w-[72px] whitespace-nowrap">{wf.phaseCount ?? 0}</TableCell>
                        <TableCell>{wf.stepCount ?? 0}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={cn('whitespace-nowrap', visibilityBadgeClass(wf))}>{visibilityLabel(wf)}</Badge>
                            {wf.ownerName ? <span className="text-xs text-muted-foreground">{wf.ownerName}</span> : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatWorkflowCreatedAt(wf.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-start gap-2">
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/workbench/${encodeURIComponent(wf.filename)}`}>
                                <LogIn className="w-3 h-3 mr-1" />
                                进入
                              </Link>
                            </Button>
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/workbench/${encodeURIComponent(wf.filename)}?mode=history`}>
                                <History className="w-3 h-3 mr-1" />
                                历史
                              </Link>
                            </Button>
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/workbench/${encodeURIComponent(wf.filename)}?mode=design`}>
                                <Edit className="w-3 h-3" />
                              </Link>
                            </Button>
                            {renderCopyMenu(wf)}
                            <Button size="sm" variant="outline" onClick={() => openShareDialog(wf)}>
                              <Share2 className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="destructive" aria-label={`删除工作流 ${wf.name || wf.filename}`} onClick={() => handleDelete(wf.filename)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {displayedWorkflows.map((workflow, index) => (
              <motion.div
                key={workflow.filename}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 12) * 0.03 }}
                className={cn(
                  'relative group rounded-xl border bg-card p-5 hover:shadow-md transition-all',
                  selectedWorkflows.has(workflow.filename)
                    ? 'border-primary ring-1 ring-primary/30'
                    : 'border-border/50'
                )}
              >
                {/* Checkbox */}
                <div className="absolute top-3 left-3 z-10">
                  <Checkbox
                    checked={selectedWorkflows.has(workflow.filename)}
                    onCheckedChange={() => toggleSelect(workflow.filename)}
                  />
                </div>

                <div className="pl-6">
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold truncate">{workflow.name}</h3>
                      <p className="text-xs text-muted-foreground mt-1 font-mono">{workflow.filename}</p>
                    </div>
                    <Badge className={cn('ml-2 shrink-0', modeBadgeClass(workflow.mode))}>
                      {modeLabel(workflow.mode)}
                    </Badge>
                  </div>

                  {workflow.description && (
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{workflow.description}</p>
                  )}

                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
                    <span>{workflow.phaseCount ?? 0} 个{workflow.mode === 'state-machine' ? '状态' : '阶段'}</span>
                    <span>{workflow.stepCount ?? 0} 个步骤</span>
                  </div>

                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <Badge className={visibilityBadgeClass(workflow)}>{visibilityLabel(workflow)}</Badge>
                    {workflow.ownerName ? <span className="text-xs text-muted-foreground">所有者：{workflow.ownerName}</span> : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/workbench/${encodeURIComponent(workflow.filename)}`}>
                        <LogIn className="w-3 h-3 mr-1" />
                        进入
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/workbench/${encodeURIComponent(workflow.filename)}?mode=history`}>
                        <History className="w-3 h-3 mr-1" />
                        历史
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/workbench/${encodeURIComponent(workflow.filename)}?mode=design`}>
                        <Edit className="w-3 h-3" />
                      </Link>
                    </Button>
                    {renderCopyMenu(workflow)}
                    <Button size="sm" variant="outline" onClick={() => openShareDialog(workflow)}>
                      <Share2 className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="destructive" aria-label={`删除工作流 ${workflow.name || workflow.filename}`} onClick={() => handleDelete(workflow.filename)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
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
                onPageChange={setPage}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                itemLabel="工作流"
                paginationStyle="numbered"
              />
            ) : null}
          </>
        ) : (
          <section className="rounded-[24px] border border-border/70 bg-card/70 p-5 shadow-sm backdrop-blur">
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
                <div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
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
                        <div className="overflow-hidden rounded-[24px] border border-border/70 bg-card/80 shadow-sm">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>名称</TableHead>
                                <TableHead>文件名</TableHead>
                                <TableHead>当前阶段</TableHead>
                                <TableHead>状态</TableHead>
                                <TableHead className="min-w-[160px] whitespace-nowrap">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="-ml-3 h-8 gap-1.5 px-2"
                                    onClick={toggleDraftSortDirection}
                                  >
                                    最近更新
                                    <DraftSortIcon />
                                  </Button>
                                </TableHead>
                                <TableHead>操作</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {creationDraftGroups.inProgress.map((session) => (
                                <TableRow key={session.id}>
                                  <TableCell className="font-medium">{session.workflowName || '未命名工作流'}</TableCell>
                                  <TableCell className="font-mono text-sm text-muted-foreground">{session.filename || '未命名配置'}</TableCell>
                                  <TableCell>{getCreationStageLabel(session)}</TableCell>
                                  <TableCell>
                                    <Badge variant={getCreationProgressTone(session)} className="text-[10px]">进行中</Badge>
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                    {formatWorkflowCreatedAt(session.updatedAt || session.createdAt)}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          resumeCreationDraft(session.id);
                                        }}
                                      >
                                        继续创建
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                        onClick={() => void handleDeleteCreationDraft(session)}
                                      >
                                        删除
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                          {creationDraftGroups.inProgress.map(renderCreationDraftCard)}
                        </div>
                      )
                    ) : (
                      <div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
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
                        <div className="overflow-hidden rounded-[24px] border border-border/70 bg-card/80 shadow-sm">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>名称</TableHead>
                                <TableHead>文件名</TableHead>
                                <TableHead>当前阶段</TableHead>
                                <TableHead>状态</TableHead>
                                <TableHead className="min-w-[160px] whitespace-nowrap">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="-ml-3 h-8 gap-1.5 px-2"
                                    onClick={toggleDraftSortDirection}
                                  >
                                    最近更新
                                    <DraftSortIcon />
                                  </Button>
                                </TableHead>
                                <TableHead>操作</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {creationDraftGroups.completed.map((session) => (
                                <TableRow key={session.id}>
                                  <TableCell className="font-medium">{session.workflowName || '未命名工作流'}</TableCell>
                                  <TableCell className="font-mono text-sm text-muted-foreground">{session.filename || '未命名配置'}</TableCell>
                                  <TableCell>{getCreationStageLabel(session)}</TableCell>
                                  <TableCell>
                                    <Badge variant={getCreationProgressTone(session)} className="text-[10px]">已完成</Badge>
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                    {formatWorkflowCreatedAt(session.updatedAt || session.createdAt)}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => router.push(`/workbench/${encodeURIComponent(session.filename || '')}?mode=design`)}
                                        disabled={!session.filename}
                                      >
                                        打开工作流
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                        onClick={() => void handleDeleteCreationDraft(session)}
                                      >
                                        删除
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                          {creationDraftGroups.completed.map(renderCreationDraftCard)}
                        </div>
                      )
                    ) : (
                      <div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                        还没有已完成创建的工作流草稿记录。
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
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
            loadWorkflows();
            void loadCreationDrafts();
            router.push(`/workbench/${encodeURIComponent(filename)}?mode=design`);
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

      {dialogProps && <ConfirmDialog {...dialogProps} />}

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

      {/* AI 引导创建指南弹窗 */}
      <Dialog open={showAIGuide} onOpenChange={setShowAIGuide}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="material-symbols-outlined text-xl">auto_awesome</span>
              AI 引导创建工作流
            </DialogTitle>
            <DialogDescription>
              先描述目标，再创建工作流
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              这类操作依赖当前对话上下文。先把目标、工作目录和约束告诉 AI，再让它生成右侧表单预填信息会更稳定。
            </p>

            <div className="text-sm font-medium">建议先发送这样一条消息</div>
            <div className="rounded-lg border bg-muted/50 p-3">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-base text-primary mt-0.5">smart_toy</span>
                <p className="text-sm italic text-muted-foreground">
                  {AI_GUIDE_SAMPLE_MESSAGE}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <span className="material-symbols-outlined text-base text-primary">auto_awesome</span>
                AI 将这样推进
              </div>
              <ul className="space-y-1.5 text-sm text-muted-foreground pl-6">
                <li>先确认你的目标、输入、工作目录和约束。</li>
                <li>整理出阶段、候选 Agent、工作流结构和关键风险。</li>
                <li>把这些信息同步到右侧工作流表单，再进入创建。</li>
              </ul>
            </div>

            <p className="text-xs text-muted-foreground">
              点击下面按钮后，这条示例消息会直接放入输入框，不会自动发送。你可以先补充细节，再手动发出。
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowAIGuide(false)}>
              稍后再说
            </Button>
            <Button onClick={handleAIGuideConfirm}>
              <span className="material-symbols-outlined text-sm mr-1.5">edit_note</span>
              把示例消息放入输入框
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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

      {activeTab === 'workflows' && displayedWorkflows.length > 0 ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 w-full max-w-fit -translate-x-1/2 px-4">
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-full border border-border/70 bg-background/95 px-3 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.18)] backdrop-blur">
            <div
              className="flex items-center rounded-full border border-border/70 bg-background px-4 py-2 text-sm shadow-sm"
              role="button"
              tabIndex={0}
              onClick={toggleSelectAll}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleSelectAll();
                }
              }}
            >
              <Checkbox
                checked={allDisplayedWorkflowsSelected ? true : hasPartialDisplayedWorkflowSelection ? 'indeterminate' : false}
                aria-label={allDisplayedWorkflowsSelected ? '取消全选当前页工作流' : '全选当前页工作流'}
                className="mr-2 h-4 w-4 rounded-[5px] border-border bg-background"
                onCheckedChange={toggleSelectAll}
              />
              {allDisplayedWorkflowsSelected ? '取消全选' : '全选当前页'}
            </div>
            <div className="px-3 text-sm font-medium text-foreground/80">
              已选 {selectedWorkflows.size} 项
            </div>
            {selectedWorkflows.size > 0 ? (
              <Button size="sm" variant="destructive" className="rounded-full px-4" onClick={handleBatchDelete}>
                <Trash2 className="mr-2 h-4 w-4" />
                批量删除
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
