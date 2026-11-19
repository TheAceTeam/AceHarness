'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { GripVertical, Cable, Check, CircleAlert, Flag, Focus, GitBranch, Gavel, LayoutGrid, ListChecks, Minus, Play, Plus, Route, Shield, Square, Swords, Terminal, Workflow, Replace } from 'lucide-react';
import ReactFlow, {
  Background, BaseEdge, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlowProvider,
  useNodesState, useReactFlow,
  type Connection, type Edge, type EdgeProps, type Node, type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Button, buttonVariants } from '@/components/ui/button';
import { ComboboxPortalProvider } from '@/components/ui/combobox';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuPortal, ContextMenuSeparator,
  ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { StateMachineDesignPanelProps } from '@/components/StateMachineDesignPanel';
import {
  CanvasGroupInspector, CanvasScriptInspector, CanvasStateInspector, CanvasStepInspector, InspectorSelect, InspectorTitle,
  type CanvasStepKind,
} from '@/components/workflow/WorkflowCanvasInspector';
import type { StateMachineState, StateTransition, WorkflowScriptInterpreter, WorkflowStep } from '@/lib/core/schemas';
import { buildStepGroups, canvasStateContents, createDesignState, getStepParallelGroup, insertDesignStep, moveCanvasGroup, moveCanvasStep, renameStateAndReferences, withoutParallelGroup } from '@/lib/workflow/state-machine-design';
import {
  CANVAS_VERDICTS, canvasStateHeight, STATE_CARD_HEIGHT, STATE_CARD_WIDTH, canvasFallbackIndex,
  hasAdvancedTransitionFilters, layoutWorkflowStates, removeCanvasState, validateCanvasTopology,
  type CanvasIssue, type CanvasPosition, type CanvasVerdict,
} from '@/lib/workflow/state-machine-canvas';
import { cn } from '@/lib/core/utils';
import { isCanvasTextTarget } from '@/lib/workflow/canvas-shortcuts';

const GROUP_DRAG_TYPE = 'application/x-aceharness-workflow-group';
const STEP_DRAG_TYPE = 'application/x-aceharness-workflow-step';
const CANVAS_DRAG_TYPE = 'application/x-aceharness-workflow-component';
const paletteItems = [
  { tab: 'flow', kind: 'initial', label: '开始状态', icon: Play, color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  { tab: 'flow', kind: 'state', label: '普通状态', icon: Flag, color: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  { tab: 'flow', kind: 'final', label: '结束状态', icon: Square, color: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  { tab: 'agent', kind: 'parallel', label: '并发组', icon: GitBranch, color: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  { tab: 'flow', kind: 'adversarial', label: '对抗评审', icon: Swords, color: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  { tab: 'flow', kind: 'development', label: '开发实现', icon: Shield, color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  { tab: 'flow', kind: 'testing', label: '测试验收', icon: Check, color: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  { tab: 'agent', kind: 'subworkflow', label: '子工作流', icon: Workflow, color: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  { tab: 'agent', kind: 'agent', label: 'Agent 步骤', icon: ListChecks, color: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  { tab: 'agent', kind: 'defender', label: '防守步骤', icon: Shield, color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  { tab: 'agent', kind: 'attacker', label: '攻击步骤', icon: Swords, color: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  { tab: 'agent', kind: 'judge', label: '裁判步骤', icon: Gavel, color: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  { tab: 'script', kind: 'bash', label: 'Bash', icon: Terminal, color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  { tab: 'script', kind: 'shell', label: 'Shell (sh)', icon: Terminal, color: 'bg-slate-500/15 text-slate-700 dark:text-slate-300' },
  { tab: 'script', kind: 'powershell', label: 'PowerShell', icon: Terminal, color: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  { tab: 'script', kind: 'cmd', label: 'CMD', icon: Terminal, color: 'bg-slate-500/15 text-slate-700 dark:text-slate-300' },
  { tab: 'script', kind: 'python', label: 'Python', icon: Terminal, color: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
] as const;
type PaletteKind = typeof paletteItems[number]['kind'];
type StateTool = 'initial' | 'state' | 'final' | 'adversarial' | 'development' | 'testing';
const paletteTabs = [{ value: 'flow', label: '流程' }, { value: 'agent', label: '步骤' }, { value: 'script', label: '脚本' }] as const;
const isStateTool = (kind: PaletteKind): kind is StateTool => ['initial', 'state', 'final', 'adversarial', 'development', 'testing'].includes(kind);
const GROUP_WIDTH = 196;
const GROUP_HEIGHT = 116;

type CardData = {
  state: StateMachineState;
  hasErrors: boolean;
  highlighted: boolean;
  dropTarget: boolean;
  activeStepIndex?: number;
  dropFrameId?: string;
  dropInsertion?: { nodeId: string; index: number; after: boolean; frameId?: string };
  onDragStep: (index: number) => void;
  onDragGroup: (groupId: string) => void;
  onEndDrag: () => void;
  onEdit: () => void;
  onStep: (index: number) => void;
  onGroup: (groupId: string) => void;
  group?: { id: string; ownerId: string; members: Array<{ step: WorkflowStep; index: number }> };
};

type LinkData = {
  link: LinkSelection;
  script: boolean;
  lane: number;
  color: string;
  conditional: boolean;
  self: boolean;
  caption: string;
  description: string;
  onEdit: () => void;
};

type LinkSelection = { source: string; target: string; index?: number; operation?: 'add' | 'replace' };
type Selection =
  | { kind: 'state'; nodeId: string }
  | { kind: 'step'; nodeId: string; stepKind: CanvasStepKind; index?: number; role?: WorkflowStep['role']; groupId?: string }
  | { kind: 'script'; nodeId: string; interpreter: WorkflowScriptInterpreter; index?: number }
  | { kind: 'group'; nodeId: string; groupId?: string }
  | { kind: 'place-group'; position: CanvasPosition; nodeId?: string }
  | { kind: 'link'; link: LinkSelection }
  | { kind: 'checks' };
type CanvasMenuTarget =
  | { kind: 'pane'; position: CanvasPosition }
  | { kind: 'state'; nodeId: string }
  | { kind: 'step'; nodeId: string; index: number }
  | { kind: 'group'; nodeId: string; groupId: string }
  | { kind: 'link'; edgeId: string };
type DeleteRequest = { nodeId: string; stepIndex?: number };
type CanvasProps = StateMachineDesignPanelProps & {
  configFile?: string;
  onSave?: () => Promise<boolean>;
  validateDraft?: (states: StateMachineState[]) => Promise<CanvasIssue[]>;
};

function StateCard({ id, data, selected }: NodeProps<CardData>) {
  const { state, hasErrors } = data;
  const groups = canvasStateContents(state);
  return (
    <div
      data-canvas-state={id}
      style={{ width: STATE_CARD_WIDTH, minHeight: canvasStateHeight(state) }}
      className={cn(
        'rounded-xl border-2 bg-card text-card-foreground shadow-sm transition-colors hover:border-primary dark:bg-slate-900 dark:hover:border-primary',
        state.isInitial ? 'border-emerald-700 dark:border-emerald-500' : 'border-slate-400 dark:border-slate-500',
        (selected || data.highlighted) && 'ring-2 ring-primary/65 ring-offset-2 ring-offset-background',
        data.dropTarget && 'border-primary bg-primary/10 ring-4 ring-primary/25 dark:border-primary dark:bg-slate-800',
      )}
    >
      <Handle id="in-left" type="target" position={Position.Left} style={{ top: '43%' }} title="转入状态" />
      <Handle id="out-left" type="source" position={Position.Left} style={{ top: '62%' }} title="从此状态连出" />
      <Handle id="in-right" type="target" position={Position.Right} style={{ top: '43%' }} title="转入状态" />
      <Handle id="out-right" type="source" position={Position.Right} style={{ top: '62%' }} title="从此状态连出" />
      <Handle id="in-top" type="target" position={Position.Top} style={{ left: '43%' }} title="转入状态" />
      <Handle id="out-top" type="source" position={Position.Top} style={{ left: '62%' }} title="从此状态连出" />
      <Handle id="in-bottom" type="target" position={Position.Bottom} style={{ left: '43%' }} title="转入状态" />
      <Handle id="out-bottom" type="source" position={Position.Bottom} style={{ left: '62%' }} title="从此状态连出" />
      <Handle id="groups" type="source" position={Position.Bottom} isConnectable={false} style={{ left: '50%', opacity: 0 }} />
      <div className="flex h-11 items-center gap-2 border-b border-slate-200 px-3 dark:border-slate-700">
        <span className={cn(
          'grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground',
          state.isInitial && 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
        )}>
          {state.isInitial ? <Play className="size-3.5" aria-hidden /> : state.isFinal ? <Square className="size-3.5" aria-hidden /> : <Flag className="size-3.5" aria-hidden />}
        </span>
        <Button
          type="button"
          variant="ghost"
          className="nodrag block h-auto min-w-0 flex-1 truncate rounded p-0 text-left text-sm font-semibold"
          title={state.name}
          aria-label={`编辑状态 ${state.name}`}
          onClick={(event) => { event.stopPropagation(); data.onEdit(); }}
        >
          {state.name || '未命名状态'}
        </Button>
        {state.isFinal || state.isInitial ? (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {state.isFinal && state.isInitial ? '起止' : state.isFinal ? '终止' : '起点'}
          </span>
        ) : null}
        {hasErrors ? <CircleAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-label="有校验问题" /> : null}
      </div>
      <div className="space-y-1 px-2 py-1.5 text-[11px] text-muted-foreground">
        {groups.map((group) => {
          if (group.id) {
            const frameId = `parallel:${encodeURIComponent(id)}:${encodeURIComponent(group.id)}`;
            return <ParallelFrame key={group.id} id={frameId} data={{ ...data, group: { id: group.id, ownerId: id, members: group.steps }, dropTarget: data.dropFrameId === frameId }} selected={false} />;
          }
          const { step, index } = group.steps[0];
          return (
            <Button key={step.id || step.name || index} type="button" variant="ghost"
              data-canvas-step={index}
              draggable
              onDragStart={(event) => {
                event.stopPropagation();
                event.dataTransfer.setData(STEP_DRAG_TYPE, JSON.stringify({ nodeId: id, index }));
                event.dataTransfer.effectAllowed = 'move';
                data.onDragStep(index);
              }}
              onDragEnd={data.onEndDrag}
              className={cn('nodrag relative h-6 w-full cursor-grab select-none justify-start gap-1.5 rounded px-1.5 text-xs active:cursor-grabbing',
                !data.dropInsertion?.frameId && data.dropInsertion?.index === index && (data.dropInsertion.after ? 'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary' : 'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary'), index === data.activeStepIndex && 'bg-primary/15 text-primary')}
              aria-label={`编辑步骤 ${step.name}`}
              onClick={(event) => { event.stopPropagation(); data.onStep(index); }}>
              <GripVertical className="size-3 shrink-0 opacity-50" aria-hidden />
              {step.type === 'script' ? <Terminal className="size-3 shrink-0 text-primary" aria-hidden />
                : step.role === 'defender' ? <Shield className="size-3 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden />
                : step.role === 'attacker' ? <Swords className="size-3 shrink-0 text-rose-600 dark:text-rose-300" aria-hidden />
                : step.role === 'judge' ? <Gavel className="size-3 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
                : step.type === 'subworkflow'
                ? <Workflow className="size-3 shrink-0 text-violet-600 dark:text-violet-300" aria-hidden />
                : <ListChecks className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="truncate" title={step.name}>{step.name}</span>
            </Button>
          );
        })}
        <div className="flex items-center gap-2 px-1.5">
          <span>{groups.length === 0 ? '可拖入步骤和并发组' : null}</span>
          {state.requireHumanApproval ? <span>人工审查</span> : null}
          {state.reviewPolicy?.mode === 'adversarial' ? <span>对抗</span> : null}
        </div>
      </div>
    </div>
  );
}

function ParallelFrame({ id, data, selected }: Pick<NodeProps<CardData>, 'id' | 'data' | 'selected'>) {
  const group = data.group;
  if (!group) return null;
  return (
    <div data-canvas-frame={id} style={{ width: '100%', minHeight: 80 }}
      className={cn(
        'rounded-xl border-2 border-dashed border-amber-600/70 bg-amber-50 text-foreground shadow-sm dark:border-amber-500/70 dark:bg-slate-900',
        (selected || data.highlighted) && 'ring-2 ring-amber-500/50 ring-offset-2 ring-offset-background',
        data.dropTarget && 'border-solid border-primary ring-4 ring-primary/30 dark:border-primary',
        data.dropInsertion?.frameId === id && (data.dropInsertion.after ? 'relative after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:bg-primary' : 'relative before:absolute before:inset-x-0 before:-top-1 before:h-0.5 before:bg-primary'),
      )}>
      <Button type="button" variant="ghost" data-canvas-frame-title draggable
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.setData(GROUP_DRAG_TYPE, JSON.stringify({ nodeId: group.ownerId, groupId: group.id }));
          event.dataTransfer.effectAllowed = 'move';
          data.onDragGroup(group.id);
        }}
        onDragEnd={data.onEndDrag}
        className="nodrag cursor-grab select-none active:cursor-grabbing h-8 w-full justify-start gap-2 rounded-b-none border-b border-amber-500/25 px-2 text-xs"
        aria-label={`编辑并发组 ${group.members[0]?.step.name || ''}`}
        onClick={(event) => { event.stopPropagation(); data.onGroup(group.id); }}>
        <GripVertical className="size-3 shrink-0 opacity-50" aria-hidden />
        <GitBranch className="size-3.5 text-amber-700 dark:text-amber-300" aria-hidden />
        并发组
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{group.members.length} 步骤</span>
      </Button>
      <div className="space-y-1 p-1.5">
        {group.members.map(({ step, index }) => (
          <Button type="button" variant="ghost" key={step.id || step.name || index} data-canvas-step={index}
            draggable
            onDragStart={(event) => {
              event.stopPropagation();
              event.dataTransfer.setData(STEP_DRAG_TYPE, JSON.stringify({ nodeId: group.ownerId, index }));
              event.dataTransfer.effectAllowed = 'move';
              data.onDragStep(index);
            }}
            onDragEnd={data.onEndDrag}
            className={cn('nodrag relative h-6 w-full cursor-grab select-none justify-start gap-1.5 px-1.5 text-[11px] active:cursor-grabbing',
              !data.dropInsertion?.frameId && data.dropInsertion?.index === index && (data.dropInsertion.after ? 'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary' : 'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary'))} aria-label={`编辑步骤 ${step.name}`}
            onClick={(event) => { event.stopPropagation(); data.onStep(index); }}>
            <GripVertical className="size-3 shrink-0 opacity-50" aria-hidden />
            {step.type === 'subworkflow' ? <Workflow className="size-3 shrink-0 text-violet-600 dark:text-violet-300" aria-hidden />
              : <ListChecks className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="truncate">{step.name}</span>
          </Button>
        ))}
        {!group.members.length && <div className="py-3 text-center text-[11px] text-muted-foreground">拖入步骤</div>}
      </div>
    </div>
  );
}

function TransitionLink({ id, data, sourceX, sourceY, targetX, targetY, sourcePosition, markerEnd, selected }: EdgeProps<LinkData>) {
  if (!data) return null;
  const { self, lane, color } = data;
  const vertical = sourcePosition === Position.Top || sourcePosition === Position.Bottom;
  const delta = vertical ? targetY - sourceY : targetX - sourceX;
  const curve = Math.max(42, Math.abs(delta) * 0.44) * (delta < 0 ? -1 : 1);
  const rise = 58 + Math.abs(lane) * 26;
  const lift = lane * 54;
  const path = self
    ? `M ${sourceX} ${sourceY} C ${sourceX - 8} ${sourceY - rise}, ${targetX - rise} ${targetY - rise}, ${targetX} ${targetY}`
    : vertical
      ? `M ${sourceX} ${sourceY} C ${sourceX + lift} ${sourceY + curve}, ${targetX + lift} ${targetY - curve}, ${targetX} ${targetY}`
      : `M ${sourceX} ${sourceY} C ${sourceX + curve} ${sourceY + lift}, ${targetX - curve} ${targetY + lift}, ${targetX} ${targetY}`;
  const labelX = (sourceX + targetX) / 2 + (self ? -rise * 0.38 : vertical ? lift * 0.75 : 0);
  const labelY = (sourceY + targetY) / 2 + (self ? -rise * 0.72 : vertical ? 0 : lift * 0.75);
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{
        stroke: color,
        strokeWidth: selected ? 2.8 : 1.8,
        strokeDasharray: data.conditional ? '5 4' : undefined,
      }} />
      <EdgeLabelRenderer>
        <Button
          type="button"
          data-canvas-edge={id}
          variant="outline"
          className="nodrag nopan pointer-events-auto absolute block h-auto max-w-24 truncate rounded-md border-border/80 px-1.5 py-0.5 text-[10px] shadow-sm hover:border-current"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, color }}
          title={data.description}
          aria-label={`编辑连线 ${data.description}`}
          onClick={data.onEdit}
        >
          {data.caption}
        </Button>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { workflowState: StateCard };
const edgeTypes = { workflowTransition: TransitionLink };

function TransitionInspector({
  selection, states, onClose, onChange,
}: {
  selection: LinkSelection;
  states: StateMachineState[];
  onClose: () => void;
  onChange: (states: StateMachineState[]) => void;
}) {
  const [sourceName, setSourceName] = useState(selection.source);
  const [replacementIndex, setReplacementIndex] = useState('');
  const source = states.find((state) => state.name === sourceName);
  const replacing = selection.operation === 'replace' && selection.index === undefined;
  const selectedIndex = selection.index ?? (replacing && replacementIndex !== '' ? Number(replacementIndex) : undefined);
  const original = selectedIndex === undefined ? undefined : source?.transitions[selectedIndex];
  const [targetName, setTargetName] = useState(selection.target);
  const [verdict, setVerdict] = useState<CanvasVerdict | ''>(() => {
    if (original) return original.condition?.verdict ?? '';
    const source = states.find((state) => state.name === selection.source);
    return (Object.keys(CANVAS_VERDICTS) as CanvasVerdict[])
      .find((value) => source && canvasFallbackIndex(source, value) === -1) || 'pass';
  });
  const [label, setLabel] = useState(original?.label ?? '');
  const [priority, setPriority] = useState(original ? String(original.priority ?? 100) : '');
  const [filter, setFilter] = useState(original?.condition?.custom || '');
  const duplicate = verdict && !filter.trim() && source?.transitions.some((edge, index) => (
    index !== selectedIndex && edge.condition?.verdict === verdict && !hasAdvancedTransitionFilters(edge)
  ));
  const priorityDefault = verdict ? CANVAS_VERDICTS[verdict].priority : 100;
  const namedStates = states.filter((state) => state.name.trim());
  const hasUnboundVerdict = Boolean(original && !original.condition?.verdict);
  const canSave = source && !source.isFinal && states.some((state) => state.name === targetName)
    && (!replacing || Boolean(original)) && (priority === '' || Number.isFinite(Number(priority)));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!source || !canSave) return;
    const transitions = [...source.transitions];
    const condition = { ...original?.condition };
    if (filter.trim()) condition.custom = filter.trim();
    else delete condition.custom;
    if (verdict) condition.verdict = verdict;
    else delete condition.verdict;
    const next: StateTransition = {
      to: targetName,
      condition,
      label: label.trim() || undefined,
      priority: priority === '' ? priorityDefault : Number(priority),
    };
    if (selectedIndex === undefined) transitions.push(next);
    else transitions[selectedIndex] = next;
    onChange(states.map((state) => state === source ? { ...state, transitions } : state));
    onClose();
  }

  return (
    <>
        <InspectorTitle title={replacing ? '替换连线' : original ? '连线设置' : '添加连线'} onClose={onClose} />
        <form onSubmit={submit}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 px-4 py-4">
            {replacing && (
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="canvas-link-original">要替换的原连线</Label>
                <Select value={replacementIndex} onValueChange={(value) => {
                  setReplacementIndex(value);
                  const edge = source?.transitions[Number(value)];
                  if (!edge) return;
                  setVerdict(edge.condition?.verdict || '');
                  setLabel(edge.label || '');
                  setPriority(String(edge.priority ?? 100));
                  setFilter(edge.condition?.custom || '');
                }}>
                  <SelectTrigger id="canvas-link-original" className="h-auto min-h-9 text-left"><SelectValue placeholder="选择一条原连线" /></SelectTrigger>
                  <SelectContent>
                    {source?.transitions.map((edge, index) => (
                      <SelectItem key={index} value={String(index)}>
                        {index + 1}. {source.name} → {edge.to} · {edge.label || (edge.condition?.verdict ? CANVAS_VERDICTS[edge.condition.verdict].label : '流转')} · 优先级 {edge.priority ?? 100}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="canvas-link-source">起始状态</Label>
              <Select value={sourceName} onValueChange={(value) => { setSourceName(value); setReplacementIndex(''); }} disabled={selection.index !== undefined}>
                <SelectTrigger id="canvas-link-source" className="h-9"><SelectValue placeholder="选择状态" /></SelectTrigger>
                <SelectContent>
                  {namedStates.filter((state) => !state.isFinal || state.name === sourceName).map((state) => (
                    <SelectItem key={state.name} value={state.name}>{state.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="canvas-link-target">目标状态</Label>
              <Select value={targetName} onValueChange={setTargetName}>
                <SelectTrigger id="canvas-link-target" className="h-9"><SelectValue placeholder="选择状态" /></SelectTrigger>
                <SelectContent>
                  {namedStates.map((state) => <SelectItem key={state.name} value={state.name}>{state.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="canvas-link-verdict">条件</Label>
              <Select value={verdict || 'unbound'} onValueChange={(value) => setVerdict(value === 'unbound' ? '' : value as CanvasVerdict)}>
                <SelectTrigger id="canvas-link-verdict" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {hasUnboundVerdict && <SelectItem value="unbound">未绑定判定</SelectItem>}
                  {Object.entries(CANVAS_VERDICTS).map(([value, meta]) => <SelectItem key={value} value={value}>{meta.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="canvas-link-priority">优先级</Label>
              <Input id="canvas-link-priority" type="number" value={priority} placeholder={String(priorityDefault)} onChange={(event) => setPriority(event.target.value)} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="canvas-link-label">标签</Label>
              <Input id="canvas-link-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：验收失败，回到代码实现" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="canvas-link-filter">筛选表达式（可选）</Label>
              <Input id="canvas-link-filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
            </div>
            {duplicate || (replacing && original) ? (
              <p className="col-span-2 rounded-md bg-muted p-2.5 text-xs text-muted-foreground">
                {replacing && original
                  ? `替换第 ${selectedIndex! + 1} 条：${sourceName} → ${original.to}。新目标为 ${targetName}。`
                  : '该判定已有默认连线。添加后会保留原连线，重复的默认规则会在校验中标出，可设置筛选表达式区分。'}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3">
            {source && original && !replacing ? (
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => {
                onChange(states.map((state) => state === source ? {
                  ...state, transitions: state.transitions.filter((_, position) => position !== selectedIndex),
                } : state));
                onClose();
              }}>删除连线</Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>取消</Button>
              <Button type="submit" size="sm" disabled={!canSave}>{replacing ? '确认替换' : original ? '应用' : '添加连线'}</Button>
            </div>
          </div>
        </form>
    </>
  );
}

function WorkflowCanvas({ states, onStatesChange: publishStates, protocolAdopted = false, availableAgents, configFile, validateDraft, onSave }: CanvasProps) {
  const flow = useReactFlow<CardData>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const connectionDrag = useRef<{
    nodeId: string;
    handleType: 'source' | 'target';
    x: number;
    y: number;
  } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [menu, setMenu] = useState<CanvasMenuTarget | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [armedTool, setArmedTool] = useState<PaletteKind | null>(null);
  const [draggingTool, setDraggingTool] = useState<PaletteKind | null>(null);
  const [draggingStep, setDraggingStep] = useState<{ nodeId: string; index: number; stepId?: string; name: string } | null>(null);
  const [draggingGroup, setDraggingGroup] = useState<{ nodeId: string; groupId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dropInsertion, setDropInsertion] = useState<CardData['dropInsertion']>();
  const [verified, setVerified] = useState<{ states: StateMachineState[]; issues: CanvasIssue[]; error?: string } | null>(null);
  const [validating, setValidating] = useState(false);
  const history = useRef<{ past: StateMachineState[][]; future: StateMachineState[][] }>({ past: [], future: [] });
  const latestStates = useRef(states);
  const clipboard = useRef<{ text: string; states: StateMachineState[]; kind: 'state' | 'step' | 'group'; groupId?: string } | null>(null);
  latestStates.current = states;
  function onStatesChange(next: StateMachineState[]) {
    const before = latestStates.current;
    if (next === before || JSON.stringify(next) === JSON.stringify(before)) return;
    history.current.past = [...history.current.past.slice(-59), before];
    history.current.future = [];
    latestStates.current = next;
    publishStates(next);
  }
  const localIssues = useMemo(() => validateCanvasTopology(states, configFile), [states, configFile]);
  const currentCheck = verified?.states === states ? verified : null;
  const issues = useMemo(() => {
    const deduplicated = new Map<string, CanvasIssue>();
    for (const issue of [...localIssues, ...(currentCheck?.issues || [])]) deduplicated.set(issue.message, issue);
    return [...deduplicated.values()];
  }, [localIssues, currentCheck]);
  const activeNodeId = selection && 'nodeId' in selection ? selection.nodeId : null;
  const activeStepIndex = selection?.kind === 'step' || selection?.kind === 'script' ? selection.index : undefined;
  const hasErrors = useMemo(() => new Set(issues.filter((issue) => issue.severity === 'error').map((issue) => issue.stateIndex)), [issues]);
  const fallbackPositions = useMemo(() => layoutWorkflowStates(states), [states]);
  const mappedNodes = useMemo(() => states.map((state, index): Node<CardData> => {
    const id = state.id ? 'state:' + state.id : 'legacy:' + index;
    return {
      id,
      type: 'workflowState',
      position: state.position ?? fallbackPositions.get(state.name) ?? { x: 0, y: 0 },
      data: {
        state,
        hasErrors: hasErrors.has(index),
        highlighted: activeNodeId === id,
        activeStepIndex: activeNodeId === id ? activeStepIndex : undefined,
        dropFrameId: dropTarget ?? undefined,
        dropInsertion: dropInsertion?.nodeId === id ? dropInsertion : undefined,
        onDragStep: (index) => setDraggingStep({ nodeId: id, index, stepId: state.steps[index]?.id, name: state.steps[index]?.name || '' }),
        onDragGroup: (groupId) => setDraggingGroup({ nodeId: id, groupId }),
        onEndDrag: clearDrag,
        dropTarget: dropTarget === id,
        onEdit: () => selectNode(id),
        onStep: (stepIndex) => {
          if (armedTool) selectNode(id);
          else openStep(id, state, stepIndex);
        },
        onGroup: (groupId) => {
          if (armedTool) selectNode(id);
          else setSelection({ kind: 'group', nodeId: id, groupId });
        },
      },
      ariaLabel: state.name,
    };
  }), [states, fallbackPositions, hasErrors, activeNodeId, activeStepIndex, dropTarget, dropInsertion, armedTool]);
  const frameNodes = useMemo(() => mappedNodes.flatMap((owner) => {
    const state = owner.data.state;
    const groups = canvasStateContents(state).filter((group) => group.id);
    return groups.map((group, index): Node<CardData> => {
      const groupId = group.id!;
      const id = `parallel:${encodeURIComponent(owner.id)}:${encodeURIComponent(groupId)}`;
      return {
        id,
        type: 'parallelFrame',
        position: state.parallelGroupPositions?.[groupId] ?? {
          x: owner.position.x + (STATE_CARD_WIDTH - GROUP_WIDTH) / 2,
          y: owner.position.y + STATE_CARD_HEIGHT + 38 + index * (GROUP_HEIGHT + 24),
        },
        connectable: false,
        ariaLabel: `${state.name}的并发组`,
        data: {
          ...owner.data,
          group: { id: groupId, ownerId: owner.id, members: group.steps },
          dropTarget: dropTarget === id,
          highlighted: selection?.kind === 'group' && selection.nodeId === owner.id && selection.groupId === groupId,
          onStep: (stepIndex) => {
            if (armedTool) selectNode(id);
            else openStep(owner.id, state, stepIndex);
          },
          onGroup: () => {
            if (armedTool) selectNode(id);
            else setSelection({ kind: 'group', nodeId: owner.id, groupId });
          },
        },
      };
    });
  }), [mappedNodes, dropTarget, selection, armedTool]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CardData>(mappedNodes);
  useEffect(() => {
    setNodes((previous) => {
      const existing = new Map(previous.map((node) => [node.id, node]));
      return mappedNodes.map((node) => ({ ...existing.get(node.id), ...node }));
    });
  }, [mappedNodes, setNodes]);
  // Positions and selection can be transient while dragging; step data always comes from the latest draft.
  const visibleNodes = useMemo(() => {
    const transient = new Map(nodes.map((node) => [node.id, node]));
    return mappedNodes.map((node) => {
      const previous = transient.get(node.id);
      return { ...previous, ...node, position: previous?.dragging ? previous.position : node.position };
    });
  }, [mappedNodes, nodes]);
  const activeState = mappedNodes.find((node) => node.id === activeNodeId)?.data.state;
  function copyCanvasSelection(target: Selection | null = selection) {
    const nodeId = target && 'nodeId' in target ? target.nodeId : undefined;
    const source = mappedNodes.find((node) => node.id === nodeId)?.data.state;
    if (!source) return;
    const snapshot = JSON.parse(JSON.stringify(source)) as StateMachineState;
    const kind = target?.kind === 'step' || target?.kind === 'script' ? 'step' : target?.kind === 'group' ? 'group' : 'state';
    const groupId = target?.kind === 'group' ? target.groupId : undefined;
    if (kind === 'step' && (target?.kind === 'step' || target?.kind === 'script')) {
      snapshot.steps = target.index === undefined ? [] : snapshot.steps.slice(target.index, target.index + 1);
    } else if (kind === 'group') snapshot.steps = snapshot.steps.filter((step) => getStepParallelGroup(step) === groupId);
    const text = JSON.stringify({ aceharnessCanvas: 1, kind, states: [snapshot] });
    clipboard.current = { text, states: [snapshot], kind, groupId };
    return text;
  }

  function pasteCanvasSelection(nodeId = activeNodeId, targetGroupId?: string, position?: CanvasPosition) {
    const payload = clipboard.current;
    if (!payload) return;
    const current = latestStates.current;
    if (payload.kind !== 'state') {
      const source = payload.states[0];
      const targetIndex = mappedNodes.findIndex((node) => node.id === nodeId);
      if (targetIndex < 0) return;
      let destination = current[targetIndex];
      const grouped = payload.kind === 'group';
      const groupId = grouped ? 'parallel-' + crypto.randomUUID() : targetGroupId;
      if (grouped && groupId) {
        const metadata = source.parallelGroups?.find((group) => group.id === payload.groupId);
        destination = { ...destination, parallelGroups: [...(destination.parallelGroups || []), {
          id: groupId, name: metadata?.name || '并发组', joinPolicy: metadata?.joinPolicy || { mode: 'all' },
        }] };
      }
      if (groupId && source.steps.some((step) => step.type === 'script')) return;
      let lastIndex = -1;
      for (const original of source.steps) {
        const step = JSON.parse(JSON.stringify(original)) as WorkflowStep;
        let name = original.name + ' 副本';
        let suffix = 2;
        while (destination.steps.some((item) => item.name === name)) name = original.name + ' 副本 ' + suffix++;
        const ungrouped = withoutParallelGroup({ ...step, name });
        destination = insertDesignStep(destination, ungrouped, groupId);
        lastIndex = destination.steps.findIndex((item) => item.name === name);
      }
      onStatesChange(current.map((state, index) => index === targetIndex ? destination : state));
      const pastedNodeId = mappedNodes[targetIndex].id;
      if (groupId) setSelection({ kind: 'group', nodeId: pastedNodeId, groupId });
      else if (lastIndex >= 0) openStep(pastedNodeId, destination, lastIndex);
      return;
    }
    const copies = payload.states.map((source) => {
      const copy = JSON.parse(JSON.stringify(source)) as StateMachineState;
      let name = source.name + ' 副本';
      let suffix = 2;
      while (current.some((state) => state.name === name)) name = source.name + ' 副本 ' + suffix++;
      const groups = new Map(canvasStateContents(copy).filter((group) => group.id).map((group) => [group.id!, 'parallel-' + crypto.randomUUID()]));
      copy.id = crypto.randomUUID();
      copy.name = name;
      copy.isInitial = false;
      copy.position = position ?? { x: (source.position?.x ?? 0) + 36, y: (source.position?.y ?? 0) + 36 };
      copy.parallelGroups = copy.parallelGroups?.map((group) => ({ ...group, id: groups.get(group.id)! }));
      copy.steps = copy.steps.map((step) => {
        const groupId = groups.get(getStepParallelGroup(step));
        return {
          ...step, id: crypto.randomUUID(), agentInstanceId: step.agentInstanceId ? crypto.randomUUID() : undefined,
          parallelGroup: groupId,
          concurrency: step.concurrency ? { ...step.concurrency, groupId, branchId: groupId ? crypto.randomUUID() : undefined } : undefined,
          ...(step.script?.onFailure.action === 'transition' && step.script.onFailure.target === source.name
            ? { script: { ...step.script, onFailure: { action: 'transition' as const, target: name } } } : {}),
        };
      });
      copy.transitions = copy.transitions.map((edge) => ({ ...edge, to: edge.to === source.name ? name : edge.to }));
      return copy;
    });
    onStatesChange([...current, ...copies]);
    setSelection({ kind: 'state', nodeId: 'state:' + copies[0].id });
  }

  function copyFromMenu(target: Selection) {
    const text = copyCanvasSelection(target);
    if (text) void navigator.clipboard?.writeText(text).catch(() => { /* The canvas clipboard also works without OS clipboard permission. */ });
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function textFocused(event: Event) {
      return event.composedPath().some((target) => isCanvasTextTarget(target as EventTarget))
        || isCanvasTextTarget(canvas!.ownerDocument.activeElement);
    }
    function focused(event: Event) {
      return canvas!.contains(canvas!.ownerDocument.activeElement) && !textFocused(event);
    }
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || !focused(event)) return;
      const key = event.key.toLowerCase();
      if (key === 's' && onSave) {
        event.preventDefault();
        event.stopPropagation();
        void onSave();
      } else if (key === 'z' || key === 'y') {
        const redo = key === 'y' || event.shiftKey;
        const stack = redo ? history.current.future : history.current.past;
        const snapshot = stack.at(-1);
        if (!snapshot) return;
        event.preventDefault();
        event.stopPropagation();
        stack.pop();
        (redo ? history.current.past : history.current.future).push(latestStates.current);
        latestStates.current = snapshot;
        publishStates(snapshot);
        setSelection(null);
      }
    }
    function copy(event: ClipboardEvent) {
      if (!focused(event) || !event.clipboardData) return;
      const text = copyCanvasSelection();
      if (!text) return;
      event.preventDefault();
      event.stopPropagation();
      event.clipboardData.setData('text/plain', text);
    }
    function paste(event: ClipboardEvent) {
      if (!focused(event) || !clipboard.current || !event.clipboardData) return;
      if (event.clipboardData.getData('text/plain') !== clipboard.current.text) return;
      event.preventDefault();
      event.stopPropagation();
      const targetGroupId = selection?.kind === 'group' ? selection.groupId
        : activeStepIndex === undefined ? undefined : getStepParallelGroup(activeState?.steps[activeStepIndex]);
      pasteCanvasSelection(activeNodeId, targetGroupId);
    }
    window.addEventListener('keydown', keydown, true);
    canvas.addEventListener('copy', copy);
    canvas.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      canvas.removeEventListener('copy', copy);
      canvas.removeEventListener('paste', paste);
    };
  }, [activeState, states, selection, onSave, publishStates]);
  const fitAfterLayout = useRef(false);
  useEffect(() => {
    if (!fitAfterLayout.current) return;
    const frame = window.requestAnimationFrame(() => {
      fitAfterLayout.current = false;
      void flow.fitView({ padding: 0.22, maxZoom: 1, duration: 220 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [nodes, flow]);

  const edges = useMemo((): Edge<LinkData>[] => {
    const stateNodes = visibleNodes.filter((node) => !node.data.group);
    const byName = new Map(stateNodes.map((node) => [node.data.state.name, node]));
    const lanes = new Map<string, number>();
    return stateNodes.flatMap((source) => {
      const state = source.data.state;
      const configured = state.transitions.map((transition, index) => ({
        to: transition.to, label: transition.label, verdict: transition.condition?.verdict, index, script: false,
      }));
      const scripted = state.steps.flatMap((step, index) => {
        const failure = step.type === 'script' ? step.script?.onFailure : undefined;
        return failure?.action === 'transition'
          ? [{ to: failure.target, label: `${step.name}失败`, verdict: 'fail' as const, index, script: true }]
          : [];
      });
      return [...configured, ...scripted].flatMap((transition) => {
      const { index, verdict } = transition;
      const target = byName.get(transition.to);
      if (!target) return [];
      const self = source.id === target.id;
      const dx = target.position.x - source.position.x;
      const dy = target.position.y - source.position.y;
      const vertical = Math.abs(dy) > Math.abs(dx) && Math.abs(dy) >= STATE_CARD_HEIGHT;
      const exit = self ? 'top' : vertical ? (dy > 0 ? 'bottom' : 'top') : (dx >= 0 ? 'right' : 'left');
      const entry = self ? 'left' : vertical ? (dy > 0 ? 'top' : 'bottom') : (dx >= 0 ? 'left' : 'right');
      const pair = JSON.stringify([source.id, target.id].sort());
      const counter = lanes.get(pair) ?? 0;
      lanes.set(pair, counter + 1);
      const lane = self ? counter : (counter % 2 === 0 ? -1 : 1) * Math.ceil(counter / 2);
      const color = verdict ? CANVAS_VERDICTS[verdict].color : 'var(--canvas-neutral)';
      const caption = transition.label || (verdict ? CANVAS_VERDICTS[verdict].label : '流转');
      const description = `${source.data.state.name} → ${target.data.state.name} · ${caption}`;
      return [{
        id: `${source.id}:${transition.script ? 'script:' : ''}${index}`,
        source: source.id,
        target: target.id,
        sourceHandle: 'out-' + exit,
        targetHandle: 'in-' + entry,
        type: 'workflowTransition',
        markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color },
        data: {
          link: { source: state.name, target: target.data.state.name, index },
          script: transition.script,
          lane, color, caption, description, self,
          conditional: verdict === 'fail' || verdict === 'conditional_pass',
          onEdit: () => {
            if (transition.script) openStep(source.id, state, index);
            else setSelection({ kind: 'link', link: { source: state.name, target: target.data.state.name, index } });
          },
        },
      }];
      });
    });
  }, [visibleNodes]);
  function openLink(connection?: Pick<Connection, 'source' | 'target'>, operation: 'add' | 'replace' = 'add') {
    const source = connection
      ? mappedNodes.find((node) => node.id === connection.source)?.data.state
      : (activeState && !activeState.isFinal ? activeState : states.find((state) => !state.isFinal));
    const target = connection
      ? mappedNodes.find((node) => node.id === connection.target)?.data.state
      : states.find((state) => state.name !== source?.name) || source;
    if (source && target && !source.isFinal) setSelection({ kind: 'link', link: { source: source.name, target: target.name, operation } });
  }

  function nodeUnderPointer(x: number, y: number) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const card = canvas.ownerDocument.elementsFromPoint(x, y)
      .map((element) => element.closest('[data-canvas-state], [data-canvas-frame]'))
      .find((element) => element && canvas.contains(element));
    return card?.getAttribute('data-canvas-state') || card?.getAttribute('data-canvas-frame') || null;
  }

  function connectOnCardDrop(event: MouseEvent | TouchEvent) {
    const drag = connectionDrag.current;
    connectionDrag.current = null;
    const canvas = canvasRef.current;
    if (!drag || !canvas || event.type === 'touchcancel') return;
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    if (!point || Math.hypot(point.clientX - drag.x, point.clientY - drag.y) < 6) return;

    const droppedNodeId = nodeUnderPointer(point.clientX, point.clientY);
    if (!droppedNodeId) return;

    openLink(drag.handleType === 'source'
      ? { source: drag.nodeId, target: droppedNodeId }
      : { source: droppedNodeId, target: drag.nodeId });
  }

  function addState(position?: CanvasPosition, kind: StateTool = 'state') {
    const last = mappedNodes.at(-1)?.position;
    const next = position ?? (last ? { x: last.x + STATE_CARD_WIDTH + 100, y: last.y } : { x: 0, y: 0 });
    const state = createDesignState(states, protocolAdopted);
    const base = kind === 'initial' ? '开始' : kind === 'final' ? '结束'
      : kind === 'adversarial' ? '对抗评审' : kind === 'development' ? '开发实现' : kind === 'testing' ? '测试验收' : state.name;
    let name = base;
    let suffix = 2;
    while (states.some((item) => item.name === name)) name = base + suffix++;
    const isInitial = kind === 'initial' || (kind === 'state' && !states.length);
    const current = isInitial ? states.map((item) => item.isInitial ? { ...item, isInitial: false } : item) : states;
    const template = kind === 'adversarial' || kind === 'development' || kind === 'testing';
    const agent = availableAgents.find((item) => item.roleType !== 'supervisor' && item.team !== 'black-gold')?.name || '';
    const steps: WorkflowStep[] = kind === 'adversarial' ? [
      { id: crypto.randomUUID(), name: '防守实现', type: 'agent', agent, task: '依据需求完成实现，提供变更说明和验证结果。', role: 'defender', agentInstanceId: crypto.randomUUID() },
      { id: crypto.randomUUID(), name: '攻击审查', type: 'agent', agent, task: '独立检查实现，复现边界问题并提供证据。', role: 'attacker', agentInstanceId: crypto.randomUUID() },
      { id: crypto.randomUUID(), name: '裁判裁决', type: 'agent', agent, task: '依据需求和执行证据裁决，输出 pass、conditional_pass 或 fail。', role: 'judge', agentInstanceId: crypto.randomUUID() },
    ] : template ? [{
      id: crypto.randomUUID(), name: kind === 'development' ? '防守开发' : '防守测试', type: 'agent', agent,
      role: 'defender', task: kind === 'development'
        ? '依据需求实现代码并验证，输出变更、验证结果和判定结论。'
        : '依据规格验证正常场景和边界场景，记录复现步骤、证据和判定结论。',
    }] : [];
    onStatesChange([...current, {
      ...state, name, isInitial, isFinal: kind === 'final', position: next,
      ...(template ? {
        steps,
        reviewPolicy: { mode: kind === 'adversarial' ? 'adversarial' as const : 'standard' as const, source: 'user' as const, locked: false, confidence: 'high' as const, riskSignals: [], rationale: '从状态模板创建。' },
      } : {}),
    }]);
    setSelection({ kind: 'state', nodeId: 'state:' + state.id });
    if (!position) void flow.setCenter(next.x + STATE_CARD_WIDTH / 2, next.y + STATE_CARD_HEIGHT / 2, {
      zoom: flow.getZoom(), duration: 200,
    });
  }

  function openStep(nodeId: string, state: StateMachineState, index: number) {
    const step = state.steps[index];
    if (!step) return;
    if (step.type === 'script') setSelection({ kind: 'script', nodeId, index, interpreter: step.script?.interpreter || 'shell' });
    else setSelection({ kind: 'step', nodeId, index, stepKind: step.type === 'subworkflow' ? 'subworkflow' : 'agent' });
  }

  function placeInside(kind: Exclude<PaletteKind, StateTool>, nodeId: string, insertBefore?: number) {
    const node = [...mappedNodes, ...frameNodes].find((item) => item.id === nodeId);
    if (!node) return;
    const state = node.data.state;
    const group = node.data.group;
    const ownerId = group?.ownerId ?? nodeId;
    if (kind === 'parallel') {
      if (group) return;
      const groupId = 'parallel-' + crypto.randomUUID();
      const next = { ...state, parallelGroups: [...(state.parallelGroups || []), {
        id: groupId, name: '并发组', joinPolicy: { mode: 'all' as const }, insertBefore,
      }] };
      onStatesChange(states.map((item) => item === state ? next : item));
      setSelection({ kind: 'group', nodeId: ownerId, groupId });
      setArmedTool(null);
      return;
    }
    const meta = paletteItems.find((item) => item.kind === kind);
    if (!meta || (group && !['agent', 'defender', 'attacker', 'judge', 'subworkflow'].includes(kind))) return;
    const base = meta.tab === 'script' ? meta.label + ' 脚本' : meta.label;
    let name: string = base;
    let suffix = 2;
    while (state.steps.some((step) => step.name === name)) name = base + ' ' + suffix++;
    const step: WorkflowStep = { name, agent: '', task: '' };
    if (kind === 'subworkflow') step.type = 'subworkflow';
    else if (kind === 'agent' || kind === 'defender' || kind === 'attacker' || kind === 'judge') {
      step.type = 'agent';
      if (kind !== 'agent') step.role = kind;
    } else {
      if (state.reviewPolicy?.mode === 'adversarial') {
        setSelection({ kind: 'script', nodeId: ownerId, interpreter: kind });
        setArmedTool(null);
        return;
      }
      step.type = 'script';
      step.script = { interpreter: kind, source: '', timeoutMs: 120000, onFailure: { action: 'stop' } };
    }
    const next = insertDesignStep(state, step, group?.id, insertBefore);
    const index = next.steps.findIndex((item) => item.name === name);
    onStatesChange(states.map((item) => item === state ? next : item));
    openStep(ownerId, next, index);
    setArmedTool(null);
  }

  function selectNode(nodeId: string) {
    if (armedTool && !isStateTool(armedTool)) placeInside(armedTool, nodeId);
    else {
      const group = frameNodes.find((node) => node.id === nodeId)?.data.group;
      setSelection(group ? { kind: 'group', nodeId: group.ownerId, groupId: group.id } : { kind: 'state', nodeId });
    }
  }

  function addStateAtPoint(x: number, y: number, kind: StateTool) {
    const position = flow.screenToFlowPosition({ x, y });
    addState({ x: Math.round(position.x - STATE_CARD_WIDTH / 2), y: Math.round(position.y - STATE_CARD_HEIGHT / 2) }, kind);
    setArmedTool(null);
  }

  function placeGroup(position: CanvasPosition) {
    setSelection({
      kind: 'place-group',
      position: { x: Math.round(position.x - GROUP_WIDTH / 2), y: Math.round(position.y - GROUP_HEIGHT / 2) },
      nodeId: activeNodeId ?? mappedNodes.find((node) => node.data.state.steps.length > 1)?.id ?? mappedNodes[0]?.id,
    });
    setArmedTool(null);
  }

  function clearDrag() {
    setDraggingTool(null);
    setDraggingStep(null);
    setDraggingGroup(null);
    setDropTarget(null);
    setDropInsertion(undefined);
  }

  // Hit-test ordered slots, including the gaps between rows and whole parallel groups.
  function insertionAt(x: number, y: number, enterGroup: boolean) {
    const canvas = canvasRef.current;
    const targetId = nodeUnderPointer(x, y);
    const target = [...mappedNodes, ...frameNodes].find((node) => node.id === targetId);
    if (!target || !canvas) return null;
    const nodeId = target.data.group?.ownerId ?? target.id;
    const owner = mappedNodes.find((node) => node.id === nodeId);
    if (!owner) return null;
    const card = [...canvas.querySelectorAll<HTMLElement>('[data-canvas-state]')].find((element) => element.dataset.canvasState === nodeId);
    if (!card) return null;
    const targetIndex = mappedNodes.indexOf(owner);
    const contents = canvasStateContents(owner.data.state);
    const groupId = enterGroup ? target.data.group?.id : undefined;
    const group = groupId ? contents.find((group) => group.id === groupId) : undefined;
    const slots = group ? group.steps.map(({ index }) => ({ index, end: index + 1,
      element: card.querySelector<HTMLElement>(`[data-canvas-step="${index}"]`), frameId: undefined as string | undefined,
    })) : contents.map((item) => {
      const frameId = item.id ? `parallel:${encodeURIComponent(nodeId)}:${encodeURIComponent(item.id)}` : undefined;
      const element = frameId ? [...card.querySelectorAll<HTMLElement>('[data-canvas-frame]')].find((element) => element.dataset.canvasFrame === frameId)
        : card.querySelector<HTMLElement>(`[data-canvas-step="${item.startIndex}"]`);
      return { index: item.startIndex, end: item.steps.at(-1) ? item.steps.at(-1)!.index + 1 : item.startIndex, element, frameId };
    });
    const next = slots.find((slot) => slot.element && y < slot.element.getBoundingClientRect().top + slot.element.getBoundingClientRect().height / 2);
    const anchor = next ?? slots.at(-1);
    const before = next ? next.index : anchor?.end ?? group?.startIndex ?? 0;
    const insertion = anchor ? { nodeId, index: anchor.index, after: !next, frameId: anchor.frameId } : undefined;
    return { targetId: groupId ? targetId! : nodeId, nodeId, targetIndex, groupId, before, insertion };
  }

  function movingDropAt(x: number, y: number) {
    const location = insertionAt(x, y, !draggingGroup);
    if (!location) return null;
    const sourceIndex = mappedNodes.findIndex((node) => node.id === (draggingGroup?.nodeId ?? draggingStep?.nodeId));
    if (sourceIndex < 0) return null;
    const stepIndex = draggingStep ? states[sourceIndex].steps.findIndex((step) => draggingStep.stepId
      ? step.id === draggingStep.stepId : step.name === draggingStep.name) : -1;
    const next = draggingGroup ? moveCanvasGroup(states, sourceIndex, draggingGroup.groupId, location.targetIndex, location.before)
      : stepIndex >= 0 ? moveCanvasStep(states, sourceIndex, stepIndex, location.targetIndex, location.groupId, location.before) : states;
    return { ...location, sourceIndex, next };
  }

  function dropComponent(event: DragEvent) {
    if ((draggingStep && event.dataTransfer.types.includes(STEP_DRAG_TYPE)) || (draggingGroup && event.dataTransfer.types.includes(GROUP_DRAG_TYPE))) {
      event.preventDefault();
      const drop = movingDropAt(event.clientX, event.clientY);
      if (drop && drop.next !== states) {
        onStatesChange(drop.next);
        if (draggingGroup) {
          const destination = drop.next[drop.targetIndex];
          setSelection({ kind: 'group', nodeId: drop.nodeId, groupId: destination.parallelGroups?.at(-1)?.id });
        } else if (draggingStep) {
          const movedIndex = drop.next[drop.targetIndex].steps.findIndex((step) => !states[drop.targetIndex].steps.includes(step));
          if (movedIndex >= 0) openStep(drop.nodeId, drop.next[drop.targetIndex], movedIndex);
        }
      }
      clearDrag();
      return;
    }
    if (!event.dataTransfer.types.includes(CANVAS_DRAG_TYPE)) return;
    event.preventDefault();
    const kind = paletteItems.find((item) => item.kind === event.dataTransfer.getData(CANVAS_DRAG_TYPE))?.kind;
    const target = nodeUnderPointer(event.clientX, event.clientY);
    const location = insertionAt(event.clientX, event.clientY, kind !== 'parallel');
    clearDrag();
    if (kind && isStateTool(kind) && !target) addStateAtPoint(event.clientX, event.clientY, kind);
    else if (kind === 'parallel' && !target) placeGroup(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    else if (kind && !isStateTool(kind) && location) placeInside(kind, location.targetId, location.before);
  }

  function updateDragTarget(event: DragEvent) {
    if ((draggingStep && event.dataTransfer.types.includes(STEP_DRAG_TYPE)) || (draggingGroup && event.dataTransfer.types.includes(GROUP_DRAG_TYPE))) {
      const drop = movingDropAt(event.clientX, event.clientY);
      const valid = Boolean(drop && drop.next !== states);
      if (valid) event.preventDefault();
      event.dataTransfer.dropEffect = valid ? 'move' : 'none';
      setDropTarget(valid ? drop!.targetId : null);
      setDropInsertion(valid ? drop!.insertion : undefined);
      return;
    }
    if (!draggingTool || !event.dataTransfer.types.includes(CANVAS_DRAG_TYPE)) return;
    const hovered = nodeUnderPointer(event.clientX, event.clientY);
    const location = insertionAt(event.clientX, event.clientY, draggingTool !== 'parallel');
    const valid = isStateTool(draggingTool) ? !hovered : draggingTool === 'parallel' || Boolean(
      location && (!location.groupId || ['agent', 'defender', 'attacker', 'judge', 'subworkflow'].includes(draggingTool)),
    );
    if (valid) event.preventDefault();
    event.dataTransfer.dropEffect = valid ? 'copy' : 'none';
    setDropTarget(valid && !isStateTool(draggingTool) ? location?.targetId ?? null : null);
    setDropInsertion(valid && !isStateTool(draggingTool) ? location?.insertion : undefined);
  }

  function savePositions(moved: Node<CardData>[]) {
    const positionOf = (node: Node<CardData>) => ({ x: Math.round(node.position.x), y: Math.round(node.position.y) });
    const positions = new Map(moved.filter((node) => !node.data.group).map((node) => [node.data.state.name, positionOf(node)]));
    const groupPositions = new Map<string, Record<string, CanvasPosition>>();
    for (const node of moved) {
    const group = node.data.group;
      if (!group) continue;
      const stateName = node.data.state.name;
      groupPositions.set(stateName, { ...groupPositions.get(stateName), [group.id]: positionOf(node) });
    }
    onStatesChange(states.map((state) => {
      const position = positions.get(state.name);
      const frames = groupPositions.get(state.name);
      if (!frames && (!position || (state.position?.x === position.x && state.position.y === position.y))) return state;
      return {
        ...state, position: position ?? state.position,
        ...(frames ? { parallelGroupPositions: { ...state.parallelGroupPositions, ...frames } } : {}),
      };
    }));
  }

  function updateState(next: StateMachineState) {
    if (!activeState) return;
    const renamed = next.name === activeState.name ? states : renameStateAndReferences(states, activeState.name, next.name);
    onStatesChange(renamed.map((state, index) => states[index] === activeState
      ? { ...next, transitions: state.transitions }
      : next.isInitial && state.isInitial ? { ...state, isInitial: false } : state));
  }

  function inspectIssue(issue: CanvasIssue) {
    const node = issue.stateIndex === undefined ? undefined : mappedNodes[issue.stateIndex];
    if (!node) return;
    const state = node.data.state;
    const transition = issue.transitionIndex === undefined ? undefined : state.transitions[issue.transitionIndex];
    if (transition) setSelection({ kind: 'link', link: { source: state.name, target: transition.to, index: issue.transitionIndex } });
    else if (issue.stepIndex !== undefined) openStep(node.id, state, issue.stepIndex);
    else setSelection({ kind: 'state', nodeId: node.id });
    void flow.setCenter(node.position.x + STATE_CARD_WIDTH / 2, node.position.y + STATE_CARD_HEIGHT / 2, { zoom: flow.getZoom(), duration: 220 });
  }

  async function runValidation() {
    setSelection({ kind: 'checks' });
    if (!validateDraft) return;
    setValidating(true);
    try {
      setVerified({ states, issues: await validateDraft(states) });
    } catch (error) {
      setVerified({ states, issues: [], error: error instanceof Error ? error.message : '工作流校验失败' });
    } finally {
      setValidating(false);
    }
  }

  function rememberMenuTarget(event: ReactMouseEvent<HTMLDivElement>) {
    const element = event.target instanceof Element ? event.target : null;
    const frame = element?.closest('[data-canvas-frame]');
    const card = element?.closest('[data-canvas-state]');
    const id = frame?.getAttribute('data-canvas-frame') || card?.getAttribute('data-canvas-state');
    if (id) {
      const group = frameNodes.find((node) => node.id === id)?.data.group;
      const step = element?.closest('[data-canvas-step]')?.getAttribute('data-canvas-step');
      if (step !== undefined && step !== null) setMenu({ kind: 'step', nodeId: group?.ownerId ?? id, index: Number(step) });
      else if (group) setMenu({ kind: 'group', nodeId: group.ownerId, groupId: group.id });
      else setMenu({ kind: 'state', nodeId: id });
      return;
    }
    const edgeId = element?.closest('[data-canvas-edge]')?.getAttribute('data-canvas-edge')
      || element?.closest('.react-flow__edge')?.getAttribute('data-testid')?.replace(/^rf__edge-/, '');
    if (edgeId) setMenu({ kind: 'link', edgeId });
    else setMenu({ kind: 'pane', position: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
  }

  function deleteSelection() {
    if (!deleteRequest) return;
    const node = mappedNodes.find((item) => item.id === deleteRequest.nodeId);
    setDeleteRequest(null);
    if (!node) return;
    const state = node.data.state;
    if (deleteRequest.stepIndex === undefined) {
      if (state.isInitial || states.length < 2) return;
      onStatesChange(removeCanvasState(states, state.name));
      setSelection(null);
      return;
    }
    const step = state.steps[deleteRequest.stepIndex];
    if (!step || isProtectedStep(state, step)) return;
    const group = getStepParallelGroup(step);
    const steps = state.steps.filter((_, index) => index !== deleteRequest.stepIndex);
    const singleton = group && !state.parallelGroups?.some((item) => item.id === group)
      && steps.filter((item) => getStepParallelGroup(item) === group).length === 1;
    const updated = singleton ? steps.map((item) => getStepParallelGroup(item) === group ? withoutParallelGroup(item) : item) : steps;
    onStatesChange(states.map((item) => item === state ? { ...state, steps: updated } : item));
    setSelection({ kind: 'state', nodeId: node.id });
  }

  function isProtectedStep(state: StateMachineState, step: WorkflowStep) {
    return Boolean(state.reviewPolicy?.locked && (
      step.provenance?.origin === 'review-policy' || step.provenance?.managedRole === 'standard-closer'
    ));
  }

  function fitCanvas() {
    void flow.fitView({ padding: 0.22, maxZoom: 1, duration: 220 });
  }

  function arrangeCanvas() {
    fitAfterLayout.current = true;
    onStatesChange(states.map((state) => ({ ...state, position: fallbackPositions.get(state.name), parallelGroupPositions: undefined })));
  }

  function canPasteInto(groupId?: string) {
    const payload = clipboard.current;
    if (!payload) return false;
    return !groupId || (payload.kind === 'step' && payload.states[0].steps.every((step) => (
      step.type !== 'script'
    )));
  }

  function renderMenuItems() {
    if (!menu) return null;
    if (menu.kind === 'pane') return (
      <>
        <ContextMenuLabel>画布</ContextMenuLabel>
        <ContextMenuItem disabled={clipboard.current?.kind !== 'state'} onSelect={() => pasteCanvasSelection(null, undefined, menu.position)}>粘贴状态</ContextMenuItem>
        <ContextMenuSeparator />
        {paletteItems.filter((item) => isStateTool(item.kind)).map(({ kind, label, icon: Icon }) => (
          <ContextMenuItem key={kind} className="gap-2" onSelect={() => {
            if (!isStateTool(kind)) return;
            addState({ x: Math.round(menu.position.x - STATE_CARD_WIDTH / 2), y: Math.round(menu.position.y - STATE_CARD_HEIGHT / 2) }, kind);
          }}>
            <Icon className="size-3.5" aria-hidden /> 新建{label}
          </ContextMenuItem>
        ))}
        <ContextMenuItem className="gap-2" onSelect={() => placeGroup(menu.position)}><GitBranch className="size-3.5" aria-hidden /> 新建并发组</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={arrangeCanvas} disabled={!states.length}>自动布局</ContextMenuItem>
        <ContextMenuItem onSelect={fitCanvas}>适应画布</ContextMenuItem>
        <ContextMenuItem onSelect={() => void runValidation()}>校验工作流</ContextMenuItem>
      </>
    );
    if (menu.kind === 'link') {
      const edge = edges.find((item) => item.id === menu.edgeId)?.data;
      if (!edge) return null;
      return (
        <>
          <ContextMenuLabel>连线</ContextMenuLabel>
          <ContextMenuItem onSelect={edge.onEdit}>{edge.script ? '打开脚本属性' : '编辑连线'}</ContextMenuItem>
          {!edge.script && <ContextMenuItem className="text-destructive" onSelect={() => {
            onStatesChange(states.map((state) => state.name === edge.link.source ? {
              ...state, transitions: state.transitions.filter((_, index) => index !== edge.link.index),
            } : state));
            setSelection(null);
          }}>删除连线</ContextMenuItem>}
        </>
      );
    }
    const owner = mappedNodes.find((node) => node.id === menu.nodeId);
    if (!owner) return null;
    const state = owner.data.state;
    if (menu.kind === 'step') {
      const step = state.steps[menu.index];
      if (!step) return null;
      return (
        <>
          <ContextMenuLabel className="max-w-56 truncate">{step.name}</ContextMenuLabel>
          <ContextMenuItem onSelect={() => openStep(owner.id, state, menu.index)}>编辑步骤</ContextMenuItem>
          <ContextMenuItem onSelect={() => copyFromMenu({ kind: 'step', nodeId: owner.id, index: menu.index, stepKind: 'agent' })}>复制步骤</ContextMenuItem>
          <ContextMenuItem disabled={!canPasteInto(getStepParallelGroup(step))} onSelect={() => pasteCanvasSelection(owner.id, getStepParallelGroup(step))}>粘贴</ContextMenuItem>
          <ContextMenuSeparator />
          {getStepParallelGroup(step) && <ContextMenuItem onSelect={() => setSelection({
            kind: 'group', nodeId: owner.id, groupId: getStepParallelGroup(step),
          })}>查看并发组</ContextMenuItem>}
          <ContextMenuItem disabled={isProtectedStep(state, step)} className="text-destructive"
            onSelect={() => setDeleteRequest({ nodeId: owner.id, stepIndex: menu.index })}>删除步骤</ContextMenuItem>
        </>
      );
    }
    if (menu.kind === 'group') {
      const frame = frameNodes.find((node) => node.data.group?.id === menu.groupId && node.data.group.ownerId === owner.id);
      return (
        <>
          <ContextMenuLabel>并发组</ContextMenuLabel>
          <ContextMenuItem onSelect={() => copyFromMenu({ kind: 'group', nodeId: owner.id, groupId: menu.groupId })}>复制并发组</ContextMenuItem>
          <ContextMenuItem disabled={!canPasteInto(menu.groupId)} onSelect={() => pasteCanvasSelection(owner.id, menu.groupId)}>粘贴</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => setSelection({ kind: 'group', nodeId: owner.id, groupId: menu.groupId })}>编辑并发组</ContextMenuItem>
          <ContextMenuItem onSelect={() => { if (frame) placeInside('agent', frame.id); }}>添加 Agent 步骤</ContextMenuItem>
          <ContextMenuItem onSelect={() => { if (frame) placeInside('subworkflow', frame.id); }}>添加子工作流</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => {
            const positions = { ...state.parallelGroupPositions };
            delete positions[menu.groupId];
            onStatesChange(states.map((item) => item === state ? {
              ...state, parallelGroupPositions: positions,
              parallelGroups: state.parallelGroups?.filter((group) => group.id !== menu.groupId),
              steps: state.steps.map((step) => getStepParallelGroup(step) === menu.groupId ? withoutParallelGroup(step) : step),
            } : item));
            setSelection({ kind: 'state', nodeId: owner.id });
          }}>解散并发组</ContextMenuItem>
        </>
      );
    }
    return (
      <>
        <ContextMenuLabel className="max-w-56 truncate">{state.name}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => setSelection({ kind: 'state', nodeId: owner.id })}>编辑状态</ContextMenuItem>
        <ContextMenuItem onSelect={() => copyFromMenu({ kind: 'state', nodeId: owner.id })}>复制状态</ContextMenuItem>
        <ContextMenuItem disabled={!canPasteInto()} onSelect={() => pasteCanvasSelection(owner.id)}>粘贴</ContextMenuItem>
        <ContextMenuSeparator />
        {(['agent', 'script'] as const).map((tab) => (
          <ContextMenuSub key={tab}>
            <ContextMenuSubTrigger>{tab === 'agent' ? '添加步骤' : '添加脚本'}</ContextMenuSubTrigger>
            <ContextMenuPortal>
              <ContextMenuSubContent className="z-[70]">
                {paletteItems.filter((item) => item.tab === tab).map(({ kind, label, icon: Icon }) => (
                  <ContextMenuItem key={kind} className="gap-2" onSelect={() => {
                    if (!isStateTool(kind)) placeInside(kind, owner.id);
                  }}><Icon className="size-3.5" aria-hidden /> {label}</ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuPortal>
          </ContextMenuSub>
        ))}
        <ContextMenuItem onSelect={() => placeInside('parallel', owner.id)}>创建并发组</ContextMenuItem>
        <ContextMenuItem disabled={state.isFinal} onSelect={() => {
          const target = mappedNodes.find((node) => node.id !== owner.id);
          openLink({ source: owner.id, target: target?.id ?? owner.id });
        }}>从此状态添加连线</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={state.isInitial} onSelect={() => {
          onStatesChange(states.map((item) => ({ ...item, isInitial: item === state })));
        }}>设为开始状态</ContextMenuItem>
        <ContextMenuItem onSelect={() => {
          onStatesChange(states.map((item) => item === state ? { ...state, isFinal: !state.isFinal } : item));
        }}>{state.isFinal ? '取消结束状态' : '设为结束状态'}</ContextMenuItem>
        <ContextMenuItem className="text-destructive" disabled={state.isInitial || states.length < 2}
          onSelect={() => setDeleteRequest({ nodeId: owner.id })}>删除状态</ContextMenuItem>
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/20 p-3 sm:p-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-300 bg-card shadow-sm dark:border-slate-700 lg:flex-row">
        <aside aria-label="组件库" className="shrink-0 border-b bg-muted/15 px-3 py-2 lg:w-52 lg:border-b-0 lg:border-r lg:py-4 xl:w-60">
          <h3 className="mb-3 hidden px-1 text-sm font-semibold lg:block">组件库</h3>
          <Tabs defaultValue="flow" onValueChange={() => setArmedTool(null)}>
            <TabsList className="grid h-8 w-full grid-cols-3">
              {paletteTabs.map(({ value, label }) => <TabsTrigger key={value} value={value} className="h-6 px-1.5 text-[11px]">{label}</TabsTrigger>)}
            </TabsList>
            {paletteTabs.map(({ value }) => (
              <TabsContent key={value} value={value} className="mt-2 lg:mt-3">
                <div className="grid grid-cols-5 gap-1.5 lg:grid-cols-2 lg:gap-2">
                  {paletteItems.filter((item) => item.tab === value).map(({ kind, label, icon: Icon, color }) => (
                    <Button key={kind} type="button" variant={armedTool === kind ? 'secondary' : 'outline'}
                      className="group h-12 min-w-0 cursor-grab flex-col gap-1 rounded-lg px-1 text-[10px] active:cursor-grabbing lg:h-[76px] lg:gap-2 lg:text-xs"
                      draggable aria-pressed={armedTool === kind}
                      title={isStateTool(kind) ? '拖到画布空白处' : '拖到状态卡片'}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(CANVAS_DRAG_TYPE, kind);
                        event.dataTransfer.effectAllowed = 'copy';
                        setArmedTool(null);
                        setDraggingTool(kind);
                      }}
                      onDragEnd={clearDrag}
                      onClick={(event) => {
                        if (isStateTool(kind) && event.detail === 0) addState(undefined, kind);
                        else setArmedTool(armedTool === kind ? null : kind);
                      }}
                    >
                      <span className={cn('grid size-5 shrink-0 place-items-center rounded-md lg:size-8 lg:rounded-lg', color)}>
                        <Icon className="size-3 lg:size-4" aria-hidden />
                      </span>
                      <span className="max-w-full truncate">{label}</span>
                    </Button>
                  ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>
          <p className="mt-4 hidden border-t px-1 pt-3 text-xs leading-5 text-muted-foreground lg:block">拖到画布，也可以点选组件后放置。</p>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div role="toolbar" aria-label="画布工具栏" className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" title="新增连线"
              disabled={!states.some((state) => !state.isFinal)} onClick={() => openLink()}>
              <Cable className="size-3.5" aria-hidden />新增连线
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5 text-xs"
              disabled={!states.some((state) => !state.isFinal && state.transitions.length > 0)}
              onClick={() => openLink(undefined, 'replace')}>
              <Replace className="size-3.5" aria-hidden />替换连线
            </Button>
            <div className="mx-1 h-5 w-px bg-border" />
            <Button type="button" variant="ghost" size="icon" className="size-8" title="自动布局" aria-label="自动布局"
              disabled={!states.length} onClick={arrangeCanvas}>
              <LayoutGrid className="size-4" />
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void runValidation()}>
            {issues.length ? <CircleAlert className="size-3.5 text-amber-600 dark:text-amber-400" /> : <Check className="size-3.5 text-emerald-600" />}
            {issues.length ? `${issues.length} 项待检查` : '校验工作流'}
          </Button>
        </div>
        <ContextMenu>
        <ContextMenuTrigger asChild>
        <div
          ref={canvasRef}
          tabIndex={0}
          onPointerDownCapture={(event) => {
            if (!isCanvasTextTarget(event.target)) event.currentTarget.focus({ preventScroll: true });
          }}
          className="relative min-h-0 flex-1 bg-background [--canvas-pass:#207356] [--canvas-conditional:#966021] [--canvas-fail:#b74b64] [--canvas-neutral:#596d88] dark:[--canvas-pass:#64c7a1] dark:[--canvas-conditional:#e0ad73] dark:[--canvas-fail:#ed93a6] dark:[--canvas-neutral:#a5b8d3] [&_.react-flow__handle]:size-2.5 [&_.react-flow__handle]:border-background [&_.react-flow__handle]:bg-muted-foreground [&_.react-flow__handle.source]:bg-primary"
          onDragOver={updateDragTarget}
          onDragLeave={(event) => {
            if (!(event.relatedTarget instanceof globalThis.Node) || !event.currentTarget.contains(event.relatedTarget)) { setDropTarget(null); setDropInsertion(undefined); }
          }}
          onDrop={dropComponent}
          onContextMenu={rememberMenuTarget}
        >
          <ReactFlow
            aria-label="工作流编排画布"
            nodes={visibleNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_, node) => selectNode(node.id)}
            onPaneClick={(event) => {
              if (armedTool && isStateTool(armedTool)) addStateAtPoint(event.clientX, event.clientY, armedTool);
              else if (armedTool === 'parallel') placeGroup(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
              else if (!armedTool) setSelection(null);
            }}
            onNodeDragStop={(_, node, moved) => savePositions(moved?.length ? moved : [node])}
            onSelectionDragStop={(_, moved) => savePositions(moved)}
            onEdgeClick={(_, edge) => edge.data?.onEdit()}
            onConnectStart={(event, { nodeId, handleType }) => {
              const point = 'changedTouches' in event ? event.changedTouches[0] : event;
              connectionDrag.current = nodeId && handleType && point
                ? { nodeId, handleType, x: point.clientX, y: point.clientY }
                : null;
            }}
            onConnect={(connection) => {
              connectionDrag.current = null;
              openLink(connection);
            }}
            onConnectEnd={connectOnCardDrop}
            isValidConnection={(connection) => Boolean(mappedNodes.find((node) => node.id === connection.source && !node.data.state.isFinal)
              && mappedNodes.find((node) => node.id === connection.target))}
            fitView
            fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
            minZoom={0.18}
            maxZoom={1.8}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} color="hsl(var(--muted-foreground) / 0.32)" />
          </ReactFlow>
          {(armedTool || draggingTool) && (
            <div role="status" className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-primary/30 bg-card px-3 py-1.5 text-xs text-primary shadow-sm">
              {(armedTool || draggingTool) === 'parallel' ? '将并发组放到画布上' : isStateTool((armedTool || draggingTool)!)
                ? '将状态放到画布空白处' : '选择一个状态或可接纳该步骤的并发组'}
            </div>
          )}
          {!nodes.length ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="pointer-events-auto rounded-xl border bg-card px-8 py-6 text-center shadow-sm">
                <Route className="mx-auto mb-3 size-5 text-muted-foreground" />
                <div className="text-sm font-semibold">从一个状态开始</div>
                <Button type="button" size="sm" className="mt-3" onClick={() => addState()}>添加状态</Button>
              </div>
            </div>
          ) : null}
          <div className="absolute bottom-3 left-3 z-10 inline-flex items-center gap-0.5 rounded-lg border bg-card p-0.5 shadow-sm">
            <Button variant="ghost" size="icon" className="size-7" title="缩小" aria-label="缩小" onClick={() => void flow.zoomOut({ duration: 160 })}><Minus className="size-4" /></Button>
            <Button variant="ghost" size="icon" className="size-7" title="放大" aria-label="放大" onClick={() => void flow.zoomIn({ duration: 160 })}><Plus className="size-4" /></Button>
            <Button variant="ghost" size="icon" className="size-7" title="适应画布" aria-label="适应画布" onClick={fitCanvas}><Focus className="size-4" /></Button>
          </div>
        </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="z-[70] w-48">{renderMenuItems()}</ContextMenuContent>
        </ContextMenu>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t px-3 py-2 text-[11px] text-muted-foreground">
          <span>{states.length} 个状态 · {frameNodes.length} 个并发组 · {edges.length} 条连线</span>
          <span>从端口拖到状态可连线 · 点选后在右侧编辑</span>
        </div>
        </div>


        <aside
          aria-label="属性面板"
          className={cn('max-h-[44%] min-w-0 shrink-0 overflow-auto border-t bg-card lg:max-h-none lg:w-72 lg:border-l lg:border-t-0 xl:w-80', !selection && 'hidden lg:block')}
        >
          {!selection && (
            <div className="px-4 py-4">
              <h3 className="text-sm font-semibold">属性</h3>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">选择状态、步骤、并发组或连线查看设置。</p>
            </div>
          )}
          {selection?.kind === 'state' && activeState && (
            <>
              <InspectorTitle title="状态设置" detail={activeState.name} onClose={() => setSelection(null)} />
              <CanvasStateInspector
                key={activeNodeId}
                state={activeState}
                states={states}
                onSave={updateState}
                onStep={(index) => openStep(selection.nodeId, activeState, index)}
                onAdd={() => placeInside('agent', selection.nodeId)}
                onGroup={() => placeInside('parallel', selection.nodeId)}
              >
                <Button size="sm" variant="ghost" className="text-destructive" disabled={states.length < 2 || activeState.isInitial}
                  onClick={() => setDeleteRequest({ nodeId: selection.nodeId })}>删除状态</Button>
              </CanvasStateInspector>
            </>
          )}
          {selection?.kind === 'step' && activeState && (
            <>
              <InspectorTitle
                title={selection.index === undefined
                  ? selection.stepKind === 'subworkflow' ? '添加子工作流'
                    : selection.role ? `添加${paletteItems.find((item) => item.kind === selection.role)?.label}` : '添加 Agent 步骤'
                  : '步骤设置'}
                detail={activeState.name}
                onClose={() => setSelection({ kind: 'state', nodeId: selection.nodeId })}
              />
              <CanvasStepInspector
                key={selection.nodeId + ':' + selection.stepKind + ':' + selection.index}
                state={activeState}
                index={selection.index}
                kind={selection.stepKind}
                role={selection.role}
                agents={availableAgents}
                configFile={configFile}
                onSave={updateState}
                onNavigate={(index) => {
                  if (index === undefined) setSelection({ kind: 'state', nodeId: selection.nodeId });
                  else openStep(selection.nodeId, activeState, index);
                }}
              />
            </>
          )}
          {selection?.kind === 'script' && activeState && (
            <>
              <InspectorTitle title={selection.index === undefined ? '添加脚本步骤' : '脚本设置'} detail={activeState.name}
                onClose={() => setSelection({ kind: 'state', nodeId: selection.nodeId })} />
              <CanvasScriptInspector key={selection.nodeId + ':' + selection.interpreter + ':' + selection.index}
                state={activeState} states={states} interpreter={selection.interpreter} index={selection.index}
                onSave={(next) => {
                  updateState(next);
                  setSelection({ kind: 'state', nodeId: selection.nodeId });
                }} />
            </>
          )}
          {selection?.kind === 'group' && activeState && (
            <>
              <InspectorTitle title={selection.groupId ? '并发组设置' : '添加并发组'} detail={activeState.name}
                onClose={() => setSelection({ kind: 'state', nodeId: selection.nodeId })} />
              <CanvasGroupInspector key={selection.nodeId + ':' + selection.groupId} state={activeState} groupId={selection.groupId}
                onSave={(state) => {
                  updateState(state);
                  setSelection({ kind: 'state', nodeId: selection.nodeId });
                }}
                onStep={(index) => openStep(selection.nodeId, activeState, index)} />
            </>
          )}
          {selection?.kind === 'place-group' && (
            <>
              <InspectorTitle title="添加并发组" onClose={() => setSelection(null)} />
              <div className="px-4 pt-4">
                <InspectorSelect label="所属状态" value={selection.nodeId ?? ''}
                  options={mappedNodes.map((node) => ({ value: node.id, label: node.data.state.name }))}
                  onChange={(nodeId) => setSelection({ ...selection, nodeId })} />
              </div>
              {activeState && (
                <CanvasGroupInspector key={selection.nodeId} state={activeState}
                  onSave={(next) => {
                    const prior = new Set(activeState.steps.map(getStepParallelGroup));
                    const groupId = next.steps.map(getStepParallelGroup).find((id) => id && !prior.has(id));
                    if (!groupId || !selection.nodeId) return;
                    updateState({ ...next, parallelGroupPositions: { ...next.parallelGroupPositions, [groupId]: selection.position } });
                    setSelection({ kind: 'group', nodeId: selection.nodeId, groupId });
                  }}
                  onStep={() => {}} />
              )}
            </>
          )}
          {selection?.kind === 'link' && (
            <TransitionInspector key={JSON.stringify(selection.link)} selection={selection.link}
              states={states} onChange={onStatesChange} onClose={() => setSelection(null)} />
          )}
          {selection?.kind === 'checks' && (
            <>
              <InspectorTitle title="工作流校验" onClose={() => setSelection(null)} />
              <div className="space-y-3 px-4 py-4">
                {validating ? <p role="status" className="text-xs text-muted-foreground">正在校验运行配置…</p> : null}
                {currentCheck?.error ? <p role="alert" className="text-xs text-destructive">{currentCheck.error}</p> : null}
                {!issues.length && <p className="text-xs leading-5 text-muted-foreground">{currentCheck && !currentCheck.error ? '画布和运行配置校验通过。' : '画布结构校验通过。'}</p>}
                {issues.map((issue) => (
                  <Button
                    key={issue.message}
                    variant="outline"
                    className="h-auto w-full justify-start gap-2 whitespace-normal px-2.5 py-2 text-left text-xs leading-5"
                    onClick={() => inspectIssue(issue)}
                    disabled={issue.stateIndex === undefined}
                  >
                    <CircleAlert className={cn('size-3.5 shrink-0', issue.severity === 'error' ? 'text-destructive' : 'text-amber-500')} aria-hidden />
                    {issue.message}
                  </Button>
                ))}
                {validateDraft ? <Button variant="outline" size="sm" onClick={() => void runValidation()} disabled={validating}>重新校验</Button> : null}
              </div>
            </>
          )}
        </aside>
      </div>
      <AlertDialog open={Boolean(deleteRequest)} onOpenChange={(open) => { if (!open) setDeleteRequest(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteRequest?.stepIndex === undefined ? '删除状态' : '删除步骤'}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRequest?.stepIndex === undefined ? '将从当前草稿移除该状态及其连线。' : '将从当前草稿移除该步骤。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className={buttonVariants({ variant: 'destructive' })} onClick={deleteSelection}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function StateMachineGraphPanel(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <ComboboxPortalProvider><WorkflowCanvas {...props} /></ComboboxPortalProvider>
    </ReactFlowProvider>
  );
}
