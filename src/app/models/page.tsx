'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/core/utils';
import { ComboboxPortalProvider, MultiCombobox } from '@/components/ui/combobox';
import { PaginationBar } from '@/components/PaginationBar';
import { useToast } from '@/components/ui/toast';
import ModelProbeMonitor from '@/components/models/ModelProbeMonitor';
import ModelDiagnosticsWorkbench from '@/components/models/ModelDiagnosticsWorkbench';
import { EngineIcon } from '@/components/EngineIcon';
import { EndpointIcon, endpointHasWordmark, getEndpointDisplayName } from '@/components/EndpointIcon';
import { getConcreteEngines, getEngineDisplayName } from '@/lib/core/engine-metadata';
import { getLogicalEngineId } from '@/lib/engines/engine-selection';

interface Model {
  id: string;
  name: string;
  endpoints: string[];
  engines: string[];
  status: 'active' | 'inactive';
  costMultiplier: number;
  contextWindow?: number;
  createdAt?: string;
  updatedAt?: string;
}

const DEFAULT_MODEL_ENDPOINTS = ['anthropic', 'openai'] as const;

function normalizeClientModelEngines(engines: unknown): string[] {
  if (!Array.isArray(engines)) return [];
  return Array.from(
    new Set(
      engines
        .map((engine) => String(engine || '').trim())
        .filter(Boolean)
        .map((engine) => getLogicalEngineId(engine) || engine),
    ),
  );
}

function normalizeClientModelOptions(models: any[]): Model[] {
  return models.map((model) => ({
    id: String(model.value || ''),
    name: String(model.label || model.value || ''),
    endpoints: Array.isArray(model.endpoints)
      ? Array.from(new Set(model.endpoints.map((endpoint: unknown) => String(endpoint || '').trim()).filter(Boolean)))
      : [],
    engines: normalizeClientModelEngines(model.engines),
    status: model.status === 'inactive' ? 'inactive' : 'active',
    costMultiplier: Number.isFinite(Number(model.costMultiplier)) ? Number(model.costMultiplier) : 1,
    contextWindow: Number.isFinite(Number(model.contextWindow)) ? Number(model.contextWindow) : undefined,
    createdAt: typeof model.createdAt === 'string' ? model.createdAt : undefined,
    updatedAt: typeof model.updatedAt === 'string' ? model.updatedAt : undefined,
  }));
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
        'max-w-full rounded-full border border-border/70 bg-background/80 text-[11px] font-medium leading-none text-foreground shadow-sm',
        iconOnly ? 'h-7 w-7 justify-center p-0' : showText ? 'h-8 gap-1.5 px-2.5' : 'h-8 px-2.5'
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
        'max-w-full rounded-full border-border/70 bg-background/80 text-[11px] font-medium leading-none text-foreground shadow-sm',
        compact ? 'h-8 gap-1.5 px-2.5' : 'h-8 gap-1.5 px-2.5'
      )}
    >
      <EngineIcon engineId={engine} className="h-3.5 w-3.5" alt={label} decorative={false} />
      <span className="truncate">{label}</span>
    </Badge>
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

  const statusConfig = {
    active: { label: '有效', class: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
    inactive: { label: '无效', class: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400' },
  };

  const status = statusConfig[model.status];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex min-h-[252px] flex-col rounded-[22px] border bg-card px-5 py-5 transition-all',
        isDragging && 'z-50 shadow-2xl',
        selected && 'ring-2 ring-primary'
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Cpu className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-[15px] font-semibold leading-6">{model.name}</h3>
            <span
              className={cn(
                'mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium',
                status.class
              )}
            >
              {status.label}
            </span>
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
          {model.engines.length > 0 && (
            <div className="grid grid-cols-[14px_minmax(0,1fr)] items-start gap-x-2.5">
              <Settings className="mt-2 h-3.5 w-3.5 text-muted-foreground/80" />
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {model.engines.map((engine) => (
                  <EngineTag key={`${model.id}-engine-${engine}`} engine={engine} compact />
                ))}
              </div>
            </div>
          )}
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
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SortableModelRow({
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

  const statusConfig = {
    active: { label: '有效', class: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
    inactive: { label: '无效', class: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400' },
  };

  const status = statusConfig[model.status];

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={cn(
        'group',
        isDragging && 'z-50 bg-card shadow-lg',
        selected && 'bg-primary/5'
      )}
    >
      <TableCell className="w-10">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab opacity-0 transition-opacity group-hover:opacity-40 hover:!opacity-100"
        >
          <GripVertical className="h-4 w-4" />
        </div>
      </TableCell>
      <TableCell className="w-10">
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Cpu className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="font-medium">{model.name}</div>
            <div className="text-xs text-muted-foreground line-clamp-1">{model.id}</div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', status.class)}>
          {status.label}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1.5">
          {model.endpoints.map((endpoint) => (
            <EndpointTag key={`${model.id}-endpoint-row-${endpoint}`} endpoint={endpoint} iconOnly />
          ))}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1.5">
          {model.engines.map((engine) => (
            <EngineTag key={`${model.id}-engine-row-${engine}`} engine={engine} compact />
          ))}
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {model.contextWindow ? model.contextWindow.toLocaleString() : '-'}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {model.costMultiplier}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {model.createdAt ? new Date(model.createdAt).toLocaleDateString() : '-'}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {model.updatedAt ? new Date(model.updatedAt).toLocaleDateString() : '-'}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
            <Edit className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function ModelsPage() {
  useDocumentTitle('模型管理');
  const { toast } = useToast();

  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [editingOriginalId, setEditingOriginalId] = useState<string | null>(null);
  const [creatingModel, setCreatingModel] = useState(false);
  const [newModel, setNewModel] = useState<Omit<Model, 'createdAt' | 'updatedAt'>>({
    id: '',
    name: '',
    endpoints: [],
    engines: [],
    status: 'active',
    costMultiplier: 1,
    contextWindow: undefined,
  });
  const [activeTab, setActiveTab] = useState<'catalog' | 'probe' | 'diagnostics'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('models-active-tab');
      if (saved === 'catalog' || saved === 'probe' || saved === 'diagnostics') return saved;
    }
    return 'catalog';
  });

  const [floatingFilterBar, setFloatingFilterBar] = useState(false);
  const filterBarAnchorRef = useRef<HTMLDivElement | null>(null);
  const filterBarMeasureRef = useRef<HTMLDivElement | null>(null);
  const [filterBarHeight, setFilterBarHeight] = useState(0);

  useEffect(() => {
    localStorage.setItem('models-view-mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('models-active-tab', activeTab);
  }, [activeTab]);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const PAGE_SIZE_OPTIONS = [12, 24, 48];

  useEffect(() => {
    void loadModelsFromApi();
  }, []);

  const loadModelsFromApi = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/models');
      const data = await res.json();
      if (data.models) {
        const transformedModels = normalizeClientModelOptions(data.models);
        setModels(transformedModels);
      }
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  };

  const serializeModelsForApi = useCallback((items: Model[]) => ({
    models: items.map((model) => ({
      value: model.id,
      label: model.name,
      endpoints: model.endpoints || [],
      engines: normalizeClientModelEngines(model.engines),
      status: model.status,
      costMultiplier: model.costMultiplier,
      contextWindow: model.contextWindow,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    })),
  }), []);

  const persistModels = useCallback(async (nextModels: Model[]) => {
    const res = await fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serializeModelsForApi(nextModels)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || '保存模型失败');
    }
  }, [serializeModelsForApi]);

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
    const set = new Set<string>();
    getConcreteEngines().forEach((engine) => normalizeClientModelEngines([engine.id]).forEach((id) => set.add(id)));
    allEngines.forEach((engine) => set.add(engine));
    normalizeClientModelEngines(editingModel?.engines).forEach((engine) => set.add(engine));
    normalizeClientModelEngines(newModel.engines).forEach((engine) => set.add(engine));
    return Array.from(set)
      .filter(Boolean)
      .sort((a, b) => getEngineDisplayName(a).localeCompare(getEngineDisplayName(b), 'zh-CN'))
      .map((engine) => ({
        value: engine,
        label: getEngineDisplayName(engine) || engine,
        icon: <EngineIcon engineId={engine} className="h-3.5 w-3.5" alt={getEngineDisplayName(engine)} decorative={false} />,
      }));
  }, [allEngines, editingModel, newModel.engines]);

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
        await loadModelsFromApi();
      });
    }
  }

  useEffect(() => {
    const handleScroll = () => {
      if (filterBarAnchorRef.current) {
        const rect = filterBarAnchorRef.current.getBoundingClientRect();
        setFloatingFilterBar(rect.top <= 8);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (filterBarMeasureRef.current) {
      setFilterBarHeight(filterBarMeasureRef.current.offsetHeight);
    }
  }, []);

  const filteredModels = useMemo(() => {
    let result = models;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.endpoints.some((e) => e.toLowerCase().includes(q)) ||
          m.engines.some((e) => e.toLowerCase().includes(q))
      );
    }
    if (selectedEndpoints.length > 0) {
      result = result.filter((m) =>
        m.endpoints.some((e) => selectedEndpoints.includes(e))
      );
    }
    if (selectedEngines.length > 0) {
      result = result.filter((m) =>
        m.engines.some((e) => selectedEngines.includes(e))
      );
    }
    if (selectedStatus.length > 0) {
      result = result.filter((m) => selectedStatus.includes(m.status));
    }
    return result;
  }, [models, searchQuery, selectedEndpoints, selectedEngines, selectedStatus]);

  const totalPages = Math.ceil(filteredModels.length / pageSize);
  const paginatedModels = filteredModels.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedEndpoints, selectedEngines, selectedStatus]);

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

  const handleDelete = async (model: Model) => {
    const nextModels = models.filter((m) => m.id !== model.id);
    try {
      await persistModels(nextModels);
      setModels(nextModels);
      setSelectedModels((prev) => {
        const next = new Set(prev);
        next.delete(model.id);
        return next;
      });
      toast('success', `已删除模型 ${model.name}`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '删除模型失败');
      await loadModelsFromApi();
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
      await loadModelsFromApi();
    }
  };

  const handleEdit = (model: Model) => {
    setEditingModel({ ...model });
    setEditingOriginalId(model.id);
  };

  const handleEditSave = async () => {
    if (!editingModel || !editingOriginalId) return;
    const updatedModel = { ...editingModel, updatedAt: new Date().toISOString() };
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
      await loadModelsFromApi();
    }
  };

  const handleCreateSave = async () => {
    if (!newModel.id || !newModel.name) return;
    const now = new Date().toISOString();
    const createdModel: Model = {
      ...newModel,
      createdAt: now,
      updatedAt: now,
    };
    const nextModels = [...models, createdModel];
    try {
      await persistModels(nextModels);
      setModels(nextModels);
      setNewModel({ id: '', name: '', endpoints: [], engines: [], status: 'active', costMultiplier: 1, contextWindow: undefined });
      toast('success', `已创建模型 ${createdModel.name}`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '创建模型失败');
      await loadModelsFromApi();
    }
    setCreatingModel(false);
  };

  const activeFilterCount = selectedEndpoints.length + selectedEngines.length + selectedStatus.length;

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b bg-background/85 px-6 backdrop-blur">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="w-4 h-4 mr-2" />
              返回首页
            </Link>
          </Button>
          <div className="h-6 w-px bg-border" />
          <div>
            <h1 className="text-base font-semibold">模型中心</h1>
            <p className="text-xs text-muted-foreground">模型配置与智能探针监控</p>
          </div>
        </div>
        {activeTab === 'catalog' ? (
          <Button size="sm" className="gap-1.5 rounded-lg" onClick={() => {
            setNewModel({ id: '', name: '', endpoints: [], engines: [], status: 'active', costMultiplier: 1, contextWindow: undefined });
            setCreatingModel(true);
          }}>
            <Plus className="h-4 w-4" />
            新建模型
          </Button>
        ) : null}
      </header>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'catalog' | 'probe' | 'diagnostics')} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b bg-background/70 px-6 py-3" data-tour-step-id="model-tabs">
          <TabsList className="grid w-full max-w-[540px] grid-cols-3 rounded-2xl">
            <TabsTrigger value="catalog" className="rounded-xl">模型管理</TabsTrigger>
            <TabsTrigger value="probe" className="rounded-xl">探针监控</TabsTrigger>
            <TabsTrigger value="diagnostics" className="rounded-xl">诊断评测</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="catalog" className="mt-0 min-h-0 flex-1 pb-28">
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div ref={filterBarAnchorRef} className="h-px" />

            {floatingFilterBar ? <div style={{ height: filterBarHeight }} /> : null}

            <section
              className={cn(
                floatingFilterBar
                  ? 'fixed inset-x-0 top-2 z-40 px-6'
                  : 'relative z-10'
              )}
              data-tour-step-id="model-filter"
            >
              <div
                ref={filterBarMeasureRef}
                className={cn(
                  'rounded-[24px] border bg-card p-4 transition-shadow',
                  floatingFilterBar && 'shadow-lg'
                )}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative min-w-[220px] flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="搜索模型..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="rounded-xl pl-9"
                    />
                  </div>

                  <div className="flex items-center gap-1 rounded-xl border p-1">
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
                              isActive && 'ring-1 ring-primary/50'
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

                  {allEngines.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground mr-1">引擎:</span>
                      {allEngines.map((engine) => {
                        const isActive = selectedEngines.includes(engine);
                        return (
                          <Button
                            key={engine}
                            variant={isActive ? 'secondary' : 'outline'}
                            size="sm"
                            className={cn(
                              'h-8 gap-1.5 rounded-lg px-2.5 text-xs',
                              isActive && 'ring-1 ring-primary/50'
                            )}
                            onClick={() => {
                              setSelectedEngines((prev) =>
                                isActive
                                  ? prev.filter((e) => e !== engine)
                                  : [...prev, engine]
                              );
                            }}
                          >
                            <EngineIcon engineId={engine} className="h-3.5 w-3.5" alt={getEngineDisplayName(engine)} decorative={false} />
                            {getEngineDisplayName(engine) || engine}
                          </Button>
                        );
                      })}
                    </div>
                  )}

                  <div className="w-[120px]">
                    <MultiCombobox
                      options={[
                        { label: '有效', value: 'active' },
                        { label: '无效', value: 'inactive' },
                      ]}
                      value={selectedStatus}
                      onValueChange={setSelectedStatus}
                      placeholder="状态筛选"
                      emptyText="全部状态"
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

                </div>
              </div>
            </section>

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
                  <div className="rounded-[20px] border bg-card">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10" />
                          <TableHead className="w-10">
                            <Checkbox
                              checked={
                                allPaginatedSelected ? true : hasPartialPaginatedSelection ? 'indeterminate' : false
                              }
                              onCheckedChange={toggleSelectAll}
                            />
                          </TableHead>
                          <TableHead>名称</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead>端点</TableHead>
                          <TableHead>引擎</TableHead>
                          <TableHead>上下文窗口</TableHead>
                          <TableHead>费用倍率</TableHead>
                          <TableHead>创建日期</TableHead>
                          <TableHead>最近修改</TableHead>
                          <TableHead className="w-20">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedModels.map((model) => (
                          <SortableModelRow
                            key={model.id}
                            model={model}
                            selected={selectedModels.has(model.id)}
                            onToggleSelect={() => toggleSelect(model.id)}
                            onEdit={() => handleEdit(model)}
                            onDelete={() => handleDelete(model)}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </SortableContext>
              )}
            </DndContext>

            {filteredModels.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Cpu className="mb-4 h-12 w-12 opacity-30" />
                <p className="text-lg font-medium">没有找到匹配的模型</p>
                <p className="text-sm">尝试调整搜索或筛选条件</p>
              </div>
            )}

            {loading && (
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
        </TabsContent>

        <TabsContent value="probe" className="mt-0 min-h-0 flex-1">
          <ModelProbeMonitor
            managedModels={models.map((model) => ({
              id: model.id,
              name: model.name,
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
              endpoints: model.endpoints || [],
              engines: model.engines || [],
            }))}
          />
        </TabsContent>
      </Tabs>

      {activeTab === 'catalog' && paginatedModels.length > 0 ? (
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
                checked={allPaginatedSelected ? true : hasPartialPaginatedSelection ? 'indeterminate' : false}
                aria-label={allPaginatedSelected ? '取消全选当前页模型' : '全选当前页模型'}
                className="mr-2 h-4 w-4 rounded-[5px] border-border bg-background"
                onCheckedChange={toggleSelectAll}
              />
              {allPaginatedSelected ? '取消全选' : '全选当前页'}
            </div>
            <div className="px-3 text-sm font-medium text-foreground/80">
              已选 {selectedModels.size} 项
            </div>
            {selectedModels.size > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="rounded-full px-4 text-destructive hover:text-destructive"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                批量删除
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除选中的 {selectedModels.size} 个模型吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleBatchDelete}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingModel !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingModel(null);
            setEditingOriginalId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <ComboboxPortalProvider>
            <DialogHeader>
              <DialogTitle>编辑模型</DialogTitle>
              <DialogDescription>
                修改模型 {editingModel?.name} 的配置信息。
              </DialogDescription>
            </DialogHeader>
            {editingModel && (
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">模型名称</label>
                  <Input
                    value={editingModel.name}
                    onChange={(e) => setEditingModel({ ...editingModel, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">模型 ID</label>
                  <Input
                    value={editingModel.id}
                    onChange={(e) => setEditingModel({ ...editingModel, id: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">端点</label>
                  <MultiCombobox
                    value={editingModel.endpoints}
                    onValueChange={(endpoints) => setEditingModel({ ...editingModel, endpoints })}
                    options={endpointOptions}
                    placeholder="选择可访问该模型的 API 端点"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">引擎</label>
                  <MultiCombobox
                    value={editingModel.engines}
                    onValueChange={(engines) => setEditingModel({ ...editingModel, engines })}
                    options={engineOptions}
                    placeholder="选择可使用该模型的执行引擎"
                  />
                  <p className="text-xs text-muted-foreground">留空表示不限制，由各引擎按自身兼容性决定是否可用。</p>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">启用状态</label>
                  <Switch
                    checked={editingModel.status === 'active'}
                    onCheckedChange={(checked: boolean) =>
                      setEditingModel({ ...editingModel, status: checked ? 'active' : 'inactive' })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">费用倍率</label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editingModel.costMultiplier}
                    onChange={(e) =>
                      setEditingModel({ ...editingModel, costMultiplier: parseFloat(e.target.value) || 0 })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">上下文窗口</label>
                  <Input
                    type="number"
                    step="1000"
                    min="0"
                    value={editingModel.contextWindow ?? ''}
                    onChange={(e) =>
                      setEditingModel({
                        ...editingModel,
                        contextWindow: e.target.value ? parseInt(e.target.value, 10) : undefined,
                      })
                    }
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingModel(null)}>
                取消
              </Button>
              <Button onClick={handleEditSave}>
                保存
              </Button>
            </DialogFooter>
          </ComboboxPortalProvider>
        </DialogContent>
      </Dialog>

      <Dialog open={creatingModel} onOpenChange={setCreatingModel}>
        <DialogContent className="sm:max-w-[560px]">
          <ComboboxPortalProvider>
            <DialogHeader>
              <DialogTitle>新建模型</DialogTitle>
              <DialogDescription>
                添加一个新的模型配置。
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">模型名称</label>
                <Input
                  value={newModel.name}
                  onChange={(e) => setNewModel({ ...newModel, name: e.target.value })}
                  placeholder="例如: Claude 3.5 Sonnet"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">模型 ID</label>
                <Input
                  value={newModel.id}
                  onChange={(e) => setNewModel({ ...newModel, id: e.target.value })}
                  placeholder="例如: claude-3-5-sonnet"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">端点</label>
                <MultiCombobox
                  value={newModel.endpoints}
                  onValueChange={(endpoints) => setNewModel({ ...newModel, endpoints })}
                  options={endpointOptions}
                  placeholder="选择可访问该模型的 API 端点"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">引擎</label>
                <MultiCombobox
                  value={newModel.engines}
                  onValueChange={(engines) => setNewModel({ ...newModel, engines })}
                  options={engineOptions}
                  placeholder="选择可使用该模型的执行引擎"
                />
                <p className="text-xs text-muted-foreground">留空表示不限制，由各引擎按自身兼容性决定是否可用。</p>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">启用状态</label>
                <Switch
                  checked={newModel.status === 'active'}
                  onCheckedChange={(checked: boolean) =>
                    setNewModel({ ...newModel, status: checked ? 'active' : 'inactive' })
                  }
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">费用倍率</label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={newModel.costMultiplier}
                  onChange={(e) =>
                    setNewModel({ ...newModel, costMultiplier: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">上下文窗口</label>
                <Input
                  type="number"
                  step="1000"
                  min="0"
                  value={newModel.contextWindow ?? ''}
                  onChange={(e) =>
                    setNewModel({
                      ...newModel,
                      contextWindow: e.target.value ? parseInt(e.target.value, 10) : undefined,
                    })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreatingModel(false)}>
                取消
              </Button>
              <Button onClick={handleCreateSave} disabled={!newModel.id || !newModel.name}>
                创建
              </Button>
            </DialogFooter>
          </ComboboxPortalProvider>
        </DialogContent>
      </Dialog>
    </div>
  );
}
