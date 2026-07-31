'use client';

import { useCallback, useMemo, useEffect, useState, useRef } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  Panel,
  MarkerType,
  NodeTypes,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  EdgeProps,
  useReactFlow,
  ReactFlowProvider,
  useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { StateMachineState, StateTransition, StateTransitionRecord } from '@/lib/core/schemas';
import { Badge } from './ui/badge';
import { RotateCcw } from 'lucide-react';

// 稳定的空数组引用：避免默认参数 = [] 在每次渲染产生新数组，
// 进而触发 useMemo 重算与 setNodes 写入新对象 → Maximum update depth exceeded
const EMPTY_ACTIVE_STEPS: string[] = [];
const EMPTY_COMPLETED_STEPS: string[] = [];
const EMPTY_FAILED_STEPS: string[] = [];
const EMPTY_STATE_HISTORY: StateTransitionRecord[] = [];
const EXECUTED_EDGE_COLOR = '#2563eb';
const CONFIG_EDGE_COLOR = '#64748b';
const MUTED_EDGE_COLOR = CONFIG_EDGE_COLOR;
const MUTED_EDGE_MARKER_COLOR = '#94a3b8';
const HUMAN_APPROVAL_EDGE_COLOR = '#f97316';

function compactEdgeLabel(label: string, maxLength = 38): string {
  const normalized = label.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function getVerdictEdgeLabel(verdict: string | undefined): string {
  if (verdict === 'pass') return '通过';
  if (verdict === 'conditional_pass') return '有条件';
  if (verdict === 'fail') return '失败';
  return '';
}

type TransitionEdgeLabelPart = {
  verdict?: string;
  verdictLabel?: string;
  text: string;
};

function getTransitionRuleLabelPart(transition: StateTransition): TransitionEdgeLabelPart {
  const verdict = transition.condition?.verdict;
  const verdictLabel = getVerdictEdgeLabel(verdict);
  const condition = getConditionLabel(transition);
  const detail = String(transition.label || (condition !== '默认' ? condition : '') || transition.to || '').trim();
  return {
    verdict,
    verdictLabel,
    text: compactEdgeLabel(detail || condition || '默认', 30),
  };
}

function getTransitionPathLabelParts(transitions: StateTransition[]): TransitionEdgeLabelPart[] {
  const seen = new Set<string>();
  const labels: TransitionEdgeLabelPart[] = [];
  for (const transition of transitions) {
    const label = getTransitionRuleLabelPart(transition);
    const signature = `${label.verdict || ''}:${label.text}`;
    if (!label.text || seen.has(signature)) continue;
    seen.add(signature);
    labels.push(label);
  }
  return labels.slice(0, 3);
}

function getVerdictLabelClass(verdict: string | undefined): string {
  if (verdict === 'pass') return 'text-emerald-700 dark:text-emerald-300';
  if (verdict === 'conditional_pass') return 'text-amber-700 dark:text-amber-300';
  if (verdict === 'fail') return 'text-red-700 dark:text-red-300';
  return 'text-slate-600 dark:text-slate-300';
}

function TransitionEdgeLabel({ label, defaultColor }: { label: unknown; defaultColor: string }) {
  const parts = Array.isArray(label) ? label as TransitionEdgeLabelPart[] : [];
  if (!parts.length) {
    return <span style={{ color: defaultColor }}>{String(label || '')}</span>;
  }

  return (
    <span className="flex max-w-[300px] flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center">
      {parts.map((part, index) => (
        <span key={`${part.verdict || 'default'}-${part.text}-${index}`} className="inline-flex items-center gap-1">
          {part.verdictLabel ? (
            <span className={`font-semibold ${getVerdictLabelClass(part.verdict)}`}>{part.verdictLabel}</span>
          ) : null}
          <span className="font-medium text-slate-600 dark:text-slate-300">{part.text}</span>
        </span>
      ))}
    </span>
  );
}

function StateTransitionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  label,
  data,
}: EdgeProps) {
  if (data?.isSelfLoop) {
    const loopSize = data?.loopSize ?? 120;
    const edgePath = [
      `M ${sourceX},${sourceY}`,
      `C ${sourceX + loopSize},${sourceY}`,
      `${sourceX + loopSize},${targetY - loopSize}`,
      `${targetX},${targetY}`,
    ].join(' ');
    const labelX = sourceX + loopSize * 0.78;
    const labelY = Math.min(sourceY, targetY) - loopSize * 0.55;

    return (
      <>
        <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
        {label ? (
          <EdgeLabelRenderer>
            <div
              className="nodrag nopan pointer-events-none rounded bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold shadow-sm ring-1 ring-white/80 dark:bg-gray-950/95"
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                maxWidth: 240,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: data?.labelColor || EXECUTED_EDGE_COLOR,
                zIndex: data?.labelZIndex || 50,
              }}
            >
              <TransitionEdgeLabel label={data?.labelParts || label} defaultColor={data?.labelColor || EXECUTED_EDGE_COLOR} />
            </div>
          </EdgeLabelRenderer>
        ) : null}
      </>
    );
  }

  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const length = Math.max(1, Math.hypot(dx, dy));
  const curveOffset = Number(data?.curveOffset ?? 0);
  const derivedOffsetX = (-dy / length) * curveOffset;
  const derivedOffsetY = (dx / length) * curveOffset;
  const rawOffsetX = Number(data?.curveOffsetX ?? Number.NaN);
  const rawOffsetY = Number(data?.curveOffsetY ?? Number.NaN);
  const curveOffsetX = Number.isFinite(rawOffsetX) ? rawOffsetX : derivedOffsetX;
  const curveOffsetY = Number.isFinite(rawOffsetY) ? rawOffsetY : derivedOffsetY;
  const offset = data?.labelOffset ?? 22;
  const hasAvoidanceOffset = Math.abs(curveOffsetX) > 0.5 || Math.abs(curveOffsetY) > 0.5;
  let edgePath: string;
  let labelX: number;
  let labelY: number;

  if (hasAvoidanceOffset) {
    edgePath = [
      `M ${sourceX},${sourceY}`,
      `C ${sourceX + curveOffsetX},${sourceY + curveOffsetY}`,
      `${targetX + curveOffsetX},${targetY + curveOffsetY}`,
      `${targetX},${targetY}`,
    ].join(' ');
    labelX = (sourceX + targetX) / 2 + curveOffsetX;
    labelY = (sourceY + targetY) / 2 + curveOffsetY;
  } else {
    const path = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
    edgePath = path[0];
    const offsetX = (-dy / length) * offset;
    const offsetY = (dx / length) * offset;
    labelX = path[1] + offsetX;
    labelY = path[2] + offsetY;
  }

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none rounded bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold shadow-sm ring-1 ring-white/80 dark:bg-gray-950/95"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              maxWidth: 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: data?.labelColor || EXECUTED_EDGE_COLOR,
              zIndex: data?.labelZIndex || 50,
            }}
            >
              <TransitionEdgeLabel label={data?.labelParts || label} defaultColor={data?.labelColor || EXECUTED_EDGE_COLOR} />
            </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

// 格式化状态名称，将内部状态名转换为友好显示
function formatStateName(name: string): string {
  if (name === '__origin__') return '开始';
  if (name === '__human_approval__') return '人工审查';
  return name;
}

function buildExecutedStateTransitions(history: StateTransitionRecord[]): Array<{
  from: string;
  to: string;
  reason: string;
}> {
  const transitions: Array<{ from: string; to: string; reason: string }> = [];

  for (let i = 0; i < history.length; i += 1) {
    const record = history[i];
    if (!record || record.from === '__origin__') continue;

    if (record.to === '__human_approval__') {
      const next = history[i + 1];
      if (next?.from === '__human_approval__' && next.to && next.to !== '__human_approval__') {
        transitions.push({
          from: record.from,
          to: next.to,
          reason: next.reason || record.reason || '人工审查后转移',
        });
        i += 1;
      }
      continue;
    }

    if (record.from === '__human_approval__') {
      continue;
    }

    transitions.push({
      from: record.from,
      to: record.to,
      reason: record.reason || '状态转移',
    });
  }

  return transitions;
}

function buildUniqueExecutedTransitions(history: StateTransitionRecord[]): Array<{
  from: string;
  to: string;
  reason: string;
  index: number;
}> {
  const folded = buildExecutedStateTransitions(history);
  const seen = new Set<string>();
  const unique: Array<{ from: string; to: string; reason: string; index: number }> = [];

  folded.forEach((transition, index) => {
    const key = `${transition.from}->${transition.to}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push({ ...transition, index });
  });

  return unique;
}

interface SupervisorFlowRecord {
  type: string;
  from: string;
  to: string;
  question?: string;
  method?: string;
  round: number;
  timestamp: string;
}

const EMPTY_SUPERVISOR_FLOW: SupervisorFlowRecord[] = [];

interface StateMachineDiagramProps {
  states: StateMachineState[];
  agents?: Array<{ name: string; team?: string | null }>;
  onStateClick?: (stateName: string) => void;
  onStepClick?: (step: any) => void;
  onRerunFromStep?: (stepName: string) => void;
  onTransitionClick?: (from: string, to: string) => void;
  onForceTransition?: (targetState: string) => void;
  currentState?: string | null;
  currentStep?: string | null;
  activeSteps?: string[];
  completedSteps?: string[];
  failedSteps?: string[];
  stateHistory?: StateTransitionRecord[];
  isRunning?: boolean;
  allowForceTransition?: boolean;
  focusedState?: string | null;
  supervisorFlow?: SupervisorFlowRecord[];
  pendingHumanQuestion?: {
    source?: { type?: string; stateName?: string; stepName?: string; groupId?: string };
    currentState?: string | null;
  } | null;
}

// 自动布局算法：基于层次结构排列节点，优化空间利用
function calculateNodeLayout(states: StateMachineState[], useAutoLayout: boolean = true): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // 如果不使用自动布局且所有节点都有预定义位置，直接使用
  if (!useAutoLayout) {
    const allHavePositions = states.every(s => s.position);
    if (allHavePositions) {
      states.forEach(state => {
        if (state.position) {
          positions.set(state.name, state.position);
        }
      });
      return positions;
    }
  }

  // 构建依赖图
  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();

  states.forEach(state => {
    inDegree.set(state.name, 0);
    outEdges.set(state.name, []);
  });

  states.forEach(state => {
    if (state.transitions) {
      state.transitions.forEach(trans => {
        const current = inDegree.get(trans.to) || 0;
        inDegree.set(trans.to, current + 1);
        const edges = outEdges.get(state.name) || [];
        edges.push(trans.to);
        outEdges.set(state.name, edges);
      });
    }
  });

  // 拓扑排序分层
  const layers: string[][] = [];
  const processed = new Set<string>();

  while (processed.size < states.length) {
    const currentLayer: string[] = [];

    states.forEach(state => {
      if (processed.has(state.name)) return;

      const degree = inDegree.get(state.name) || 0;
      if (degree === 0 || state.isInitial) {
        currentLayer.push(state.name);
      }
    });

    if (currentLayer.length === 0) {
      // 处理循环依赖：选择入度最小的节点
      let minDegree = Infinity;
      let minNode = '';
      states.forEach(state => {
        if (!processed.has(state.name)) {
          const degree = inDegree.get(state.name) || 0;
          if (degree < minDegree) {
            minDegree = degree;
            minNode = state.name;
          }
        }
      });
      if (minNode) {
        currentLayer.push(minNode);
      }
    }

    layers.push(currentLayer);

    currentLayer.forEach(node => {
      processed.add(node);
      const edges = outEdges.get(node) || [];
      edges.forEach(target => {
        const current = inDegree.get(target) || 0;
        inDegree.set(target, Math.max(0, current - 1));
      });
    });
  }

  // 优化布局：使用更紧凑的网格布局，充分利用屏幕空间
  const nodeWidth = 220;
  const nodeHeight = 180;
  const horizontalSpacing = 350;  // 水平间距
  const verticalSpacing = 250;    // 垂直间距
  const maxNodesPerRow = 3;       // 每行最多节点数

  // 如果层数较多且每层节点较少，尝试使用网格布局
  const totalNodes = states.length;
  const avgNodesPerLayer = totalNodes / layers.length;

  if (layers.length > 4 && avgNodesPerLayer < 2) {
    // 使用网格布局
    let nodeIndex = 0;
    states.forEach(state => {
      const row = Math.floor(nodeIndex / maxNodesPerRow);
      const col = nodeIndex % maxNodesPerRow;
      const x = col * (nodeWidth + horizontalSpacing) - ((maxNodesPerRow - 1) * (nodeWidth + horizontalSpacing)) / 2;
      const y = row * (nodeHeight + verticalSpacing) + 100;
      positions.set(state.name, { x, y });
      nodeIndex++;
    });
  } else {
    // 使用层次布局
    layers.forEach((layer, layerIndex) => {
      const layerWidth = layer.length * nodeWidth + (layer.length - 1) * horizontalSpacing;
      const startX = -layerWidth / 2;

      layer.forEach((nodeName, nodeIndex) => {
        const x = startX + nodeIndex * (nodeWidth + horizontalSpacing) + nodeWidth / 2;
        const y = layerIndex * (nodeHeight + verticalSpacing) + 100;
        positions.set(nodeName, { x, y });
      });
    });
  }

  return positions;
}

// 自定义状态节点组件
const stateDiagramJoinPolicyLabels: Record<string, string> = {
  all: '等待全部',
  any: '任一完成',
  quorum: '达到数量',
  manual: '人工确认',
};

function getStateDiagramParallelGroup(step: any) {
  return step?.parallelGroup || step?.concurrency?.groupId || '';
}

function buildStateDiagramStepGroups(steps: any[]) {
  const groups: Array<{ id?: string; steps: any[] }> = [];
  steps.forEach((step) => {
    const groupId = getStateDiagramParallelGroup(step);
    const last = groups[groups.length - 1];
    if (groupId && last?.id === groupId) {
      last.steps.push(step);
      return;
    }
    groups.push({ id: groupId || undefined, steps: [step] });
  });
  return groups;
}

function getStateDiagramAgentTeam(agents: Array<{ name: string; team?: string | null }> | undefined, agentName: string | undefined) {
  if (!agentName) return undefined;
  return agents?.find((agent) => agent?.name === agentName)?.team || undefined;
}

function getStateDiagramTeamIcon(team: string | null | undefined) {
  if (team === 'blue') return 'swords';
  if (team === 'judge') return 'gavel';
  if (team === 'red') return 'shield';
  return 'radio_button_unchecked';
}

function getStateDiagramStepIcon(step: any, team: string | null | undefined) {
  if (step?.type === 'subworkflow') return 'account_tree';
  return getStateDiagramTeamIcon(team);
}

export function stateDiagramStepKeyMatches(stepKey: string | null | undefined, stateName: string, stepName: string): boolean {
  const key = String(stepKey || '').trim();
  const name = String(stepName || '').trim();
  const state = String(stateName || '').trim();
  if (!key || !name) return false;
  const baseName = name.replace(/-迭代\d+$/, '');
  const variants = [
    name,
    baseName,
    state ? `${state}-${name}` : '',
    state ? `${state}-${baseName}` : '',
    state ? `state:${state}#${name}` : '',
    state ? `state:${state}#${baseName}` : '',
  ].filter(Boolean);
  return variants.some((variant) => (
    key === variant
    || key.startsWith(`${variant}-迭代`)
    || key.endsWith(`-${variant}`)
  ));
}

export function getStateDiagramRerunStepKey(stateName: string, stepName: string): string {
  return `${stateName}-${stepName}`;
}

function StateNode({ data }: any) {
  const { state, isInitial, isFinal, isCurrent, currentStep, activeSteps = EMPTY_ACTIVE_STEPS, completedSteps = EMPTY_COMPLETED_STEPS, failedSteps = EMPTY_FAILED_STEPS, agents, onStepClick, onRerunFromStep, onForceTransition, isRunning, allowForceTransition, pendingHumanQuestion } = data;
  const isHumanCheckpoint = state.type === 'human-checkpoint';
  const isHumanApprovalState = state.name === '人工审查' || state.name === '__human_approval__';
  const isHumanHelpPending = pendingHumanQuestion?.source?.type === 'human-help'
    && (pendingHumanQuestion.source?.stateName === state.name || pendingHumanQuestion.currentState === state.name);
  const isParallelManualJoinPending = pendingHumanQuestion?.source?.type === 'parallel-manual-join'
    && (pendingHumanQuestion.source?.stateName === state.name || pendingHumanQuestion.currentState === state.name);
  const pendingParallelGroupId = isParallelManualJoinPending ? String(pendingHumanQuestion?.source?.groupId || '') : '';
  const pendingHumanHelpStep = isHumanHelpPending ? pendingHumanQuestion?.source?.stepName : '';
  const getStepStatus = (step: any) => {
    const isDone = completedSteps.some((key: string) => stateDiagramStepKeyMatches(key, state.name, step.name));
    const isFailed = failedSteps.some((key: string) => stateDiagramStepKeyMatches(key, state.name, step.name));
    const runningKeys = [currentStep, ...activeSteps].filter(Boolean);
    const isRunningStep = runningKeys.some((key) => stateDiagramStepKeyMatches(key, state.name, step.name));
    const isWaitingHumanHelp = Boolean(isHumanHelpPending && pendingHumanHelpStep && pendingHumanHelpStep === step.name);
    const isWaitingParallelApproval = Boolean(isParallelManualJoinPending && pendingParallelGroupId && getStateDiagramParallelGroup(step) === pendingParallelGroupId);
    return { isDone, isFailed, isRunningStep, isWaitingHumanHelp, isWaitingParallelApproval };
  };
  const renderStepPill = (step: any, idx: number, compact = false) => {
    const { isDone, isFailed, isRunningStep, isWaitingHumanHelp, isWaitingParallelApproval } = getStepStatus(step);
    const agentTeam = getStateDiagramAgentTeam(agents, step?.agent);
    const isWaitingApproval = isWaitingHumanHelp || isWaitingParallelApproval;
    return (
      <div
        key={`${step.name}-${idx}`}
        onClick={(e) => { e.stopPropagation(); onStepClick?.(step); }}
        className={`
          flex items-center gap-1 rounded cursor-pointer transition-colors
          ${compact ? 'px-1 py-0.5 text-[9px]' : 'px-1.5 py-0.5 text-[10px]'}
          ${isWaitingApproval ? 'bg-amber-500 text-black ring-1 ring-amber-300' : isRunningStep ? 'bg-blue-500 text-white' : isFailed ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : isDone ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'}
        `}
      >
        <span className="material-symbols-outlined" style={{ fontSize: compact ? 10 : 11 }}>
          {isWaitingApproval ? 'support_agent' : isRunningStep ? 'play_arrow' : isDone ? 'check_circle' : getStateDiagramStepIcon(step, agentTeam)}
        </span>
        <span className="truncate flex-1">{step.name}</span>
        {!isRunning && (isDone || isFailed) && onRerunFromStep ? (
          <button
            type="button"
            className="nodrag nopan inline-flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-black/10"
            aria-label={`从 ${state.name} / ${step.name} 重新运行`}
            title="从此步骤重新运行"
            onClick={(event) => {
              event.stopPropagation();
              onRerunFromStep(getStateDiagramRerunStepKey(state.name, step.name));
            }}
          >
            <RotateCcw size={compact ? 10 : 11} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div
      className={`
        px-3 py-2 rounded-lg border-2 min-w-[220px] max-w-[320px] transition-all
        ${(isCurrent && isHumanApprovalState) || isHumanHelpPending || isParallelManualJoinPending
          ? 'border-amber-500 bg-amber-50 dark:bg-amber-950 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]'
          : isCurrent
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 shadow-lg'
            : isHumanCheckpoint
              ? 'border-amber-400 bg-amber-50/80 dark:bg-amber-950/80'
              : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800'}
        ${isInitial ? 'ring-2 ring-green-400' : ''}
        ${isFinal ? 'ring-2 ring-red-400' : ''}
      `}
    >
      {/* 每个方向同时支持 source/target，历史回退边可能从任意方向出入。 */}
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="target" position={Position.Bottom} id="bottom" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left} id="left" />

      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          {isHumanCheckpoint && (
            <span className="material-symbols-outlined text-amber-600" style={{ fontSize: 13 }}>notification_important</span>
          )}
          <div className="font-semibold text-xs">{state.name}</div>
        </div>
        <div className="flex gap-1">
          {isInitial && <Badge variant="outline" className="text-[10px] px-1 py-0 bg-green-100 dark:bg-green-900">初始</Badge>}
          {isFinal && <Badge variant="outline" className="text-[10px] px-1 py-0 bg-red-100 dark:bg-red-900">终止</Badge>}
          {isHumanCheckpoint && <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-300 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100">人工审查</Badge>}
          {isHumanHelpPending && <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-300 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100">人工客服</Badge>}
          {isParallelManualJoinPending && <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-300 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100">并发确认</Badge>}
          {isCurrent && (
            <Badge className={`text-[10px] px-1 py-0 ${isHumanApprovalState ? 'bg-amber-500 text-black' : 'bg-blue-500 text-white'}`}>
              {isHumanApprovalState ? '等待处理' : '执行中'}
            </Badge>
          )}
        </div>
      </div>

      {state.description && (
        <div className={`text-[10px] mb-1.5 line-clamp-1 ${isHumanApprovalState ? 'text-amber-700 dark:text-amber-200 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
          {state.description}
        </div>
      )}

      {isHumanHelpPending ? (
        <div className="mb-1.5 rounded border border-amber-300 bg-amber-100 px-1.5 py-1 text-[10px] font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          等待人工客服回复
        </div>
      ) : null}
      {isParallelManualJoinPending ? (
        <div className="mb-1.5 rounded border border-amber-300 bg-amber-100 px-1.5 py-1 text-[10px] font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          等待并发人工确认
        </div>
      ) : null}

      {/* 步骤列表 */}
      <div className="space-y-0.5 mt-1.5">
        {buildStateDiagramStepGroups(state.steps || []).map((group, groupIndex) => {
          const isParallel = !!group.id && group.steps.length > 1;
          if (!isParallel) {
            return renderStepPill(group.steps[0], groupIndex);
          }
          const mode = group.steps[0]?.concurrency?.joinPolicy?.mode || 'all';
          const groupStatus = group.steps.map((step) => getStepStatus(step));
          const hasRunningStep = groupStatus.some((item) => item.isRunningStep);
          const hasPendingApproval = groupStatus.some((item) => item.isWaitingHumanHelp || item.isWaitingParallelApproval);
          return (
            <div
              key={`${group.id}-${groupIndex}`}
              className={`
                rounded-md border p-1
                ${hasRunningStep ? 'border-blue-400 bg-blue-500/10 shadow-sm' : hasPendingApproval ? 'border-amber-400 bg-amber-500/10 shadow-sm' : 'border-cyan-300 bg-cyan-500/10 dark:border-cyan-800'}
              `}
            >
              <div className="mb-1 flex items-center justify-between gap-1 text-[9px] font-medium text-cyan-700 dark:text-cyan-300">
                <span className="flex items-center gap-0.5">
                  <span className="material-symbols-outlined" style={{ fontSize: 10 }}>lan</span>
                  并发
                </span>
                <span className="truncate text-muted-foreground">{stateDiagramJoinPolicyLabels[mode] || mode}</span>
              </div>
              <div className="grid grid-cols-2 gap-0.5">
                {group.steps.map((step, idx) => renderStepPill(step, idx, true))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 人工审查节点：当前状态时显示可选跳转目标 */}
      {isHumanCheckpoint && isCurrent && allowForceTransition && onForceTransition && (
        <div className="mt-1.5 space-y-0.5">
          <div className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold mb-0.5">人工审查待处理，请明确选择下一步：</div>
          {state.transitions && state.transitions.length > 0 ? (
            state.transitions.map((transition: any, idx: number) => (
              <button
                key={idx}
                onClick={(e) => { e.stopPropagation(); onForceTransition(transition.to); }}
                className="w-full text-[10px] px-1.5 py-0.5 rounded border border-orange-300 text-orange-600 hover:bg-orange-100 dark:hover:bg-orange-900/50 transition-colors text-left"
              >
                → {transition.to}
                {transition.label && <span className="text-gray-500 ml-1">({transition.label})</span>}
              </button>
            ))
          ) : (
            <div className="text-[10px] text-gray-500">配置的转移规则为空</div>
          )}
        </div>
      )}

      {/* 强制跳转按钮（仅在运行中且非当前状态时显示，非人工审查节点） */}
      {allowForceTransition && !isCurrent && !isHumanCheckpoint && onForceTransition && (
        <button
          onClick={(e) => { e.stopPropagation(); onForceTransition(state.name); }}
          className="mt-1.5 w-full text-[10px] px-1.5 py-0.5 rounded border border-orange-300 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/30 transition-colors"
        >
          {isRunning ? '强制跳转到此' : '强制恢复到此'}
        </button>
      )}
    </div>
  );
}

// Supervisor 节点组件
function SupervisorNode({ data }: any) {
  const { currentRound, flowCount } = data;

  return (
    <div className="px-3 py-2 rounded-lg border-2 border-purple-400 bg-purple-50 dark:bg-purple-950 min-w-[180px] shadow-lg">
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />

      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-purple-500" style={{ fontSize: 18 }}>hub</span>
        <div className="font-semibold text-sm text-purple-700 dark:text-purple-300">Supervisor</div>
      </div>
      {currentRound !== undefined && (
        <div className="mt-1 text-xs text-purple-600 dark:text-purple-400">
          第 {currentRound + 1} 轮 · {flowCount} 条记录
        </div>
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  stateNode: StateNode,
  supervisorNode: SupervisorNode,
};

const edgeTypes = {
  stateTransition: StateTransitionEdge,
};

// 根据两个节点的相对位置计算最佳连接点
function calculateHandlePositions(
  sourcePos: { x: number; y: number },
  targetPos: { x: number; y: number }
): { sourceHandle: string; targetHandle: string } {
  const dx = targetPos.x - sourcePos.x;
  const dy = targetPos.y - sourcePos.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
    return { sourceHandle: 'right', targetHandle: 'top' };
  }

  // 计算角度，判断主要方向
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  // 根据角度确定连接点
  // -45° 到 45°: 右侧
  // 45° 到 135°: 下方
  // 135° 到 180° 或 -180° 到 -135°: 左侧
  // -135° 到 -45°: 上方

  let sourceHandle = 'right';
  let targetHandle = 'left';

  if (angle >= -45 && angle < 45) {
    // 目标在右侧
    sourceHandle = 'right';
    targetHandle = 'left';
  } else if (angle >= 45 && angle < 135) {
    // 目标在下方
    sourceHandle = 'bottom';
    targetHandle = 'top';
  } else if (angle >= 135 || angle < -135) {
    // 目标在左侧
    sourceHandle = 'left';
    targetHandle = 'right';
  } else {
    // 目标在上方
    sourceHandle = 'top';
    targetHandle = 'bottom';
  }

  return { sourceHandle, targetHandle };
}

function getNodeCenterPosition(node: Node | undefined, fallback?: { x: number; y: number }) {
  const position = node?.position || fallback || { x: 0, y: 0 };
  return {
    x: position.x + (node?.width || 260) / 2,
    y: position.y + (node?.height || 150) / 2,
  };
}

type NodeBounds = {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getNodeBounds(node: Node | undefined, fallback?: { x: number; y: number }): NodeBounds | null {
  if (!node && !fallback) return null;
  const position = node?.position || fallback || { x: 0, y: 0 };
  const width = node?.width || 300;
  const height = node?.height || 170;
  return {
    id: node?.id || '',
    left: position.x,
    right: position.x + width,
    top: position.y,
    bottom: position.y + height,
    centerX: position.x + width / 2,
    centerY: position.y + height / 2,
  };
}

function expandBounds(bounds: NodeBounds, padding: number): NodeBounds {
  return {
    ...bounds,
    left: bounds.left - padding,
    right: bounds.right + padding,
    top: bounds.top - padding,
    bottom: bounds.bottom + padding,
  };
}

function getHandlePoint(bounds: NodeBounds, handle: string | null | undefined): { x: number; y: number } {
  switch (handle) {
    case 'top':
      return { x: bounds.centerX, y: bounds.top };
    case 'right':
      return { x: bounds.right, y: bounds.centerY };
    case 'bottom':
      return { x: bounds.centerX, y: bounds.bottom };
    case 'left':
      return { x: bounds.left, y: bounds.centerY };
    default:
      return { x: bounds.centerX, y: bounds.centerY };
  }
}

function segmentIntersectsBounds(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bounds: NodeBounds,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const tests = [
    { p: -dx, q: start.x - bounds.left },
    { p: dx, q: bounds.right - start.x },
    { p: -dy, q: start.y - bounds.top },
    { p: dy, q: bounds.bottom - start.y },
  ];

  for (const { p, q } of tests) {
    if (Math.abs(p) < 0.0001) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) {
      if (ratio > t1) return false;
      if (ratio > t0) t0 = ratio;
    } else {
      if (ratio < t0) return false;
      if (ratio < t1) t1 = ratio;
    }
  }

  return true;
}

function ensureOffsetMagnitude(value: number, minMagnitude: number): number {
  if (Math.abs(value) >= minMagnitude) return value;
  return value < 0 ? -minMagnitude : minMagnitude;
}

function calculateEdgeAvoidanceOffset(params: {
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  nodesById: Map<string, Node>;
  fallbackPositions: Map<string, { x: number; y: number }>;
}): { x: number; y: number } {
  if (params.source === params.target) return { x: 0, y: 0 };

  const sourceBounds = getNodeBounds(params.nodesById.get(params.source), params.fallbackPositions.get(params.source));
  const targetBounds = getNodeBounds(params.nodesById.get(params.target), params.fallbackPositions.get(params.target));
  if (!sourceBounds || !targetBounds) return { x: 0, y: 0 };

  const start = getHandlePoint(sourceBounds, params.sourceHandle);
  const end = getHandlePoint(targetBounds, params.targetHandle);
  const blockers: NodeBounds[] = [];
  for (const node of params.nodesById.values()) {
    if (node.id === params.source || node.id === params.target) continue;
    const bounds = getNodeBounds(node, params.fallbackPositions.get(node.id));
    if (!bounds) continue;
    const expanded = expandBounds(bounds, 18);
    if (segmentIntersectsBounds(start, end, expanded)) {
      blockers.push(expanded);
    }
  }

  if (!blockers.length) return { x: 0, y: 0 };

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const margin = 44;
  const minMagnitude = 110;
  const maxMagnitude = 300;

  if (Math.abs(dy) >= Math.abs(dx)) {
    const leftOffset = Math.min(...blockers.map((bounds) => bounds.left - start.x - margin));
    const rightOffset = Math.max(...blockers.map((bounds) => bounds.right - start.x + margin));
    const chosen = Math.abs(leftOffset) <= Math.abs(rightOffset) ? leftOffset : rightOffset;
    return {
      x: clampNumber(ensureOffsetMagnitude(chosen, minMagnitude), -maxMagnitude, maxMagnitude),
      y: 0,
    };
  }

  const topOffset = Math.min(...blockers.map((bounds) => bounds.top - start.y - margin));
  const bottomOffset = Math.max(...blockers.map((bounds) => bounds.bottom - start.y + margin));
  const chosen = Math.abs(topOffset) <= Math.abs(bottomOffset) ? topOffset : bottomOffset;
  return {
    x: 0,
    y: clampNumber(ensureOffsetMagnitude(chosen, minMagnitude), -maxMagnitude, maxMagnitude),
  };
}

// 内部组件，使用 useReactFlow
function StateMachineDiagramInner({
  states,
  agents,
  onStateClick,
  onStepClick,
  onRerunFromStep,
  onTransitionClick,
  onForceTransition,
  currentState,
  currentStep,
  activeSteps = EMPTY_ACTIVE_STEPS,
  completedSteps = EMPTY_COMPLETED_STEPS,
  failedSteps = EMPTY_FAILED_STEPS,
  stateHistory = EMPTY_STATE_HISTORY,
  isRunning = false,
  allowForceTransition = isRunning,
  focusedState,
  supervisorFlow = EMPTY_SUPERVISOR_FLOW,
  pendingHumanQuestion,
}: StateMachineDiagramProps) {
  const [showAllEdges, setShowAllEdges] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const { setCenter, fitView: rfFitView } = useReactFlow();
  const initialFitDone = useRef(false);
  const fitViewRef = useRef(rfFitView);
  const onStepClickRef = useRef(onStepClick);
  const onRerunFromStepRef = useRef(onRerunFromStep);
  const onForceTransitionRef = useRef(onForceTransition);

  useEffect(() => {
    fitViewRef.current = rfFitView;
  }, [rfFitView]);

  useEffect(() => {
    onStepClickRef.current = onStepClick;
  }, [onStepClick]);

  useEffect(() => {
    onRerunFromStepRef.current = onRerunFromStep;
  }, [onRerunFromStep]);

  useEffect(() => {
    onForceTransitionRef.current = onForceTransition;
  }, [onForceTransition]);

  const handleStepClick = useCallback((step: any) => {
    onStepClickRef.current?.(step);
  }, []);

  const handleRerunFromStepClick = useCallback((stepName: string) => {
    onRerunFromStepRef.current?.(stepName);
  }, []);

  const handleForceTransitionClick = useCallback((targetState: string) => {
    onForceTransitionRef.current?.(targetState);
  }, []);

  // 转换为 ReactFlow 节点
  const initialNodes: Node[] = useMemo(() => {
    // 计算布局 - 强制使用自动布局
    const layoutPositions = calculateNodeLayout(states, true);

    const nodes = states.map((state, index) => {
      const position = layoutPositions.get(state.name) || {
        x: (index % 3) * 400 + 150,
        y: Math.floor(index / 3) * 350 + 150,
      };

      return {
        id: state.name,
        type: 'stateNode',
        position,
        data: {
          state,
          isInitial: state.isInitial,
          isFinal: state.isFinal,
          isCurrent: currentState === state.name,
          currentStep,
          activeSteps,
          completedSteps,
          failedSteps,
          agents,
          onStepClick: handleStepClick,
          onRerunFromStep: handleRerunFromStepClick,
          onForceTransition: handleForceTransitionClick,
          isRunning,
          allowForceTransition,
          pendingHumanQuestion,
        },
      };
    });

    // 始终添加内置的人工审查节点
    // 将人工审查节点放在视图最下方，居中显示
    const avgX = nodes.length > 0 ? nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length : 500;
    const maxY = nodes.length > 0 ? Math.max(...nodes.map(n => n.position.y)) : 200;

    nodes.push({
      id: '__human_approval__',
      type: 'stateNode',
      position: { x: avgX, y: maxY + 300 }, // 放在最下方，距离其他节点300px
      data: {
        state: {
          name: '人工审查',
          description: '等待人工决策下一步',
          steps: [],
          transitions: states.map(s => ({ to: s.name, condition: {}, priority: 100, label: s.name })),
          type: 'human-checkpoint',
          isInitial: false,
          isFinal: false,
        },
        isInitial: false,
        isFinal: false,
        isCurrent: currentState === '__human_approval__',
        currentStep,
        activeSteps,
        completedSteps,
        failedSteps,
        agents,
        onStepClick: handleStepClick,
        onRerunFromStep: handleRerunFromStepClick,
        onForceTransition: handleForceTransitionClick,
        isRunning,
        allowForceTransition,
        pendingHumanQuestion,
      },
    });

    return nodes;
  }, [states, agents, currentState, currentStep, activeSteps, completedSteps, failedSteps, handleStepClick, handleRerunFromStepClick, handleForceTransitionClick, isRunning, allowForceTransition, pendingHumanQuestion]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  useEffect(() => {
    setNodes((previousNodes) => {
      const previousById = new Map(previousNodes.map((node) => [node.id, node]));
      const nextNodes = initialNodes.map((node) => {
        const previous = previousById.get(node.id);
        return {
          ...node,
          position: previous?.position || node.position,
          selected: previous?.selected,
          dragging: previous?.dragging,
        };
      });
      return nextNodes;
    });
  }, [initialNodes, setNodes]);

  // 转换为 ReactFlow 边
  const initialEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [];
    const edgeSet = new Set<string>(); // 用于去重

    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const fallbackPositions = calculateNodeLayout(states, true);
    const humanApprovalNode = nodesById.get('__human_approval__');
    if (!humanApprovalNode) {
      const avgX = states.length > 0
        ? Array.from(fallbackPositions.values()).reduce((sum, pos) => sum + pos.x, 0) / fallbackPositions.size
        : 500;
      const maxY = states.length > 0
        ? Math.max(...Array.from(fallbackPositions.values()).map(pos => pos.y))
        : 200;
      fallbackPositions.set('__human_approval__', { x: avgX, y: maxY + 300 });
    }

    const executedTransitions = buildExecutedStateTransitions(stateHistory);
    const executedKeys = new Set(executedTransitions.map((transition) => `${transition.from}->${transition.to}`));

    const getHandles = (source: string, target: string) => {
      if (source === target) {
        return { sourceHandle: 'right', targetHandle: 'top' };
      }
      const sourceNode = nodesById.get(source);
      const targetNode = nodesById.get(target);
      return calculateHandlePositions(
        getNodeCenterPosition(sourceNode, fallbackPositions.get(source)),
        getNodeCenterPosition(targetNode, fallbackPositions.get(target)),
      );
    };

    // 历史实际发生的转移优先绘制为蓝线。不要依赖配置 transition，
    // 否则同源同目标的多条配置边会被 from-to 去重吞掉实际线路。
    for (let i = 0; i < executedTransitions.length; i++) {
      const record = executedTransitions[i];
      const edgeId = `history-${i}-${record.from}-${record.to}`;
      const { sourceHandle, targetHandle } = getHandles(record.from, record.to);
      const isSelfLoop = record.from === record.to;
      const avoidanceOffset = calculateEdgeAvoidanceOffset({
        source: record.from,
        target: record.to,
        sourceHandle,
        targetHandle,
        nodesById,
        fallbackPositions,
      });

      edges.push({
        id: edgeId,
        source: record.from,
        target: record.to,
        sourceHandle,
        targetHandle,
        label: `${i + 1}. ${compactEdgeLabel(record.reason)}`,
        type: 'stateTransition',
        animated: true,
        hidden: false,
        style: {
          stroke: EXECUTED_EDGE_COLOR,
          strokeWidth: 3,
        },
        zIndex: 1,
        data: {
          labelColor: EXECUTED_EDGE_COLOR,
          labelOffset: 26,
          labelZIndex: 80,
          curveOffset: 0,
          curveOffsetX: avoidanceOffset.x,
          curveOffsetY: avoidanceOffset.y,
          isSelfLoop,
          loopSize: 125,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: EXECUTED_EDGE_COLOR,
        },
      });
    }

    // 配置的状态转移边
    for (const state of states) {
      if (!state.transitions || !Array.isArray(state.transitions)) {
        continue;
      }

      for (let transitionIndex = 0; transitionIndex < state.transitions.length; transitionIndex += 1) {
        const transition = state.transitions[transitionIndex];
        const edgeKey = `${state.name}->${transition.to}`;

        // 已执行边已经由 stateHistory 画成蓝线，配置边只作为未执行背景路径。
        if (executedKeys.has(edgeKey)) {
          continue;
        }

        const edgeId = `config-${state.name}-${transition.to}-${transitionIndex}`;

        // 检查是否已经添加过这条边
        if (edgeSet.has(edgeKey)) {
          continue;
        }
        edgeSet.add(edgeKey);

        // 检查是否是当前状态的可用转移
        const isCurrentStateTransition = currentState === state.name;

        // 根据边的类型设置不同的样式
        let edgeStyle: any = {};
        let edgeAnimated = false;
        let edgeHidden = false;

        if (isCurrentStateTransition) {
          // 当前状态可用的转移：中等粗细，正常颜色
          edgeStyle = {
            stroke: CONFIG_EDGE_COLOR,
            strokeWidth: 2,
          };
        } else {
          // 其他未使用的转移：细虚线，半透明
          edgeStyle = {
            stroke: MUTED_EDGE_COLOR,
            strokeWidth: 1.5,
            strokeDasharray: '4,5',
            opacity: 0.6,
          };
          // 如果不显示所有边，隐藏这些边
          edgeHidden = !showAllEdges;
        }

        const { sourceHandle, targetHandle } = getHandles(state.name, transition.to);
        const isSelfLoop = state.name === transition.to;
        const siblingTransitions = state.transitions.filter((item: StateTransition) => item.to === transition.to);
        const avoidanceOffset = calculateEdgeAvoidanceOffset({
          source: state.name,
          target: transition.to,
          sourceHandle,
          targetHandle,
          nodesById,
          fallbackPositions,
        });

        edges.push({
          id: edgeId,
          source: state.name,
          target: transition.to,
          sourceHandle,
          targetHandle,
          label: 'transition',
          type: 'stateTransition',
          animated: edgeAnimated,
          hidden: edgeHidden,
          style: edgeStyle,
          zIndex: 0,
          data: {
            labelColor: CONFIG_EDGE_COLOR,
            labelParts: getTransitionPathLabelParts(siblingTransitions),
            labelOffset: 18,
            labelZIndex: 20,
            curveOffset: 0,
            curveOffsetX: avoidanceOffset.x,
            curveOffsetY: avoidanceOffset.y,
            isSelfLoop,
            loopSize: 105,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: isCurrentStateTransition ? CONFIG_EDGE_COLOR : MUTED_EDGE_MARKER_COLOR,
          },
        });
      }
    }

    // 添加从需要人工审查的状态到人工审查节点的连线
    for (const state of states) {
      // 检查状态是否需要人工审查（通过 requireHumanApproval 或 humanApproval 字段）
      if ((state as any).requireHumanApproval || (state as any).humanApproval) {
        const edgeId = `${state.name}-__human_approval__`;

        // 避免重复添加
        if (!edgeSet.has(edgeId)) {
          edgeSet.add(edgeId);

          // 计算连接点
          const sourceNode = nodesById.get(state.name);
          const targetNode = nodesById.get('__human_approval__');
          let sourceHandle = 'bottom'; // 默认从下方连接到人工审查节点
          let targetHandle = 'top';

          const handles = calculateHandlePositions(
            getNodeCenterPosition(sourceNode, fallbackPositions.get(state.name)),
            getNodeCenterPosition(targetNode, fallbackPositions.get('__human_approval__')),
          );
          sourceHandle = handles.sourceHandle;
          targetHandle = handles.targetHandle;

          edges.push({
            id: edgeId,
            source: state.name,
            target: '__human_approval__',
            sourceHandle,
            targetHandle,
            label: '需要人工审查',
            type: 'stateTransition',
            animated: false,
            hidden: !showAllEdges,
            style: {
              stroke: HUMAN_APPROVAL_EDGE_COLOR,
              strokeWidth: 2,
              strokeDasharray: '5,5',
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color: HUMAN_APPROVAL_EDGE_COLOR,
            },
            data: {
              labelColor: HUMAN_APPROVAL_EDGE_COLOR,
              labelOffset: 18,
              labelZIndex: 30,
            },
          });
        }
      }
    }

    return edges;
  }, [states, stateHistory, currentState, showAllEdges, nodes]);

  useEffect(() => {
    if (!initialFitDone.current) {
      initialFitDone.current = true;
      setTimeout(() => fitViewRef.current({ padding: 0.3, maxZoom: 1.2 }), 50);
    }
  }, []);

  const displayEdges = useMemo(() => {
    if (!hoveredNode || showAllEdges) {
      return initialEdges;
    }

    return initialEdges.map((edge) => {
      const isRelated = edge.source === hoveredNode || edge.target === hoveredNode;
      const isInHistory = stateHistory.some(
        h => h.from === edge.source && h.to === edge.target
      );

      if (isRelated && !isInHistory) {
        return {
          ...edge,
          hidden: false,
          style: {
            ...edge.style,
            opacity: 0.6,
          },
        };
      }

      return edge;
    });
  }, [hoveredNode, initialEdges, showAllEdges, stateHistory]);

  // 当 focusedState 改变时，自动聚焦到对应节点（用于视图跳转，不影响执行状态）
  const prevFocusedState = useRef<string | null>(null);
  useEffect(() => {
    if (focusedState && focusedState !== prevFocusedState.current) {
      prevFocusedState.current = focusedState;
      const targetNode = nodes.find(n => n.id === focusedState);
      if (targetNode) {
        setTimeout(() => {
          setCenter(targetNode.position.x, targetNode.position.y, {
            zoom: 1.0,
            duration: 800,
          });
        }, 100);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedState, setCenter, nodes]);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (onStateClick) {
        onStateClick(node.id);
      }
    },
    [onStateClick]
  );

  const onNodeMouseEnter = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setHoveredNode(node.id);
    },
    []
  );

  const onNodeMouseLeave = useCallback(
    () => {
      setHoveredNode(null);
    },
    []
  );

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      if (onTransitionClick) {
        onTransitionClick(edge.source, edge.target);
      }
    },
    [onTransitionClick]
  );

  return (
    <div className="w-full h-full bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
      <ReactFlow
        nodes={nodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onEdgeClick={onEdgeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={{ x: 0, y: 0, zoom: 0.6 }}
        minZoom={0.2}
        maxZoom={1.5}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        attributionPosition="bottom-left"
      >
        <Controls />
        <Background />

        {/* 切换按钮 */}
        <Panel position="top-right">
          <button
            onClick={() => setShowAllEdges(!showAllEdges)}
            className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 shadow-lg text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              {showAllEdges ? 'visibility' : 'visibility_off'}
            </span>
            <span>{showAllEdges ? '隐藏未执行路径' : '显示所有路径'}</span>
          </button>
        </Panel>

        {/* 图例 */}
        <Panel position="bottom-right">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 shadow-lg text-xs">
            <div className="font-semibold mb-2">图例</div>
            <div className="space-y-1">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-blue-500" /><span>当前状态</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full border-2 border-green-400" /><span>初始状态</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full border-2 border-red-400" /><span>终止状态</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full border-2 border-orange-400" /><span>人工检查点</span></div>
              <div className="flex items-center gap-2"><div className="h-0 w-8 border-t-[3px] border-blue-600" /><span>已执行路径</span></div>
              <div className="flex items-center gap-2"><div className="w-8 h-0.5 bg-gray-500" /><span>当前可用</span></div>
              <div className="flex items-center gap-2"><div className="h-0 w-8 border-t-[2px] border-dashed border-gray-400 opacity-40" /><span>未使用路径</span></div>
            </div>
            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-500">
              提示：悬停节点可查看相关路径
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

function getConditionLabel(transition: StateTransition): string {
  const condition = transition.condition;
  const parts: string[] = [];

  if (condition.verdict) {
    const verdictLabels: Record<string, string> = {
      pass: '通过',
      conditional_pass: '有条件通过',
      fail: '失败',
    };
    parts.push(verdictLabels[condition.verdict] || condition.verdict);
  }

  if (condition.issueTypes && condition.issueTypes.length > 0) {
    parts.push(condition.issueTypes.join(','));
  }

  if (condition.severities && condition.severities.length > 0) {
    parts.push(condition.severities.join(','));
  }

  return parts.length > 0 ? parts.join(' | ') : '默认';
}

// 主组件，用 ReactFlowProvider 包装
export default function StateMachineDiagram(props: StateMachineDiagramProps) {
  return (
    <ReactFlowProvider>
      <StateMachineDiagramInner {...props} />
    </ReactFlowProvider>
  );
}
