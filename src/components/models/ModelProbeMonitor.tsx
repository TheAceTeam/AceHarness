'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CheckCircle2,
  Clock3,
  Edit3,
  Gauge,
  Loader2,
  Play,
  Plus,
  RefreshCcw,
  Settings2,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ComboboxPortalProvider, SingleCombobox } from '@/components/ui/combobox';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/core/utils';
import { getEngineDisplayName } from '@/lib/core/engine-metadata';
import type { ModelProbeListResponse, ModelProbeRuntimeStatus, ModelProbeSummary } from '@/lib/models/probe-types';

interface ManagedModelReference {
  id: string;
  name: string;
  endpoints: string[];
  engines: string[];
}

interface AuthViewer {
  username: string;
  email: string;
  role: 'admin' | 'user';
  avatar?: string;
}

type SortMode = 'custom' | 'group' | 'name';
type AvailabilityWindow = 7 | 15 | 30;
type ProbeFormMode = 'single' | 'batch';
type ProbeDriver = 'auto' | 'sdk' | 'stdio';
type GroupActionMode = 'split' | 'merge';

interface SingleProbeFormState {
  name: string;
  engine: string;
  driver: ProbeDriver;
  model: string;
  intervalMinutes: string;
  timeoutMs: string;
  enabled: boolean;
  note: string;
}

interface BatchProbeFormState {
  groupName: string;
  engine: string;
  driver: ProbeDriver;
  intervalMinutes: string;
  timeoutMs: string;
  enabled: boolean;
  note: string;
  search: string;
  selectedModelIds: string[];
}

interface GroupActionDialogState {
  open: boolean;
  mode: GroupActionMode;
  groupName: string;
}

const POLL_INTERVAL_MS = 30_000;
const HISTORY_BAR_COUNT = 60;
const DEFAULT_POLL_MINUTES = 5;
const DRIVER_CAPABLE_ENGINES = new Set(['claude-code', 'opencode', 'nga', 'codegenie']);
const PROBE_ENGINES = [
  'claude-code',
  'codex',
  'opencode',
  'kiro-cli',
  'nga',
  'codegenie',
  'cursor',
  'trae-cli',
] as const;
const AVAILABILITY_WINDOWS: AvailabilityWindow[] = [7, 15, 30];
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  cangjie: 'Cangjie',
  mixed: 'Mixed',
  unknown: 'Unassigned',
};

function readStoredAuthUser(): AuthViewer | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem('auth-user');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (parsed?.role === 'admin' || parsed?.role === 'user') {
      return parsed as AuthViewer;
    }
  } catch {}
  return null;
}

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = { ...getAuthHeaders(), ...(init?.headers || {}) };
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('auth-token');
    localStorage.removeItem('auth-user');
    window.dispatchEvent(new CustomEvent('auth:expired'));
    if (window.location.pathname !== '/login') {
      window.location.replace('/login');
    }
  }
  return response;
}

function createEmptySingleForm(): SingleProbeFormState {
  return {
    name: '',
    engine: 'claude-code',
    driver: 'auto',
    model: '',
    intervalMinutes: String(DEFAULT_POLL_MINUTES),
    timeoutMs: '45000',
    enabled: true,
    note: '',
  };
}

function createEmptyBatchForm(): BatchProbeFormState {
  return {
    groupName: 'New Group',
    engine: 'claude-code',
    driver: 'auto',
    intervalMinutes: String(DEFAULT_POLL_MINUTES),
    timeoutMs: '45000',
    enabled: true,
    note: '',
    search: '',
    selectedModelIds: [],
  };
}

function createGroupActionState(mode: GroupActionMode, groupName: string): GroupActionDialogState {
  return {
    open: true,
    mode,
    groupName,
  };
}

function supportsDriverSelection(engine: string): boolean {
  return DRIVER_CAPABLE_ENGINES.has(engine);
}

function driverLabel(driver?: string): string {
  if (driver === 'sdk') return 'SDK';
  if (driver === 'stdio') return 'STDIO';
  return 'AUTO';
}

function providerLabel(endpoint?: string): string {
  return PROVIDER_LABELS[endpoint || ''] || endpoint || PROVIDER_LABELS.unknown;
}

function statusMeta(status: ModelProbeRuntimeStatus): {
  label: string;
  badgeClassName: string;
  dotClassName: string;
  icon: typeof CheckCircle2;
} {
  switch (status) {
    case 'operational':
      return {
        label: '正常',
        badgeClassName: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        dotClassName: 'bg-emerald-500',
        icon: CheckCircle2,
      };
    case 'running':
      return {
        label: '探测中',
        badgeClassName: 'border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400',
        dotClassName: 'bg-sky-500',
        icon: Activity,
      };
    case 'degraded':
      return {
        label: '波动',
        badgeClassName: 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400',
        dotClassName: 'bg-amber-500',
        icon: AlertTriangle,
      };
    case 'down':
      return {
        label: '异常',
        badgeClassName: 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400',
        dotClassName: 'bg-red-500',
        icon: XCircle,
      };
    case 'paused':
      return {
        label: '已暂停',
        badgeClassName: 'border-zinc-500/20 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
        dotClassName: 'bg-zinc-500',
        icon: Settings2,
      };
    case 'unknown':
    default:
      return {
        label: '待探测',
        badgeClassName: 'border-border/80 bg-muted text-muted-foreground',
        dotClassName: 'bg-muted-foreground',
        icon: Gauge,
      };
  }
}

function statusPriority(status: ModelProbeRuntimeStatus): number {
  switch (status) {
    case 'operational':
      return 0;
    case 'running':
      return 1;
    case 'degraded':
      return 2;
    case 'down':
      return 3;
    case 'unknown':
      return 4;
    case 'paused':
    default:
      return 5;
  }
}

function availabilityForWindow(probe: ModelProbeSummary, window: AvailabilityWindow) {
  if (window === 15) return probe.availability.days15;
  if (window === 30) return probe.availability.days30;
  return probe.availability.days7;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '--';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '--';
  return new Date(timestamp).toLocaleString();
}

function formatMs(value?: number | null): string {
  if (value == null || value <= 0) return '--';
  return `${Math.round(value).toLocaleString()} ms`;
}

function formatRate(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatCountdown(target: string | null, nowMs: number): string {
  if (!target) return '--';
  const diff = Date.parse(target) - nowMs;
  if (!Number.isFinite(diff)) return '--';
  if (diff <= 0) return '准备执行';
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function buildHistoryBars(probe: ModelProbeSummary) {
  const points = [...probe.history].reverse();
  const padding = Array.from({ length: Math.max(0, HISTORY_BAR_COUNT - points.length) }, (_, index) => ({
    at: `empty-${index}`,
    status: 'unknown' as const,
    success: null,
    responseLatencyMs: null,
  }));
  return [...padding, ...points].slice(-HISTORY_BAR_COUNT);
}

function modelSupportsEngine(model: ManagedModelReference, engine: string): boolean {
  return model.engines.length === 0 || model.engines.includes(engine);
}

function overallHealthLabel(data: ModelProbeListResponse | null): string {
  if (!data || data.summary.total === 0) return 'IDLE';
  if (data.summary.down > 0) return 'PARTIAL OUTAGE';
  if (data.summary.degraded > 0) return 'DEGRADED';
  if (data.summary.operational > 0) return 'OPERATIONAL';
  return 'MONITORING';
}

function groupOrder(sortMode: SortMode, window: AvailabilityWindow) {
  return (
    a: { provider: string; groupName: string; probes: ModelProbeSummary[] },
    b: { provider: string; groupName: string; probes: ModelProbeSummary[] },
  ) => {
    if (sortMode === 'name') {
      return a.groupName.localeCompare(b.groupName, 'zh-CN');
    }
    const aBest = Math.min(...a.probes.map((probe) => statusPriority(probe.status)));
    const bBest = Math.min(...b.probes.map((probe) => statusPriority(probe.status)));
    if (aBest !== bBest) return aBest - bBest;

    const aRate = a.probes.reduce((sum, probe) => sum + availabilityForWindow(probe, window).successRate, 0) / Math.max(1, a.probes.length);
    const bRate = b.probes.reduce((sum, probe) => sum + availabilityForWindow(probe, window).successRate, 0) / Math.max(1, b.probes.length);
    if (sortMode === 'group' && aRate !== bRate) return bRate - aRate;

    return a.groupName.localeCompare(b.groupName, 'zh-CN');
  };
}

function cardOrder(sortMode: SortMode, window: AvailabilityWindow) {
  return (a: ModelProbeSummary, b: ModelProbeSummary) => {
    if (sortMode === 'name') return a.name.localeCompare(b.name, 'zh-CN');
    const statusDiff = statusPriority(a.status) - statusPriority(b.status);
    if (statusDiff !== 0) return statusDiff;
    const rateDiff = availabilityForWindow(b, window).successRate - availabilityForWindow(a, window).successRate;
    if (rateDiff !== 0) return rateDiff;
    const latencyDiff = (a.latestRun?.responseLatencyMs || Number.MAX_SAFE_INTEGER) - (b.latestRun?.responseLatencyMs || Number.MAX_SAFE_INTEGER);
    if (latencyDiff !== 0) return latencyDiff;
    return a.name.localeCompare(b.name, 'zh-CN');
  };
}

export default function ModelProbeMonitor({ managedModels }: { managedModels: ManagedModelReference[] }) {
  const { toast, updateToast } = useToast();
  const [data, setData] = useState<ModelProbeListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('custom');
  const [windowDays, setWindowDays] = useState<AvailabilityWindow>(7);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<ProbeFormMode>('single');
  const [editingProbe, setEditingProbe] = useState<ModelProbeSummary | null>(null);
  const [singleForm, setSingleForm] = useState<SingleProbeFormState>(createEmptySingleForm);
  const [batchForm, setBatchForm] = useState<BatchProbeFormState>(createEmptyBatchForm);
  const [batchLeftSelection, setBatchLeftSelection] = useState<string[]>([]);
  const [batchRightSelection, setBatchRightSelection] = useState<string[]>([]);
  const [selectedProbeIds, setSelectedProbeIds] = useState<Set<string>>(new Set());
  const [groupActionDialog, setGroupActionDialog] = useState<GroupActionDialogState | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthViewer | null>(() => readStoredAuthUser());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const isAdmin = currentUser?.role === 'admin';

  const engineOptions = useMemo(() => PROBE_ENGINES.map((engine) => ({
    value: engine,
    label: getEngineDisplayName(engine),
  })), []);

  const driverOptions = useMemo(() => ([
    { value: 'auto', label: '自动' },
    { value: 'sdk', label: 'SDK' },
    { value: 'stdio', label: 'STDIO' },
  ]), []);

  const suggestedModels = useMemo(() => {
    const query = singleForm.model.trim().toLowerCase();
    return managedModels
      .filter((model) => modelSupportsEngine(model, singleForm.engine))
      .filter((model) => {
        if (!query) return true;
        return model.id.toLowerCase().includes(query) || model.name.toLowerCase().includes(query);
      })
      .slice(0, 10);
  }, [managedModels, singleForm.engine, singleForm.model]);

  const eligibleBatchModels = useMemo(() => (
    managedModels
      .filter((model) => modelSupportsEngine(model, batchForm.engine))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  ), [batchForm.engine, managedModels]);

  const availableBatchModels = useMemo(() => {
    const selectedSet = new Set(batchForm.selectedModelIds);
    const query = batchForm.search.trim().toLowerCase();
    return eligibleBatchModels.filter((model) => {
      if (selectedSet.has(model.id)) return false;
      if (!query) return true;
      return model.name.toLowerCase().includes(query) || model.id.toLowerCase().includes(query);
    });
  }, [batchForm.search, batchForm.selectedModelIds, eligibleBatchModels]);

  const selectedBatchModels = useMemo(() => {
    const byId = new Map(eligibleBatchModels.map((model) => [model.id, model]));
    return batchForm.selectedModelIds
      .map((id) => byId.get(id))
      .filter((model): model is ManagedModelReference => Boolean(model));
  }, [batchForm.selectedModelIds, eligibleBatchModels]);

  const groupedProbes = useMemo(() => {
    const grouped = new Map<string, ModelProbeSummary[]>();
    for (const probe of data?.probes || []) {
      const bucket = grouped.get(probe.groupId) || [];
      bucket.push(probe);
      grouped.set(probe.groupId, bucket);
    }

    const groups = Array.from(grouped.entries()).map(([groupId, probes]) => {
      const providerSet = new Set(probes.map((probe) => probe.endpoints[0] || 'unknown'));
      return {
        groupId,
        groupName: probes[0]?.groupName || 'New Group',
        provider: providerSet.size === 1 ? Array.from(providerSet)[0] : 'mixed',
        probes: [...probes].sort(cardOrder(sortMode, windowDays)),
      };
    });

    groups.sort(groupOrder(sortMode, windowDays));
    return groups;
  }, [data?.probes, sortMode, windowDays]);

  useEffect(() => {
    setCurrentUser(readStoredAuthUser());
  }, []);

  const loadProbes = useCallback(async (refresh = false, silent = false) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);
      const endpoint = isAdmin
        ? `/api/models/probes${refresh ? '?refresh=1' : ''}`
        : '/api/models/probes/query';
      const res = await authFetch(endpoint, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '探针数据加载失败');
      setData(json);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '探针数据加载失败');
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, [isAdmin, toast]);

  useEffect(() => {
    void loadProbes(true, false);
  }, [loadProbes]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadProbes(true, true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadProbes]);

  const resetForms = useCallback(() => {
    setEditingProbe(null);
    setSingleForm(createEmptySingleForm());
    setBatchForm(createEmptyBatchForm());
    setBatchLeftSelection([]);
    setBatchRightSelection([]);
    setDialogMode('single');
  }, []);

  const openCreateDialog = useCallback((mode: ProbeFormMode = 'single') => {
    if (!isAdmin) {
      toast('warning', '仅管理员可新增探针');
      return;
    }
    resetForms();
    setDialogMode(mode);
    setDialogOpen(true);
  }, [isAdmin, resetForms, toast]);

  const openEditDialog = useCallback((probe: ModelProbeSummary) => {
    if (!isAdmin) {
      toast('warning', '仅管理员可编辑探针');
      return;
    }
    setEditingProbe(probe);
    setDialogMode('single');
    setSingleForm({
      name: probe.name,
      engine: probe.engine,
      driver: (probe.driver as ProbeDriver) || 'auto',
      model: probe.model,
      intervalMinutes: String(probe.intervalMinutes),
      timeoutMs: String(probe.timeoutMs),
      enabled: probe.enabled,
      note: probe.note || '',
    });
    setDialogOpen(true);
  }, [isAdmin, toast]);

  const runAllProbes = useCallback(async () => {
    if (!isAdmin) {
      toast('warning', '仅管理员可手动触发探针');
      return;
    }
    const toastId = toast('loading', '正在触发全量探针...');
    try {
      setRefreshing(true);
      const res = await authFetch('/api/models/probes/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '批量探测失败');
      setData({ probes: json.probes || [], summary: json.summary });
      updateToast(toastId, 'success', `已触发 ${json.executed?.length || 0} 个探针`);
    } catch (error) {
      updateToast(toastId, 'error', error instanceof Error ? error.message : '批量探测失败');
    } finally {
      setRefreshing(false);
    }
  }, [isAdmin, toast, updateToast]);

  const runSingleProbe = useCallback(async (probeId: string) => {
    if (!isAdmin) {
      toast('warning', '仅管理员可手动触发探针');
      return;
    }
    const toastId = toast('loading', '正在触发探针...');
    try {
      const res = await authFetch(`/api/models/probes/${probeId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '执行探针失败');
      updateToast(toastId, 'success', '探针已执行');
      await loadProbes(false, true);
    } catch (error) {
      updateToast(toastId, 'error', error instanceof Error ? error.message : '执行探针失败');
    }
  }, [isAdmin, loadProbes, toast, updateToast]);

  const toggleProbeEnabled = useCallback(async (probe: ModelProbeSummary) => {
    if (!isAdmin) {
      toast('warning', '仅管理员可修改探针状态');
      return;
    }
    try {
      const res = await authFetch(`/api/models/probes/${probe.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !probe.enabled }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '更新探针状态失败');
      toast('success', probe.enabled ? '探针已暂停' : '探针已启用');
      await loadProbes(false, true);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '更新探针状态失败');
    }
  }, [isAdmin, loadProbes, toast]);

  const deleteProbe = useCallback(async (probe: ModelProbeSummary) => {
    if (!isAdmin) {
      toast('warning', '仅管理员可删除探针');
      return;
    }
    if (!window.confirm(`确定删除探针「${probe.name}」吗？`)) return;
    try {
      const res = await authFetch(`/api/models/probes/${probe.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '删除探针失败');
      toast('success', '探针已删除');
      await loadProbes(false, true);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '删除探针失败');
    }
  }, [isAdmin, loadProbes, toast]);

  const submitSingleProbe = useCallback(async () => {
    if (!isAdmin) {
      toast('warning', '仅管理员可保存探针');
      return;
    }
    const engine = singleForm.engine.trim();
    const model = singleForm.model.trim();
    if (!engine) {
      toast('warning', '请选择引擎');
      return;
    }
    if (!model) {
      toast('warning', '请输入模型 ID');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        name: singleForm.name.trim() || undefined,
        engine,
        driver: supportsDriverSelection(engine) ? singleForm.driver : 'auto',
        model,
        intervalMinutes: Number.parseInt(singleForm.intervalMinutes, 10) || DEFAULT_POLL_MINUTES,
        timeoutMs: Number.parseInt(singleForm.timeoutMs, 10) || 45000,
        enabled: singleForm.enabled,
        note: singleForm.note.trim() || undefined,
      };
      const endpoint = editingProbe ? `/api/models/probes/${editingProbe.id}` : '/api/models/probes';
      const method = editingProbe ? 'PATCH' : 'POST';
      const res = await authFetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '保存探针失败');
      toast('success', editingProbe ? '探针已更新' : '探针已创建');
      setDialogOpen(false);
      resetForms();
      await loadProbes(false, true);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '保存探针失败');
    } finally {
      setSubmitting(false);
    }
  }, [editingProbe, isAdmin, loadProbes, resetForms, singleForm, toast]);

  const submitBatchProbes = useCallback(async () => {
    if (!isAdmin) {
      toast('warning', '仅管理员可新增探针');
      return;
    }
    const engine = batchForm.engine.trim();
    const modelMap = new Map(managedModels.map((model) => [model.id, model]));
    const entries = batchForm.selectedModelIds
      .map((id) => modelMap.get(id))
      .filter((model): model is ManagedModelReference => Boolean(model));
    if (!engine) {
      toast('warning', '请选择引擎');
      return;
    }
    if (entries.length === 0) {
      toast('warning', '请至少选择一个模型');
      return;
    }

    try {
      setSubmitting(true);
      const probes = entries.map((entry) => ({
        name: `${getEngineDisplayName(engine)} / ${entry.name}`,
        engine,
        driver: supportsDriverSelection(engine) ? batchForm.driver : 'auto',
        model: entry.id,
        groupName: batchForm.groupName.trim() || 'New Group',
        intervalMinutes: Number.parseInt(batchForm.intervalMinutes, 10) || DEFAULT_POLL_MINUTES,
        timeoutMs: Number.parseInt(batchForm.timeoutMs, 10) || 45000,
        enabled: batchForm.enabled,
        note: batchForm.note.trim() || undefined,
      }));

      const res = await authFetch('/api/models/probes/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName: batchForm.groupName.trim() || 'New Group', probes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '批量创建探针失败');
      toast('success', `已创建 ${json.createdCount || probes.length} 个探针`);
      setDialogOpen(false);
      resetForms();
      setData({ probes: json.probes || [], summary: json.summary });
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '批量创建探针失败');
    } finally {
      setSubmitting(false);
    }
  }, [batchForm, isAdmin, managedModels, resetForms, toast]);

  const moveBatchModelsToSelected = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setBatchForm((prev) => ({
      ...prev,
      selectedModelIds: [...prev.selectedModelIds, ...ids.filter((id) => !prev.selectedModelIds.includes(id))],
    }));
    setBatchLeftSelection([]);
  }, []);

  const moveBatchModelsToAvailable = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setBatchForm((prev) => ({
      ...prev,
      selectedModelIds: prev.selectedModelIds.filter((id) => !ids.includes(id)),
    }));
    setBatchRightSelection([]);
  }, []);

  const toggleProbeSelection = useCallback((probeId: string) => {
    setSelectedProbeIds((prev) => {
      const next = new Set(prev);
      if (next.has(probeId)) next.delete(probeId);
      else next.add(probeId);
      return next;
    });
  }, []);

  const patchSelectedProbesGroup = useCallback(async (probeIds: string[], groupName: string) => {
    const groupId = crypto.randomUUID();
    await Promise.all(
      probeIds.map((probeId) =>
        authFetch(`/api/models/probes/${probeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId, groupName }),
        }).then(async (res) => {
          const json = await res.json();
          if (!res.ok) throw new Error(json?.error || '分组更新失败');
        })
      )
    );
  }, []);

  const openSplitSelectedProbes = useCallback(() => {
    if (!isAdmin) {
      toast('warning', '仅管理员可拆分分组');
      return;
    }
    const selected = (data?.probes || []).filter((probe) => selectedProbeIds.has(probe.id));
    if (selected.length === 0) {
      toast('warning', '请先选择要拆分的模型');
      return;
    }
    const sourceGroups = new Set(selected.map((probe) => probe.groupId));
    if (sourceGroups.size !== 1) {
      toast('warning', '拆分时请选择同一个分组里的模型');
      return;
    }
    setGroupActionDialog(createGroupActionState('split', `${selected[0].groupName} - Split`));
  }, [data?.probes, isAdmin, selectedProbeIds, toast]);

  const splitSelectedProbes = useCallback(async () => {
    const nextGroupName = groupActionDialog?.groupName.trim();
    if (!nextGroupName) {
      toast('warning', '请输入新分组名称');
      return;
    }
    const selected = (data?.probes || []).filter((probe) => selectedProbeIds.has(probe.id));
    try {
      setRefreshing(true);
      await patchSelectedProbesGroup(selected.map((probe) => probe.id), nextGroupName);
      setSelectedProbeIds(new Set());
      setGroupActionDialog(null);
      toast('success', '已拆分为新分组');
      await loadProbes(false, true);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '拆分分组失败');
    } finally {
      setRefreshing(false);
    }
  }, [data?.probes, groupActionDialog?.groupName, loadProbes, patchSelectedProbesGroup, selectedProbeIds, toast]);

  const openMergeSelectedProbes = useCallback(() => {
    if (!isAdmin) {
      toast('warning', '仅管理员可合并分组');
      return;
    }
    const selected = (data?.probes || []).filter((probe) => selectedProbeIds.has(probe.id));
    if (selected.length < 2) {
      toast('warning', '请至少选择两个模型');
      return;
    }
    const sourceGroups = new Set(selected.map((probe) => probe.groupId));
    if (sourceGroups.size < 2) {
      toast('warning', '合并时请至少选择两个不同分组里的模型');
      return;
    }
    setGroupActionDialog(createGroupActionState('merge', 'Merged Group'));
  }, [data?.probes, isAdmin, selectedProbeIds, toast]);

  const mergeSelectedProbes = useCallback(async () => {
    const nextGroupName = groupActionDialog?.groupName.trim();
    if (!nextGroupName) {
      toast('warning', '请输入合并后的分组名称');
      return;
    }
    const selected = (data?.probes || []).filter((probe) => selectedProbeIds.has(probe.id));
    try {
      setRefreshing(true);
      await patchSelectedProbesGroup(selected.map((probe) => probe.id), nextGroupName);
      setSelectedProbeIds(new Set());
      setGroupActionDialog(null);
      toast('success', '已合并为新分组');
      await loadProbes(false, true);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '合并分组失败');
    } finally {
      setRefreshing(false);
    }
  }, [data?.probes, groupActionDialog?.groupName, loadProbes, patchSelectedProbesGroup, selectedProbeIds, toast]);

  const deleteSelectedProbes = useCallback(async () => {
    if (!isAdmin) {
      toast('warning', '仅管理员可删除探针');
      return;
    }
    const selected = (data?.probes || []).filter((probe) => selectedProbeIds.has(probe.id));
    if (selected.length === 0) {
      toast('warning', '请先选择要删除的探针');
      return;
    }

    try {
      setRefreshing(true);
      await Promise.all(
        selected.map(async (probe) => {
          const res = await authFetch(`/api/models/probes/${probe.id}`, { method: 'DELETE' });
          const json = await res.json();
          if (!res.ok) throw new Error(json?.error || `删除探针「${probe.name}」失败`);
        })
      );
      setBulkDeleteOpen(false);
      setSelectedProbeIds(new Set());
      toast('success', `已删除 ${selected.length} 个探针`);
      await loadProbes(false, true);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '批量删除探针失败');
    } finally {
      setRefreshing(false);
    }
  }, [data?.probes, isAdmin, loadProbes, selectedProbeIds, toast]);

  const selectedProbes = useMemo(
    () => (data?.probes || []).filter((probe) => selectedProbeIds.has(probe.id)),
    [data?.probes, selectedProbeIds]
  );
  const allProbeIds = useMemo(
    () => (data?.probes || []).map((probe) => probe.id),
    [data?.probes]
  );
  const allSelected = allProbeIds.length > 0 && selectedProbeIds.size === allProbeIds.length;
  const hasPartialProbeSelection = selectedProbeIds.size > 0 && !allSelected;

  const toggleSelectAllProbes = useCallback(() => {
    setSelectedProbeIds((prev) => {
      if (allProbeIds.length === 0) return prev;
      if (prev.size === allProbeIds.length) return new Set();
      return new Set(allProbeIds);
    });
  }, [allProbeIds]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6 pb-32">
        <section
          className="overflow-hidden rounded-[32px] border border-border/60 bg-background/90"
          style={{
            backgroundImage: 'linear-gradient(to right, rgba(120,120,120,0.10) 1px, transparent 1px), linear-gradient(to bottom, rgba(120,120,120,0.10) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        >
          <div className="flex flex-col gap-10 px-6 py-8 lg:flex-row lg:items-start lg:justify-between lg:px-10 lg:py-10">
            <div className="max-w-4xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.32em] text-muted-foreground">AI Service</div>
              <h2 className="mt-3 text-5xl font-semibold uppercase leading-[0.86] tracking-tight text-foreground/55 sm:text-7xl lg:text-[96px]">
                Intelligence
                <br />
                Monitor
              </h2>
              <p className="mt-8 max-w-3xl text-lg leading-8 text-muted-foreground">
                实时追踪各大 AI 模型对话接口的可用性、延迟与官方服务状态。
                <br />
                Advanced performance metrics for next-gen intelligence.
              </p>
            </div>

            <div className="flex w-full flex-col gap-4 lg:max-w-[520px]">
              <div className="flex flex-col gap-3 rounded-[24px] border border-border/60 bg-background/90 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-medium text-muted-foreground">排序</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={sortMode === 'custom' ? 'default' : 'ghost'}
                    className="rounded-full px-4"
                    onClick={() => setSortMode('custom')}
                  >
                    自定义
                  </Button>
                  <Button
                    size="sm"
                    variant={sortMode === 'group' ? 'default' : 'ghost'}
                    className="rounded-full px-4"
                    onClick={() => setSortMode('group')}
                  >
                    按分组
                  </Button>
                  <Button
                    size="sm"
                    variant={sortMode === 'name' ? 'default' : 'ghost'}
                    className="rounded-full px-4"
                    onClick={() => setSortMode('name')}
                  >
                    按名称
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-[24px] border border-border/60 bg-background/90 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-medium text-muted-foreground">可用性区间</span>
                <div className="flex flex-wrap items-center gap-2">
                  {AVAILABILITY_WINDOWS.map((days) => (
                    <Button
                      key={days}
                      size="sm"
                      variant={windowDays === days ? 'default' : 'ghost'}
                      className="rounded-full px-4"
                      onClick={() => setWindowDays(days)}
                    >
                      {days} 天
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="inline-flex items-center gap-3 rounded-full border border-emerald-500/15 bg-background/90 px-5 py-3 text-lg font-semibold">
                  <span className="h-4 w-4 rounded-full bg-emerald-500 shadow-[0_0_0_6px_rgba(34,197,94,0.12)]" />
                  {overallHealthLabel(data)}
                </div>
                {isAdmin ? (
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Button size="sm" className="rounded-full px-4" onClick={() => openCreateDialog('batch')}>
                      <Plus className="mr-2 h-4 w-4" />
                      添加
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-full border border-border/60 bg-background/80 px-4 py-2 text-sm text-muted-foreground">
                    只读查询
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <RefreshCcw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
                  更新于 {formatDateTime(data?.summary.lastUpdatedAt)}
                </span>
                <span>|</span>
                <span>{DEFAULT_POLL_MINUTES} 分钟轮询</span>
                <Button variant="ghost" size="sm" className="rounded-full px-3" onClick={() => loadProbes(true, true)}>
                  刷新
                </Button>
                {isAdmin ? (
                  <Button variant="ghost" size="sm" className="rounded-full px-3" onClick={runAllProbes}>
                    全量探测
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            加载探针中...
          </div>
        ) : groupedProbes.length === 0 ? (
          <div className="mt-8 flex min-h-[320px] flex-col items-center justify-center rounded-[32px] border border-dashed border-border/70 bg-card/70 px-6 text-center">
            <Gauge className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h3 className="text-lg font-semibold">还没有任何模型探针</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              {isAdmin
                ? '创建后系统会以 5 分钟为默认周期持续探测，并通过对外 API 提供实时状态、统计和历史结果。'
                : '当前还没有可查询的模型探针。请联系管理员创建监控项后再查看状态。'}
            </p>
            {isAdmin ? (
              <div className="mt-5 flex flex-wrap gap-2">
                <Button className="rounded-full px-4" onClick={() => openCreateDialog('batch')}>
                  添加
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mx-auto mt-8 w-full max-w-[1440px] space-y-6">
            {groupedProbes.map((group) => {
              const operationalCount = group.probes.filter((probe) => probe.status === 'operational').length;

              return (
                <section key={group.groupId} className="mx-auto rounded-[28px] border border-border/70 bg-card/95 px-5 py-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-background/90 text-muted-foreground">
                        <div className="grid grid-cols-2 gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-current/80" />
                          <span className="h-1.5 w-1.5 rounded-full bg-current/80" />
                          <span className="h-1.5 w-1.5 rounded-full bg-current/80" />
                          <span className="h-1.5 w-1.5 rounded-full bg-current/80" />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="text-2xl font-semibold">{group.groupName}</h3>
                          <Badge variant="secondary" className="rounded-full bg-amber-500/15 px-3 py-1 text-amber-600 dark:text-amber-400">
                            {group.provider}
                          </Badge>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                          {operationalCount}/{group.probes.length} 正常
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mx-auto mt-6 grid max-w-[1240px] gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                    {group.probes.map((probe) => {
                      const availability = availabilityForWindow(probe, windowDays);
                      const meta = statusMeta(probe.status);
                      const StatusIcon = meta.icon;
                      const historyBars = buildHistoryBars(probe);
                      const checked = selectedProbeIds.has(probe.id);

                      return (
                        <article key={probe.id} className="rounded-[24px] border border-border/70 bg-background/90 p-4 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
                          <div className="flex flex-col gap-4">
                            <div className="flex items-start justify-between gap-4">
                              {isAdmin ? (
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={() => toggleProbeSelection(probe.id)}
                                  aria-label={`选择探针 ${probe.name}`}
                                  className="mt-1 h-5 w-5 shrink-0 rounded-[6px] border-border bg-background shadow-sm data-[state=checked]:border-primary"
                                />
                              ) : <div />}
                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                <Badge className={cn('rounded-full border px-4 py-1 text-sm font-medium', meta.badgeClassName)}>
                                  <StatusIcon className="mr-1.5 inline h-4 w-4" />
                                  {meta.label}
                                </Badge>
                                {isAdmin ? (
                                  <>
                                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={() => runSingleProbe(probe.id)}>
                                      <Play className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={() => openEditDialog(probe)}>
                                      <Edit3 className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-destructive hover:text-destructive" onClick={() => deleteProbe(probe)}>
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex min-w-0 items-center gap-4">
                              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] border border-border/70 bg-card text-xl font-semibold text-foreground/80 shadow-sm">
                                AI
                              </div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="break-words text-xl font-semibold">{probe.name}</h4>
                                  <span className="text-xs text-muted-foreground">{driverLabel(probe.driver)}</span>
                                </div>
                                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <span>{providerLabel(probe.endpoints[0])}</span>
                                  <span className="break-all">{probe.model}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="mt-5 grid grid-cols-2 gap-4 rounded-[20px] border border-border/60 bg-card/55 px-4 py-4">
                            <div>
                              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                <Activity className="h-3.5 w-3.5" />
                                对话延迟
                              </div>
                              <div className="mt-2 text-3xl font-semibold tracking-tight">{formatMs(probe.latestRun?.responseLatencyMs ?? null)}</div>
                            </div>
                            <div>
                              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                <Gauge className="h-3.5 w-3.5" />
                                端点 PING
                              </div>
                              <div className="mt-2 text-3xl font-semibold tracking-tight">{formatMs(probe.latestRun?.availabilityCheckMs ?? null)}</div>
                            </div>
                          </div>

                          <div className="mt-5 border-t border-border/60 pt-4">
                            <div className="grid grid-cols-2 gap-6">
                              <div>
                                <div className="text-sm text-muted-foreground">官方状态</div>
                                <div className="mt-2 text-xl font-semibold">
                                  {probe.latestRun?.engineAvailable === false ? '异常' : '正常'}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm text-muted-foreground">可用性（{windowDays} 天）</div>
                                <div className="mt-2 text-xl font-semibold text-emerald-600 dark:text-emerald-400">
                                  {formatRate(availability.successRate)}
                                </div>
                                <div className="mt-1 text-sm text-muted-foreground">
                                  {availability.successCount}/{availability.totalCount} 成功
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="mt-5 border-t border-border/60 pt-4">
                            <div className="flex items-center justify-between text-sm uppercase tracking-[0.18em] text-muted-foreground">
                              <span>History ({HISTORY_BAR_COUNT}pts)</span>
                              <span className="normal-case tracking-normal text-foreground/85">
                                <Clock3 className="mr-1 inline h-4 w-4" />
                                Next update in {formatCountdown(probe.nextRunAt, nowMs)}
                              </span>
                            </div>
                            <div className="mt-4 flex h-14 items-end gap-1">
                              {historyBars.map((item, index) => (
                                <div
                                  key={`${probe.id}-${item.at}-${index}`}
                                  className={cn(
                                    'min-w-0 flex-1 cursor-pointer rounded-full transition-transform duration-150 ease-out hover:-translate-y-0.5 hover:scale-y-105 hover:brightness-110',
                                    item.status === 'operational' && 'bg-emerald-500',
                                    item.status === 'running' && 'bg-sky-500',
                                    item.status === 'degraded' && 'bg-amber-500',
                                    item.status === 'down' && 'bg-red-500',
                                    item.status === 'paused' && 'bg-zinc-500',
                                    item.status === 'unknown' && 'bg-muted',
                                  )}
                                  style={{ height: item.responseLatencyMs ? '100%' : '56%' }}
                                  title={item.success == null ? 'No history' : `${item.status} · ${item.responseLatencyMs || 0} ms`}
                                />
                              ))}
                            </div>
                            <div className="mt-3 flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                              <span>Past</span>
                              <span>Now</span>
                            </div>
                          </div>

                          <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-4">
                            <div className="text-sm text-muted-foreground">
                              最近成功 {formatDateTime(probe.lastSuccessAt)}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">{probe.enabled ? '启用' : '暂停'}</span>
                              {isAdmin ? (
                                <Switch checked={probe.enabled} onCheckedChange={() => toggleProbeEnabled(probe)} />
                              ) : null}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {isAdmin && allProbeIds.length > 0 ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 w-full max-w-fit -translate-x-1/2 px-4">
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-full border border-border/70 bg-background/95 px-3 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.18)] backdrop-blur">
            <div
              className="flex items-center rounded-full border border-border/70 bg-background px-4 py-2 text-sm shadow-sm"
              role="button"
              tabIndex={0}
              onClick={toggleSelectAllProbes}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleSelectAllProbes();
                }
              }}
            >
              <Checkbox
                checked={allSelected ? true : hasPartialProbeSelection ? 'indeterminate' : false}
                aria-label={allSelected ? '取消全选探针' : '全选探针'}
                className="mr-2 h-4 w-4 rounded-[5px] border-border bg-background"
                onCheckedChange={toggleSelectAllProbes}
              />
              {allSelected ? '取消全选' : '全选'}
            </div>
            <div className="px-3 text-sm font-medium text-foreground/80">
              已选 {selectedProbeIds.size} 项
            </div>
            {selectedProbes.length > 0 ? (
              <>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full px-4 text-destructive hover:text-destructive"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              批量删除
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full px-4"
              onClick={openSplitSelectedProbes}
            >
              拆分分组
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full px-4"
              onClick={openMergeSelectedProbes}
              disabled={selectedProbeIds.size < 2}
            >
              合并分组
            </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <Dialog
        open={isAdmin && dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForms();
        }}
      >
        <DialogContent className="sm:max-w-[680px]">
          <ComboboxPortalProvider>
            <DialogHeader>
              <DialogTitle>{editingProbe ? '编辑模型探针' : '创建模型探针'}</DialogTitle>
              <DialogDescription>
                探针默认每 5 分钟执行一次；支持显式指定 engine driver，也支持同引擎/driver 下的批量导入。
              </DialogDescription>
            </DialogHeader>

            <Tabs
              value={editingProbe ? 'single' : 'batch'}
              className="mt-2"
            >
              <TabsContent value="single" className="mt-4 space-y-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">展示名称</label>
                  <Input
                    value={singleForm.name}
                    onChange={(event) => setSingleForm((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="例如：主模型生产探针"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">引擎</label>
                    <SingleCombobox
                      value={singleForm.engine}
                      onValueChange={(value) => setSingleForm((prev) => ({
                        ...prev,
                        engine: value || prev.engine,
                        driver: supportsDriverSelection(value || prev.engine) ? prev.driver : 'auto',
                      }))}
                      options={engineOptions}
                      placeholder="选择引擎"
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">驱动</label>
                    <SingleCombobox
                      value={supportsDriverSelection(singleForm.engine) ? singleForm.driver : 'auto'}
                      onValueChange={(value) => setSingleForm((prev) => ({ ...prev, driver: (value as ProbeDriver) || 'auto' }))}
                      options={driverOptions}
                      placeholder="选择驱动"
                      disabled={!supportsDriverSelection(singleForm.engine)}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <label className="text-sm font-medium">模型 ID</label>
                  <Input
                    value={singleForm.model}
                    onChange={(event) => setSingleForm((prev) => ({ ...prev, model: event.target.value }))}
                    placeholder="例如：claude-sonnet-4-20250514"
                  />
                  {suggestedModels.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {suggestedModels.map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          className="rounded-full border border-border/70 bg-muted/25 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() => setSingleForm((prev) => ({
                            ...prev,
                            model: model.id,
                            name: prev.name || `${getEngineDisplayName(prev.engine)} / ${model.name}`,
                          }))}
                        >
                          {model.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">轮询间隔（分钟）</label>
                    <Input
                      type="number"
                      min="1"
                      max="1440"
                      value={singleForm.intervalMinutes}
                      onChange={(event) => setSingleForm((prev) => ({ ...prev, intervalMinutes: event.target.value }))}
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">超时（毫秒）</label>
                    <Input
                      type="number"
                      min="5000"
                      max="300000"
                      step="1000"
                      value={singleForm.timeoutMs}
                      onChange={(event) => setSingleForm((prev) => ({ ...prev, timeoutMs: event.target.value }))}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-muted/20 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium">启用探针</div>
                    <div className="text-xs text-muted-foreground">关闭后会保留历史，但不会继续自动探测。</div>
                  </div>
                  <Switch
                    checked={singleForm.enabled}
                    onCheckedChange={(checked) => setSingleForm((prev) => ({ ...prev, enabled: checked }))}
                  />
                </div>

                <div className="grid gap-2">
                  <label className="text-sm font-medium">备注</label>
                  <Textarea
                    value={singleForm.note}
                    onChange={(event) => setSingleForm((prev) => ({ ...prev, note: event.target.value }))}
                    rows={4}
                    placeholder="可填写用途、环境说明等。"
                  />
                </div>
              </TabsContent>

              {!editingProbe && (
              <TabsContent value="batch" className="mt-4 space-y-4">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">分组名称</label>
                    <Input
                      value={batchForm.groupName}
                      onChange={(event) => setBatchForm((prev) => ({ ...prev, groupName: event.target.value }))}
                      placeholder="例如：Anthropic 生产组"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">引擎</label>
                      <SingleCombobox
                        value={batchForm.engine}
                        onValueChange={(value) => setBatchForm((prev) => ({
                          ...prev,
                          engine: value || prev.engine,
                          driver: supportsDriverSelection(value || prev.engine) ? prev.driver : 'auto',
                          selectedModelIds: prev.selectedModelIds.filter((id) => {
                            const model = managedModels.find((item) => item.id === id);
                            return model ? modelSupportsEngine(model, value || prev.engine) : false;
                          }),
                        }))}
                        options={engineOptions}
                        placeholder="选择引擎"
                      />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">驱动</label>
                      <SingleCombobox
                        value={supportsDriverSelection(batchForm.engine) ? batchForm.driver : 'auto'}
                        onValueChange={(value) => setBatchForm((prev) => ({ ...prev, driver: (value as ProbeDriver) || 'auto' }))}
                        options={driverOptions}
                        placeholder="选择驱动"
                        disabled={!supportsDriverSelection(batchForm.engine)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">轮询间隔（分钟）</label>
                      <Input
                        type="number"
                        min="1"
                        max="1440"
                        value={batchForm.intervalMinutes}
                        onChange={(event) => setBatchForm((prev) => ({ ...prev, intervalMinutes: event.target.value }))}
                      />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">超时（毫秒）</label>
                      <Input
                        type="number"
                        min="5000"
                        max="300000"
                        step="1000"
                        value={batchForm.timeoutMs}
                        onChange={(event) => setBatchForm((prev) => ({ ...prev, timeoutMs: event.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-muted/20 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium">批量创建后立即启用</div>
                      <div className="text-xs text-muted-foreground">所有新探针都会继承这一开关与 driver 配置。</div>
                    </div>
                    <Switch
                      checked={batchForm.enabled}
                      onCheckedChange={(checked) => setBatchForm((prev) => ({ ...prev, enabled: checked }))}
                    />
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm font-medium">批量模型选择</label>
                    <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
                      <div className="rounded-2xl border border-border/70 bg-background/70">
                        <div className="border-b border-border/60 px-4 py-3">
                          <div className="text-sm font-medium">可选模型</div>
                          <div className="mt-2">
                            <Input
                              value={batchForm.search}
                              onChange={(event) => setBatchForm((prev) => ({ ...prev, search: event.target.value }))}
                              placeholder="搜索模型名称或 ID"
                            />
                          </div>
                        </div>
                        <div className="max-h-72 space-y-1 overflow-y-auto p-2">
                          {availableBatchModels.length === 0 ? (
                            <div className="rounded-xl px-3 py-6 text-center text-sm text-muted-foreground">
                              当前引擎下没有更多可选模型
                            </div>
                          ) : availableBatchModels.map((model) => {
                            const selected = batchLeftSelection.includes(model.id);
                            return (
                              <button
                                key={model.id}
                                type="button"
                                className={cn(
                                  'w-full rounded-xl border px-3 py-2 text-left transition-colors',
                                  selected
                                    ? 'border-primary bg-primary/10'
                                    : 'border-transparent bg-muted/20 hover:border-border hover:bg-muted/40'
                                )}
                                onClick={() => setBatchLeftSelection((prev) => (
                                  prev.includes(model.id)
                                    ? prev.filter((id) => id !== model.id)
                                    : [...prev, model.id]
                                ))}
                              >
                                <div className="text-sm font-medium">{model.name}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{model.id}</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex flex-row items-center justify-center gap-2 md:flex-col">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="rounded-full"
                          onClick={() => moveBatchModelsToSelected(batchLeftSelection)}
                          disabled={batchLeftSelection.length === 0}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="rounded-full"
                          onClick={() => moveBatchModelsToSelected(availableBatchModels.map((model) => model.id))}
                          disabled={availableBatchModels.length === 0}
                        >
                          <ChevronsRight className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="rounded-full"
                          onClick={() => moveBatchModelsToAvailable(batchRightSelection)}
                          disabled={batchRightSelection.length === 0}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="rounded-full"
                          onClick={() => moveBatchModelsToAvailable(batchForm.selectedModelIds)}
                          disabled={batchForm.selectedModelIds.length === 0}
                        >
                          <ChevronsLeft className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="rounded-2xl border border-border/70 bg-background/70">
                        <div className="border-b border-border/60 px-4 py-3">
                          <div className="text-sm font-medium">本次创建 ({selectedBatchModels.length})</div>
                          <div className="mt-1 text-xs text-muted-foreground">右侧模型将批量生成探针</div>
                        </div>
                        <div className="max-h-72 space-y-1 overflow-y-auto p-2">
                          {selectedBatchModels.length === 0 ? (
                            <div className="rounded-xl px-3 py-6 text-center text-sm text-muted-foreground">
                              从左侧选择模型加入本次批量创建
                            </div>
                          ) : selectedBatchModels.map((model) => {
                            const selected = batchRightSelection.includes(model.id);
                            return (
                              <button
                                key={model.id}
                                type="button"
                                className={cn(
                                  'w-full rounded-xl border px-3 py-2 text-left transition-colors',
                                  selected
                                    ? 'border-primary bg-primary/10'
                                    : 'border-transparent bg-muted/20 hover:border-border hover:bg-muted/40'
                                )}
                                onClick={() => setBatchRightSelection((prev) => (
                                  prev.includes(model.id)
                                    ? prev.filter((id) => id !== model.id)
                                    : [...prev, model.id]
                                ))}
                              >
                                <div className="text-sm font-medium">{model.name}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{model.id}</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm font-medium">统一备注</label>
                    <Textarea
                      value={batchForm.note}
                      onChange={(event) => setBatchForm((prev) => ({ ...prev, note: event.target.value }))}
                      rows={3}
                      placeholder="可选，会附加到本次批量创建的所有探针。"
                    />
                  </div>
                </TabsContent>
              )}
            </Tabs>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button
                className="rounded-full px-5"
                onClick={editingProbe || dialogMode === 'single' ? submitSingleProbe : submitBatchProbes}
                disabled={submitting}
              >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                {editingProbe ? '保存变更' : dialogMode === 'single' ? '创建探针' : '批量创建'}
              </Button>
            </DialogFooter>
          </ComboboxPortalProvider>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(isAdmin && groupActionDialog?.open)}
        onOpenChange={(open) => {
          if (!open) setGroupActionDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{groupActionDialog?.mode === 'merge' ? '合并分组' : '拆分分组'}</DialogTitle>
            <DialogDescription>
              {groupActionDialog?.mode === 'merge'
                ? '为选中的探针输入合并后的分组名称。'
                : '为选中的探针输入新的分组名称。'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <label className="text-sm font-medium">
              {groupActionDialog?.mode === 'merge' ? '合并后分组名' : '新分组名称'}
            </label>
            <Input
              value={groupActionDialog?.groupName || ''}
              onChange={(event) => setGroupActionDialog((prev) => (
                prev ? { ...prev, groupName: event.target.value } : prev
              ))}
              placeholder={groupActionDialog?.mode === 'merge' ? '例如：生产核心模型组' : '例如：Codex 灰度组'}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupActionDialog(null)}>
              取消
            </Button>
            <Button
              className="rounded-full px-5"
              onClick={groupActionDialog?.mode === 'merge' ? mergeSelectedProbes : splitSelectedProbes}
              disabled={refreshing}
            >
              {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isAdmin && bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>批量删除探针</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {selectedProbes.length > 0
                ? `确定删除已选中的 ${selectedProbes.length} 个探针吗？\n删除后无法恢复，相关历史记录也会一起移除。`
                : '请先选择要删除的探针。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void deleteSelectedProbes();
              }}
            >
              {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
