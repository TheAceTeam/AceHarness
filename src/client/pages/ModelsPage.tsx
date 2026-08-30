'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from '@/lib/navigation/client';
import { useSearchParams } from '@/lib/navigation/client';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  Trash2,
  GripVertical,
  Edit,
  X,
  Globe,
  Settings,
  Cpu,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkActionBar } from '@/components/ui/bulk-action-bar';
import type { ActionMenuGroup } from '@/components/ui/action-menu';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { DataCard } from '@/components/ui/data-card';
import { DataTable, type DataTableColumn, type DataTableRowEnhancerProps } from '@/components/ui/data-table';
import { FormField } from '@/components/ui/form-section';
import { ObjectEditDrawer } from '@/components/ui/object-edit-drawer';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { StatusPill } from '@/components/ui/status-pill';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/core/utils';
import { AiModelSelectorField } from '@/components/AiModelSelectorField';
import { PaginationBar } from '@/components/PaginationBar';
import { useToast } from '@/components/ui/toast';
import ModelProbeMonitor from '@/components/models/ModelProbeMonitor';
import ModelDiagnosticsWorkbench from '@/components/models/ModelDiagnosticsWorkbench';
import { EngineIcon } from '@/components/EngineIcon';
import { EndpointIcon, endpointHasWordmark, getEndpointDisplayName } from '@/components/EndpointIcon';
import { getEngineDisplayName } from '@/lib/core/engine-metadata';
import { normalizeRuntimeEngineId } from '@/lib/models/engine-compatibility';
import { useModelsQuery, useRuntimeEngineOptionsQuery, useSaveModelsMutation } from '@/client/query/engines';
import { getOfficeAwareReturnTarget } from '@/lib/navigation/return-target';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { useModelCatalogRows, useSyncModelCatalogToDb } from '@/client/db/collections';
import type { ModelsSearch } from '@/routes/models';

interface Model {
  id: string;
  name: string;
  modelRouteId?: string | null;
  modelId?: string;
  agentId?: string | null;
  providerModel?: string | null;
  runtime?: string | null;
  isDefault?: boolean;
  endpoints: string[];
  engines: string[];
  status: 'active' | 'inactive';
  costMultiplier: number;
  contextWindow?: number;
  createdAt?: string;
  updatedAt?: string;
}

type ModelTab = 'catalog' | 'probes' | 'diagnostics';

interface ModelsPageProps {
  routeSearch?: ModelsSearch;
  onRouteSearchChange?: (next: ModelsSearch) => void;
}

const DEFAULT_MODEL_ENDPOINTS = ['anthropic', 'openai'] as const;
const DEFAULT_COST_MULTIPLIER = 1;
const DEFAULT_CONTEXT_WINDOW = 128000;

function normalizeCostMultiplier(value: unknown): number {
  if (value === '' || value === null || value === undefined) return DEFAULT_COST_MULTIPLIER;
  const next = Number(value);
  return Number.isFinite(next) ? next : DEFAULT_COST_MULTIPLIER;
}

function normalizeContextWindow(value: unknown): number {
  if (value === '' || value === null || value === undefined) return DEFAULT_CONTEXT_WINDOW;
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : DEFAULT_CONTEXT_WINDOW;
}

function normalizeClientModelEngines(engines: unknown): string[] {
  if (!Array.isArray(engines)) return [];
  return Array.from(
    new Set(
      engines
        .map((engine) => String(engine || '').trim())
        .filter(Boolean)
        .map((engine) => normalizeRuntimeEngineId(engine) || engine),
    ),
  );
}

export function normalizeClientModelOptions(models: any[]): Model[] {
  return models.map((model) => ({
    // Catalog rows use the stable model identity. A route id identifies only
    // one engine/provider mapping and must not replace the catalog id here.
    id: String(model.modelId || model.value || ''),
    name: String(model.label || model.modelId || model.value || ''),
    modelRouteId: typeof model.modelRouteId === 'string' ? model.modelRouteId : null,
    modelId: typeof model.modelId === 'string' && model.modelId.trim()
      ? model.modelId
      : String(model.value || ''),
    agentId: typeof model.agentId === 'string' ? model.agentId : null,
    providerModel: typeof model.providerModel === 'string' ? model.providerModel : null,
    runtime: typeof model.runtime === 'string' ? model.runtime : null,
    isDefault: Boolean(model.isDefault),
    endpoints: Array.isArray(model.endpoints)
      ? Array.from(new Set(model.endpoints.map((endpoint: unknown) => String(endpoint || '').trim()).filter(Boolean)))
      : [],
    engines: normalizeClientModelEngines(model.engines),
    status: model.status === 'inactive' ? 'inactive' : 'active',
    costMultiplier: normalizeCostMultiplier(model.costMultiplier),
    contextWindow: normalizeContextWindow(model.contextWindow),
    createdAt: typeof model.createdAt === 'string' ? model.createdAt : undefined,
    updatedAt: typeof model.updatedAt === 'string' ? model.updatedAt : undefined,
  }));
}

function normalizeModelTab(value: unknown): ModelTab {
  if (value === 'routes') return 'catalog';
  if (value === 'catalog' || value === 'probes' || value === 'diagnostics') return value;
  if (value === 'probe') return 'probes';
  return 'catalog';
}

function modelTabStatusLabel(tab: ModelTab): string {
  if (tab === 'probes') return '可用性';
  if (tab === 'diagnostics') return '诊断评测';
  return '模型列表';
}

function EndpointTag({ endpoint, iconOnly = false }: { endpoint: string; iconOnly?: boolean }) {
  const label = getEndpointDisplayName(endpoint);
  const hasWordmark = endpointHasWordmark(endpoint);
  const showText = !iconOnly && !hasWordmark;
  return (
    <Badge
      variant="secondary"
      title={label}
      className={cn(
        'max-w-full rounded-md border border-border/70 bg-background/80 text-[11px] font-medium leading-none text-foreground shadow-sm',
        iconOnly ? 'h-7 w-7 justify-center p-0' : showText ? 'h-7 gap-1.5 px-2.5' : 'h-7 px-2.5'
      )}
    >
      <EndpointIcon
        endpoint={endpoint}
        mode={iconOnly ? 'mark' : hasWordmark ? 'logo' : 'mark'}
        className={hasWordmark && !iconOnly ? 'h-3.5 w-auto max-w-[4.75rem]' : 'h-3.5 w-3.5'}
        alt={label}
        decorative={iconOnly}
      />
      {iconOnly || !showText ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
    </Badge>
  );
}

function EngineTag({ engine, compact = false }: { engine: string; compact?: boolean }) {
  const label = getEngineDisplayName(engine) || engine;
  return (
    <Badge
      variant="outline"
      title={label}
      className={cn(
        'max-w-full rounded-md border-border/70 bg-background/80 text-[11px] font-medium leading-none text-foreground shadow-sm',
        compact ? 'h-7 gap-1.5 px-2.5' : 'h-7 gap-1.5 px-2.5'
      )}
    >
      <EngineIcon engineId={engine} className="h-3.5 w-3.5" alt={label} decorative={false} />
      <span className="truncate">{label}</span>
    </Badge>
  );
}

function ModelStatusPill({ status }: { status: Model['status'] }) {
  return (
    <StatusPill
      tone={status === 'active' ? 'success' : 'neutral'}
      className="h-6 min-w-[3.5rem] justify-center rounded-md px-2 py-0 text-[11px]"
    >
      {status === 'active' ? '有效' : '无效'}
    </StatusPill>
  );
}

function SortableModelCard({
  model,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
}: {
  model: Model;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: model.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative transition-colors',
        isDragging && 'z-50'
      )}
    >
      <DataCard
        selected={selected}
        className={cn(
          'relative flex min-h-[252px] flex-col px-5 py-5',
          isDragging && 'shadow-sm'
        )}
      >
        <div
          {...attributes}
          {...listeners}
          className="absolute left-2 top-1/2 -translate-y-1/2 cursor-grab opacity-0 transition-opacity group-hover:opacity-40 hover:!opacity-100"
        >
          <GripVertical className="h-4 w-4" />
        </div>

        <div className="absolute left-5 top-5">
          <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
        </div>

        <div className="ml-8 flex min-h-[212px] flex-1 flex-col">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
            <Cpu className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-[15px] font-semibold leading-6">{model.name}</h3>
            <div className="mt-1">
              <ModelStatusPill status={model.status} />
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2.5 text-sm text-muted-foreground">
          <div className="grid grid-cols-[14px_minmax(0,1fr)] items-start gap-x-2.5">
            <Globe className="mt-2 h-3.5 w-3.5 text-muted-foreground/80" />
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {model.endpoints.length > 0 ? (
                model.endpoints.map((endpoint) => (
                  <EndpointTag key={`${model.id}-endpoint-${endpoint}`} endpoint={endpoint} />
                ))
              ) : (
                <span className="py-1 text-xs text-muted-foreground">未配置端点</span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-[14px_minmax(0,1fr)] items-start gap-x-2.5">
            <Settings className="mt-2 h-3.5 w-3.5 text-muted-foreground/80" />
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {model.engines.length > 0 ? model.engines.map((engine) => (
                <EngineTag key={`${model.id}-engine-${engine}`} engine={engine} compact />
              )) : (
                <span className="py-1 text-xs text-muted-foreground">-</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[22px] text-xs">
            {model.contextWindow && (
              <span>{model.contextWindow.toLocaleString()} ctx</span>
            )}
            <span>费用倍率: {model.costMultiplier}</span>
          </div>
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-border/60 pt-4 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-col gap-1">
            {model.createdAt && <span>创建: {new Date(model.createdAt).toLocaleDateString()}</span>}
            {model.updatedAt && <span>修改: {new Date(model.updatedAt).toLocaleDateString()}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
      </DataCard>
    </div>
  );
}

function SortableModelTableRowEnhancer({
  rowKey,
  selected,
  children,
}: DataTableRowEnhancerProps<Model>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(rowKey),
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return children({
    rowProps: {
      ref: setNodeRef,
      style,
      className: cn(
        'group',
        isDragging && 'relative z-50 bg-card shadow-sm',
        selected && 'bg-muted/50',
      ),
    },
    leadingCellClassName: 'text-muted-foreground',
    leadingCell: (
        <div
          {...attributes}
          {...listeners}
        className="inline-flex cursor-grab items-center opacity-0 transition-opacity group-hover:opacity-40 hover:!opacity-100"
        aria-label="拖动排序"
        >
          <GripVertical className="h-4 w-4" />
        </div>
    ),
  });
}

export default function ModelsPage({ routeSearch, onRouteSearchChange }: ModelsPageProps = {}) {
  useDocumentTitle('模型管理');
  const searchParams = useSearchParams();
  const returnTarget = getOfficeAwareReturnTarget(searchParams.get('from'));
  const { toast } = useToast();
  const modelsQuery = useModelsQuery();
  const runtimeEngineOptionsQuery = useRuntimeEngineOptionsQuery();
  const saveModelsMutation = useSaveModelsMutation();

  const [models, setModels] = useState<Model[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'gallery' | 'table'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('models-view-mode');
      if (saved === 'gallery' || saved === 'table') return saved;
    }
    return 'table';
  });
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [selectedEndpoints, setSelectedEndpoints] = useState<string[]>([]);
  const [selectedEngines, setSelectedEngines] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteModel, setDeleteModel] = useState<Model | null>(null);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [editingOriginalId, setEditingOriginalId] = useState<string | null>(null);
  const [creatingModel, setCreatingModel] = useState(false);
  const [newModel, setNewModel] = useState<Omit<Model, 'createdAt' | 'updatedAt'>>({
    id: '',
    name: '',
    endpoints: [...DEFAULT_MODEL_ENDPOINTS],
    engines: [],
    status: 'active',
    costMultiplier: 1,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  });
  const [activeTab, setActiveTab] = useState<ModelTab>(() => {
    if (routeSearch?.tab) return normalizeModelTab(routeSearch.tab);
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('models-active-tab');
      return normalizeModelTab(saved);
    }
    return 'catalog';
  });

  useEffect(() => {
    localStorage.setItem('models-view-mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('models-active-tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    const nextTab = normalizeModelTab(routeSearch?.tab);
    if (routeSearch?.tab && nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  }, [activeTab, routeSearch?.tab]);

  const handleTabChange = useCallback((value: string) => {
    const nextTab = normalizeModelTab(value);
    setActiveTab(nextTab);
    onRouteSearchChange?.({ tab: nextTab === 'probes' ? 'probe' : nextTab });
  }, [onRouteSearchChange]);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const PAGE_SIZE_OPTIONS = [12, 24, 48];

  useEffect(() => {
    if (!modelsQuery.data?.models) return;
    setModels(normalizeClientModelOptions(modelsQuery.data.models));
  }, [modelsQuery.data?.models]);
  useSyncModelCatalogToDb(models);

  useEffect(() => {
    if (modelsQuery.isError) {
      console.error('Failed to load models:', modelsQuery.error);
    }
  }, [modelsQuery.error, modelsQuery.isError]);

  const loading = modelsQuery.isLoading;

  const serializeModelsForApi = useCallback((items: Model[]) => ({
    models: items.map((model) => ({
      value: model.modelId || model.id,
      modelRouteId: model.modelRouteId || undefined,
      modelId: model.modelId || model.id,
      label: model.name,
      endpoints: model.endpoints || [],
      engines: normalizeClientModelEngines(model.engines),
      status: model.status,
      costMultiplier: normalizeCostMultiplier(model.costMultiplier),
      contextWindow: normalizeContextWindow(model.contextWindow),
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
      isDefault: model.isDefault,
    })),
  }), []);

  const persistModels = useCallback(async (nextModels: Model[]) => {
    await saveModelsMutation.mutateAsync(serializeModelsForApi(nextModels));
  }, [saveModelsMutation, serializeModelsForApi]);

  const allEndpoints = useMemo(() => {
    const set = new Set<string>();
    models.forEach((m) => m.endpoints.forEach((e) => set.add(e)));
    return Array.from(set).sort();
  }, [models]);

  const allEngines = useMemo(() => {
    const set = new Set<string>();
    models.forEach((m) => normalizeClientModelEngines(m.engines).forEach((engine) => set.add(engine)));
    return Array.from(set).sort((a, b) => getEngineDisplayName(a).localeCompare(getEngineDisplayName(b), 'zh-CN'));
  }, [models]);

  const endpointOptions = useMemo(() => {
    const set = new Set<string>(DEFAULT_MODEL_ENDPOINTS);
    allEndpoints.forEach((endpoint) => set.add(endpoint));
    editingModel?.endpoints.forEach((endpoint) => set.add(endpoint));
    newModel.endpoints.forEach((endpoint) => set.add(endpoint));
    return Array.from(set)
      .filter(Boolean)
      .sort((a, b) => getEndpointDisplayName(a).localeCompare(getEndpointDisplayName(b), 'zh-CN'))
      .map((endpoint) => ({
        value: endpoint,
        label: getEndpointDisplayName(endpoint),
        description: endpoint,
        icon: (
          <EndpointIcon
            endpoint={endpoint}
            mode={endpointHasWordmark(endpoint) ? 'logo' : 'mark'}
            className={endpointHasWordmark(endpoint) ? 'h-3.5 w-auto max-w-[4.75rem]' : 'h-3.5 w-3.5'}
            alt={getEndpointDisplayName(endpoint)}
            decorative={false}
          />
        ),
      }));
  }, [allEndpoints, editingModel, newModel.endpoints]);

  const engineOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const item of runtimeEngineOptionsQuery.data || []) {
      const engine = normalizeClientModelEngines([item.id])[0];
      const label = item.name || getEngineDisplayName(engine) || engine;
      if (engine) byId.set(engine, label);
    }
    for (const engine of allEngines) {
      if (!byId.has(engine)) byId.set(engine, getEngineDisplayName(engine) || engine);
    }
    const iconPathById = new Map(
      (runtimeEngineOptionsQuery.data || [])
        .map((item) => [normalizeClientModelEngines([item.id])[0], item.iconPath] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1])),
    );
    return Array.from(byId.entries())
      .sort(([, a], [, b]) => a.localeCompare(b, 'zh-CN'))
      .map(([engine, label]) => ({
        value: engine,
        label,
        icon: <EngineIcon engineId={engine} iconPath={iconPathById.get(engine)} className="h-3.5 w-3.5" alt={label} decorative={false} />,
      }));
  }, [allEngines, runtimeEngineOptionsQuery.data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = models.findIndex((m) => m.id === active.id);
      const newIndex = models.findIndex((m) => m.id === over.id);
      const nextModels = arrayMove(models, oldIndex, newIndex);
      setModels(nextModels);
      void persistModels(nextModels).catch(async (error) => {
        toast('error', error instanceof Error ? error.message : '模型排序保存失败');
        await modelsQuery.refetch();
      });
    }
  }

  const catalogRows = useModelCatalogRows({
    keyword: searchQuery,
    endpoints: selectedEndpoints,
    engines: selectedEngines,
    statuses: selectedStatus,
  }) as Model[];
  const modelById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models]);
  const catalogRowsWithRouteMetadata = useMemo(() => (
    catalogRows.map((row) => ({ ...row, ...modelById.get(row.id) }))
  ), [catalogRows, modelById]);
  const filteredModels = useMemo(() => (
    catalogRowsWithRouteMetadata
  ), [catalogRowsWithRouteMetadata]);

  const totalPages = Math.ceil(filteredModels.length / pageSize);
  const paginatedModels = filteredModels.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, selectedEndpoints, selectedEngines, selectedStatus]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allPaginatedSelected = paginatedModels.length > 0
    && paginatedModels.every((model) => selectedModels.has(model.id));
  const hasPartialPaginatedSelection = paginatedModels.some((model) => selectedModels.has(model.id)) && !allPaginatedSelected;

  const toggleSelectAll = useCallback(() => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (allPaginatedSelected) {
        paginatedModels.forEach((model) => next.delete(model.id));
      } else {
        paginatedModels.forEach((model) => next.add(model.id));
      }
      return next;
    });
  }, [allPaginatedSelected, paginatedModels]);

  const handleDelete = (model: Model) => {
    setDeleteModel(model);
  };

  const confirmDeleteModel = async () => {
    if (!deleteModel) return;
    const model = deleteModel;
    const nextModels = models.filter((m) => m.id !== model.id);
    try {
      await persistModels(nextModels);
      setModels(nextModels);
      setSelectedModels((prev) => {
        const next = new Set(prev);
        next.delete(model.id);
        return next;
      });
      setDeleteModel(null);
      toast('success', `已删除模型 ${model.name}`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '删除模型失败');
      await modelsQuery.refetch();
    }
  };

  const handleBatchDelete = async () => {
    const nextModels = models.filter((m) => !selectedModels.has(m.id));
    const deletedCount = selectedModels.size;
    try {
      await persistModels(nextModels);
      setModels(nextModels);
      setSelectedModels(new Set());
      setDeleteDialogOpen(false);
      toast('success', `已删除 ${deletedCount} 个模型`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '批量删除模型失败');
      await modelsQuery.refetch();
    }
  };

  const handleEdit = (model: Model) => {
    setEditingModel({ ...model });
    setEditingOriginalId(model.id);
  };

  const handleEditSave = async () => {
    if (!editingModel || !editingOriginalId) return;
    const updatedModel = {
      ...editingModel,
      costMultiplier: normalizeCostMultiplier(editingModel.costMultiplier),
      contextWindow: normalizeContextWindow(editingModel.contextWindow),
      updatedAt: new Date().toISOString(),
    };
    const nextModels = models.map((m) => (m.id === editingOriginalId ? updatedModel : m));
    try {
      await persistModels(nextModels);
      setModels(nextModels);
      setSelectedModels((prev) => {
        if (editingOriginalId === updatedModel.id) return prev;
        const next = new Set(prev);
        if (next.delete(editingOriginalId)) next.add(updatedModel.id);
        return next;
      });
      setEditingModel(null);
      setEditingOriginalId(null);
      toast('success', `已保存模型 ${updatedModel.name}`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '保存模型失败');
      await modelsQuery.refetch();
    }
  };

  const handleCreateSave = async () => {
    if (!newModel.id || !newModel.name) return;
    const now = new Date().toISOString();
    const createdModel: Model = {
      ...newModel,
      costMultiplier: normalizeCostMultiplier(newModel.costMultiplier),
      contextWindow: normalizeContextWindow(newModel.contextWindow),
      createdAt: now,
      updatedAt: now,
    };
    const nextModels = [...models, createdModel];
    try {
      await persistModels(nextModels);
      setModels(nextModels);
      setNewModel({ id: '', name: '', endpoints: [...DEFAULT_MODEL_ENDPOINTS], engines: [], status: 'active', costMultiplier: 1, contextWindow: DEFAULT_CONTEXT_WINDOW });
      toast('success', `已创建模型 ${createdModel.name}`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '创建模型失败');
      await modelsQuery.refetch();
    }
    setCreatingModel(false);
  };

  const activeFilterCount = selectedEndpoints.length + selectedEngines.length + selectedStatus.length;
  const modelTableColumns = useMemo<DataTableColumn<Model>[]>(() => [
    {
      id: 'name',
      header: '名称',
      render: (model) => (
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
            <Cpu className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{model.name}</div>
            <div className="truncate text-xs text-muted-foreground">{model.id}</div>
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: '状态',
      width: 86,
      render: (model) => <ModelStatusPill status={model.status} />,
    },
    {
      id: 'endpoints',
      header: '端点',
      priority: 3,
      render: (model) => (
        <div className="flex flex-wrap gap-1.5">
          {model.endpoints.length ? model.endpoints.map((endpoint) => (
            <EndpointTag key={`${model.id}-endpoint-table-${endpoint}`} endpoint={endpoint} iconOnly />
          )) : <span className="text-xs text-muted-foreground">-</span>}
        </div>
      ),
    },
    {
      id: 'engines',
      header: '引擎',
      priority: 3,
      render: (model) => (
        <div className="flex flex-wrap gap-1.5">
          {model.engines.length ? model.engines.map((engine) => (
            <EngineTag key={`${model.id}-engine-table-${engine}`} engine={engine} compact />
          )) : <span className="text-xs text-muted-foreground">-</span>}
        </div>
      ),
    },
    {
      id: 'contextWindow',
      header: '上下文',
      width: 110,
      priority: 4,
      render: (model) => <span className="text-sm text-muted-foreground">{model.contextWindow ? model.contextWindow.toLocaleString() : '-'}</span>,
    },
    {
      id: 'costMultiplier',
      header: '费用倍率',
      width: 98,
      priority: 4,
      render: (model) => <span className="text-sm text-muted-foreground">{model.costMultiplier}</span>,
    },
    {
      id: 'updatedAt',
      header: '最近修改',
      width: 110,
      priority: 4,
      render: (model) => <span className="text-xs text-muted-foreground">{model.updatedAt ? new Date(model.updatedAt).toLocaleDateString() : '-'}</span>,
    },
  ], []);

  const getModelRowActions = useCallback((model: Model): ActionMenuGroup[] => [
    {
      actions: [
        {
          id: 'edit',
          label: '编辑',
          icon: <Edit className="h-4 w-4" />,
          primary: true,
          onSelect: () => handleEdit(model),
        },
        {
          id: 'delete',
          label: '删除',
          icon: <Trash2 className="h-4 w-4" />,
          destructive: true,
          onSelect: () => handleDelete(model),
        },
      ],
    },
  ], []);

  const catalogOrRoutesContent = (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <PageToolbar
        className="sticky top-0 z-20 mb-4 rounded-lg border bg-card shadow-none"
        data-tour-step-id="model-filter"
      >
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索模型..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="flex items-center gap-1 rounded-lg border p-1">
              <Button
                variant={viewMode === 'gallery' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 gap-1.5 rounded-lg px-3 text-xs"
                onClick={() => setViewMode('gallery')}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                卡片
              </Button>
              <Button
                variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 gap-1.5 rounded-lg px-3 text-xs"
                onClick={() => setViewMode('table')}
              >
                <List className="h-3.5 w-3.5" />
                表格
              </Button>
            </div>

            {allEndpoints.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="mr-1 text-xs text-muted-foreground">端点:</span>
                {allEndpoints.map((endpoint) => {
                  const label = getEndpointDisplayName(endpoint);
                  const hasWordmark = endpointHasWordmark(endpoint);
                  const isActive = selectedEndpoints.includes(endpoint);
                  return (
                    <Button
                      key={endpoint}
                      variant={isActive ? 'secondary' : 'outline'}
                      size="sm"
                      className={cn(
                        'h-8 gap-1.5 rounded-lg px-2.5 text-xs',
                        isActive && 'border-border bg-muted text-foreground'
                      )}
                      onClick={() => {
                        setSelectedEndpoints((prev) =>
                          isActive
                            ? prev.filter((value) => value !== endpoint)
                            : [...prev, endpoint]
                        );
                      }}
                    >
                      <EndpointIcon
                        endpoint={endpoint}
                        mode={hasWordmark ? 'logo' : 'mark'}
                        className={hasWordmark ? 'h-3.5 w-auto max-w-[4.75rem]' : 'h-3.5 w-3.5'}
                        alt={label}
                        decorative={false}
                      />
                      {hasWordmark ? <span className="sr-only">{label}</span> : label}
                    </Button>
                  );
                })}
              </div>
            )}

            {engineOptions.length > 0 && (
              <div className="w-[180px]">
                <AiModelSelectorField
                  value=""
                  onValueChange={() => {}}
                  values={selectedEngines}
                  onValuesChange={setSelectedEngines}
                  options={engineOptions}
                  placeholder="引擎筛选"
                  searchPlaceholder="搜索引擎..."
                  emptyLabel="没有匹配引擎"
                  className="h-8 text-xs"
                />
              </div>
            )}

            <div className="w-[150px]">
              <AiModelSelectorField
                value=""
                onValueChange={() => {}}
                values={selectedStatus}
                onValuesChange={setSelectedStatus}
                options={[
                  { label: '有效', value: 'active' },
                  { label: '无效', value: 'inactive' },
                ]}
                placeholder="状态筛选"
                searchPlaceholder="搜索状态..."
                emptyLabel="没有匹配状态"
                className="h-8 text-xs"
              />
            </div>

            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs text-muted-foreground"
                onClick={() => {
                  setSelectedEndpoints([]);
                  setSelectedEngines([]);
                  setSelectedStatus([]);
                }}
              >
                <X className="h-3.5 w-3.5" />
                清除 {activeFilterCount} 个筛选
              </Button>
            )}
      </PageToolbar>

      <div className="my-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          共 {filteredModels.length} 个模型
          {selectedModels.size > 0 && `，已选 ${selectedModels.size} 个`}
        </span>
        {filteredModels.length !== models.length && (
          <span>从 {models.length} 个中筛选</span>
        )}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        {viewMode === 'gallery' ? (
          <SortableContext
            items={paginatedModels.map((m) => m.id)}
            strategy={rectSortingStrategy}
          >
            {paginatedModels.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {paginatedModels.map((model) => (
                  <SortableModelCard
                    key={model.id}
                    model={model}
                    selected={selectedModels.has(model.id)}
                    onToggleSelect={() => toggleSelect(model.id)}
                    onEdit={() => handleEdit(model)}
                    onDelete={() => handleDelete(model)}
                  />
                ))}
              </div>
            ) : null}
          </SortableContext>
        ) : (
          <SortableContext
            items={paginatedModels.map((m) => m.id)}
            strategy={verticalListSortingStrategy}
          >
            <DataTable
              columns={modelTableColumns}
              rows={paginatedModels}
              rowKey="id"
              density="comfortable"
              loading={loading}
              rowEnhancer={SortableModelTableRowEnhancer}
              selection={{
                selectedKeys: Array.from(selectedModels),
                onSelectedKeysChange: (keys) => setSelectedModels(new Set(keys.map(String))),
                ariaLabel: '选择当前页模型',
              }}
              rowActions={(model) => getModelRowActions(model)}
              emptyState={{
                icon: <Cpu className="h-12 w-12 opacity-30" />,
                title: '没有找到匹配的模型',
                description: '尝试调整搜索或筛选条件',
                className: 'min-h-[260px]',
              }}
              aria-label="模型列表"
            />
          </SortableContext>
        )}
      </DndContext>

      {viewMode === 'gallery' && filteredModels.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Cpu className="mb-4 h-12 w-12 opacity-30" />
          <p className="text-lg font-medium">没有找到匹配的模型</p>
          <p className="text-sm">尝试调整搜索或筛选条件</p>
        </div>
      )}

      {viewMode === 'gallery' && loading && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">加载中...</p>
        </div>
      )}

      {totalPages > 1 && (
        <PaginationBar
          current={currentPage}
          total={filteredModels.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCurrentPage(1);
          }}
          itemLabel="模型"
          paginationStyle="numbered"
        />
      )}
    </div>
  );

  const { isDashboardShell } = useDashboardShellHeader({
    title: '模型中心',
    subtitle: '模型配置、可用性探针与诊断评测',
    actions: activeTab === 'catalog' ? (
      <Button size="sm" className="gap-1.5 rounded-lg" onClick={() => {
        setNewModel({ id: '', name: '', endpoints: [...DEFAULT_MODEL_ENDPOINTS], engines: [], status: 'active', costMultiplier: 1, contextWindow: DEFAULT_CONTEXT_WINDOW });
        setCreatingModel(true);
      }}>
        <Plus className="h-4 w-4" />
        新建模型
      </Button>
    ) : null,
  }, [activeTab]);

  return (
    <div className="flex h-full flex-col">
      {!isDashboardShell ? (
        <PageHeader
          className="sticky top-0 z-20 shrink-0 bg-card"
          title="模型中心"
          subtitle="模型配置、可用性探针与诊断评测"
          eyebrow="SYSTEM / EVALUATE"
          status={<StatusPill tone={activeTab === 'catalog' ? 'accent' : 'info'}>{modelTabStatusLabel(activeTab)}</StatusPill>}
          secondaryActions={(
            <Button variant="outline" size="sm" asChild>
              <Link href={returnTarget.href}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {returnTarget.label}
              </Link>
            </Button>
          )}
          primaryAction={activeTab === 'catalog' ? (
            <Button size="sm" className="gap-1.5" onClick={() => {
              setNewModel({ id: '', name: '', endpoints: [...DEFAULT_MODEL_ENDPOINTS], engines: [], status: 'active', costMultiplier: 1, contextWindow: DEFAULT_CONTEXT_WINDOW });
              setCreatingModel(true);
            }}>
              <Plus className="h-4 w-4" />
              新建模型
            </Button>
          ) : null}
        />
      ) : null}

      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b bg-card px-6 py-3" data-tour-step-id="model-tabs">
          <TabsList className="grid w-full max-w-[520px] grid-cols-3 rounded-lg bg-muted/50">
            <TabsTrigger value="catalog" className="rounded-md">模型列表</TabsTrigger>
            <TabsTrigger value="probes" className="rounded-md">探针监控</TabsTrigger>
            <TabsTrigger value="diagnostics" className="rounded-md">诊断评测</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="catalog" className="mt-0 min-h-0 flex-1 pb-28">
          {catalogOrRoutesContent}
        </TabsContent>

        <TabsContent value="probes" className="mt-0 min-h-0 flex-1">
          <ModelProbeMonitor
            managedModels={models.map((model) => ({
              id: model.id,
              name: model.name,
              modelRouteId: model.modelRouteId,
              endpoints: model.endpoints || [],
              engines: model.engines || [],
            }))}
          />
        </TabsContent>

        <TabsContent value="diagnostics" className="mt-0 min-h-0 flex-1">
          <ModelDiagnosticsWorkbench
            managedModels={models.map((model) => ({
              id: model.id,
              name: model.name,
              modelRouteId: model.modelRouteId,
              modelId: model.modelId,
              agentId: model.agentId,
              providerModel: model.providerModel,
              runtime: model.runtime,
              isDefault: model.isDefault,
              endpoints: model.endpoints || [],
              engines: model.engines || [],
            }))}
          />
        </TabsContent>
      </Tabs>

      {activeTab === 'catalog' ? (
        <BulkActionBar
          selectedCount={selectedModels.size}
          onClear={() => setSelectedModels(new Set())}
          actions={(
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleSelectAll}
              >
                {allPaginatedSelected ? '取消全选当前页' : '全选当前页'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                批量删除
              </Button>
            </>
          )}
        />
      ) : null}

      <ConfirmModal
        open={deleteDialogOpen}
        variant="delete"
        title="确认批量删除模型"
        objectName={`${selectedModels.size} 个模型`}
        consequence="这些模型会从模型目录中移除，此操作不可撤销。"
        confirmLabel="确认删除"
        cancelLabel="取消"
        affectedItems={models
          .filter((model) => selectedModels.has(model.id))
          .map((model) => ({ id: model.id, label: model.name, description: model.id }))}
        onConfirm={handleBatchDelete}
        onCancel={() => setDeleteDialogOpen(false)}
        onOpenChange={setDeleteDialogOpen}
      />

      <ConfirmModal
        open={Boolean(deleteModel)}
        variant="delete"
        title="确认删除模型"
        objectName={deleteModel?.name}
        consequence="该模型会从模型目录中移除，此操作不可撤销。"
        confirmLabel="删除模型"
        cancelLabel="取消"
        affectedItems={deleteModel ? [{ id: deleteModel.id, label: deleteModel.name, description: deleteModel.id }] : undefined}
        onConfirm={confirmDeleteModel}
        onCancel={() => setDeleteModel(null)}
        onOpenChange={(open) => { if (!open) setDeleteModel(null); }}
      />

      <ObjectEditDrawer
        open={editingModel !== null}
        mode="edit"
        title="编辑模型"
        subtitle={editingModel ? `修改 ${editingModel.name} 的配置信息。` : undefined}
        status={editingModel ? { label: editingModel.status === 'active' ? '有效' : '无效', tone: editingModel.status === 'active' ? 'success' : 'neutral' } : undefined}
        saveAction={{ label: '保存', onClick: handleEditSave }}
        cancelAction={{
          label: '取消',
          onClick: () => {
            setEditingModel(null);
            setEditingOriginalId(null);
          },
        }}
        onOpenChange={(open) => {
          if (!open) {
            setEditingModel(null);
            setEditingOriginalId(null);
          }
        }}
        sections={editingModel ? [
          {
            id: 'identity',
            title: '模型标识',
            content: (
              <div className="grid gap-4">
                <FormField
                  label="模型名称"
                  required
                  control={<Input value={editingModel.name} onChange={(e) => setEditingModel({ ...editingModel, name: e.target.value })} />}
                />
                <FormField
                  label="模型 ID"
                  required
                  control={<Input value={editingModel.id} onChange={(e) => setEditingModel({ ...editingModel, id: e.target.value, modelId: e.target.value })} />}
                />
              </div>
            ),
          },
          {
            id: 'routing',
            title: '可用范围',
            content: (
              <div className="grid gap-4">
                <FormField
                  label="端点"
                  control={(
                    <AiModelSelectorField
                      value=""
                      onValueChange={() => {}}
                      values={editingModel.endpoints}
                      onValuesChange={(endpoints) => setEditingModel({ ...editingModel, endpoints })}
                      options={endpointOptions}
                      placeholder="选择可访问该模型的 API 端点"
                      searchPlaceholder="搜索端点..."
                    />
                  )}
                />
                <FormField
                  label="引擎"
                  description="留空表示不限制，由各引擎按自身兼容性决定是否可用。"
                  control={(
                    <AiModelSelectorField
                      value=""
                      onValueChange={() => {}}
                      values={editingModel.engines}
                      onValuesChange={(engines) => setEditingModel({ ...editingModel, engines })}
                      options={engineOptions}
                      placeholder="选择引擎"
                      searchPlaceholder="搜索引擎..."
                    />
                  )}
                />
              </div>
            ),
          },
          {
            id: 'runtime',
            title: '运行参数',
            content: (
              <div className="grid gap-4">
                <FormField
                  label="启用状态"
                  control={<Switch checked={editingModel.status === 'active'} onCheckedChange={(checked: boolean) => setEditingModel({ ...editingModel, status: checked ? 'active' : 'inactive' })} />}
                />
                <FormField
                  label="费用倍率"
                  control={<Input type="number" step="0.1" min="0" value={editingModel.costMultiplier} onChange={(e) => setEditingModel({ ...editingModel, costMultiplier: normalizeCostMultiplier(e.target.value) })} />}
                />
                <FormField
                  label="上下文窗口"
                  control={<Input type="number" step="1000" min="0" value={editingModel.contextWindow ?? DEFAULT_CONTEXT_WINDOW} onChange={(e) => setEditingModel({ ...editingModel, contextWindow: normalizeContextWindow(e.target.value) })} />}
                />
              </div>
            ),
          },
        ] : []}
      />

      <ObjectEditDrawer
        open={creatingModel}
        mode="create"
        title="新建模型"
        subtitle="添加一个新的模型配置。"
        status={{ label: newModel.status === 'active' ? '有效' : '无效', tone: newModel.status === 'active' ? 'success' : 'neutral' }}
        saveAction={{ label: '创建', onClick: handleCreateSave, disabled: !newModel.id || !newModel.name }}
        cancelAction={{ label: '取消', onClick: () => setCreatingModel(false) }}
        onOpenChange={setCreatingModel}
        sections={[
          {
            id: 'identity',
            title: '模型标识',
            content: (
              <div className="grid gap-4">
                <FormField
                  label="模型名称"
                  required
                  control={<Input value={newModel.name} onChange={(e) => setNewModel({ ...newModel, name: e.target.value })} placeholder="例如: Claude 3.5 Sonnet" />}
                />
                <FormField
                  label="模型 ID"
                  required
                  control={<Input value={newModel.id} onChange={(e) => setNewModel({ ...newModel, id: e.target.value })} placeholder="例如: claude-3-5-sonnet" />}
                />
              </div>
            ),
          },
          {
            id: 'routing',
            title: '可用范围',
            content: (
              <div className="grid gap-4">
                <FormField
                  label="端点"
                  control={(
                    <AiModelSelectorField
                      value=""
                      onValueChange={() => {}}
                      values={newModel.endpoints}
                      onValuesChange={(endpoints) => setNewModel({ ...newModel, endpoints })}
                      options={endpointOptions}
                      placeholder="选择可访问该模型的 API 端点"
                      searchPlaceholder="搜索端点..."
                    />
                  )}
                />
                <FormField
                  label="引擎"
                  description="留空表示不限制，由各引擎按自身兼容性决定是否可用。"
                  control={(
                    <AiModelSelectorField
                      value=""
                      onValueChange={() => {}}
                      values={newModel.engines}
                      onValuesChange={(engines) => setNewModel({ ...newModel, engines })}
                      options={engineOptions}
                      placeholder="选择引擎"
                      searchPlaceholder="搜索引擎..."
                    />
                  )}
                />
              </div>
            ),
          },
          {
            id: 'runtime',
            title: '运行参数',
            content: (
              <div className="grid gap-4">
                <FormField
                  label="启用状态"
                  control={<Switch checked={newModel.status === 'active'} onCheckedChange={(checked: boolean) => setNewModel({ ...newModel, status: checked ? 'active' : 'inactive' })} />}
                />
                <FormField
                  label="费用倍率"
                  control={<Input type="number" step="0.1" min="0" value={newModel.costMultiplier} onChange={(e) => setNewModel({ ...newModel, costMultiplier: normalizeCostMultiplier(e.target.value) })} />}
                />
                <FormField
                  label="上下文窗口"
                  control={<Input type="number" step="1000" min="0" value={newModel.contextWindow ?? DEFAULT_CONTEXT_WINDOW} onChange={(e) => setNewModel({ ...newModel, contextWindow: normalizeContextWindow(e.target.value) })} />}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
