'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { ResizablePanelGroup, ResizablePanel } from '@/components/ui/resizable';
import { useDefaultLayout } from 'react-resizable-panels';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { ComboboxPortalProvider, SingleCombobox } from '@/components/ui/combobox';
import SpriteAvatar from '@/components/SpriteAvatar';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';
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
import LightweightWorkflowDesignPanel, {
  hasLightweightWorkflowTopology,
  type LightweightWorkflowDesignMetadata,
} from './LightweightWorkflowDesignPanel';
import type { ReviewPolicy, StateMachineState, StateTransition, WorkflowStep } from '@/lib/core/schemas';
import { useWorkflowConfigQuery } from '@/client/query/configs';
import { useSaveConfigMutation } from '@/client/query/workflow-mutations';
import { renameStateAndReferences } from '@/lib/workflow/state-machine-design';
import { isWorkflowStepSelectableAgent } from '@/lib/agent/catalog';
import {
  defaultMaxSelfTransitions,
  hashReviewStep,
  hashReviewState,
  reconcileReviewPolicy,
  type ReviewPolicyOperation,
} from '@/lib/workflow/state-review-policy';

interface StateMachineDesignPanelProps {
  states: StateMachineState[];
  onStatesChange: (states: StateMachineState[]) => void;
  availableAgents: any[];
  availableSkills?: { name: string; description: string }[];
  specTasks?: { id: string; title: string; phaseTitle?: string; ownerAgents?: string[] }[];
  onOptimizeState?: (
    stateIndex: number,
    presetInstruction?: string,
    reviewPolicyOnly?: boolean,
    unlockForAi?: boolean,
  ) => void;
  onOptimizeStep?: (stateIndex: number, stepIndex: number) => void;
  onAgentSkillsChange?: (agentName: string, skills: string[]) => void | Promise<void>;
  lightweightMetadata?: LightweightWorkflowDesignMetadata;
  /** Whether this workflow runs state-level review. Pre-protocol workflows do not. */
  protocolAdopted?: boolean;
  /** Adopt the protocol for every non-final state at once. Absent hides the entry. */
  onAdoptReviewProtocol?: (states: StateMachineState[]) => void;
}

type SubworkflowDrilldownState = {
  parentStep: WorkflowStep;
  parentStateName?: string;
  parentStepIndex?: number;
  configFile: string;
  loading: boolean;
  saving: boolean;
  error?: string;
  config?: any;
};

type StepGroup = {
  id?: string;
  startIndex: number;
  steps: Array<{ step: WorkflowStep; index: number }>;
};

type ReviewPolicyCandidate = {
  stateId?: string;
  stateName: string;
  targetMode: 'standard' | 'adversarial';
  targetPolicy: ReviewPolicy;
  nextState: StateMachineState;
  operations: ReviewPolicyOperation[];
  warnings: string[];
  blocked: boolean;
  unsafeDeleteRepairSignature?: string;
};

export type ReviewProtocolAdoptionPreview = {
  targetCount: number;
  nextStates: StateMachineState[];
  operations: ReviewPolicyOperation[];
  warnings: string[];
  blocked: boolean;
};

export function buildReviewProtocolAdoptionPreview(
  states: StateMachineState[],
  executableAgentNames: string[],
  idFactory: () => string = () => crypto.randomUUID(),
): ReviewProtocolAdoptionPreview | null {
  const targets = states.filter((state) => !state.isFinal);
  if (targets.length === 0) return null;
  const operations: ReviewPolicyOperation[] = [];
  const warnings: string[] = [];
  let blocked = false;
  const nextStates = states.map((state) => {
    if (state.isFinal) return state;
    const targetPolicy = state.reviewPolicy ?? {
      mode: 'standard',
      source: 'default',
      locked: false,
      confidence: 'medium',
      riskSignals: [],
      rationale: '启用状态级审查时按标准模式建立基线，可逐状态调整。',
    } satisfies ReviewPolicy;
    const result = reconcileReviewPolicy(state, targetPolicy, {
      availableAgents: executableAgentNames,
      fallbackAgent: executableAgentNames[0],
      idFactory,
    });
    if (result.blocked) {
      blocked = true;
      warnings.push(...result.warnings.map((warning) => `${state.name}: ${warning}`));
      return state;
    }
    operations.push(...result.operations);
    warnings.push(...result.warnings.map((warning) => `${state.name}: ${warning}`));
    return result.nextState;
  });
  return { targetCount: targets.length, nextStates, operations, warnings, blocked };
}

function isReviewStructureStep(step: WorkflowStep | undefined): boolean {
  return Boolean(step && (
    step.role
    || step.provenance?.origin === 'review-policy'
    || step.provenance?.managedRole === 'standard-closer'
  ));
}

/**
 * What the two modes mean in the terms the person choosing actually cares about:
 * who judges this state, and what that costs. The mode names stay `标准`/`对抗`
 * because they are also the step names, rationale wording and prompt vocabulary
 * that get persisted into workflow configs — renaming only the buttons would put
 * the panel out of step with everything the engine writes.
 */
const REVIEW_MODE_OPTIONS = [
  {
    mode: 'standard' as const,
    name: '标准',
    who: '执行者自己给结论',
    cost: '不额外增加步骤，最省',
  },
  {
    mode: 'adversarial' as const,
    name: '对抗',
    who: '另派 2 个 Agent 挑错并裁决',
    cost: '新增「对抗审查」「独立裁决」两步，约 3 倍开销',
  },
];

/**
 * A low-confidence standard policy is silently upgraded to adversarial, and the
 * only trace is this sentence appended to the rationale. Matching it lets the
 * panel say so outright instead of leaving the user to wonder why the mode they
 * picked is not the mode they got.
 */
function isForcedAdversarialRationale(rationale: string | undefined): boolean {
  return String(rationale || '').includes('判断把握不足，按保守规则采用对抗模式');
}

function getReviewOperationFieldChanges(operation: ReviewPolicyOperation): Array<{ label: string; before: string; after: string }> {
  const fields: Array<{ key: keyof WorkflowStep; label: string }> = [
    { key: 'role', label: '角色' },
    { key: 'agent', label: 'Agent' },
    { key: 'agentInstanceId', label: '实例' },
    { key: 'parallelGroup', label: '并发组' },
    { key: 'concurrency', label: '汇合' },
    { key: 'task', label: '任务' },
  ];
  const compact = (value: unknown) => {
    const raw = value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—');
    const text = raw.replace(/\s+/g, ' ').trim() || '—';
    return text.length > 96 ? `${text.slice(0, 96)}…` : text;
  };
  return fields.flatMap(({ key, label }) => {
    const before = compact(operation.before?.[key]);
    const after = compact(operation.after?.[key]);
    return before === after ? [] : [{ label, before, after }];
  });
}

function getAgentTeamTone(team?: string) {
  if (team === 'red') return { ring: 'ring-red-400/40' };
  if (team === 'judge') return { ring: 'ring-amber-400/40' };
  if (team === 'black-gold') return { ring: 'ring-yellow-400/40' };
  return { ring: 'ring-blue-400/40' };
}

function findAgentConfig(agents: any[] | undefined, agentName: string) {
  const normalized = agentName.trim();
  if (!normalized) return undefined;
  return agents?.find((agent) => agent?.name === normalized);
}

function StepAgentBadge({ step, availableAgents }: { step: WorkflowStep; availableAgents?: any[] }) {
  if (step.type === 'subworkflow') {
    return (
      <span className="inline-flex min-w-0 max-w-[220px] items-center gap-1.5">
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <span className="material-symbols-outlined text-[12px]">account_tree</span>
        </span>
        <span className="truncate">子工作流</span>
      </span>
    );
  }
  const name = step.agent?.trim() || '未分配 Agent';
  const agent = findAgentConfig(availableAgents, name);
  const tone = getAgentTeamTone(agent?.team);
  const avatarSrc = resolveAgentAvatarSrc(agent?.avatar, name, {
    team: agent?.team,
    roleType: agent?.roleType,
  });

  return (
    <span className="inline-flex min-w-0 max-w-[180px] items-center gap-1.5">
      <SpriteAvatar
        avatar={avatarSrc}
        seed={name}
        category="agent-default"
        alt={name}
        fallback={name.charAt(0).toUpperCase()}
        className={`h-4 w-4 shrink-0 ring-1 ${tone.ring}`}
        fallbackClassName="bg-primary/10 text-[10px] font-semibold text-primary"
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

function getStepSpecTaskIds(step: WorkflowStep): string[] {
  return Array.from(new Set([
    ...((step.specTaskBinding?.taskIds || []) as string[]),
    step.specTaskBinding?.taskId,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function MergeIntoParallelIcon({ direction }: { direction: 'previous' | 'next' }) {
  const arrow = direction === 'previous' ? 'keyboard_arrow_up' : 'keyboard_arrow_down';
  const arrowPosition = direction === 'previous' ? '-top-1' : '-bottom-1';
  return (
    <span className="relative inline-flex h-4 w-4 items-center justify-center">
      <span className="material-symbols-outlined text-[15px] leading-none">call_merge</span>
      <span className={`material-symbols-outlined absolute -right-1 ${arrowPosition} rounded-full bg-background text-[10px] leading-none`}>
        {arrow}
      </span>
    </span>
  );
}

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
const ISSUE_TYPE_OPTIONS = [
  { value: 'design', label: '设计问题', desc: '架构/方案缺陷' },
  { value: 'implementation', label: '实现问题', desc: 'Bug/代码错误' },
  { value: 'performance', label: '性能问题', desc: '性能瓶颈/退化' },
  { value: 'security', label: '安全问题', desc: '漏洞/安全缺陷' },
  { value: 'test', label: '测试问题', desc: '测试用例失败' },
] as const;
const SEVERITY_OPTIONS = [
  { value: 'critical', label: '严重' },
  { value: 'major', label: '主要' },
  { value: 'minor', label: '次要' },
] as const;

const getStepParallelGroup = (step?: WorkflowStep) => step?.parallelGroup || step?.concurrency?.groupId || '';

const getStepJoinPolicyMode = (step?: WorkflowStep) => step?.concurrency?.joinPolicy?.mode || 'all';

const getStepJoinPolicyQuorum = (step?: WorkflowStep) => step?.concurrency?.joinPolicy?.quorum;

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

export function buildWorkflowStepFromEditData(data: any, existingStep?: WorkflowStep | null): WorkflowStep {
  const normalizedConstraints = Array.isArray(data.constraints)
    ? data.constraints.filter((c: string) => typeof c === 'string' && c.trim())
    : typeof data.constraints === 'string'
      ? data.constraints.split('\n').filter((c: string) => c.trim())
      : undefined;
  const normalizedSkills: string[] | undefined = Array.isArray(data.skills)
    ? Array.from(new Set<string>(
        data.skills
          .filter((skill: unknown): skill is string => typeof skill === 'string')
          .map((skill: string) => skill.trim())
          .filter(Boolean),
      ))
    : undefined;
  const newStep: WorkflowStep = data.type === 'subworkflow'
    ? {
        ...(existingStep || {}),
        name: data.name,
        type: 'subworkflow',
        workflow: data.workflow,
        subworkflow: data.subworkflow,
        inputs: data.inputs,
        role: data.role ?? existingStep?.role,
        parallelGroup: data.parallelGroup,
        concurrency: data.concurrency,
        agentInstanceId: data.agentInstanceId ?? existingStep?.agentInstanceId,
        channelIds: data.channelIds,
        specTaskBinding: data.specTaskBinding,
      } as WorkflowStep
    : ({
        ...(existingStep || {}),
        name: data.name,
        agent: data.agent,
        task: data.task,
        role: data.role ?? existingStep?.role,
        constraints: normalizedConstraints,
        enableReviewPanel: data.enableReviewPanel,
        parallelGroup: data.parallelGroup,
        concurrency: data.concurrency,
        agentInstanceId: data.agentInstanceId ?? existingStep?.agentInstanceId,
        channelIds: data.channelIds,
        specTaskBinding: data.specTaskBinding,
        ...(normalizedSkills !== undefined ? { skills: normalizedSkills } : {}),
      } as WorkflowStep);
  if (data.type === 'subworkflow') {
    delete (newStep as any).agent;
    delete (newStep as any).task;
    delete (newStep as any).constraints;
    delete (newStep as any).enableReviewPanel;
    delete (newStep as any).preCommands;
    delete (newStep as any).skills;
  }
  if (data.type !== 'subworkflow' && Array.isArray(data.preCommands) && data.preCommands.length > 0) {
    newStep.preCommands = data.preCommands;
  } else if (data.type !== 'subworkflow' && Array.isArray(existingStep?.preCommands) && existingStep.preCommands.length > 0) {
    newStep.preCommands = existingStep.preCommands;
  }
  return newStep;
}

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
    const existing = transitions.find((transition) => (
      transition.condition?.verdict === preset.verdict
      && !hasAdvancedTransitionFilters(transition)
    ));
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

function hasAdvancedTransitionFilters(transition?: StateTransition | null): boolean {
  if (!transition) return false;
  return Boolean(
    transition.condition?.issueTypes?.length
    || transition.condition?.severities?.length
    || transition.condition?.minIssueCount !== undefined
    || transition.condition?.maxIssueCount !== undefined
    || transition.condition?.custom?.trim()
  );
}

function getAdvancedVerdictTransitions(verdict: VerdictTransition, transitions: StateTransition[] = []): StateTransition[] {
  let consumedFallback = false;
  return transitions.filter((transition) => {
    if (transition.condition?.verdict !== verdict) {
      return false;
    }
    if (!hasAdvancedTransitionFilters(transition) && !consumedFallback) {
      consumedFallback = true;
      return false;
    }
    return true;
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
    const fallbackMatches = matches.filter((transition) => !hasAdvancedTransitionFilters(transition));
    if (fallbackMatches.length === 0) {
      errors.push(`${verdict} 缺少兜底路径`);
      continue;
    }
    if (fallbackMatches.length > 1) {
      errors.push(`${verdict} 存在多条兜底路径`);
    }
    if (!fallbackMatches[0]?.to?.trim()) {
      errors.push(`${verdict} 未设置目标状态`);
    } else if (!stateNames.has(fallbackMatches[0].to)) {
      errors.push(`${verdict} 指向不存在的状态`);
    }
    matches.filter((transition) => hasAdvancedTransitionFilters(transition)).forEach((transition, index) => {
      if (!transition.to?.trim()) {
        errors.push(`${verdict} 高级规则 ${index + 1} 未设置目标状态`);
      } else if (!stateNames.has(transition.to)) {
        errors.push(`${verdict} 高级规则 ${index + 1} 指向不存在的状态`);
      }
    });
  }

  const nonVerdictTransitions = transitions.filter((transition) => !REQUIRED_VERDICTS.includes(transition.condition?.verdict as VerdictTransition));
  if (nonVerdictTransitions.length > 0) {
    errors.push('存在未绑定 verdict 的转移');
  }

  return errors;
}

// 可拖拽的步骤行
function SortableStepRow({
  step, index, availableAgents, isParallel = false, canGroupPrevious, canGroupNext, structureLocked = false, dragLocked = false, editLocked = false, onEdit, onDelete, onGroupWithPrevious, onGroupWithNext, onUngroup, onSpecTaskClick, onOptimize, onPreviewSubworkflow,
}: {
  step: WorkflowStep;
  index: number;
  availableAgents?: any[];
  isParallel?: boolean;
  canGroupPrevious?: boolean;
  canGroupNext?: boolean;
  structureLocked?: boolean;
  dragLocked?: boolean;
  editLocked?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onGroupWithPrevious?: () => void;
  onGroupWithNext?: () => void;
  onUngroup?: () => void;
  onSpecTaskClick?: () => void;
  onOptimize?: () => void;
  onPreviewSubworkflow?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(index), disabled: dragLocked });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const agentTeam = findAgentConfig(availableAgents, step.agent || '')?.team;
  const isSubworkflow = step.type === 'subworkflow';
  const childConfigFile = step.workflow || step.subworkflow?.configFile || '';
  const roleIcon = isSubworkflow ? 'account_tree' : agentTeam === 'blue' ? 'swords' : agentTeam === 'judge' ? 'gavel' : agentTeam === 'red' ? 'shield' : 'radio_button_unchecked';
  const roleColor = isSubworkflow
    ? 'bg-cyan-500/10 text-cyan-700 border-cyan-200 dark:border-cyan-800 dark:text-cyan-200'
    : agentTeam === 'blue'
    ? 'bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-800'
    : agentTeam === 'judge'
    ? 'bg-yellow-500/10 text-yellow-600 border-yellow-200 dark:border-yellow-800'
    : agentTeam === 'red'
    ? 'bg-red-500/10 text-red-600 border-red-200 dark:border-red-800'
    : 'bg-muted/40 text-muted-foreground border-border';
  const specTaskIds = getStepSpecTaskIds(step);
  const specTaskLabel = specTaskIds.length > 1 ? `Spec ${specTaskIds.length}` : specTaskIds[0] || 'Spec 任务';

  return (
    <div ref={setNodeRef} style={style} className={`group rounded-lg border px-3 py-2.5 transition-colors ${roleColor}`}>
      <div className="flex items-start gap-2.5">
        <button {...attributes} {...listeners} disabled={dragLocked} title={dragLocked ? '系统维护的审查步骤，切换审查模式即可调整' : '拖动排序'} className="mt-1 flex-shrink-0 cursor-grab rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40">
          <GripVertical className="w-4 h-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-background/70 shadow-sm">
                  <span className="material-symbols-outlined text-[13px]">{roleIcon}</span>
                </span>
                <span className="min-w-0 truncate text-sm font-semibold leading-5" title={step.name}>
                  {step.name}
                </span>
                {isSubworkflow ? <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">子工作流</Badge> : null}
                {isSubworkflow ? (
                  <button
                    type="button"
                    className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 text-[10px] font-medium text-cyan-700 transition hover:bg-cyan-500/20 dark:text-cyan-200"
                    title="查看子工作流内部"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPreviewSubworkflow?.();
                    }}
                  >
                    <span className="material-symbols-outlined text-[12px]">visibility</span>
                    查看
                  </button>
                ) : null}
                {isParallel ? <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">并发</Badge> : null}
                {specTaskIds.length > 0 ? (
                  <button
                    type="button"
                    className="inline-flex h-5 max-w-[150px] shrink-0 items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 text-[10px] font-medium text-violet-700 transition hover:bg-violet-500/20 dark:text-violet-200"
                    title={`打开 Spec 任务绑定：${specTaskIds.join(', ')}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSpecTaskClick?.();
                    }}
                  >
                    <span className="material-symbols-outlined text-[12px]">assignment</span>
                    <span className="truncate">{specTaskLabel}</span>
                  </button>
                ) : null}
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-gray-500">
                <StepAgentBadge step={step} availableAgents={availableAgents} />
                {isSubworkflow ? (
                  <span className="min-w-0 flex-1 truncate" title={childConfigFile}>
                    {childConfigFile || '未设置子工作流配置'} · {step.inputs?.workspace === 'inherit' ? '继承父工作区' : step.inputs?.workspace || 'inherit'} · {step.runtime?.humanQuestions === 'child-only' ? '人工确认仅子流程' : '人工确认冒泡'}
                  </span>
                ) : step.task ? (
                  <span className="min-w-0 flex-1 truncate" title={step.task}>
                    {step.task}
                  </span>
                ) : (
                  <span className="text-gray-400">未填写任务说明</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border/60 bg-background/75 p-0.5 text-muted-foreground shadow-sm opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {canGroupPrevious && (
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title={structureLocked ? '系统维护的审查步骤，切换审查模式即可调整' : '与上一并发'} disabled={structureLocked} onClick={(e) => { e.stopPropagation(); onGroupWithPrevious?.(); }}>
                  <MergeIntoParallelIcon direction="previous" />
                </Button>
              )}
              {canGroupNext && (
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title={structureLocked ? '系统维护的审查步骤，切换审查模式即可调整' : '与下一并发'} disabled={structureLocked} onClick={(e) => { e.stopPropagation(); onGroupWithNext?.(); }}>
                  <MergeIntoParallelIcon direction="next" />
                </Button>
              )}
              {isParallel && (
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title={structureLocked ? '系统维护的审查步骤，切换审查模式即可调整' : '拆分并发组'} disabled={structureLocked} onClick={(e) => { e.stopPropagation(); onUngroup?.(); }}>
                  <span className="material-symbols-outlined text-[15px]">call_split</span>
                </Button>
              )}
              {onOptimize ? (
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title={editLocked ? '系统维护的审查步骤，内容由审查模式决定' : 'AI 优化'} disabled={editLocked} onClick={(e) => { e.stopPropagation(); onOptimize(); }}>
                  <span className="material-symbols-outlined text-[14px]">auto_fix_high</span>
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title={editLocked ? '系统维护的审查步骤，内容由审查模式决定' : '编辑'} disabled={editLocked} onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                <span className="material-symbols-outlined text-[14px]">edit</span>
              </Button>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive" title={structureLocked ? '系统维护的审查步骤，切换审查模式即可调整' : '删除'} disabled={structureLocked} onClick={(e) => { e.stopPropagation(); onDelete(); }}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
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
        {!state.isFinal && state.reviewPolicy ? (
          <span
            className={`h-1.5 w-1.5 rounded-full ${state.reviewPolicy.mode === 'adversarial' ? 'bg-rose-400' : 'bg-sky-400'}`}
            title={state.reviewPolicy.mode === 'adversarial' ? '对抗模式' : '标准模式'}
          />
        ) : null}
        {!state.isFinal && state.reviewPolicy?.locked ? (
          <span className="material-symbols-outlined text-[12px] leading-none" title="已固定：AI 优化时不会改动这个状态的审查模式，你自己仍可随时调整">push_pin</span>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={`h-5 w-5 p-0 opacity-0 group-hover:opacity-100 flex-shrink-0 ${
          isSelected ? 'hover:bg-destructive/20 text-primary-foreground' : 'text-destructive hover:bg-destructive/10 hover:text-destructive'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="删除状态"
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
}

function AdvancedVerdictTransitionsModal({
  open,
  onOpenChange,
  preset,
  states,
  transitions,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset: typeof VERDICT_TRANSITION_PRESETS[number];
  states: StateMachineState[];
  transitions: StateTransition[];
  onSave: (transitions: StateTransition[]) => void;
}) {
  const [draft, setDraft] = useState<StateTransition[]>(transitions);
  const advancedDraftCount = draft.filter((transition) => hasAdvancedTransitionFilters(transition)).length;
  const duplicateFallbackDraftCount = draft.length - advancedDraftCount;

  useEffect(() => {
    if (open) setDraft(transitions);
  }, [open, transitions]);

  const updateTransition = (index: number, patch: Partial<StateTransition>) => {
    setDraft((prev) => prev.map((item, itemIndex) => (
      itemIndex === index
        ? {
            ...item,
            ...patch,
            condition: {
              ...(item.condition || {}),
              ...(patch.condition || {}),
              verdict: preset.verdict,
            },
          }
        : item
    )));
  };

  const addRule = () => {
    setDraft((prev) => [...prev, {
      to: '',
      label: `${preset.title}高级规则`,
      priority: Math.max(1, (prev.at(-1)?.priority || preset.priority) - 1),
      condition: {
        verdict: preset.verdict,
        custom: '',
      },
    }]);
  };

  const removeRule = (index: number) => setDraft((prev) => prev.filter((_, itemIndex) => itemIndex !== index));

  const toggleListValue = (index: number, field: 'issueTypes' | 'severities', value: string) => {
    const current = ((draft[index]?.condition as any)?.[field] || []) as string[];
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    updateTransition(index, {
      condition: {
        ...draft[index]?.condition,
        [field]: next.length ? next : undefined,
      },
    });
  };

  const commit = () => {
    const normalized = draft
      .map((item) => ({
        ...item,
        label: item.label?.trim() || undefined,
        priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : preset.priority,
        condition: {
          ...item.condition,
          verdict: preset.verdict,
          custom: item.condition?.custom?.trim() || undefined,
          issueTypes: item.condition?.issueTypes?.length ? item.condition.issueTypes : undefined,
          severities: item.condition?.severities?.length ? item.condition.severities : undefined,
          minIssueCount: item.condition?.minIssueCount === undefined || item.condition?.minIssueCount === null || item.condition?.minIssueCount === ('' as any)
            ? undefined
            : Number(item.condition.minIssueCount),
          maxIssueCount: item.condition?.maxIssueCount === undefined || item.condition?.maxIssueCount === null || item.condition?.maxIssueCount === ('' as any)
            ? undefined
            : Number(item.condition.maxIssueCount),
        },
      }))
      .filter((item) => item.to?.trim())
      .filter((item) => hasAdvancedTransitionFilters(item));
    onSave(normalized);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[92vw] max-h-[85vh] overflow-hidden p-0">
        <ComboboxPortalProvider>
          <DialogTitle className="sr-only">{preset.title}高级状态转移设置</DialogTitle>
          <div className="flex max-h-[85vh] flex-col">
            <div className="border-b px-6 py-4">
              <div className="text-base font-semibold">{preset.title}高级状态转移设置</div>
              <div className="mt-1 text-xs text-muted-foreground">
                基础路径继续作为兜底。这里配置更细粒度的场景规则，并通过优先级控制命中顺序。
              </div>
            </div>
            <div className="flex-1 overflow-auto px-6 py-5 space-y-4">
              {duplicateFallbackDraftCount > 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/40 dark:text-amber-200">
                  检测到 {duplicateFallbackDraftCount} 条未设置过滤条件的额外路径。它们会作为重复兜底显示；保存时如果仍未补充条件，会被自动清理，只保留基础兜底路径。
                </div>
              ) : null}
              <div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" onClick={addRule}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  添加高级规则
                </Button>
              </div>
              {draft.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                  暂无高级规则，未命中时将走基础兜底路径。
                </div>
              ) : draft.map((transition, index) => {
                const isDuplicateFallback = !hasAdvancedTransitionFilters(transition);
                return (
                  <div
                    key={`${preset.verdict}-${index}`}
                    className={`rounded-2xl border bg-background/80 p-4 space-y-4 ${isDuplicateFallback ? 'border-amber-300/80 bg-amber-500/[0.03] dark:border-amber-900/80' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium">规则 {index + 1}</div>
                          <Badge variant={isDuplicateFallback ? 'destructive' : 'outline'} className="text-[10px]">
                            {isDuplicateFallback ? '重复兜底' : '高级规则'}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {isDuplicateFallback
                            ? '这条额外路径当前没有过滤条件，会与基础兜底冲突。补上条件后才会作为高级规则保留。'
                            : '优先级数字越小越先命中。'}
                        </div>
                      </div>
                      <Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => removeRule(index)}>
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        删除
                      </Button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">跳转目标</Label>
                        <SingleCombobox
                          value={transition.to}
                          onValueChange={(value) => updateTransition(index, { to: value })}
                          options={states.map((state) => ({ value: state.name, label: state.name }))}
                          placeholder="选择状态"
                          searchable={false}
                          triggerClassName="h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">路径说明</Label>
                        <Input
                          className="h-9 text-sm"
                          value={transition.label || ''}
                          onChange={(e) => updateTransition(index, { label: e.target.value })}
                          placeholder={`${preset.title}高级规则`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">优先级</Label>
                        <Input
                          className="h-9 text-sm"
                          type="number"
                          value={transition.priority ?? preset.priority}
                          onChange={(e) => updateTransition(index, { priority: parseInt(e.target.value, 10) || preset.priority })}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">模式匹配</Label>
                      <Input
                        className="h-9 text-sm"
                        value={transition.condition?.custom || ''}
                        onChange={(e) => updateTransition(index, { condition: { ...transition.condition, custom: e.target.value || undefined } })}
                        placeholder="例如：timeout|memory leak|race condition"
                      />
                    </div>
                    <div>
                      <Label className="mb-1.5 block text-xs">问题类型过滤</Label>
                      <div className="flex flex-wrap gap-2">
                        {ISSUE_TYPE_OPTIONS.map((opt) => {
                          const selected = transition.condition?.issueTypes?.includes(opt.value as any);
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              title={opt.desc}
                              className={`rounded-full border px-3 py-1.5 text-xs transition ${selected ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}
                              onClick={() => toggleListValue(index, 'issueTypes', opt.value)}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <Label className="mb-1.5 block text-xs">严重程度过滤</Label>
                      <div className="flex flex-wrap gap-2">
                        {SEVERITY_OPTIONS.map((opt) => {
                          const selected = transition.condition?.severities?.includes(opt.value as any);
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              className={`rounded-full border px-3 py-1.5 text-xs transition ${selected ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}
                              onClick={() => toggleListValue(index, 'severities', opt.value)}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">最少问题数量</Label>
                        <Input
                          className="h-9 text-sm"
                          type="number"
                          min={0}
                          value={transition.condition?.minIssueCount ?? ''}
                          placeholder="不限"
                          onChange={(e) => updateTransition(index, {
                            condition: {
                              ...transition.condition,
                              minIssueCount: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0),
                            },
                          })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">最多问题数量</Label>
                        <Input
                          className="h-9 text-sm"
                          type="number"
                          min={0}
                          value={transition.condition?.maxIssueCount ?? ''}
                          placeholder="不限"
                          onChange={(e) => updateTransition(index, {
                            condition: {
                              ...transition.condition,
                              maxIssueCount: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0),
                            },
                          })}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
              <Button type="button" onClick={commit}>确认</Button>
            </div>
          </div>
        </ComboboxPortalProvider>
      </DialogContent>
    </Dialog>
  );
}

function VerdictTransitionCard({
  transition, states, onChange, preset, advancedTransitions, onSaveAdvancedTransitions,
}: {
  transition: StateTransition;
  states: StateMachineState[];
  onChange: (t: StateTransition) => void;
  preset: typeof VERDICT_TRANSITION_PRESETS[number];
  advancedTransitions: StateTransition[];
  onSaveAdvancedTransitions: (transitions: StateTransition[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedRuleCount = advancedTransitions.filter((item) => hasAdvancedTransitionFilters(item)).length;
  const duplicateFallbackCount = advancedTransitions.length - advancedRuleCount;

  const conditionSummary = () => (
    duplicateFallbackCount > 0
      ? `${advancedRuleCount > 0 ? `${advancedRuleCount} 条高级规则 · ` : ''}${duplicateFallbackCount} 条待修复`
      : advancedRuleCount > 0
        ? `${advancedRuleCount} 条高级规则`
        : '仅使用基础兜底路径'
  );

  return (
    <>
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
                  {!transition.to ? <Badge variant="destructive" className="text-[10px]">未配置</Badge> : null}
                  {duplicateFallbackCount > 0 ? (
                    <Badge variant="destructive" className="text-[10px]">发现 {duplicateFallbackCount} 条重复兜底</Badge>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">{preset.description}</div>
                {!transition.to ? (
                  <div className="text-xs text-red-500">该路径还没有配置跳转目标，当前状态将无法通过保存校验。</div>
                ) : null}
              </div>
              <div className="rounded-full border bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground">
                {conditionSummary()}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="space-y-1.5">
                <Label className="text-xs">基础兜底目标</Label>
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
              <span>基础路径始终作为兜底。更细粒度的场景跳转请放到高级状态转移设置里，并通过优先级控制覆盖顺序。</span>
            </div>
            {duplicateFallbackCount > 0 ? (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>检测到 {duplicateFallbackCount} 条没有过滤条件的额外路径，已经自动带入高级规则编辑里。你可以删除它们，或者补充过滤条件后作为高级规则保留。</span>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3 rounded-xl border bg-background/70 px-3 py-3">
              <div>
                <div className="text-sm font-medium">高级状态转移设置</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {advancedRuleCount > 0
                    ? `已配置 ${advancedRuleCount} 条高级规则，命中后会覆盖兜底路径。`
                    : '默认不显示，只有需要覆盖更细场景时再配置。'}
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setAdvancedOpen(true)}>
                {duplicateFallbackCount > 0 ? '查看并修复规则' : '配置高级规则'}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <AdvancedVerdictTransitionsModal
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        preset={preset}
        states={states}
        transitions={advancedTransitions}
        onSave={onSaveAdvancedTransitions}
      />
    </>
  );
}

export default function StateMachineDesignPanel({
  states,
  onStatesChange,
  availableAgents,
  availableSkills = [],
  specTasks = [],
  onOptimizeState,
  onOptimizeStep,
  onAgentSkillsChange,
  lightweightMetadata,
  protocolAdopted = false,
  onAdoptReviewProtocol,
}: StateMachineDesignPanelProps) {
  const isLightweight = Boolean(lightweightMetadata) || hasLightweightWorkflowTopology(states);
  const workflowStepAgents = useMemo(
    () => availableAgents.filter(isWorkflowStepSelectableAgent),
    [availableAgents],
  );
  const [selectedStateName, setSelectedStateName] = useState<string | null>(
    states.length > 0 ? states[0].name : null
  );
  const [editingStateInfo, setEditingStateInfo] = useState(false);
  const [editingStep, setEditingStep] = useState<{ index: number; isNew: boolean; focusSpec?: boolean } | null>(null);
  const [subworkflowDrilldown, setSubworkflowDrilldown] = useState<SubworkflowDrilldownState | null>(null);
  const [reviewPolicyCandidate, setReviewPolicyCandidate] = useState<ReviewPolicyCandidate | null>(null);
  const [reviewPolicyUnsafeDeletes, setReviewPolicyUnsafeDeletes] = useState<Set<string>>(new Set());
  const subworkflowConfigFile = subworkflowDrilldown?.configFile || '';
  const subworkflowConfigQuery = useWorkflowConfigQuery(subworkflowConfigFile);
  const saveSubworkflowConfigMutation = useSaveConfigMutation(subworkflowConfigFile);

  const { onLayoutChanged } = useDefaultLayout({ id: 'design-editor' });

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
  const updateState = useCallback((updated: StateMachineState) => {
    onStatesChange(states.map((s, i) => i === selectedStateIndex ? updated : s));
  }, [states, selectedStateIndex, onStatesChange]);
  const executableAgents = useMemo(() => (availableAgents || [])
    .filter((agent) => agent?.roleType !== 'supervisor' && agent?.team !== 'black-gold'), [availableAgents]);
  const executableAgentNames = useMemo(() => Array.from(new Set(
    executableAgents
      .map((agent) => String(agent?.name || '').trim())
      .filter(Boolean)
  )), [executableAgents]);

  // Adoption is all-or-nothing: once a workflow runs state-level review, every
  // non-final state owes a policy, so enabling it state by state would leave the
  // config unsavable in between.
  const adoptionPreview = useMemo(() => {
    if (protocolAdopted || !onAdoptReviewProtocol || isLightweight) return null;
    return buildReviewProtocolAdoptionPreview(states, executableAgentNames);
  }, [executableAgentNames, isLightweight, onAdoptReviewProtocol, protocolAdopted, states]);

  const requestReviewModeChange = useCallback((targetMode: 'standard' | 'adversarial') => {
    if (!selectedState || selectedState.isFinal) return;
    const current = selectedState.reviewPolicy;
    const targetPolicy: ReviewPolicy = {
      mode: targetMode,
      source: 'user',
      locked: true,
      confidence: targetMode === 'standard' && current?.confidence === 'low'
        ? 'medium'
        : (current?.confidence || 'high'),
      riskSignals: current?.riskSignals || [],
      rationale: `用户明确选择${targetMode === 'adversarial' ? '对抗' : '标准'}模式。`,
    };
    const result = reconcileReviewPolicy(selectedState, targetPolicy, {
      availableAgents: executableAgentNames,
      fallbackAgent: executableAgentNames[0],
      idFactory: () => crypto.randomUUID(),
    });
    setReviewPolicyUnsafeDeletes(new Set());
    setReviewPolicyCandidate({
      stateId: selectedState.id,
      stateName: selectedState.name,
      targetMode,
      targetPolicy,
      nextState: result.nextState,
      operations: result.operations,
      warnings: result.warnings,
      blocked: result.blocked,
    });
  }, [executableAgentNames, selectedState]);

  const applyReviewPolicyCandidate = useCallback(() => {
    if (!reviewPolicyCandidate || reviewPolicyCandidate.blocked) return;
    const latestState = states.find((state) => (
      reviewPolicyCandidate.stateId
        ? state.id === reviewPolicyCandidate.stateId
        : state.name === reviewPolicyCandidate.stateName
    ));
    if (!latestState) {
      setReviewPolicyCandidate(null);
      return;
    }
    const refreshed = reconcileReviewPolicy(latestState, reviewPolicyCandidate.targetPolicy, {
      availableAgents: executableAgentNames,
      fallbackAgent: executableAgentNames[0],
      idFactory: () => crypto.randomUUID(),
    });
    if (refreshed.blocked) {
      setReviewPolicyCandidate((current) => current ? {
        ...current,
        blocked: true,
        warnings: Array.from(new Set([...current.warnings, ...refreshed.warnings])),
      } : current);
      return;
    }
    const unsafeDeleteIds = reviewPolicyUnsafeDeletes;
    if (unsafeDeleteIds.size > 0) {
      const staleDeleteIds = [...unsafeDeleteIds].filter((stepId) => {
        const previewOperation = reviewPolicyCandidate.operations.find((operation) => (
          !operation.safe && operation.stepId === stepId
        ));
        const refreshedOperation = refreshed.operations.find((operation) => (
          !operation.safe && operation.stepId === stepId
        ));
        if (!previewOperation?.before || !refreshedOperation?.before) return true;
        return hashReviewStep(previewOperation.before as WorkflowStep)
          !== hashReviewStep(refreshedOperation.before as WorkflowStep);
      });
      if (staleDeleteIds.length > 0) {
        setReviewPolicyCandidate((current) => current ? {
          ...current,
          nextState: refreshed.nextState,
          operations: refreshed.operations,
          warnings: Array.from(new Set([
            ...current.warnings,
            ...refreshed.warnings,
            '待删除步骤在预览后已发生变化，已取消删除选择；请基于最新 diff 再次确认。',
          ])),
        } : current);
        setReviewPolicyUnsafeDeletes(new Set());
        return;
      }
    }
    let nextState = unsafeDeleteIds.size > 0
      ? {
          ...refreshed.nextState,
          steps: refreshed.nextState.steps.filter((step) => !step.id || !unsafeDeleteIds.has(step.id)),
        }
      : refreshed.nextState;
    if (unsafeDeleteIds.size > 0) {
      const repairSeed = hashReviewState(nextState).replace(/[^a-zA-Z0-9_-]/g, '-');
      let repairStepIndex = 0;
      const repairedAfterDelete = reconcileReviewPolicy(nextState, reviewPolicyCandidate.targetPolicy, {
        availableAgents: executableAgentNames,
        fallbackAgent: executableAgentNames[0],
        idFactory: () => `${repairSeed}-${++repairStepIndex}`,
      });
      if (repairedAfterDelete.blocked) {
        setReviewPolicyCandidate((current) => current ? {
          ...current,
          blocked: true,
          warnings: Array.from(new Set([...current.warnings, ...repairedAfterDelete.warnings])),
        } : current);
        return;
      }
      nextState = repairedAfterDelete.nextState;
      if (repairedAfterDelete.operations.length > 0) {
        const repairSignature = hashReviewState(repairedAfterDelete.nextState);
        if (reviewPolicyCandidate.unsafeDeleteRepairSignature !== repairSignature) {
          setReviewPolicyCandidate((current) => current ? {
            ...current,
            nextState: repairedAfterDelete.nextState,
            operations: [...refreshed.operations, ...repairedAfterDelete.operations],
            warnings: Array.from(new Set([
              ...current.warnings,
              ...repairedAfterDelete.warnings,
              '明确删除后需要重新建立标准 verdict 输出者；请确认下方新增的收口变更。',
            ])),
            unsafeDeleteRepairSignature: repairSignature,
          } : current);
          return;
        }
      }
    }
    const latestIndex = states.findIndex((state) => (
      reviewPolicyCandidate.stateId
        ? state.id === reviewPolicyCandidate.stateId
        : state.name === reviewPolicyCandidate.stateName
    ));
    if (latestIndex < 0) {
      setReviewPolicyCandidate(null);
      return;
    }
    onStatesChange(states.map((state, index) => index === latestIndex ? nextState : state));
    setReviewPolicyCandidate(null);
    setReviewPolicyUnsafeDeletes(new Set());
  }, [executableAgentNames, onStatesChange, reviewPolicyCandidate, reviewPolicyUnsafeDeletes, states]);

  const returnReviewPolicyToAi = useCallback(() => {
    if (!selectedState || selectedState.isFinal || !selectedState.reviewPolicy) return;
    onOptimizeState?.(
      selectedStateIndex,
      `只重新评估状态「${selectedState.name}」的 reviewPolicy，返回 mode、rationale、riskSignals、confidence。不要返回步骤、状态名称、转移或任何管理字段；步骤编排由本地系统生成。`,
      true,
      true,
    );
  }, [onOptimizeState, selectedState, selectedStateIndex]);

  const lockCurrentReviewPolicy = useCallback(() => {
    if (!selectedState || selectedState.isFinal || !selectedState.reviewPolicy) return;
    updateState({
      ...selectedState,
      reviewPolicy: {
        ...selectedState.reviewPolicy,
        source: 'user',
        locked: true,
        rationale: selectedState.reviewPolicy.rationale || '用户确认并锁定当前审查模式。',
      },
    });
  }, [selectedState, updateState]);

  const openSubworkflowDrilldown = useCallback((step: WorkflowStep, context?: { stateName?: string; stepIndex?: number }) => {
    const configFile = String(step.workflow || step.subworkflow?.configFile || '').trim();
    setSubworkflowDrilldown({
      parentStep: step,
      parentStateName: context?.stateName,
      parentStepIndex: context?.stepIndex,
      configFile,
      loading: Boolean(configFile),
      saving: false,
      error: configFile ? undefined : '这个子工作流步骤还没有选择配置文件。',
    });
  }, []);

  useEffect(() => {
    if (!subworkflowDrilldown?.configFile) return;
    if (subworkflowConfigQuery.data) {
      setSubworkflowDrilldown((prev) => {
        if (!prev || prev.configFile !== subworkflowConfigFile) return prev;
        return { ...prev, loading: false, error: undefined, config: subworkflowConfigQuery.data.config };
      });
      return;
    }
    if (subworkflowConfigQuery.error && !subworkflowConfigQuery.isFetching) {
      setSubworkflowDrilldown((prev) => {
        if (!prev || prev.configFile !== subworkflowConfigFile) return prev;
        const message = subworkflowConfigQuery.error instanceof Error
          ? subworkflowConfigQuery.error.message
          : '加载子工作流配置失败';
        return { ...prev, loading: false, error: message };
      });
    }
  }, [
    subworkflowConfigFile,
    subworkflowConfigQuery.data,
    subworkflowConfigQuery.error,
    subworkflowConfigQuery.isFetching,
    subworkflowDrilldown?.configFile,
  ]);

  // 步骤拖拽排序
  const handleDragEnd = (event: DragEndEvent) => {
    if (!selectedState) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = Number(active.id);
    const newIndex = Number(over.id);
    if (selectedState.reviewPolicy?.locked) {
      const steps = selectedState.steps || [];
      const activeStep = steps[oldIndex];
      if (!activeStep || activeStep.provenance?.origin === 'review-policy') return;
      if (selectedState.reviewPolicy.mode === 'adversarial') {
        const attackerIndex = steps.findIndex((step) => step.role === 'attacker');
        if (activeStep.role !== 'defender' || attackerIndex < 0 || newIndex >= attackerIndex) return;
      } else {
        const closerIndex = steps.findIndex((step) => step.provenance?.managedRole === 'standard-closer');
        if (closerIndex >= 0 && newIndex >= closerIndex) return;
      }
    }
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
      id: crypto.randomUUID(),
      name,
      description: '',
      steps: [],
      transitions: [],
      isInitial: states.length === 0,
      isFinal: false,
      maxSelfTransitions: 3,
      // Only a workflow that already runs state-level review gives its new states
      // a policy. Attaching one here on a pre-protocol workflow would opt the
      // whole thing in, and every other state would then fail validation for not
      // declaring one.
      ...(protocolAdopted ? {
        reviewPolicy: {
          mode: 'standard' as const,
          source: 'default' as const,
          locked: false,
          confidence: 'medium' as const,
          riskSignals: [],
          rationale: '手工新增状态默认采用标准模式，可在状态详情中调整。',
        },
      } : {}),
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
    const existingStep = !editingStep.isNew ? selectedState.steps[editingStep.index] : null;
    if (selectedState.reviewPolicy?.locked
      && (existingStep?.provenance?.origin === 'review-policy'
        || existingStep?.provenance?.managedRole === 'standard-closer')) return;
    const newStep = buildWorkflowStepFromEditData(data, existingStep);
    if (editingStep.isNew) {
      newStep.id = crypto.randomUUID();
      newStep.provenance = { origin: 'user' };
    }
    if (selectedState.reviewPolicy?.locked && existingStep && isReviewStructureStep(existingStep)) {
      newStep.id = existingStep.id;
      newStep.provenance = existingStep.provenance;
      newStep.role = existingStep.role;
      newStep.agentInstanceId = existingStep.agentInstanceId;
      newStep.parallelGroup = existingStep.parallelGroup;
      newStep.concurrency = existingStep.concurrency;
    }
    if (selectedState.reviewPolicy?.locked
      && selectedState.reviewPolicy.mode === 'adversarial'
      && editingStep.isNew) {
      newStep.role = 'defender';
      newStep.agentInstanceId = crypto.randomUUID();
      const groupId = getStepParallelGroup(newStep);
      if (groupId) {
        newStep.concurrency = {
          ...(newStep.concurrency || {}),
          groupId,
          joinPolicy: { mode: 'all' },
        };
      }
    }
    const steps = [...selectedState.steps];
    if (editingStep.isNew) {
      const protectedTailIndex = selectedState.reviewPolicy?.locked
        ? selectedState.reviewPolicy.mode === 'standard'
          ? steps.findIndex((step) => step.provenance?.managedRole === 'standard-closer')
          : steps.findIndex((step) => step.role === 'attacker')
        : -1;
      if (protectedTailIndex >= 0) steps.splice(protectedTailIndex, 0, newStep);
      else steps.push(newStep);
    } else {
      steps[editingStep.index] = newStep;
    }
    updateState({ ...selectedState, steps });
    setEditingStep(null);
  };

  const handleDeleteStep = (index: number) => {
    if (!selectedState) return;
    if (selectedState.reviewPolicy?.locked && isReviewStructureStep(selectedState.steps?.[index])) return;
    updateState({ ...selectedState, steps: (selectedState.steps || []).filter((_, i) => i !== index) });
    setEditingStep(null);
  };

  const handleGroupSteps = (start: number, end: number, groupId?: string) => {
    if (!selectedState) return;
    if (selectedState.reviewPolicy?.locked
      && selectedState.steps.slice(start, end + 1).some((step) => isReviewStructureStep(step))) return;
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
    if (selectedState.reviewPolicy?.locked
      && steps.slice(range.start, range.end + 1).some((step) => isReviewStructureStep(step))) return;
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
    if (selectedState.reviewPolicy?.locked && groupSteps.some((step) => isReviewStructureStep(step))) return;
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

  const handleSetJoinPolicyQuorum = (groupId: string, quorum: number) => {
    if (!selectedState) return;
    const groupSteps = (selectedState.steps || []).filter((step) => getStepParallelGroup(step) === groupId);
    if (selectedState.reviewPolicy?.locked && groupSteps.some((step) => isReviewStructureStep(step))) return;
    const normalizedQuorum = Math.max(1, Math.min(groupSteps.length || 1, Math.floor(quorum) || 1));
    updateState({
      ...selectedState,
      steps: (selectedState.steps || []).map((step) => {
        if (getStepParallelGroup(step) !== groupId) return step;
        const currentPolicy = step.concurrency?.joinPolicy || { mode: 'quorum' as const };
        return {
          ...step,
          concurrency: {
            ...(step.concurrency || {}),
            groupId,
            joinPolicy: {
              ...currentPolicy,
              mode: 'quorum',
              quorum: normalizedQuorum,
            },
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
    const fallbackTransitions = buildVerdictTransitions(selectedState, states, selectedState.transitions).map((item) => (
      item.condition.verdict === verdict
        ? { ...transition, condition: { ...(transition.condition || {}), verdict }, priority: VERDICT_TRANSITION_PRESETS.find((preset) => preset.verdict === verdict)?.priority || item.priority }
        : item
    ));
    const supplementalTransitions = REQUIRED_VERDICTS.flatMap((currentVerdict) => (
      getAdvancedVerdictTransitions(currentVerdict, selectedState.transitions || [])
    ));
    updateState({ ...selectedState, transitions: [...fallbackTransitions, ...supplementalTransitions] });
  };

  const handleSaveAdvancedVerdictTransitions = (verdict: VerdictTransition, nextTransitions: StateTransition[]) => {
    if (!selectedState) return;
    const fallbackTransitions = buildVerdictTransitions(selectedState, states, selectedState.transitions);
    const otherSupplementalTransitions = REQUIRED_VERDICTS
      .filter((currentVerdict) => currentVerdict !== verdict)
      .flatMap((currentVerdict) => getAdvancedVerdictTransitions(currentVerdict, selectedState.transitions || []));
    updateState({
      ...selectedState,
      transitions: [
        ...fallbackTransitions,
        ...otherSupplementalTransitions,
        ...nextTransitions.map((item) => ({
          ...item,
          condition: { ...(item.condition || {}), verdict },
        })),
      ],
    });
  };

  // 编辑步骤时的初始数据
  const editingStepData = editingStep && !editingStep.isNew && selectedState
    ? (() => {
        const s = selectedState.steps[editingStep.index];
        return {
          type: s.type,
          name: s.name,
          agent: s.agent,
          task: s.task,
          workflow: (s as any).workflow,
          subworkflow: (s as any).subworkflow,
          inputs: (s as any).inputs,
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

  const childWorkflowStates = useMemo(() => {
    const workflow = subworkflowDrilldown?.config?.workflow;
    return Array.isArray(workflow?.states) ? workflow.states as StateMachineState[] : [];
  }, [subworkflowDrilldown?.config?.workflow]);

  const handleChildStatesChange = useCallback((nextStates: StateMachineState[]) => {
    setSubworkflowDrilldown((prev) => {
      if (!prev?.config) return prev;
      return {
        ...prev,
        config: {
          ...prev.config,
          workflow: {
            ...(prev.config.workflow || {}),
            mode: 'state-machine',
            states: nextStates,
          },
        },
      };
    });
  }, []);

  const saveSubworkflowDrilldown = useCallback(async () => {
    if (!subworkflowDrilldown?.configFile || !subworkflowDrilldown.config) return;
    setSubworkflowDrilldown((prev) => prev ? { ...prev, saving: true, error: undefined } : prev);
    try {
      await saveSubworkflowConfigMutation.mutateAsync(subworkflowDrilldown.config);
      setSubworkflowDrilldown((prev) => prev ? { ...prev, saving: false } : prev);
    } catch (error: any) {
      setSubworkflowDrilldown((prev) => prev ? { ...prev, saving: false, error: error?.message || '保存子工作流失败' } : prev);
    }
  }, [saveSubworkflowConfigMutation, subworkflowDrilldown?.config, subworkflowDrilldown?.configFile]);

  if (isLightweight) {
    return (
      <LightweightWorkflowDesignPanel
        states={states}
        onStatesChange={onStatesChange}
        availableAgents={availableAgents}
        metadata={lightweightMetadata}
      />
    );
  }

  if (subworkflowDrilldown) {
    const workflow = subworkflowDrilldown.config?.workflow || {};
    const childLightweightMetadata = workflow.profile === 'lightweight'
      ? {
          workflowName: workflow.name,
          workspace: subworkflowDrilldown.config?.context?.projectRoot,
        }
      : undefined;
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setSubworkflowDrilldown(null)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              返回父工作流
            </Button>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {workflow.name || subworkflowDrilldown.configFile}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                子工作流 · {childLightweightMetadata ? '轻量工作流 · ' : ''}{subworkflowDrilldown.configFile}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {typeof subworkflowDrilldown.parentStepIndex === 'number' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setSelectedStateName(subworkflowDrilldown.parentStateName || selectedStateName);
                  setEditingStep({ index: subworkflowDrilldown.parentStepIndex!, isNew: false });
                  setSubworkflowDrilldown(null);
                }}
              >
                编辑引用步骤
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              disabled={subworkflowDrilldown.loading || subworkflowDrilldown.saving || !subworkflowDrilldown.config}
              onClick={saveSubworkflowDrilldown}
            >
              {subworkflowDrilldown.saving ? '保存中...' : '保存子工作流'}
            </Button>
          </div>
        </div>
        {subworkflowDrilldown.error ? (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
            {subworkflowDrilldown.error}
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          {subworkflowDrilldown.loading ? (
            <div className="grid h-full grid-cols-[220px_minmax(0,1fr)] gap-3 p-4">
              <div className="h-full animate-pulse rounded-xl border bg-muted/40" />
              <div className="h-full animate-pulse rounded-xl border bg-muted/40" />
            </div>
          ) : childWorkflowStates.length ? (
            <StateMachineDesignPanel
              states={childWorkflowStates}
              onStatesChange={handleChildStatesChange}
              availableAgents={availableAgents}
              availableSkills={availableSkills}
              specTasks={specTasks}
              onAgentSkillsChange={onAgentSkillsChange}
              lightweightMetadata={childLightweightMetadata}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <div className="max-w-md rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                这个子工作流不是状态机，或没有可编辑的 states。请打开子工作流设计页查看完整配置。
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

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
                    key={index}
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

      {/* 主编辑区 */}
      <ResizablePanelGroup
        id="design-editor"
        orientation="horizontal"
        className="flex-1 min-w-0"
        onLayoutChanged={onLayoutChanged}
      >
      <ResizablePanel id="design-editor-main" defaultSize={100} minSize={50}>
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
                      onChange={(e) => {
                        const newName = e.target.value;
                        const previousName = selectedState.name;
                        setSelectedStateName(newName);
                        onStatesChange(renameStateAndReferences(states, previousName, newName));
                      }}
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
                        onCheckedChange={(v) => {
                          const isFinal = !!v;
                          updateState({
                            ...selectedState,
                            isFinal,
                            reviewPolicy: isFinal
                              ? undefined
                              : selectedState.reviewPolicy || {
                                  mode: 'standard',
                                  source: 'default',
                                  locked: false,
                                  confidence: 'medium',
                                  riskSignals: [],
                                  rationale: '从终态改为可执行状态，默认采用标准模式。',
                                },
                          });
                        }}
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
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox
                        checked={selectedState.enableSpecRevisionOnComplete ?? false}
                        onCheckedChange={(v) => updateState({ ...selectedState, enableSpecRevisionOnComplete: !!v })}
                      />
                      <span className="text-xs">结束后 Spec 修订</span>
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground"
                        title="开启后，该状态执行结束时才会发起现有的 Spec 修订投票，由参与 Agent 和 Supervisor 判断是否需要更新 requirements/design/tasks；默认关闭，不影响状态跳转。"
                        onClick={(event) => event.preventDefault()}
                        aria-label="结束后 Spec 修订说明"
                      >
                        <Info className="h-3 w-3" />
                      </button>
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">最大自循环次数</Label>
                    <Input
                      className="h-8 text-sm"
                      type="number"
                      min={1}
                      max={100}
                      value={selectedState.maxSelfTransitions ?? defaultMaxSelfTransitions(selectedState)}
                      onChange={(e) => updateState({
                        ...selectedState,
                        maxSelfTransitions: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)),
                      })}
                    />
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      限制状态连续回到自身的次数，超出后自动熔断，避免卡在同一状态反复循环。
                    </div>
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
                <div className="flex flex-wrap gap-2">
                  {onOptimizeState && selectedStateIndex >= 0 ? (
                    <Button size="sm" variant="outline" onClick={() => onOptimizeState(selectedStateIndex)}>
                      <span className="material-symbols-outlined mr-1 text-sm">auto_fix_high</span>
                      AI 优化状态
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => setEditingStateInfo(false)}>完成</Button>
                </div>
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
                    {selectedState.enableSpecRevisionOnComplete && <Badge variant="outline" className="text-xs py-0 bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">Spec 修订</Badge>}
                    <Badge variant="outline" className="text-xs py-0">
                      自循环上限 {selectedState.maxSelfTransitions ?? defaultMaxSelfTransitions(selectedState)}
                    </Badge>
                  </div>
                  {selectedState.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{selectedState.description}</div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {onOptimizeState && selectedStateIndex >= 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs opacity-80"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOptimizeState(selectedStateIndex);
                      }}
                    >
                      <span className="material-symbols-outlined text-[14px]">auto_fix_high</span>
                      AI 优化
                    </Button>
                  ) : null}
                  <span className="material-symbols-outlined text-sm text-muted-foreground opacity-0 group-hover:opacity-100">edit</span>
                </div>
              </div>
            )}
          </div>

          {!selectedState.isFinal && !selectedState.reviewPolicy && adoptionPreview ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-3 space-y-2">
              <div className="text-sm font-medium">本工作流尚未启用状态级审查</div>
              <p className="text-xs leading-5 text-muted-foreground">
                当前按原有编排运行，不会插入裁决步骤、不绑定隔离实例，也不改动自循环上限。
                启用后会保留已有审查策略，并为缺少策略的状态建立标准模式基线；共覆盖
                {' '}{adoptionPreview.targetCount} 个非终态，之后可逐状态调整。
              </p>
              {adoptionPreview.operations.length ? (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    启用将进行 {adoptionPreview.operations.length} 项结构调整
                  </summary>
                  <ul className="mt-2 space-y-1.5 border-l border-border pl-3">
                    {adoptionPreview.operations.map((operation, index) => (
                      <li key={`adopt-op-${index}`} className="leading-5">
                        <span className="font-medium">{operation.op}</span>
                        <span className="text-muted-foreground">{' · '}{operation.stepName}</span>
                        <span className="block text-muted-foreground">{operation.reason}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {adoptionPreview.warnings.map((warning) => (
                <p key={warning} className="text-xs text-amber-600 dark:text-amber-400">{warning}</p>
              ))}
              <Button
                size="sm"
                disabled={adoptionPreview.blocked}
                onClick={() => onAdoptReviewProtocol?.(adoptionPreview.nextStates)}
              >
                启用状态级审查
              </Button>
              {adoptionPreview.blocked ? (
                <p className="text-xs text-destructive">存在无法自动建立基线的状态，请先补齐可执行 Agent。</p>
              ) : null}
            </div>
          ) : null}

          {!selectedState.isFinal && selectedState.reviewPolicy ? (
            <div className="rounded-xl border border-border bg-card p-3 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">状态审查模式</span>
                    <Badge
                      variant="outline"
                      className={selectedState.reviewPolicy.mode === 'adversarial'
                        ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
                        : 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300'}
                    >
                      {selectedState.reviewPolicy.mode === 'adversarial' ? '对抗模式' : '标准模式'}
                    </Badge>
                    {selectedState.reviewPolicy.locked ? (
                      <Badge variant="outline" className="gap-1 text-[10px]" title="AI 优化时不会改动这个模式；你自己仍可随时切换">
                        <span className="material-symbols-outlined text-[12px]">push_pin</span>已固定
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>
                      {selectedState.reviewPolicy.mode === 'adversarial'
                        ? '这个状态的成果，由另外两个 Agent 挑错并裁决。'
                        : '这个状态的成果，由执行者在最后一步自己给出结论。'}
                    </span>
                    <span
                      className="material-symbols-outlined cursor-help text-[13px] leading-none"
                      title={`来源：${{ ai: 'AI 判断', user: '用户选择', legacy: '旧配置推断', default: '兼容默认' }[selectedState.reviewPolicy.source]} · 置信度：${{ high: '高', medium: '中', low: '低' }[selectedState.reviewPolicy.confidence]}`}
                    >
                      info
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {!selectedState.reviewPolicy.locked ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      title="固定后，AI 优化不会改动这个模式；你自己仍可随时切换"
                      onClick={lockCurrentReviewPolicy}
                    >
                      固定此模式
                    </Button>
                  ) : null}
                  {onOptimizeState ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      title="AI 只提供建议，你确认后才会生效"
                      onClick={returnReviewPolicyToAi}
                    >
                      让 AI 重新评估
                    </Button>
                  ) : null}
                </div>
              </div>
              {/* Two option cards instead of a pair of small buttons: the choice is
                  "who judges this state and what does that cost", which needs more
                  room than a label. The current option is marked, not disabled — a
                  greyed-out button reads as unavailable rather than selected. */}
              <div className="grid gap-2 sm:grid-cols-2">
                {REVIEW_MODE_OPTIONS.map((option) => {
                  const isCurrent = selectedState.reviewPolicy!.mode === option.mode;
                  const ceiling = defaultMaxSelfTransitions({
                    reviewPolicy: { ...selectedState.reviewPolicy!, mode: option.mode },
                  });
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      aria-pressed={isCurrent}
                      className={`rounded-lg border p-2.5 text-left transition-colors ${
                        isCurrent
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/40 hover:bg-muted/40'
                      }`}
                      onClick={() => { if (!isCurrent) requestReviewModeChange(option.mode); }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold">{option.name}</span>
                        {isCurrent
                          ? <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">当前</Badge>
                          : <span className="text-[10px] text-muted-foreground">点击切换</span>}
                      </div>
                      <div className="mt-1 text-[11px] leading-4 text-muted-foreground">{option.who}</div>
                      <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                        {option.cost}
                        {selectedState.maxSelfTransitions === undefined ? ` · 自我重试上限 ${ceiling} 次` : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
              {isForcedAdversarialRationale(selectedState.reviewPolicy.rationale) ? (
                <div className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  <span className="material-symbols-outlined mt-0.5 text-[14px] leading-none">warning</span>
                  <span>系统对这个状态的判断把握不足，已按保守规则自动改用对抗模式。你可以手动切回标准。</span>
                </div>
              ) : null}
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5">
                {selectedState.reviewPolicy.rationale || '暂无判断理由。'}
              </div>
              {selectedState.reviewPolicy.riskSignals.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selectedState.reviewPolicy.riskSignals.map((signal) => (
                    <Badge key={signal} variant="secondary" className="text-[10px]">{signal}</Badge>
                  ))}
                </div>
              ) : null}
              {selectedState.reviewPolicy.mode === 'adversarial' ? (
                <div>
                  <div className="mb-1.5 text-xs font-medium">角色与运行实例</div>
                  <div className="grid gap-1.5 md:grid-cols-3">
                    {(['defender', 'attacker', 'judge'] as const).map((role) => {
                      const roleSteps = selectedState.steps.filter((step) => step.role === role);
                      return (
                        <div key={role} className="rounded-lg border border-border px-2.5 py-2 text-[11px]">
                          <div className="font-semibold">{{ defender: 'Defender（防守执行）', attacker: 'Attacker（攻击审查）', judge: 'Judge（独立裁决）' }[role]}</div>
                          {roleSteps.length > 0 ? roleSteps.map((step) => {
                            const agent = findAgentConfig(availableAgents, step.agent || '');
                            return (
                              <div key={step.id || step.name} className="mt-1 text-muted-foreground">
                                {step.agent || '未分配'}{agent?.team ? ` · ${agent.team}队` : ''}
                                <div className="truncate font-mono text-[10px]" title={step.agentInstanceId || ''}>{step.agentInstanceId || '缺少实例 ID'}</div>
                              </div>
                            );
                          }) : <div className="mt-1 text-destructive">缺少角色步骤</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : selectedState.isFinal ? (
            <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              终态只汇总结果，不参与标准/对抗模式配置，也不要求输出 verdict。
            </div>
          ) : null}

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
                    const groupReviewLocked = Boolean(selectedState.reviewPolicy?.locked
                      && group.steps.some(({ step }) => isReviewStructureStep(step)));
                    const joinMode = getStepJoinPolicyMode(firstStep);
                    const quorumValue = getStepJoinPolicyQuorum(firstStep) || Math.max(1, Math.min(2, group.steps.length));
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
                                  disabled={groupReviewLocked}
                                  onClick={() => group.id && handleSetJoinPolicy(group.id, mode)}
                                >
                                  {joinPolicyLabels[mode]}
                                </Button>
                              ))}
                              {joinMode === 'quorum' ? (
                                <label className="inline-flex h-6 items-center gap-1 rounded-md border border-input bg-background px-1.5 text-[10px]">
                                  <Input
                                    type="number"
                                    min={1}
                                    max={group.steps.length}
                                    value={quorumValue}
                                    className="h-5 w-12 border-0 p-0 text-center text-[10px] shadow-none focus-visible:ring-0"
                                    disabled={groupReviewLocked}
                                    onChange={(event) => group.id && handleSetJoinPolicyQuorum(group.id, Number(event.target.value) || 1)}
                                  />
                                  <span className="text-muted-foreground">个</span>
                                </label>
                              ) : null}
                              <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={groupReviewLocked} onClick={() => handleUngroup(group.startIndex)}>
                                拆分
                              </Button>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            {group.steps.map(({ step, index }) => (
                              <SortableStepRow
                                key={step.id || `${step.name}-${index}`}
                                step={step}
                                index={index}
                                availableAgents={availableAgents}
                                isParallel
                                structureLocked={Boolean(selectedState.reviewPolicy?.locked && isReviewStructureStep(step))}
                                dragLocked={Boolean(selectedState.reviewPolicy?.locked
                                  && (step.provenance?.origin === 'review-policy'
                                    || step.provenance?.managedRole === 'standard-closer'))}
                                editLocked={Boolean(selectedState.reviewPolicy?.locked
                                  && (step.provenance?.origin === 'review-policy'
                                    || step.provenance?.managedRole === 'standard-closer'))}
                                canGroupPrevious={index > 0 && getStepParallelGroup((selectedState.steps || [])[index - 1]) !== getStepParallelGroup(step)}
                                canGroupNext={index < (selectedState.steps?.length ?? 0) - 1 && getStepParallelGroup((selectedState.steps || [])[index + 1]) !== getStepParallelGroup(step)}
                                onGroupWithPrevious={() => handleGroupWithPrevious(index)}
                                onGroupWithNext={() => handleGroupWithNext(index)}
                                onUngroup={() => handleUngroup(index)}
                                onEdit={() => setEditingStep({ index, isNew: false })}
                                onOptimize={onOptimizeStep && selectedStateIndex >= 0 ? () => onOptimizeStep(selectedStateIndex, index) : undefined}
                                onSpecTaskClick={() => setEditingStep({ index, isNew: false, focusSpec: true })}
                                onPreviewSubworkflow={() => openSubworkflowDrilldown(step, { stateName: selectedState.name, stepIndex: index })}
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
                        key={step.id || `${step.name}-${index}`}
                        step={step}
                        index={index}
                        availableAgents={availableAgents}
                        structureLocked={Boolean(selectedState.reviewPolicy?.locked && isReviewStructureStep(step))}
                        dragLocked={Boolean(selectedState.reviewPolicy?.locked
                          && (step.provenance?.origin === 'review-policy'
                            || step.provenance?.managedRole === 'standard-closer'))}
                        editLocked={Boolean(selectedState.reviewPolicy?.locked
                          && (step.provenance?.origin === 'review-policy'
                            || step.provenance?.managedRole === 'standard-closer'))}
                        canGroupPrevious={index > 0}
                        canGroupNext={index < (selectedState.steps?.length ?? 0) - 1}
                        onGroupWithPrevious={() => handleGroupWithPrevious(index)}
                        onGroupWithNext={() => handleGroupWithNext(index)}
                        onEdit={() => setEditingStep({ index, isNew: false })}
                        onOptimize={onOptimizeStep && selectedStateIndex >= 0 ? () => onOptimizeStep(selectedStateIndex, index) : undefined}
                        onSpecTaskClick={() => setEditingStep({ index, isNew: false, focusSpec: true })}
                        onPreviewSubworkflow={() => openSubworkflowDrilldown(step, { stateName: selectedState.name, stepIndex: index })}
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
                    <span>系统会按 verdict 固定识别三条基础路径。每条路径都必须保留一个兜底目标；更细的场景覆盖放到高级状态转移设置里，并按优先级命中。</span>
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
                      advancedTransitions={getAdvancedVerdictTransitions(verdict, selectedState?.transitions || [])}
                      onChange={(nextTransition) => handleUpdateVerdictTransition(verdict, nextTransition)}
                      onSaveAdvancedTransitions={(nextTransitions) => handleSaveAdvancedVerdictTransitions(verdict, nextTransitions)}
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

      </ResizablePanelGroup>

      {/* 步骤编辑弹窗（复用 EditNodeModal） */}
      {editingStep !== null && (
        <EditNodeModal
          isOpen
          type="step"
          data={editingStep.isNew ? {
            name: '',
            agent: workflowStepAgents[0]?.name ?? '',
            task: '',
            role: 'defender',
            constraints: '',
            parallelGroup: '',
            concurrency: undefined,
            agentInstanceId: '',
            channelIds: [],
            specTaskBinding: undefined,
          } : editingStepData}
          roles={workflowStepAgents}
          availableSkills={availableSkills}
          specTasks={specTasks}
          initialSection={editingStep.focusSpec ? 'spec' : undefined}
          isNew={editingStep.isNew}
          existingSteps={selectedState?.steps ?? []}
          onClose={() => setEditingStep(null)}
          onSave={handleSaveStep}
          onAgentSkillsChange={onAgentSkillsChange}
          onDelete={editingStep.isNew ? undefined : () => handleDeleteStep(editingStep.index)}
        />
      )}

      <Dialog
        open={Boolean(reviewPolicyCandidate)}
        onOpenChange={(open) => {
          if (!open) {
            setReviewPolicyCandidate(null);
            setReviewPolicyUnsafeDeletes(new Set());
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[82vh] overflow-y-auto">
          <DialogTitle>确认状态审查模式变更</DialogTitle>
          {reviewPolicyCandidate ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                状态「{reviewPolicyCandidate.stateName}」将切换为
                <span className="mx-1 font-semibold">{reviewPolicyCandidate.targetMode === 'adversarial' ? '对抗模式' : '标准模式'}</span>
                。确认后这个选择会被固定，AI 优化时不会改动它；你自己仍可随时切换模式或删除该状态。
              </div>
              {reviewPolicyCandidate.warnings.length > 0 ? (
                <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  {reviewPolicyCandidate.warnings.map((warning) => <div key={warning}>• {warning}</div>)}
                </div>
              ) : null}
              <div>
                <div className="mb-2 text-sm font-semibold">编排差异</div>
                {reviewPolicyCandidate.operations.length > 0 ? (
                  <div className="space-y-2">
                    {reviewPolicyCandidate.operations.map((operation, index) => {
                      const identity = operation.stepId || `${operation.stepName}-${index}`;
                      const deleteUnsafe = !operation.safe && Boolean(operation.stepId) && reviewPolicyUnsafeDeletes.has(operation.stepId!);
                      const fieldChanges = getReviewOperationFieldChanges(operation);
                      return (
                        <div key={`${operation.op}-${identity}-${index}`} className="rounded-lg border border-border px-3 py-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 text-xs font-medium">
                                <Badge variant="outline" className="text-[10px]">
                                  {{ insert: '新增', delete: '删除', retag: '角色/实例调整', convert: '转换' }[operation.op]}
                                </Badge>
                                {operation.stepName}
                                {!operation.safe ? <Badge variant="outline" className="border-amber-300 text-[10px] text-amber-700">用户内容</Badge> : null}
                              </div>
                              <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{operation.reason}</div>
                              {fieldChanges.length > 0 ? (
                                <div className="mt-2 space-y-1 rounded-md bg-muted/50 px-2 py-1.5 text-[10px] leading-4">
                                  {fieldChanges.map((change) => (
                                    <div key={change.label} className="grid grid-cols-[44px_minmax(0,1fr)] gap-1">
                                      <span className="text-muted-foreground">{change.label}</span>
                                      <span className="break-words">
                                        <span className="text-red-600/80 line-through">{change.before}</span>
                                        <span className="mx-1 text-muted-foreground">→</span>
                                        <span className="text-emerald-700 dark:text-emerald-300">{change.after}</span>
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            {!operation.safe && operation.stepId ? (
                              <div className="flex gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={!deleteUnsafe ? 'default' : 'outline'}
                                  className="h-7 px-2 text-[10px]"
                                  onClick={() => setReviewPolicyUnsafeDeletes((current) => {
                                    const next = new Set(current);
                                    next.delete(operation.stepId!);
                                    return next;
                                  })}
                                >
                                  保留并转换
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={deleteUnsafe ? 'destructive' : 'outline'}
                                  className="h-7 px-2 text-[10px]"
                                  onClick={() => setReviewPolicyUnsafeDeletes((current) => new Set(current).add(operation.stepId!))}
                                >
                                  明确删除
                                </Button>
                              </div>
                            ) : (
                              <Checkbox checked disabled aria-label="必要的安全变更" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                    步骤编排无需调整，只更新审查策略和锁定状态。
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setReviewPolicyCandidate(null)}>取消</Button>
                <Button type="button" disabled={reviewPolicyCandidate.blocked} onClick={applyReviewPolicyCandidate}>
                  确认并应用
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

    </div>
  );
}
