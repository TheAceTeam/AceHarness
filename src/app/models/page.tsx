'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Cpu, Plus, Trash2, ArrowLeft, Edit2, Check, X, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MultiCombobox } from '@/components/ui/combobox';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useTranslations } from '@/hooks/useTranslations';
import { useToast } from '@/components/ui/toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ModelOption {
  value: string;
  label: string;
  costMultiplier: number;
  endpoints: string[];
  engines?: string[];
}

const ALL_ENGINES = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'kiro-cli', label: 'Kiro CLI' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'nga', label: 'NGA' },
  { id: 'codegenie', label: 'CodeGenie' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'cangjie-magic', label: 'CangjieMagic' },
];

interface SortableItemProps {
  id: string;
  model: ModelOption;
  index: number;
  editingIndex: number | null;
  editingModel: ModelOption | null;
  updateEditingModel: (field: keyof ModelOption, value: string | number | string[]) => void;
  saveEditModel: () => void;
  cancelEditModel: () => void;
  startEditModel: (index: number) => void;
  deleteModel: (index: number) => void;
  t: (key: string) => string;
}

function SortableItem({
  id,
  model,
  index,
  editingIndex,
  editingModel,
  updateEditingModel,
  saveEditModel,
  cancelEditModel,
  startEditModel,
  deleteModel,
  t,
}: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg border border-border/30"
    >
      {editingIndex !== index && (
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="w-5 h-5 text-muted-foreground" />
        </div>
      )}
      {editingIndex === index ? (
        <>
          <div className="flex-1 space-y-2">
            <div className="grid grid-cols-3 gap-3">
              <Input
                value={editingModel?.value || ''}
                onChange={(e) => updateEditingModel('value', e.target.value)}
                placeholder={t('models.modelValue')}
              />
              <Input
                value={editingModel?.label || ''}
                onChange={(e) => updateEditingModel('label', e.target.value)}
                placeholder={t('models.displayLabel')}
              />
              <Input
                type="number"
                step="0.01"
                value={editingModel?.costMultiplier || 0}
                onChange={(e) => updateEditingModel('costMultiplier', parseFloat(e.target.value) || 0)}
                placeholder={t('models.costMultiplier')}
              />
            </div>
            <div className="flex gap-4 items-center flex-wrap">
              <div className="flex-1 min-w-[150px]">
                <span className="text-xs text-muted-foreground mb-1 block">端点:</span>
                <MultiCombobox
                  value={editingModel?.endpoints || []}
                  onValueChange={(v) => updateEditingModel('endpoints', v)}
                  options={[
                    { value: 'anthropic', label: 'Anthropic' },
                    { value: 'openai', label: 'OpenAI' },
                  ]}
                  placeholder="选择端点"
                  searchable={false}
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <span className="text-xs text-muted-foreground mb-1 block">引擎:</span>
                <MultiCombobox
                  value={editingModel?.engines || []}
                  onValueChange={(v) => updateEditingModel('engines', v)}
                  options={ALL_ENGINES.map(eng => ({ value: eng.id, label: eng.label }))}
                  placeholder="选择引擎"
                  searchable={false}
                />
              </div>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={saveEditModel}
          >
            <Check className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={cancelEditModel}
          >
            <X className="w-4 h-4" />
          </Button>
        </>
      ) : (
        <>
          <div className="flex-1 grid grid-cols-5 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">{t('models.value')}</div>
              <div className="font-mono text-sm">{model.value}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('models.label')}</div>
              <div className="font-medium">{model.label}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('models.costMultiplier')}</div>
              <div className="font-medium">{model.costMultiplier}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">API 端点</div>
              <div className="flex gap-1 mt-1 flex-wrap">
                {(model.endpoints || []).map(ep => (
                  <span key={ep} className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">
                    {ep}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">引擎</div>
              <div className="flex gap-1 mt-1 flex-wrap">
                {(model.engines || []).length > 0 ? (model.engines || []).map(eng => (
                  <span key={eng} className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-500 rounded">
                    {eng}
                  </span>
                )) : (
                  <span className="text-xs text-muted-foreground">全部</span>
                )}
              </div>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => startEditModel(index)}
          >
            <Edit2 className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => deleteModel(index)}
            className="text-red-500 hover:text-red-600"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </>
      )}
    </div>
  );
}

export default function ModelsPage() {
  const router = useRouter();
  const { t } = useTranslations();
  const { toast } = useToast();
  useDocumentTitle('模型管理');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingModel, setEditingModel] = useState<ModelOption | null>(null);
  const [newModel, setNewModel] = useState<ModelOption>({
    value: '',
    label: '',
    costMultiplier: 0.1,
    endpoints: [],
    engines: [],
  });
  const { confirm, dialogProps } = useConfirmDialog();

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/models');
      const data = await response.json();
      setModels(data.models || []);
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveModels = async (updatedModels: ModelOption[]) => {
    try {
      const response = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models: updatedModels }),
      });

      if (response.ok) {
        toast('success', t('models.messages.saveSuccess'));
      } else {
        toast('error', t('models.messages.saveFailed'));
      }
    } catch (error) {
      console.error('Failed to save models:', error);
      toast('error', t('models.messages.saveFailed'));
    }
  };

  const addModel = async () => {
    if (!newModel.value || !newModel.label || newModel.endpoints.length === 0) {
      toast('warning', t('models.messages.fillAllFields'));
      return;
    }
    const updatedModels = [...models, { ...newModel }];
    setModels(updatedModels);
    await saveModels(updatedModels);
    setNewModel({ value: '', label: '', costMultiplier: 0.1, endpoints: [] });
  };

  const deleteModel = async (index: number) => {
    const confirmed = await confirm({
      title: t('models.messages.deleteTitle'),
      description: t('models.messages.confirmDelete'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      variant: 'destructive',
    });
    if (confirmed) {
      const updatedModels = models.filter((_, i) => i !== index);
      setModels(updatedModels);
      await saveModels(updatedModels);
    }
  };

  const startEditModel = (index: number) => {
    setEditingIndex(index);
    setEditingModel({ ...models[index] });
  };

  const cancelEditModel = () => {
    setEditingIndex(null);
    setEditingModel(null);
  };

  const saveEditModel = async () => {
    if (editingIndex !== null && editingModel) {
      const updated = [...models];
      updated[editingIndex] = editingModel;
      setModels(updated);
      await saveModels(updated);
      setEditingIndex(null);
      setEditingModel(null);
    }
  };

  const updateEditingModel = (field: keyof ModelOption, value: any) => {
    if (editingModel) {
      setEditingModel({ ...editingModel, [field]: value });
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = models.findIndex((_, i) => i.toString() === active.id);
      const newIndex = models.findIndex((_, i) => i.toString() === over.id);
      const updatedModels = arrayMove(models, oldIndex, newIndex);
      setModels(updatedModels);
      await saveModels(updatedModels);
    }
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Animated background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="relative z-10">
        {/* Header */}
        <motion.header
          initial={{ y: -100 }}
          animate={{ y: 0 }}
          className="border-b border-border/50 bg-card/30 backdrop-blur-xl sticky top-0 z-50"
        >
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/dashboard">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {t('common.back')}
                  </Link>
                </Button>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gradient-to-br from-primary to-blue-600 rounded-lg">
                    <Cpu className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
                      {t('models.title')}
                    </h1>
                    <p className="text-xs text-muted-foreground">{t('models.subtitle')}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <LanguageToggle />
                <ThemeToggle />
              </div>
            </div>
          </div>
        </motion.header>

        <div className="container mx-auto px-6 py-8 space-y-8">
          {/* Add New Model */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-6"
          >
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              {t('models.addNew')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="value">{t('models.modelValue')}</Label>
                <Input
                  id="value"
                  placeholder={t('models.placeholders.value')}
                  value={newModel.value}
                  onChange={(e) => setNewModel({ ...newModel, value: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="label">{t('models.displayLabel')}</Label>
                <Input
                  id="label"
                  placeholder={t('models.placeholders.label')}
                  value={newModel.label}
                  onChange={(e) => setNewModel({ ...newModel, label: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="cost">{t('models.costMultiplier')}</Label>
                <Input
                  id="cost"
                  type="number"
                  step="0.01"
                  placeholder={t('models.placeholders.cost')}
                  value={newModel.costMultiplier}
                  onChange={(e) => setNewModel({ ...newModel, costMultiplier: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="flex gap-4 items-center flex-wrap mt-3">
              <div className="flex-1 min-w-[150px]">
                <Label className="text-xs text-muted-foreground mb-1 block">端点:</Label>
                <MultiCombobox
                  value={newModel.endpoints}
                  onValueChange={(v) => setNewModel({ ...newModel, endpoints: v })}
                  options={[
                    { value: 'anthropic', label: 'Anthropic' },
                    { value: 'openai', label: 'OpenAI' },
                  ]}
                  placeholder="选择端点"
                  searchable={false}
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs text-muted-foreground mb-1 block">引擎:</Label>
                <MultiCombobox
                  value={newModel.engines || []}
                  onValueChange={(v) => setNewModel({ ...newModel, engines: v })}
                  options={ALL_ENGINES.map(eng => ({ value: eng.id, label: eng.label }))}
                  placeholder="选择引擎"
                  searchable={false}
                />
              </div>
              <Button onClick={addModel} className="ml-auto">
                <Plus className="w-4 h-4 mr-2" />
                {t('models.addModel')}
              </Button>
            </div>
          </motion.div>

          {/* Models List */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-6"
          >
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Cpu className="w-5 h-5 text-primary" />
              {t('models.configured')} ({models.length})
            </h2>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">{t('models.loading')}</div>
            ) : models.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">{t('models.noModels')}</div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={models.map((_, i) => i.toString())}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-3">
                    {models.map((model, index) => (
                      <SortableItem
                        key={index}
                        id={index.toString()}
                        model={model}
                        index={index}
                        editingIndex={editingIndex}
                        editingModel={editingModel}
                        updateEditingModel={updateEditingModel}
                        saveEditModel={saveEditModel}
                        cancelEditModel={cancelEditModel}
                        startEditModel={startEditModel}
                        deleteModel={deleteModel}
                        t={t}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </motion.div>
        </div>
      </div>

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  );
}
