'use client';

import { useMemo, useEffect } from 'react';
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
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Badge } from './ui/badge';
import type { StateMachineState } from '@/lib/core/schemas';

interface AgentFlowRecord {
  id: string;
  type: 'stream' | 'request' | 'response' | 'supervisor';
  fromAgent: string;
  toAgent: string;
  message?: string;
  stateName: string;
  stepName: string;
  round: number;
  timestamp: string;
}

interface AgentFlowDiagramProps {
  flow: AgentFlowRecord[];
  states: StateMachineState[];
  currentRound?: number;
  currentStep?: string | null;
}

type StepRef = {
  stateName: string;
  stepName: string;
  agent: string;
};

const SUPERVISOR_NODE_ID = 'supervisor';
const USER_NODE_ID = 'user';

const getTypeColor = (type: string) => {
  switch (type) {
    case 'stream':
      return '#22c55e';
    case 'request':
      return '#3b82f6';
    case 'response':
      return '#a855f7';
    case 'supervisor':
      return '#f97316';
    case 'user':
      return '#6b7280';
    default:
      return '#9ca3af';
  }
};

const getTypeLabel = (type: string) => {
  switch (type) {
    case 'stream': return '执行';
    case 'request': return '请求';
    case 'response': return '响应';
    case 'supervisor': return '路由';
    case 'user': return '用户';
    default: return type;
  }
};

const stepNodeId = (stateName: string, stepName: string) => `step:${stateName}::${stepName}`;

function StepNode({ data }: any) {
  const { stateName, stepName, agentName, isActive } = data;

  return (
    <div
      className={[
        'px-4 py-3 rounded-xl border-2 min-w-[220px] transition-all shadow-lg cursor-move bg-white dark:bg-gray-800',
        isActive
          ? 'border-green-500 bg-green-50 dark:bg-green-950 shadow-green-200 dark:shadow-green-900'
          : 'border-blue-300 hover:shadow-xl',
      ].join(' ')}
    >
      <Handle id="target-bottom" type="target" position={Position.Bottom} className="!bg-gray-400" />
      <Handle id="target-left" type="target" position={Position.Left} className="!bg-gray-400" />

      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl bg-blue-100 dark:bg-blue-900">
          🤖
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-bold text-sm">{stepName}</div>
            <Badge variant="outline" className="text-[10px] py-0 h-5">
              {stateName}
            </Badge>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{agentName}</div>
        </div>
      </div>

      {isActive && (
        <div className="mt-2 flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-xs text-blue-600 dark:text-blue-400">执行中</span>
        </div>
      )}

      <Handle id="source-top" type="source" position={Position.Top} className="!bg-gray-400" />
      <Handle id="source-right" type="source" position={Position.Right} className="!bg-gray-400" />
    </div>
  );
}

function SpecialNode({ data }: any) {
  const { title, subtitle, icon, colorClass, flowCount, currentRound } = data;

  return (
    <div className={`px-6 py-5 rounded-2xl border-2 min-w-[220px] shadow-xl cursor-move ${colorClass}`}>
      <Handle id="target-bottom" type="target" position={Position.Bottom} className="!bg-orange-400" />
      <Handle id="target-left" type="target" position={Position.Left} className="!bg-orange-400" />

      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-white/60 dark:bg-black/20 flex items-center justify-center">
          <span className="text-2xl">{icon}</span>
        </div>
        <div className="flex flex-col">
          <div className="font-bold text-lg">{title}</div>
          <div className="text-xs opacity-80">{subtitle}</div>
        </div>
      </div>

      {typeof flowCount === 'number' && (
        <div className="mt-3 flex items-center gap-2">
          {typeof currentRound === 'number' && (
            <Badge className="bg-white/80 text-black text-xs">
              第 {currentRound + 1} 轮
            </Badge>
          )}
          <span className="text-xs opacity-80">{flowCount} 条流转</span>
        </div>
      )}

      <Handle id="source-top" type="source" position={Position.Top} className="!bg-orange-400" />
      <Handle id="source-right" type="source" position={Position.Right} className="!bg-orange-400" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  stepNode: StepNode,
  specialNode: SpecialNode,
};

function buildStepRefs(states: StateMachineState[]): StepRef[] {
  const refs: StepRef[] = [];
  for (const state of states) {
    for (const step of state.steps || []) {
      refs.push({
        stateName: state.name,
        stepName: step.name,
        agent: step.agent,
      });
    }
  }
  return refs;
}

function findState(states: StateMachineState[], stateName: string): StateMachineState | undefined {
  return states.find((state) => state.name === stateName);
}

function findStepIndex(state: StateMachineState | undefined, stepName: string): number {
  if (!state) return -1;
  return state.steps.findIndex((step) => step.name === stepName);
}

function parseTargetStateFromMessage(message?: string): string | null {
  if (!message) return null;
  const match = message.match(/状态流转:\s*.+?\s*->\s*([^(]+?)(?:\s*\(|$)/);
  return match?.[1]?.trim() || null;
}

function findStepRefByAgent(
  refs: StepRef[],
  agent: string,
  preferredState?: string,
  afterStepInState?: string
): StepRef | null {
  const sameState = refs.filter((ref) => ref.agent === agent && (!preferredState || ref.stateName === preferredState));
  if (sameState.length > 0) {
    if (afterStepInState) {
      const idx = sameState.findIndex((ref) => ref.stepName === afterStepInState);
      if (idx >= 0 && idx < sameState.length - 1) return sameState[idx + 1];
    }
    return sameState[0];
  }
  return refs.find((ref) => ref.agent === agent) || null;
}

function resolveStepNodeId(
  record: AgentFlowRecord,
  refs: StepRef[],
  states: StateMachineState[],
  direction: 'from' | 'to'
): string | null {
  const agent = direction === 'from' ? record.fromAgent : record.toAgent;
  if (!agent) return null;
  if (agent === 'supervisor') return SUPERVISOR_NODE_ID;
  if (agent === 'user') return USER_NODE_ID;

  const sourceState = findState(states, record.stateName);
  const sourceIndex = findStepIndex(sourceState, record.stepName);

  if (direction === 'from') {
    if (record.stateName && record.stepName) {
      return stepNodeId(record.stateName, record.stepName);
    }
    const fallback = findStepRefByAgent(refs, agent);
    return fallback ? stepNodeId(fallback.stateName, fallback.stepName) : null;
  }

  if (record.type === 'request') {
    return SUPERVISOR_NODE_ID;
  }

  if (record.type === 'supervisor') {
    if (agent === 'user') return USER_NODE_ID;
    const targetRef = findStepRefByAgent(refs, agent, record.stateName, record.stepName);
    return targetRef ? stepNodeId(targetRef.stateName, targetRef.stepName) : null;
  }

  if (record.type === 'stream') {
    if (sourceState && sourceIndex >= 0 && sourceIndex < sourceState.steps.length - 1) {
      const nextStep = sourceState.steps[sourceIndex + 1];
      if (nextStep.agent === agent) {
        return stepNodeId(sourceState.name, nextStep.name);
      }
    }

    const nextStateName = parseTargetStateFromMessage(record.message);
    if (nextStateName) {
      const nextState = findState(states, nextStateName);
      if (nextState?.steps?.[0]) {
        return stepNodeId(nextState.name, nextState.steps[0].name);
      }
    }
  }

  const fallback = findStepRefByAgent(refs, agent, record.stateName, record.stepName);
  return fallback ? stepNodeId(fallback.stateName, fallback.stepName) : null;
}

function calculateNodes(
  states: StateMachineState[],
  flow: AgentFlowRecord[],
  currentRound?: number,
  currentStep?: string | null
): Node[] {
  const nodes: Node[] = [];
  const stateGapX = 340;
  const stepGapY = 180;
  const baseX = 120;
  const baseY = 260;
  const centerX = baseX + Math.max(states.length - 1, 0) * stateGapX / 2;

  nodes.push({
    id: SUPERVISOR_NODE_ID,
    type: 'specialNode',
    position: { x: centerX, y: 20 },
    data: {
      title: 'Supervisor',
      subtitle: '信息路由中转',
      icon: '⚡',
      colorClass: 'border-orange-400 bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300 shadow-orange-200 dark:shadow-orange-900',
      flowCount: flow.length,
      currentRound: currentRound ?? 0,
    },
  });

  const hasUser = flow.some((record) => record.fromAgent === 'user' || record.toAgent === 'user');
  if (hasUser) {
    nodes.push({
      id: USER_NODE_ID,
      type: 'specialNode',
      position: { x: centerX + 320, y: 20 },
      data: {
        title: '用户',
        subtitle: '人工输入/审批',
        icon: '👤',
        colorClass: 'border-gray-400 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 shadow-gray-200 dark:shadow-gray-900',
      },
    });
  }

  states.forEach((state, stateIndex) => {
    const stateX = baseX + stateIndex * stateGapX;
    state.steps.forEach((step, stepIndex) => {
      const compositeStep = `${state.name}-${step.name}`;
      nodes.push({
        id: stepNodeId(state.name, step.name),
        type: 'stepNode',
        position: { x: stateX, y: baseY + stepIndex * stepGapY },
        data: {
          stateName: state.name,
          stepName: step.name,
          agentName: step.agent,
          isActive: currentStep === compositeStep || currentStep === step.name,
        },
      });
    });
  });

  return nodes;
}

function calculateEdges(flow: AgentFlowRecord[], nodes: Node[], states: StateMachineState[]): Edge[] {
  const edges: Edge[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const refs = buildStepRefs(states);
  const sortedFlow = [...flow].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (const record of sortedFlow) {
    if (record.type === 'response') {
      continue;
    }

    const sourceId = resolveStepNodeId(record, refs, states, 'from');
    const targetId = resolveStepNodeId(record, refs, states, 'to');
    if (!sourceId || !targetId || sourceId === targetId) {
      continue;
    }
    if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) {
      continue;
    }

    const sourceNode = nodes.find((node) => node.id === sourceId);
    const targetNode = nodes.find((node) => node.id === targetId);
    const dx = (targetNode?.position.x ?? 0) - (sourceNode?.position.x ?? 0);
    const dy = (targetNode?.position.y ?? 0) - (sourceNode?.position.y ?? 0);
    const useVerticalHandles = Math.abs(dy) >= Math.abs(dx);
    const color = getTypeColor(record.type);

    edges.push({
      id: `${record.id}-${sourceId}-${targetId}`,
      source: sourceId,
      target: targetId,
      sourceHandle: useVerticalHandles ? 'source-top' : 'source-right',
      targetHandle: useVerticalHandles ? 'target-bottom' : 'target-left',
      label: getTypeLabel(record.type),
      type: 'default',
      animated: true,
      style: { stroke: color, strokeWidth: 3 },
      labelStyle: { fontSize: 10, fill: color },
      labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    });
  }

  return edges;
}

function AgentFlowDiagramInner({
  flow,
  states,
  currentRound,
  currentStep,
}: AgentFlowDiagramProps) {
  const nodesData = useMemo(
    () => calculateNodes(states, flow, currentRound, currentStep),
    [states, flow, currentRound, currentStep]
  );
  const edgesData = useMemo(
    () => calculateEdges(flow, nodesData, states),
    [flow, nodesData, states]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(nodesData);
  const [edges, setEdges, onEdgesChange] = useEdgesState(edgesData);

  useEffect(() => {
    setNodes(nodesData);
    setEdges(edgesData);
  }, [nodesData, edgesData, setNodes, setEdges]);

  if (nodesData.length <= 1) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500 p-8">
          <div className="text-5xl mb-4">🔄</div>
          <p className="text-lg font-medium">暂无 Agent 流转记录</p>
          <p className="text-sm mt-2 text-gray-400">Agent 执行时将显示状态步骤流转图</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView={false}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.1}
        maxZoom={2}
        disableKeyboardA11y
        proOptions={{ hideAttribution: true }}
      >
        <Controls />
        <Background color="#e5e7eb" gap={20} />
        <Panel position="top-right" className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg border">
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="font-medium">步骤/状态流转</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="font-medium">请求</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <span className="font-medium">Supervisor 路由</span>
            </div>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            提示：节点按状态/步骤实例展开，同名 Agent 不再合并
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export default function AgentFlowDiagram(props: AgentFlowDiagramProps) {
  return (
    <ReactFlowProvider>
      <AgentFlowDiagramInner {...props} />
    </ReactFlowProvider>
  );
}
