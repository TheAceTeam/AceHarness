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
import { MultiCombobox } from '@/components/ui/combobox';
import { PaginationBar } from '@/components/PaginationBar';
import ModelProbeMonitor from '@/components/models/ModelProbeMonitor';

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
        'group relative rounded-[20px] border bg-card p-5 transition-all',
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

      <div className="ml-6 mt-4">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Cpu className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold leading-tight">{model.name}</h3>
            <span
              className={cn(
                'mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium',
                status.class
              )}
            >
              {status.label}
            </span>
          </div>
        </div>

        <div className="mb-3 space-y-1 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Globe className="h-3 w-3" />
            <span>{model.endpoints.join(', ')}</span>
          </div>
          {model.engines.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Settings className="h-3 w-3" />
              <span>{model.engines.join(', ')}</span>
            </div>
          )}
          <div className="flex items-center gap-3 text-xs">
            {model.contextWindow && (
              <span>{model.contextWindow.toLocaleString()} ctx</span>
            )}
            <span>费用倍率: {model.costMultiplier}</span>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            {model.createdAt && <span>创建: {new Date(model.createdAt).toLocaleDateString()}</span>}
            {model.updatedAt && <span>修改: {new Date(model.updatedAt).toLocaleDateString()}</span>}
          </div>
          <div className="flex items-center gap-1">
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
      <TableCell className="text-sm text-muted-foreground">
        {model.endpoints.join(', ')}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {model.engines.join(', ')}
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
  const [activeTab, setActiveTab] = useState<'catalog' | 'probe'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('models-active-tab');
      if (saved === 'catalog' || saved === 'probe') return saved;
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
        const transformedModels: Model[] = data.models.map((m: any) => ({
          id: m.value,
          name: m.label,
          endpoints: m.endpoints || [],
          engines: m.engines || [],
          status: m.status || 'active',
          costMultiplier: m.costMultiplier ?? 1,
          contextWindow: m.contextWindow,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        }));
        setModels(transformedModels);
      }
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  };

  const allEndpoints = useMemo(() => {
    const set = new Set<string>();
    models.forEach((m) => m.endpoints.forEach((e) => set.add(e)));
    return Array.from(set).sort();
  }, [models]);

  const allEngines = useMemo(() => {
    const set = new Set<string>();
    models.forEach((m) => m.engines.forEach((e) => set.add(e)));
    return Array.from(set).sort();
  }, [models]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setModels((prev) => {
        const oldIndex = prev.findIndex((m) => m.id === active.id);
        const newIndex = prev.findIndex((m) => m.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
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
  });

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

  const toggleSelectAll = useCallback(() => {
    if (selectedModels.size === paginatedModels.length) {
      setSelectedModels(new Set());
    } else {
      setSelectedModels(new Set(paginatedModels.map((m) => m.id)));
    }
  }, [selectedModels, paginatedModels]);

  const handleDelete = (model: Model) => {
    setModels((prev) => prev.filter((m) => m.id !== model.id));
    setSelectedModels((prev) => {
      const next = new Set(prev);
      next.delete(model.id);
      return next;
    });
  };

  const handleBatchDelete = () => {
    setModels((prev) => prev.filter((m) => !selectedModels.has(m.id)));
    setSelectedModels(new Set());
    setDeleteDialogOpen(false);
  };

  const handleEdit = (model: Model) => {
    setEditingModel({ ...model });
  };

  const handleEditSave = () => {
    if (!editingModel) return;
    setModels((prev) =>
      prev.map((m) => (m.id === editingModel.id ? { ...editingModel, updatedAt: new Date().toISOString() } : m))
    );
    setEditingModel(null);
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
          <Button size="sm" className="gap-1.5 rounded-lg">
            <Plus className="h-4 w-4" />
            新建模型
          </Button>
        ) : null}
      </header>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'catalog' | 'probe')} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b bg-background/70 px-6 py-3">
          <TabsList className="grid w-full max-w-[360px] grid-cols-2 rounded-2xl">
            <TabsTrigger value="catalog" className="rounded-xl">模型管理</TabsTrigger>
            <TabsTrigger value="probe" className="rounded-xl">探针监控</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="catalog" className="mt-0 min-h-0 flex-1">
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div ref={filterBarAnchorRef} className="h-px" />

            {floatingFilterBar ? <div style={{ height: filterBarHeight }} /> : null}

            <section
              className={cn(
                floatingFilterBar
                  ? 'fixed inset-x-0 top-2 z-40 px-6'
                  : 'relative z-10'
              )}
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

                  <div className="w-[140px]">
                    <MultiCombobox
                      options={allEndpoints.map((e) => ({ label: e, value: e }))}
                      value={selectedEndpoints}
                      onValueChange={setSelectedEndpoints}
                      placeholder="端点筛选"
                      emptyText="全部端点"
                    />
                  </div>

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
                              'h-7 rounded-lg px-2.5 text-xs',
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
                            {engine}
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

                  {selectedModels.size > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 gap-1.5 rounded-lg text-xs"
                      onClick={() => setDeleteDialogOpen(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      批量删除 ({selectedModels.size})
                    </Button>
                  )}

                  {viewMode === 'gallery' && paginatedModels.length > 0 && (
                    <button
                      type="button"
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors',
                        'hover:bg-accent hover:text-accent-foreground'
                      )}
                      onClick={toggleSelectAll}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary',
                          paginatedModels.length > 0 && selectedModels.size === paginatedModels.length
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-transparent'
                        )}
                      >
                        {paginatedModels.length > 0 && selectedModels.size === paginatedModels.length && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8.5 2.5L3.8 7.5L1.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      {selectedModels.size === paginatedModels.length ? '取消全选' : '全选当前页'}
                    </button>
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
                                paginatedModels.length > 0 &&
                                selectedModels.size === paginatedModels.length
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
      </Tabs>

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

      <Dialog open={editingModel !== null} onOpenChange={(open) => !open && setEditingModel(null)}>
        <DialogContent className="sm:max-w-[480px]">
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
