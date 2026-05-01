'use client';

import { useState, useCallback } from 'react';
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
import { Plus, Trash2, GripVertical, ChevronDown, ChevronRight, ArrowRight, Info } from 'lucide-react';
import EditNodeModal from './EditNodeModal';
import type { StateMachineState, StateTransition, WorkflowStep } from '@/lib/schemas';

interface StateMachineDesignPanelProps {
  states: StateMachineState[];
  onStatesChange: (states: StateMachineState[]) => void;
  availableAgents: any[];
  availableSkills?: { name: string; description: string }[];
}

// 可拖拽的步骤行
function SortableStepRow({
  step, index, onEdit, onDelete,
}: {
  step: WorkflowStep;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(index) });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const roleIcon = step.role === 'attacker' ? 'swords' : step.role === 'judge' ? 'gavel' : 'shield';
  const roleColor = step.role === 'attacker'
    ? 'bg-red-500/10 text-red-600 border-red-200 dark:border-red-800'
    : step.role === 'judge'
    ? 'bg-yellow-500/10 text-yellow-600 border-yellow-200 dark:border-yellow-800'
    : 'bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-800';

  return (
    <div ref={setNodeRef} style={style} className={`flex items-center gap-2 p-2.5 rounded-lg border ${roleColor} group`}>
      <button {...attributes} {...listeners} className="cursor-grab text-gray-400 hover:text-gray-600 flex-shrink-0">
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="material-symbols-outlined text-sm flex-shrink-0">{roleIcon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{step.name}</div>
        <div className="text-xs text-gray-500 truncate">{step.agent}</div>
        {(step.parallelGroup || step.concurrency?.branchId || step.agentInstanceId || step.channelIds?.length || step.specTaskBinding?.taskId) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {step.parallelGroup ? <Badge variant="outline" className="text-[10px] py-0">group:{step.parallelGroup}</Badge> : null}
            {step.concurrency?.branchId ? <Badge variant="outline" className="text-[10px] py-0">branch:{step.concurrency.branchId}</Badge> : null}
            {step.agentInstanceId ? <Badge variant="outline" className="text-[10px] py-0">instance:{step.agentInstanceId}</Badge> : null}
            {step.channelIds?.length ? <Badge variant="outline" className="text-[10px] py-0">channels:{step.channelIds.length}</Badge> : null}
            {step.specTaskBinding?.taskId ? <Badge variant="outline" className="text-[10px] py-0">task:{step.specTaskBinding.taskId}</Badge> : null}
          </div>
        )}
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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

// 转移条件编辑行
function TransitionRow({
  transition, index, states, currentStateName, onChange, onDelete,
}: {
  transition: StateTransition;
  index: number;
  states: StateMachineState[];
  currentStateName: string;
  onChange: (t: StateTransition) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const otherStates = states.filter(s => s.name !== currentStateName);

  // 生成人类可读的条件描述
  const conditionSummary = () => {
    const parts: string[] = [];
    if (transition.condition.verdict) {
      const labels: Record<string, string> = { pass: '✓ 通过', conditional_pass: '△ 有条件通过', fail: '✗ 失败' };
      parts.push(labels[transition.condition.verdict] || transition.condition.verdict);
    }
    if (transition.condition.issueTypes?.length) {
      parts.push(`问题类型: ${transition.condition.issueTypes.join('/')}`);
    }
    if (transition.condition.severities?.length) {
      parts.push(`严重程度: ${transition.condition.severities.join('/')}`);
    }
    if (transition.condition.minIssueCount !== undefined) {
      parts.push(`≥${transition.condition.minIssueCount}个问题`);
    }
    return parts.length ? parts.join(' · ') : '无条件（默认）';
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* 头部：点击展开/收起 */}
      <div
        className="flex items-center gap-2 p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
        <ArrowRight className="w-4 h-4 text-blue-500 flex-shrink-0" />
        <span className="font-medium text-sm flex-shrink-0">{transition.to || '未设置'}</span>
        <span className="text-xs text-gray-500 flex-1 truncate">{conditionSummary()}</span>
        <Badge variant="outline" className="text-xs flex-shrink-0">优先级 {transition.priority}</Badge>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive flex-shrink-0"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>

      {/* 展开的编辑区 */}
      {expanded && (
        <div className="p-3 pt-0 border-t border-gray-100 dark:border-gray-800 space-y-3 bg-gray-50 dark:bg-gray-900">
          {/* 目标状态 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">跳转到</Label>
              <SingleCombobox
                value={transition.to}
                onValueChange={(v) => onChange({ ...transition, to: v })}
                options={states.map(s => ({ value: s.name, label: s.name }))}
                placeholder="选择目标状态"
                triggerClassName="h-8 text-sm"
                searchable={false}
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block">优先级（数字越小越优先）</Label>
              <Input
                type="number"
                className="h-8 text-sm"
                value={transition.priority}
                onChange={(e) => onChange({ ...transition, priority: Number(e.target.value) })}
              />
            </div>
          </div>

          {/* 触发条件说明 */}
          <div className="flex items-start gap-2 p-2 rounded bg-blue-50 dark:bg-blue-950 text-xs text-blue-700 dark:text-blue-300">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>当 Judge 输出满足以下条件时，工作流跳转到目标状态。多个条件同时满足才触发。</span>
          </div>

          {/* 裁判结果 */}
          <div>
            <Label className="text-xs mb-1.5 block">Judge 裁判结果</Label>
            <div className="flex gap-2">
              {[
                { value: 'pass', label: '通过', color: 'bg-green-100 dark:bg-green-900 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300' },
                { value: 'conditional_pass', label: '有条件通过', color: 'bg-yellow-100 dark:bg-yellow-900 border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300' },
                { value: 'fail', label: '失败', color: 'bg-red-100 dark:bg-red-900 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300' },
              ].map(opt => {
                const selected = transition.condition.verdict === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange({
                      ...transition,
                      condition: {
                        ...transition.condition,
                        verdict: selected ? undefined : opt.value as any,
                      },
                    })}
                    className={`flex-1 py-1.5 px-2 rounded border text-xs font-medium transition-all ${selected ? opt.color : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300'}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-1">不选则不限制裁判结果</p>
          </div>

          {/* 问题类型 */}
          <div>
            <Label className="text-xs mb-1.5 block">发现的问题类型（满足任意一个即触发）</Label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'design', label: '设计问题', desc: '架构/方案缺陷' },
                { value: 'implementation', label: '实现问题', desc: 'Bug/代码错误' },
                { value: 'performance', label: '性能问题', desc: '性能瓶颈/退化' },
                { value: 'security', label: '安全问题', desc: '漏洞/安全缺陷' },
                { value: 'test', label: '测试问题', desc: '测试用例失败' },
              ].map(opt => {
                const selected = transition.condition.issueTypes?.includes(opt.value as any);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    title={opt.desc}
                    onClick={() => {
                      const current = transition.condition.issueTypes || [];
                      const next = selected
                        ? current.filter(t => t !== opt.value)
                        : [...current, opt.value as any];
                      onChange({ ...transition, condition: { ...transition.condition, issueTypes: next.length ? next : undefined } });
                    }}
                    className={`px-2.5 py-1 rounded-full border text-xs transition-all ${selected ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-200 dark:border-gray-700 text-gray-600 hover:border-blue-300'}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-1">不选则不限制问题类型</p>
          </div>

          {/* 严重程度 */}
          <div>
            <Label className="text-xs mb-1.5 block">问题严重程度（满足任意一个即触发）</Label>
            <div className="flex gap-2">
              {[
                { value: 'critical', label: '严重', color: 'bg-red-500 text-white border-red-500' },
                { value: 'major', label: '主要', color: 'bg-orange-500 text-white border-orange-500' },
                { value: 'minor', label: '次要', color: 'bg-gray-500 text-white border-gray-500' },
              ].map(opt => {
                const selected = transition.condition.severities?.includes(opt.value as any);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      const current = transition.condition.severities || [];
                      const next = selected
                        ? current.filter(s => s !== opt.value)
                        : [...current, opt.value as any];
                      onChange({ ...transition, condition: { ...transition.condition, severities: next.length ? next : undefined } });
                    }}
                    className={`flex-1 py-1.5 rounded border text-xs font-medium transition-all ${selected ? opt.color : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300'}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-1">不选则不限制严重程度</p>
          </div>

          {/* 问题数量 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">最少问题数量</Label>
              <Input
                type="number"
                className="h-8 text-sm"
                placeholder="不限"
                value={transition.condition.minIssueCount ?? ''}
                onChange={(e) => onChange({
                  ...transition,
                  condition: { ...transition.condition, minIssueCount: e.target.value ? Number(e.target.value) : undefined },
                })}
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block">最多问题数量</Label>
              <Input
                type="number"
                className="h-8 text-sm"
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
      )}
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

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const selectedState = states.find(s => s.name === selectedStateName) ?? null;
  const selectedStateIndex = states.findIndex(s => s.name === selectedStateName);

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

  const handleAddTransition = () => {
    if (!selectedState) return;
    const target = states.find(s => s.name !== selectedState.name);
    const newT: StateTransition = {
      to: target?.name ?? '',
      condition: {},
      priority: ((selectedState.transitions?.length ?? 0) + 1) * 10,
    };
    updateState({ ...selectedState, transitions: [...(selectedState.transitions || []), newT] });
  };

  const handleUpdateTransition = (index: number, t: StateTransition) => {
    if (!selectedState) return;
    const transitions = (selectedState.transitions || []).map((old, i) => i === index ? t : old);
    updateState({ ...selectedState, transitions });
  };

  const handleDeleteTransition = (index: number) => {
    if (!selectedState) return;
    updateState({ ...selectedState, transitions: (selectedState.transitions || []).filter((_, i) => i !== index) });
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
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {states.map((state) => (
            <div
              key={state.name}
              onClick={() => setSelectedStateName(state.name)}
              className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm ${
                selectedStateName === state.name
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{state.name}</div>
                <div className={`text-xs ${selectedStateName === state.name ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                  {state.steps?.length ?? 0}步 · {state.transitions?.length ?? 0}转移
                </div>
              </div>
              <div className="flex gap-0.5 ml-1">
                {state.isInitial && <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" title="初始状态" />}
                {state.isFinal && <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" title="终止状态" />}
              </div>
              <Button
                size="sm" variant="ghost"
                className={`h-5 w-5 p-0 opacity-0 group-hover:opacity-100 ml-1 flex-shrink-0 ${selectedStateName === state.name ? 'hover:bg-primary-foreground/20 text-primary-foreground' : 'text-destructive hover:text-destructive'}`}
                onClick={(e) => { e.stopPropagation(); handleDeleteState(state.name); }}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* 右侧：状态详情 */}
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
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={(selectedState.steps || []).map((_, i) => String(i))} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5">
                  {(selectedState.steps || []).map((step, index) => (
                    <SortableStepRow
                      key={index}
                      step={step}
                      index={index}
                      onEdit={() => setEditingStep({ index, isNew: false })}
                      onDelete={() => handleDeleteStep(index)}
                    />
                  ))}
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
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-sm font-semibold">状态转移规则</span>
                <p className="text-xs text-muted-foreground mt-0.5">定义当前状态执行完后，满足什么条件时跳转到哪个状态</p>
              </div>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={handleAddTransition}>
                <Plus className="w-3.5 h-3.5 mr-1" />添加
              </Button>
            </div>
            <div className="space-y-2">
              {(selectedState.transitions || []).map((transition, index) => (
                <TransitionRow
                  key={index}
                  transition={transition}
                  index={index}
                  states={states}
                  currentStateName={selectedState.name}
                  onChange={(t) => handleUpdateTransition(index, t)}
                  onDelete={() => handleDeleteTransition(index)}
                />
              ))}
              {(selectedState.transitions?.length ?? 0) === 0 && (
                <div className="text-center text-sm text-muted-foreground py-6 border border-dashed border-border rounded-lg">
                  暂无转移规则，点击添加
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          请选择一个状态进行编辑
        </div>
      )}

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
