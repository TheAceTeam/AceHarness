'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Checkbox } from './ui/checkbox';
import { SingleCombobox } from '@/components/ui/combobox';
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
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Trash2, GripVertical, ChevronLeft, ChevronRight, ChevronDown, ArrowRight, Info, RotateCcw } from 'lucide-react';
import EditNodeModal from './EditNodeModal';
import StateMachineDiagram from './StateMachineDiagram';
import type { StateMachineState, StateTransition, WorkflowStep } from '@/lib/schemas';

interface StateMachineDesignPanelProps {
  states: StateMachineState[];
  onStatesChange: (states: StateMachineState[]) => void;
  availableAgents: any[];
  availableSkills?: { name: string; description: string }[];
}

type StepGroup = {
  id?: string;
  startIndex: number;
  steps: Array<{ step: WorkflowStep; index: number }>;
};

const joinPolicyLabels: Record<string, string> = {
  all: '等待全部完成',
  any: '任一完成即可',
  quorum: '达到指定数量',
  manual: '人工确认',
};

const VERDICT_TRANSITION_PRESETS = [
  {
    verdict: 'pass' as const,
    title: '通过',
    description: '当前状态目标达成，进入下一状态。',
    defaultLabel: '通过后进入下一状态',
    priority: 10,
    tone: 'border-emerald-500/30 bg-emerald-500/5',
    badgeTone: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  },
  {
    verdict: 'conditional_pass' as const,
    title: '有条件通过',
    description: '方向正确但仍需补充，一般留在本状态继续迭代。',
    defaultLabel: '补充后继续当前状态',
    priority: 20,
    tone: 'border-amber-500/30 bg-amber-500/5',
    badgeTone: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
  },
  {
    verdict: 'fail' as const,
    title: '失败',
    description: '当前状态未通过，回退或重新执行。',
    defaultLabel: '失败后回退',
    priority: 30,
    tone: 'border-rose-500/30 bg-rose-500/5',
    badgeTone: 'bg-rose-500/12 text-rose-700 dark:text-rose-300',
  },
];

type VerdictTransition = typeof VERDICT_TRANSITION_PRESETS[number]['verdict'];
const REQUIRED_VERDICTS: VerdictTransition[] = ['pass', 'conditional_pass', 'fail'];

const getStepParallelGroup = (step?: WorkflowStep) => step?.parallelGroup || step?.concurrency?.groupId || '';

const getStepJoinPolicyMode = (step?: WorkflowStep) => step?.concurrency?.joinPolicy?.mode || 'all';

const slugifyId = (value: string, fallback: string) => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
};

const makeParallelGroupId = (stateName: string, startIndex: number) =>
  slugifyId(`parallel-${stateName}-${startIndex + 1}`, `parallel-${startIndex + 1}`);

const makeBranchId = (step: WorkflowStep, index: number) =>
  slugifyId(step.name || step.agent || `branch-${index + 1}`, `branch-${index + 1}`);

const withParallelGroup = (step: WorkflowStep, groupId: string, index: number): WorkflowStep => ({
  ...step,
  parallelGroup: groupId,
  concurrency: {
    ...(step.concurrency || {}),
    groupId,
    branchId: step.concurrency?.branchId || makeBranchId(step, index),
    joinPolicy: step.concurrency?.joinPolicy || { mode: 'all' },
  },
});

const withoutParallelGroup = (step: WorkflowStep): WorkflowStep => {
  const nextConcurrency = { ...(step.concurrency || {}) } as any;
  delete nextConcurrency.groupId;
  delete nextConcurrency.branchId;
  delete nextConcurrency.joinPolicy;
  return {
    ...step,
    parallelGroup: undefined,
    concurrency: Object.keys(nextConcurrency).length ? nextConcurrency : undefined,
    agentInstanceId: undefined,
    channelIds: undefined,
  };
};

const buildStepGroups = (steps: WorkflowStep[]): StepGroup[] => {
  const groups: StepGroup[] = [];
  steps.forEach((step, index) => {
    const groupId = getStepParallelGroup(step);
    const last = groups[groups.length - 1];
    if (groupId && last?.id === groupId) {
      last.steps.push({ step, index });
      return;
    }
    groups.push({ id: groupId || undefined, startIndex: index, steps: [{ step, index }] });
  });
  return groups;
};

const getGroupRange = (steps: WorkflowStep[], index: number) => {
  const groupId = getStepParallelGroup(steps[index]);
  if (!groupId) return { start: index, end: index };
  let start = index;
  let end = index;
  while (start > 0 && getStepParallelGroup(steps[start - 1]) === groupId) start -= 1;
  while (end < steps.length - 1 && getStepParallelGroup(steps[end + 1]) === groupId) end += 1;
  return { start, end };
};

function buildVerdictTransitions(
  state: StateMachineState,
  states: StateMachineState[],
  existingTransitions?: StateTransition[]
): StateTransition[] {
  const transitions = Array.isArray(existingTransitions) ? existingTransitions : state.transitions || [];
  return VERDICT_TRANSITION_PRESETS.map((preset) => {
    const existing = transitions.find((transition) => transition.condition?.verdict === preset.verdict);
    return {
      to: existing?.to ?? '',
      condition: {
        ...(existing?.condition || {}),
        verdict: preset.verdict,
      },
      priority: preset.priority,
      label: existing?.label || preset.defaultLabel,
    };
  });
}

function getStateNodeErrors(state: StateMachineState, states: StateMachineState[]): string[] {
  if (state.isFinal) return [];

  const transitions = Array.isArray(state.transitions) ? state.transitions : [];
  const stateNames = new Set(states.map((item) => item.name));
  const errors: string[] = [];

  for (const verdict of REQUIRED_VERDICTS) {
    const matches = transitions.filter((transition) => transition.condition?.verdict === verdict);
    if (matches.length === 0) {
      errors.push(`缺少 ${verdict} 路径`);
      continue;
    }
    if (matches.length > 1) {
      errors.push(`${verdict} 路径重复`);
    }
    if (!matches[0]?.to?.trim()) {
      errors.push(`${verdict} 未设置目标状态`);
    } else if (!stateNames.has(matches[0].to)) {
      errors.push(`${verdict} 指向不存在的状态`);
    }
  }

  const nonVerdictTransitions = transitions.filter((transition) => !REQUIRED_VERDICTS.includes(transition.condition?.verdict as VerdictTransition));
  if (nonVerdictTransitions.length > 0) {
    errors.push('存在未绑定 verdict 的转移');
  }

  return errors;
}

// 可拖拽的步骤行
function SortableStepRow({
  step, index, isParallel = false, canGroupPrevious, canGroupNext, onEdit, onDelete, onGroupWithPrevious, onGroupWithNext, onUngroup,
}: {
  step: WorkflowStep;
  index: number;
  isParallel?: boolean;
  canGroupPrevious?: boolean;
  canGroupNext?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onGroupWithPrevious?: () => void;
  onGroupWithNext?: () => void;
  onUngroup?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(index) });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const roleIcon = step.role === 'attacker' ? 'swords' : step.role === 'judge' ? 'gavel' : 'shield';
  const roleColor = step.role === 'attacker'
    ? 'bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-800'
    : step.role === 'judge'
    ? 'bg-yellow-500/10 text-yellow-600 border-yellow-200 dark:border-yellow-800'
    : 'bg-red-500/10 text-red-600 border-red-200 dark:border-red-800';

  return (
    <div ref={setNodeRef} style={style} className={`flex items-center gap-2 p-2.5 rounded-lg border ${roleColor} group`}>
      <button {...attributes} {...listeners} className="cursor-grab text-gray-400 hover:text-gray-600 flex-shrink-0">
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="material-symbols-outlined text-sm flex-shrink-0">{roleIcon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{step.name}</div>
        <div className="text-xs text-gray-500 truncate">{step.agent}</div>
        {(isParallel || step.specTaskBinding?.taskId || step.specTaskBinding?.taskIds?.length) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {isParallel ? <Badge variant="outline" className="text-[10px] py-0">并发分支</Badge> : null}
            {(step.specTaskBinding?.taskId || step.specTaskBinding?.taskIds?.length) ? <Badge variant="outline" className="text-[10px] py-0">Spec 任务</Badge> : null}
          </div>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {canGroupPrevious && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={(e) => { e.stopPropagation(); onGroupWithPrevious?.(); }}>
            与上一并发
          </Button>
        )}
        {canGroupNext && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={(e) => { e.stopPropagation(); onGroupWithNext?.(); }}>
            与下一并发
          </Button>
        )}
        {isParallel && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={(e) => { e.stopPropagation(); onUngroup?.(); }}>
            拆分
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onEdit}>
          <span className="material-symbols-outlined text-sm">edit</span>
        </Button>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

// 左侧状态列表：可拖拽排序
function SortableStateListItem({
  state,
  index,
  isSelected,
  errors,
  onSelect,
  onDelete,
}: {
  state: StateMachineState;
  index: number;
  isSelected: boolean;
  errors?: string[];
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(index) });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.55 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-1 rounded-lg border border-transparent px-2 py-2 transition-colors text-sm ${
        isSelected
          ? 'border-primary/40 bg-primary text-primary-foreground'
          : 'hover:bg-muted hover:border-border'
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className={`cursor-grab active:cursor-grabbing touch-none flex-shrink-0 rounded p-0.5 ${
          isSelected ? 'text-primary-foreground/80 hover:text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
        aria-label="拖动排序"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div
        role="button"
        tabIndex={0}
        className="flex-1 min-w-0 cursor-pointer text-left"
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        <div className="font-medium truncate">{state.name}</div>
        <div className={`text-xs ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
          {state.steps?.length ?? 0}步 · {state.transitions?.length ?? 0}转移
        </div>
        {errors && errors.length > 0 ? (
          <div className={`mt-1 text-[11px] ${isSelected ? 'text-primary-foreground/85' : 'text-red-500'}`}>
            {errors[0]}
          </div>
        ) : null}
      </div>
      <div className="flex gap-0.5 ml-0.5 flex-shrink-0">
        {errors && errors.length > 0 ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 self-center" title={errors.join('；')} /> : null}
        {state.isInitial && <span className="w-1.5 h-1.5 rounded-full bg-green-400 self-center" title="初始状态" />}
        {state.isFinal && <span className="w-1.5 h-1.5 rounded-full bg-red-400 self-center" title="终止状态" />}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={`h-5 w-5 p-0 opacity-0 group-hover:opacity-100 flex-shrink-0 ${
          isSelected ? 'hover:bg-primary-foreground/20 text-primary-foreground' : 'text-destructive hover:text-destructive'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
}

// 固定 verdict 三分支编辑卡
function VerdictTransitionCard({
  transition, states, onChange, preset,
}: {
  transition: StateTransition;
  states: StateMachineState[];
  onChange: (t: StateTransition) => void;
  preset: typeof VERDICT_TRANSITION_PRESETS[number];
}) {
  const [expanded, setExpanded] = useState(false);

  const conditionSummary = () => {
    const parts: string[] = [];
    if (transition.condition.issueTypes?.length) {
      parts.push(`问题类型: ${transition.condition.issueTypes.join('/')}`);
    }
    if (transition.condition.severities?.length) {
      parts.push(`严重程度: ${transition.condition.severities.join('/')}`);
    }
    if (transition.condition.minIssueCount !== undefined) {
      parts.push(`≥${transition.condition.minIssueCount}个问题`);
    }
    if (transition.condition.maxIssueCount !== undefined) {
      parts.push(`≤${transition.condition.maxIssueCount}个问题`);
    }
    return parts.length ? parts.join(' · ') : '仅按 verdict 判定';
  };

  return (
    <div className={`overflow-hidden rounded-2xl border ${preset.tone}`}>
      <div className="flex items-start gap-3 p-4">
        <button
          type="button"
          className="mt-0.5 rounded-full border border-border/60 bg-background/80 p-1 text-muted-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`border-0 ${preset.badgeTone}`}>{preset.title}</Badge>
                  <span className="text-sm font-semibold text-foreground">{transition.to || '请选择目标状态'}</span>
                  {!transition.to ? (
                    <Badge variant="destructive" className="text-[10px]">
                      未配置
                    </Badge>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">{preset.description}</div>
                {!transition.to ? (
                  <div className="text-xs text-red-500">
                    该路径还没有配置跳转目标，当前状态将无法通过保存校验。
                  </div>
                ) : null}
              </div>
              <div className="rounded-full border bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground">
                {conditionSummary()}
              </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="space-y-1.5">
              <Label className="text-xs">跳转目标</Label>
              <SingleCombobox
                value={transition.to}
                onValueChange={(value) => onChange({ ...transition, to: value })}
                options={states.map((state) => ({ value: state.name, label: state.name }))}
                placeholder="选择状态"
                triggerClassName="h-9 bg-background/90"
                searchable={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">路径说明</Label>
              <Input
                className="h-9 bg-background/90 text-sm"
                value={transition.label || ''}
                onChange={(e) => onChange({ ...transition, label: e.target.value })}
                placeholder={preset.defaultLabel}
              />
            </div>
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-3 border-t border-border/50 bg-background/60 p-4">
          <div className="flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>这条路径的 verdict 已固定为 {preset.title}。下面这些条件只是额外收紧，不会替代 verdict 本身。</span>
          </div>

          <div>
            <Label className="mb-1.5 block text-xs">问题类型过滤</Label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'design', label: '设计问题', desc: '架构/方案缺陷' },
                { value: 'implementation', label: '实现问题', desc: 'Bug/代码错误' },
                { value: 'performance', label: '性能问题', desc: '性能瓶颈/退化' },
                { value: 'security', label: '安全问题', desc: '漏洞/安全缺陷' },
                { value: 'test', label: '测试问题', desc: '测试用例失败' },
              ].map((opt) => {
                const selected = transition.condition.issueTypes?.includes(opt.value as any);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    title={opt.desc}
                    onClick={() => {
                      const current = transition.condition.issueTypes || [];
                      const next = selected
                        ? current.filter((item) => item !== opt.value)
                        : [...current, opt.value as any];
                      onChange({ ...transition, condition: { ...transition.condition, issueTypes: next.length ? next : undefined } });
                    }}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-all ${selected ? 'border-blue-500 bg-blue-500 text-white' : 'border-border bg-background/90 text-muted-foreground hover:border-blue-300'}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block text-xs">严重程度过滤</Label>
            <div className="flex gap-2">
              {[
                { value: 'critical', label: '严重', color: 'border-red-500 bg-red-500 text-white' },
                { value: 'major', label: '主要', color: 'border-orange-500 bg-orange-500 text-white' },
                { value: 'minor', label: '次要', color: 'border-slate-500 bg-slate-500 text-white' },
              ].map((opt) => {
                const selected = transition.condition.severities?.includes(opt.value as any);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      const current = transition.condition.severities || [];
                      const next = selected
                        ? current.filter((item) => item !== opt.value)
                        : [...current, opt.value as any];
                      onChange({ ...transition, condition: { ...transition.condition, severities: next.length ? next : undefined } });
                    }}
                    className={`flex-1 rounded border py-1.5 text-xs font-medium transition-all ${selected ? opt.color : 'border-border bg-background/90 text-muted-foreground hover:border-gray-300'}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block text-xs">最少问题数量</Label>
              <Input
                type="number"
                className="h-9 bg-background/90 text-sm"
                placeholder="不限"
                value={transition.condition.minIssueCount ?? ''}
                onChange={(e) => onChange({
                  ...transition,
                  condition: { ...transition.condition, minIssueCount: e.target.value ? Number(e.target.value) : undefined },
                })}
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs">最多问题数量</Label>
              <Input
                type="number"
                className="h-9 bg-background/90 text-sm"
                placeholder="不限"
                value={transition.condition.maxIssueCount ?? ''}
                onChange={(e) => onChange({
                  ...transition,
                  condition: { ...transition.condition, maxIssueCount: e.target.value ? Number(e.target.value) : undefined },
                })}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function StateMachineDesignPanel({
  states,
  onStatesChange,
  availableAgents,
  availableSkills = [],
}: StateMachineDesignPanelProps) {
  const [selectedStateName, setSelectedStateName] = useState<string | null>(
    states.length > 0 ? states[0].name : null
  );
  const [editingStateInfo, setEditingStateInfo] = useState(false);
  const [editingStep, setEditingStep] = useState<{ index: number; isNew: boolean } | null>(null);

  // Resizable panel for editor ↔ diagram split
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'design-editor-diagram' });
  const diagramPanelRef = usePanelRef();
  const [diagramCollapsed, setDiagramCollapsed] = useState(false);

  useEffect(() => {
    setDiagramCollapsed(diagramPanelRef.current?.isCollapsed() ?? false);
  }, [diagramPanelRef]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  /** 左侧状态列表单独使用略高的拖动阈值，避免与「点击选中」冲突 */
  const stateListSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const selectedState = states.find(s => s.name === selectedStateName) ?? null;
  const selectedStateIndex = states.findIndex(s => s.name === selectedStateName);
  const stateNodeErrors = useMemo(
    () => Object.fromEntries(states.map((state) => [state.name, getStateNodeErrors(state, states)])),
    [states]
  );
  const selectedStateVerdictTransitions = useMemo(
    () => (selectedState && !selectedState.isFinal ? buildVerdictTransitions(selectedState, states, selectedState.transitions) : []),
    [selectedState, states]
  );
  const flowSummary = useMemo(() => {
    const transitionCount = states.reduce((sum, state) => sum + (state.transitions?.length ?? 0), 0);
    const stepCount = states.reduce((sum, state) => sum + (state.steps?.length ?? 0), 0);
    const parallelGroupIds = new Set<string>();
    states.forEach((state) => {
      (state.steps || []).forEach((step) => {
        const groupId = getStepParallelGroup(step);
        if (groupId) parallelGroupIds.add(groupId);
      });
    });
    return {
      transitionCount,
      stepCount,
      parallelGroupCount: parallelGroupIds.size,
    };
  }, [states]);

  const updateState = useCallback((updated: StateMachineState) => {
    onStatesChange(states.map((s, i) => i === selectedStateIndex ? updated : s));
  }, [states, selectedStateIndex, onStatesChange]);

  // 步骤拖拽排序
  const handleDragEnd = (event: DragEndEvent) => {
    if (!selectedState) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = Number(active.id);
    const newIndex = Number(over.id);
    updateState({ ...selectedState, steps: arrayMove(selectedState.steps, oldIndex, newIndex) });
  };

  const handleStateListDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = Number(active.id);
    const newIndex = Number(over.id);
    onStatesChange(arrayMove(states, oldIndex, newIndex));
  };

  const handleAddState = () => {
    const name = `状态${states.length + 1}`;
    const newState: StateMachineState = {
      name,
      description: '',
      steps: [],
      transitions: [],
      isInitial: states.length === 0,
      isFinal: false,
    };
    onStatesChange([...states, newState]);
    setSelectedStateName(name);
  };

  const handleDeleteState = (name: string) => {
    onStatesChange(states.filter(s => s.name !== name));
    if (selectedStateName === name) {
      setSelectedStateName(states.find(s => s.name !== name)?.name ?? null);
    }
  };

  const handleSaveStep = (data: any) => {
    if (!selectedState || editingStep === null) return;
    const normalizedConstraints = Array.isArray(data.constraints)
      ? data.constraints.filter((c: string) => typeof c === 'string' && c.trim())
      : typeof data.constraints === 'string'
        ? data.constraints.split('\n').filter((c: string) => c.trim())
        : undefined;
    const newStep: WorkflowStep = {
      name: data.name,
      agent: data.agent,
      task: data.task,
      role: data.role,
      constraints: normalizedConstraints,
      skills: data.skills,
      enableReviewPanel: data.enableReviewPanel,
      parallelGroup: data.parallelGroup,
      concurrency: data.concurrency,
      agentInstanceId: data.agentInstanceId,
      channelIds: data.channelIds,
      specTaskBinding: data.specTaskBinding,
    };
    const steps = [...selectedState.steps];
    if (editingStep.isNew) {
      steps.push(newStep);
    } else {
      steps[editingStep.index] = newStep;
    }
    updateState({ ...selectedState, steps });
    setEditingStep(null);
  };

  const handleDeleteStep = (index: number) => {
    if (!selectedState) return;
    updateState({ ...selectedState, steps: (selectedState.steps || []).filter((_, i) => i !== index) });
    setEditingStep(null);
  };

  const handleDiagramStepClick = useCallback((step: WorkflowStep) => {
    for (const state of states) {
      const index = (state.steps || []).findIndex((candidate) => candidate === step || (
        candidate.name === step.name && candidate.agent === step.agent
      ));
      if (index >= 0) {
        setSelectedStateName(state.name);
        setEditingStep({ index, isNew: false });
        return;
      }
    }
  }, [states]);

  const handleGroupSteps = (start: number, end: number, groupId?: string) => {
    if (!selectedState) return;
    const nextGroupId = groupId || makeParallelGroupId(selectedState.name, start);
    const steps = (selectedState.steps || []).map((step, index) => (
      index >= start && index <= end ? withParallelGroup(step, nextGroupId, index - start) : step
    ));
    updateState({ ...selectedState, steps });
  };

  const handleGroupWithNext = (index: number) => {
    if (!selectedState || index >= (selectedState.steps?.length ?? 0) - 1) return;
    const steps = selectedState.steps || [];
    const left = getGroupRange(steps, index);
    const right = getGroupRange(steps, left.end + 1);
    const existingGroupId = getStepParallelGroup(steps[left.start]) || getStepParallelGroup(steps[right.start]);
    handleGroupSteps(left.start, right.end, existingGroupId || makeParallelGroupId(selectedState.name, left.start));
  };

  const handleGroupWithPrevious = (index: number) => {
    if (!selectedState || index <= 0) return;
    const steps = selectedState.steps || [];
    const right = getGroupRange(steps, index);
    const left = getGroupRange(steps, right.start - 1);
    const existingGroupId = getStepParallelGroup(steps[left.start]) || getStepParallelGroup(steps[right.start]);
    handleGroupSteps(left.start, right.end, existingGroupId || makeParallelGroupId(selectedState.name, left.start));
  };

  const handleUngroup = (index: number) => {
    if (!selectedState) return;
    const steps = selectedState.steps || [];
    const range = getGroupRange(steps, index);
    updateState({
      ...selectedState,
      steps: steps.map((step, stepIndex) => (
        stepIndex >= range.start && stepIndex <= range.end ? withoutParallelGroup(step) : step
      )),
    });
  };

  const handleSetJoinPolicy = (groupId: string, mode: 'all' | 'any' | 'quorum' | 'manual') => {
    if (!selectedState) return;
    const groupSteps = (selectedState.steps || []).filter((step) => getStepParallelGroup(step) === groupId);
    const defaultQuorum = Math.max(1, Math.min(2, groupSteps.length));
    updateState({
      ...selectedState,
      steps: (selectedState.steps || []).map((step) => {
        if (getStepParallelGroup(step) !== groupId) return step;
        const currentPolicy = step.concurrency?.joinPolicy || { mode: 'all' as const };
        const nextPolicy: any = {
          ...currentPolicy,
          mode,
        };
        if (mode === 'quorum') {
          nextPolicy.quorum = currentPolicy.quorum || defaultQuorum;
        } else {
          delete nextPolicy.quorum;
        }
        return {
          ...step,
          concurrency: {
            ...(step.concurrency || {}),
            groupId,
            joinPolicy: nextPolicy,
          },
        };
      }),
    });
  };

  const handleResetVerdictTransitions = () => {
    if (!selectedState || selectedState.isFinal) return;
    updateState({ ...selectedState, transitions: buildVerdictTransitions(selectedState, states) });
  };

  const handleUpdateVerdictTransition = (verdict: VerdictTransition, transition: StateTransition) => {
    if (!selectedState) return;
    const transitions = buildVerdictTransitions(selectedState, states, selectedState.transitions).map((item) => (
      item.condition.verdict === verdict
        ? { ...transition, condition: { ...(transition.condition || {}), verdict }, priority: VERDICT_TRANSITION_PRESETS.find((preset) => preset.verdict === verdict)?.priority || item.priority }
        : item
    ));
    updateState({ ...selectedState, transitions });
  };

  // 编辑步骤时的初始数据
  const editingStepData = editingStep && !editingStep.isNew && selectedState
    ? (() => {
        const s = selectedState.steps[editingStep.index];
        return {
          name: s.name,
          agent: s.agent,
          task: s.task,
          role: s.role,
          constraints: s.constraints?.join('\n') ?? '',
          skills: s.skills ?? [],
          enableReviewPanel: s.enableReviewPanel ?? false,
          parallelGroup: s.parallelGroup,
          concurrency: s.concurrency,
          agentInstanceId: s.agentInstanceId,
          channelIds: s.channelIds,
          specTaskBinding: s.specTaskBinding,
        };
      })()
    : undefined;

  return (
    <div className="flex h-full">
      {/* 左侧：状态列表 */}
      <div className="w-52 flex-shrink-0 border-r border-border flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-sm font-semibold">状态</span>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={handleAddState}>
            <Plus className="w-3.5 h-3.5 mr-1" />添加
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <DndContext id="sm-state-list" sensors={stateListSensors} collisionDetection={closestCenter} onDragEnd={handleStateListDragEnd}>
            <SortableContext items={states.map((_, i) => String(i))} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {states.map((state, index) => (
                  <SortableStateListItem
                    key={state.name}
                    state={state}
                    index={index}
                    isSelected={selectedStateName === state.name}
                    errors={stateNodeErrors[state.name] || []}
                    onSelect={() => setSelectedStateName(state.name)}
                    onDelete={() => handleDeleteState(state.name)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>

      {/* 中间 + 右侧：可拖拽分栏 */}
      <ResizablePanelGroup
        id="design-editor-diagram"
        orientation="horizontal"
        className="flex-1 min-w-0"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
      <ResizablePanel id="design-editor" defaultSize={50} minSize={25}>
      <div className="h-full flex flex-col">

      {selectedState ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* 状态基本信息 */}
          <div>
            {editingStateInfo ? (
              <div className="space-y-3 p-3 border border-border rounded-lg bg-muted/30">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">状态名称</Label>
                    <Input
                      className="h-8 text-sm"
                      value={selectedState.name}
                      onChange={(e) => updateState({ ...selectedState, name: e.target.value })}
                    />
                  </div>
                  <div className="flex items-end gap-4 pb-1">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox
                        checked={selectedState.isInitial}
                        onCheckedChange={(v) => updateState({ ...selectedState, isInitial: !!v })}
                      />
                      <span className="text-xs">初始状态</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox
                        checked={selectedState.isFinal}
                        onCheckedChange={(v) => updateState({ ...selectedState, isFinal: !!v })}
                      />
                      <span className="text-xs">终止状态</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer" title="完成后需要人工审查（跳转到自身除外）">
                      <Checkbox
                        checked={selectedState.requireHumanApproval ?? false}
                        onCheckedChange={(v) => updateState({ ...selectedState, requireHumanApproval: !!v })}
                      />
                      <span className="text-xs">人工审查</span>
                    </label>
                  </div>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">描述</Label>
                  <Textarea
                    className="text-sm resize-none"
                    rows={2}
                    value={selectedState.description ?? ''}
                    onChange={(e) => updateState({ ...selectedState, description: e.target.value })}
                  />
                </div>
                <Button size="sm" variant="outline" onClick={() => setEditingStateInfo(false)}>完成</Button>
              </div>
            ) : (
              <div
                className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/30 cursor-pointer group"
                onClick={() => setEditingStateInfo(true)}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{selectedState.name}</span>
                    {selectedState.isInitial && <Badge variant="outline" className="text-xs py-0">初始</Badge>}
                    {selectedState.isFinal && <Badge variant="outline" className="text-xs py-0">终止</Badge>}
                    {selectedState.requireHumanApproval && <Badge variant="outline" className="text-xs py-0 bg-orange-100 dark:bg-orange-900 text-orange-600">人工审查</Badge>}
                  </div>
                  {selectedState.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{selectedState.description}</div>
                  )}
                </div>
                <span className="material-symbols-outlined text-sm text-muted-foreground opacity-0 group-hover:opacity-100">edit</span>
              </div>
            )}
          </div>

          {/* 执行步骤 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold">执行步骤</span>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditingStep({ index: -1, isNew: true })}>
                <Plus className="w-3.5 h-3.5 mr-1" />添加步骤
              </Button>
            </div>
            <DndContext id="sm-step-list" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={(selectedState.steps || []).map((_, i) => String(i))} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5">
                  {buildStepGroups(selectedState.steps || []).map((group) => {
                    const isParallelGroup = !!group.id && group.steps.length > 1;
                    const firstStep = group.steps[0]?.step;
                    const joinMode = getStepJoinPolicyMode(firstStep);
                    if (isParallelGroup) {
                      return (
                        <div key={`${group.id}-${group.startIndex}`} className="rounded-2xl border border-cyan-300/70 bg-cyan-500/5 p-2.5 shadow-sm dark:border-cyan-800/80">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="material-symbols-outlined text-cyan-600" style={{ fontSize: 16 }}>lan</span>
                              <div>
                                <div className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">并发组</div>
                                <div className="text-[11px] text-muted-foreground">{joinPolicyLabels[joinMode] || joinMode} · {group.steps.length} 个步骤</div>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {(['all', 'any', 'quorum', 'manual'] as const).map((mode) => (
                                <Button
                                  key={mode}
                                  type="button"
                                  size="sm"
                                  variant={joinMode === mode ? 'default' : 'outline'}
                                  className="h-6 px-2 text-[10px]"
                                  onClick={() => group.id && handleSetJoinPolicy(group.id, mode)}
                                >
                                  {joinPolicyLabels[mode]}
                                </Button>
                              ))}
                              <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => handleUngroup(group.startIndex)}>
                                拆分
                              </Button>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            {group.steps.map(({ step, index }) => (
                              <SortableStepRow
                                key={index}
                                step={step}
                                index={index}
                                isParallel
                                canGroupPrevious={index > 0 && getStepParallelGroup((selectedState.steps || [])[index - 1]) !== getStepParallelGroup(step)}
                                canGroupNext={index < (selectedState.steps?.length ?? 0) - 1 && getStepParallelGroup((selectedState.steps || [])[index + 1]) !== getStepParallelGroup(step)}
                                onGroupWithPrevious={() => handleGroupWithPrevious(index)}
                                onGroupWithNext={() => handleGroupWithNext(index)}
                                onUngroup={() => handleUngroup(index)}
                                onEdit={() => setEditingStep({ index, isNew: false })}
                                onDelete={() => handleDeleteStep(index)}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    }
                    const { step, index } = group.steps[0];
                    return (
                      <SortableStepRow
                        key={index}
                        step={step}
                        index={index}
                        canGroupPrevious={index > 0}
                        canGroupNext={index < (selectedState.steps?.length ?? 0) - 1}
                        onGroupWithPrevious={() => handleGroupWithPrevious(index)}
                        onGroupWithNext={() => handleGroupWithNext(index)}
                        onEdit={() => setEditingStep({ index, isNew: false })}
                        onDelete={() => handleDeleteStep(index)}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
            {(selectedState.steps?.length ?? 0) === 0 && (
              <div className="text-center text-sm text-muted-foreground py-6 border border-dashed border-border rounded-lg">
                暂无步骤，点击添加
              </div>
            )}
          </div>

          {/* 状态转移规则 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold">状态转移规则</span>
                <p className="mt-0.5 text-xs text-muted-foreground">默认要求每个非终止状态都完整填写 pass / conditional_pass / fail 三条路径。</p>
              </div>
              {!selectedState.isFinal ? (
                <Button size="sm" variant="outline" className="h-8 gap-1.5 px-3 text-xs" onClick={handleResetVerdictTransitions}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  恢复标准三路
                </Button>
              ) : null}
            </div>
            {selectedState.isFinal ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
                终止状态不需要配置转移规则。
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />
                    <span>系统会按 verdict 固定识别三条路径。你只需要分别填写目标状态和可选的额外过滤条件，不再手工维护优先级。</span>
                  </div>
                </div>
                {selectedStateVerdictTransitions.map((transition) => {
                  const verdict = transition.condition.verdict as VerdictTransition;
                  const preset = VERDICT_TRANSITION_PRESETS.find((item) => item.verdict === verdict);
                  if (!preset) return null;
                  return (
                    <VerdictTransitionCard
                      key={verdict}
                      transition={transition}
                      states={states}
                      preset={preset}
                      onChange={(nextTransition) => handleUpdateVerdictTransition(verdict, nextTransition)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          请选择一个状态进行编辑
        </div>
      )}
      </div>
      </ResizablePanel>

      <ResizableHandle
        withHandle
        collapsed={diagramCollapsed}
        onClickHandle={() => {
          const panel = diagramPanelRef.current;
          if (!panel) return;
          panel.isCollapsed() ? panel.expand() : panel.collapse();
        }}
        handleIcon={diagramCollapsed
          ? <ChevronLeft className="h-2.5 w-2.5" />
          : <ChevronRight className="h-2.5 w-2.5" />
        }
      />

      <ResizablePanel
        id="design-diagram"
        panelRef={diagramPanelRef}
        defaultSize={50}
        minSize={20}
        collapsible
        collapsedSize={0}
        onResize={() => setDiagramCollapsed(diagramPanelRef.current?.isCollapsed() ?? false)}
      >
        <div className="h-full flex flex-col bg-muted/10">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="flex items-center gap-2 text-xs font-medium">
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 17 }}>account_tree</span>
              整体流程图
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[10px]">{states.length} 状态</Badge>
              <Badge variant="outline" className="text-[10px]">{flowSummary.stepCount} 步骤</Badge>
              <Badge variant="outline" className="text-[10px]">{flowSummary.transitionCount} 转移</Badge>
              {flowSummary.parallelGroupCount > 0 ? (
                <Badge variant="outline" className="text-[10px]">{flowSummary.parallelGroupCount} 并发组</Badge>
              ) : null}
            </div>
          </div>
          <div className="flex-1 min-h-0 p-2">
            {states.length > 0 ? (
              <StateMachineDiagram
                states={states}
                focusedState={selectedStateName}
                onStateClick={(stateName) => {
                  if (states.some((state) => state.name === stateName)) {
                    setSelectedStateName(stateName);
                  }
                }}
                onStepClick={handleDiagramStepClick}
              />
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                暂无状态，先从左侧添加状态。
              </div>
            )}
          </div>
        </div>
      </ResizablePanel>
      </ResizablePanelGroup>

      {/* 步骤编辑弹窗（复用 EditNodeModal） */}
      {editingStep !== null && (
        <EditNodeModal
          isOpen
          type="step"
          data={editingStep.isNew ? {
            name: '',
            agent: availableAgents[0]?.name ?? '',
            task: '',
            role: 'defender',
            constraints: '',
            skills: [],
            parallelGroup: '',
            concurrency: undefined,
            agentInstanceId: '',
            channelIds: [],
            specTaskBinding: undefined,
          } : editingStepData}
          roles={availableAgents}
          availableSkills={availableSkills}
          isNew={editingStep.isNew}
          existingPhases={[]}
          existingSteps={selectedState?.steps ?? []}
          onClose={() => setEditingStep(null)}
          onSave={handleSaveStep}
          onDelete={editingStep.isNew ? undefined : () => handleDeleteStep(editingStep.index)}
        />
      )}
    </div>
  );
}
