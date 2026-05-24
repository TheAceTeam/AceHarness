'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import SpriteAvatar from '@/components/SpriteAvatar';
import { Badge } from './ui/badge';
import { resolveAgentAvatarSrc, type AgentAvatarConfig, type AgentRoleType, type AgentTeam } from '@/lib/agent/personas';
import type { StateMachineState } from '@/lib/core/schemas';

type FormationAgent = {
  name: string;
  team?: AgentTeam;
  roleType?: AgentRoleType;
  avatar?: AgentAvatarConfig | string | null;
};

interface AgentFormationDiagramProps {
  states: StateMachineState[];
  agents: FormationAgent[];
  supervisorAgent?: string | null;
  currentStep?: string | null;
  activeSteps?: string[];
  status?: 'idle' | 'running' | 'completed' | 'failed' | 'waiting' | 'stopped';
  className?: string;
}

type FormationNodeData = {
  name: string;
  team: AgentTeam;
  roleType: AgentRoleType;
  avatar?: AgentAvatarConfig | string | null;
  isActive: boolean;
  activeStep?: string | null;
  isSupervisor?: boolean;
  status?: AgentFormationDiagramProps['status'];
  width?: number;
};

const SUPERVISOR_ID = 'formation-supervisor';
const MIN_NODE_WIDTH = 208;
const MAX_NODE_WIDTH = 296;

function estimateNodeWidth(name: string, isSupervisor = false): number {
  const trimmed = name.trim();
  const estimated = trimmed.length <= 8
    ? MIN_NODE_WIDTH
    : Math.min(MAX_NODE_WIDTH, MIN_NODE_WIDTH + (trimmed.length - 8) * 7);
  return isSupervisor ? Math.min(MAX_NODE_WIDTH, estimated + 18) : estimated;
}

function getTeamTone(team: AgentTeam, isSupervisor?: boolean) {
  if (isSupervisor || team === 'black-gold') {
    return {
      ring: 'ring-amber-400/45',
      border: 'border-amber-500/45',
      accent: 'bg-amber-400',
      accentSoft: 'bg-amber-500/12',
      glow: 'rgba(245,158,11,0.18)',
      avatarRing: 'ring-amber-400/45',
      badge: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200',
    };
  }
  if (team === 'red') {
    return {
      ring: 'ring-rose-400/40',
      border: 'border-rose-500/35',
      accent: 'bg-rose-400',
      accentSoft: 'bg-rose-500/10',
      glow: 'rgba(244,63,94,0.16)',
      avatarRing: 'ring-rose-400/35',
      badge: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-200',
    };
  }
  if (team === 'judge') {
    return {
      ring: 'ring-violet-400/40',
      border: 'border-violet-500/35',
      accent: 'bg-violet-400',
      accentSoft: 'bg-violet-500/10',
      glow: 'rgba(168,85,247,0.16)',
      avatarRing: 'ring-violet-400/35',
      badge: 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-200',
    };
  }
  return {
    ring: 'ring-cyan-400/40',
    border: 'border-cyan-500/35',
    accent: 'bg-cyan-400',
    accentSoft: 'bg-cyan-500/10',
    glow: 'rgba(34,211,238,0.16)',
    avatarRing: 'ring-cyan-400/35',
    badge: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200',
  };
}

function normalizeStepKeyVariants(stateName: string, stepName: string): string[] {
  return [
    stepName,
    `${stateName}-${stepName}`,
    `state:${stateName}#${stepName}`,
  ];
}

function buildActiveStepMap(
  states: StateMachineState[],
  currentStep?: string | null,
  activeSteps: string[] = []
): Map<string, string> {
  const activeKeys = new Set<string>([...activeSteps, currentStep || ''].filter(Boolean));
  const map = new Map<string, string>();

  for (const state of states) {
    for (const step of state.steps || []) {
      const variants = normalizeStepKeyVariants(state.name, step.name);
      if (variants.some((key) => activeKeys.has(key))) {
        map.set(step.agent, step.name);
      }
    }
  }

  return map;
}

function getSourceHandleId(angle: number): string {
  const degrees = ((angle * 180 / Math.PI) % 360 + 360) % 360;
  if (degrees >= 45 && degrees < 135) return 'source-bottom';
  if (degrees >= 135 && degrees < 225) return 'source-left';
  if (degrees >= 225 && degrees < 315) return 'source-top';
  return 'source-right';
}

function getTargetHandleId(angle: number): string {
  const opposite = angle + Math.PI;
  const degrees = ((opposite * 180 / Math.PI) % 360 + 360) % 360;
  if (degrees >= 45 && degrees < 135) return 'target-bottom';
  if (degrees >= 135 && degrees < 225) return 'target-left';
  if (degrees >= 225 && degrees < 315) return 'target-top';
  return 'target-right';
}

const AgentFormationNode = memo(function AgentFormationNode({ data }: NodeProps<FormationNodeData>) {
  const avatarSrc = resolveAgentAvatarSrc(data.avatar, data.name, {
    team: data.team,
    roleType: data.roleType,
  });
  const teamTone = getTeamTone(data.team, data.isSupervisor);
  const isWaiting = data.status === 'waiting';
  const isFailed = data.status === 'failed';
  const isCompleted = data.status === 'completed';
  const supervisorTone = isFailed
    ? 'from-red-500/18 via-red-500/8 to-transparent'
    : isWaiting
      ? 'from-amber-500/18 via-amber-500/8 to-transparent'
      : 'from-amber-400/20 via-yellow-400/10 to-transparent';
  const activeTone = isFailed
    ? 'from-red-500/20 via-red-500/10 to-transparent'
    : isCompleted
      ? 'from-emerald-500/18 via-emerald-500/8 to-transparent'
      : isWaiting
        ? 'from-amber-500/18 via-amber-500/8 to-transparent'
        : 'from-cyan-500/20 via-blue-500/10 to-transparent';
  const statusText = data.isSupervisor
    ? isWaiting
      ? '等待人工'
      : isFailed
        ? '调度异常'
        : data.isActive
          ? '指挥中'
          : '待命'
    : data.isActive
      ? '执行中'
      : isCompleted
        ? '已收束'
        : '待命';

  return (
    <motion.div
      initial={false}
      animate={{
        y: data.isActive ? -3 : 0,
        scale: data.isActive ? 1.02 : 1,
        boxShadow: data.isActive
          ? '0 18px 40px rgba(59,130,246,0.20)'
          : data.isSupervisor
            ? `0 12px 28px ${teamTone.glow}`
            : '0 8px 18px rgba(15,23,42,0.08)',
      }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={[
        'relative overflow-hidden rounded-2xl border bg-background/95 px-4 py-3 transition-all',
        data.isActive
          ? 'border-blue-500/80 bg-slate-950/[0.03] dark:bg-blue-950/40'
          : `border-border/70 ${teamTone.accentSoft}`,
        data.isSupervisor ? `ring-1 ${teamTone.ring}` : '',
        isFailed ? 'border-red-500/70' : '',
      ].join(' ')}
      style={{ width: data.width || MIN_NODE_WIDTH }}
    >
      <div className={`absolute inset-x-0 top-0 h-1.5 ${teamTone.accent}`} />
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${data.isSupervisor ? supervisorTone : activeTone}`} />
      {data.isSupervisor ? (
        <motion.div
          className="pointer-events-none absolute inset-[-18%] rounded-[28px] border border-amber-400/20"
          animate={{
            scale: [1, 1.06, 1],
            opacity: isWaiting ? [0.2, 0.45, 0.2] : [0.18, 0.32, 0.18],
          }}
          transition={{ duration: isWaiting ? 2.4 : 3.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : null}
      {data.isActive ? (
        <motion.div
          className="pointer-events-none absolute inset-y-0 left-[-35%] w-[42%] bg-gradient-to-r from-transparent via-white/45 to-transparent dark:via-cyan-200/20"
          animate={{ x: ['0%', '270%'] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
        />
      ) : null}
      {!data.isSupervisor ? (
        <>
          <Handle type="target" id="target-top" position={Position.Top} className="!h-2.5 !w-2.5 !border-0 !bg-transparent !opacity-0" />
          <Handle type="target" id="target-bottom" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-0 !bg-transparent !opacity-0" />
          <Handle type="target" id="target-left" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-transparent !opacity-0" />
          <Handle type="target" id="target-right" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-transparent !opacity-0" />
        </>
      ) : null}
      {data.isSupervisor ? (
        <>
          <Handle type="source" id="source-top" position={Position.Top} className="!h-2.5 !w-2.5 !border-0 !bg-transparent !opacity-0" />
          <Handle type="source" id="source-bottom" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-0 !bg-transparent !opacity-0" />
          <Handle type="source" id="source-left" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-transparent !opacity-0" />
          <Handle type="source" id="source-right" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-transparent !opacity-0" />
        </>
      ) : null}

      <div className="flex items-center gap-3">
        <SpriteAvatar
          avatar={avatarSrc}
          seed={data.name}
          category="agent-default"
          alt={data.name}
          fallback={data.name.charAt(0).toUpperCase()}
          className={`h-11 w-11 ring-2 ${teamTone.avatarRing}`}
          fallbackClassName="bg-primary/10 text-xs font-semibold text-primary"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 break-words text-sm font-semibold leading-5">{data.name}</div>
            {data.isSupervisor ? (
              <Badge variant="outline" className={`h-5 shrink-0 text-[10px] ${teamTone.badge}`}>Supervisor</Badge>
            ) : null}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {statusText}
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {data.isSupervisor && (isWaiting || isFailed) ? (
          <motion.div
            key={`${data.name}-${data.status}`}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className={[
              'mt-3 inline-flex rounded-full border px-2 py-1 text-[10px] font-medium',
              isFailed
                ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200',
            ].join(' ')}
          >
            {isFailed ? '需要介入' : '人工确认中'}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {data.activeStep ? (
        <motion.div
          key={data.activeStep}
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          className="mt-3 rounded-xl border border-blue-500/20 bg-blue-500/8 px-2.5 py-2"
        >
          <div className="text-[10px] text-blue-700 dark:text-blue-300">当前步骤</div>
          <div className="mt-0.5 truncate text-xs font-medium text-blue-900 dark:text-blue-100">{data.activeStep}</div>
        </motion.div>
      ) : null}
    </motion.div>
  );
});

const nodeTypes: NodeTypes = {
  formationNode: AgentFormationNode,
};

function buildGraph(
  agents: FormationAgent[],
  states: StateMachineState[],
  supervisorAgent?: string | null,
  currentStep?: string | null,
  activeSteps: string[] = [],
  status?: AgentFormationDiagramProps['status']
): { nodes: Node<FormationNodeData>[]; edges: Edge[] } {
  const activeStepMap = buildActiveStepMap(states, currentStep, activeSteps);
  const supervisorName = supervisorAgent || agents.find((agent) => agent.roleType === 'supervisor')?.name || 'Supervisor';
  const supervisorConfig = agents.find((agent) => agent.name === supervisorName);
  const workerAgents = agents.filter((agent) => agent.name !== supervisorName);
  const supervisorWidth = estimateNodeWidth(supervisorName, true);
  const widestWorker = workerAgents.reduce((max, agent) => Math.max(max, estimateNodeWidth(agent.name)), MIN_NODE_WIDTH);
  const ringRadiusBase = Math.max(230, widestWorker * 0.9 + 92);
  const ringCapacity = 6;

  const nodes: Node<FormationNodeData>[] = [
    {
      id: SUPERVISOR_ID,
      type: 'formationNode',
      position: { x: 0, y: 0 },
      zIndex: 2,
      data: {
        name: supervisorName,
        team: supervisorConfig?.team || 'black-gold',
        roleType: 'supervisor',
        avatar: supervisorConfig?.avatar,
        isActive: status === 'running' || status === 'waiting',
        activeStep: status === 'waiting' ? '等待人工回复' : null,
        isSupervisor: true,
        status,
        width: supervisorWidth,
      },
      draggable: false,
    },
  ];

  const edges: Edge[] = [];

  workerAgents.forEach((agent, index) => {
    const ringIndex = Math.floor(index / ringCapacity);
    const indexInRing = index % ringCapacity;
    const countInRing = Math.min(ringCapacity, workerAgents.length - ringIndex * ringCapacity);
    const radius = ringRadiusBase + ringIndex * 170;
    const angle = (-Math.PI / 2) + (indexInRing / Math.max(countInRing, 1)) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius + 70;

    nodes.push({
      id: `formation-agent:${agent.name}`,
      type: 'formationNode',
      position: { x, y },
      zIndex: 2,
      data: {
        name: agent.name,
        team: agent.team || 'blue',
        roleType: agent.roleType || 'normal',
        avatar: agent.avatar,
        isActive: activeStepMap.has(agent.name),
        activeStep: activeStepMap.get(agent.name) || null,
        status,
        width: estimateNodeWidth(agent.name),
      },
      draggable: false,
    });

    edges.push({
      id: `formation-edge:${supervisorName}->${agent.name}`,
      source: SUPERVISOR_ID,
      target: `formation-agent:${agent.name}`,
      sourceHandle: getSourceHandleId(angle),
      targetHandle: getTargetHandleId(angle),
      type: 'default',
      zIndex: 0,
      animated: activeStepMap.has(agent.name) || status === 'running' || status === 'waiting',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: activeStepMap.has(agent.name)
          ? status === 'waiting'
            ? '#f59e0b'
            : status === 'failed'
              ? '#ef4444'
              : '#22d3ee'
          : '#94a3b8',
      },
      style: {
        stroke: activeStepMap.has(agent.name)
          ? status === 'waiting'
            ? '#f59e0b'
            : status === 'failed'
              ? '#ef4444'
              : '#22d3ee'
          : '#94a3b8',
        strokeWidth: activeStepMap.has(agent.name) ? 3 : 1.6,
        strokeDasharray: activeStepMap.has(agent.name) ? '10 6' : '6 8',
        opacity: activeStepMap.has(agent.name) ? 0.95 : 0.55,
      },
    });
  });

  return { nodes, edges };
}

function AgentFormationDiagramInner(props: AgentFormationDiagramProps) {
  const { fitView } = useReactFlow();
  const graph = useMemo(
    () => buildGraph(props.agents, props.states, props.supervisorAgent, props.currentStep, props.activeSteps, props.status),
    [props.agents, props.states, props.supervisorAgent, props.currentStep, props.activeSteps, props.status]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  const layoutSignatureRef = useRef('');

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph, setEdges, setNodes]);

  useEffect(() => {
    const signature = JSON.stringify({
      agents: props.agents.map((agent) => agent.name),
      states: props.states.map((state) => `${state.name}:${state.steps?.length || 0}`),
    });
    const layoutChanged = layoutSignatureRef.current !== signature;
    layoutSignatureRef.current = signature;

    const timer = window.setTimeout(() => {
      fitView({
        padding: layoutChanged ? 0.08 : 0.12,
        duration: 240,
        includeHiddenNodes: false,
        maxZoom: 1.18,
      });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [fitView, props.agents, props.states, nodes.length, edges.length]);

  if (props.agents.length === 0) {
    return (
      <div className="flex h-full min-h-[clamp(420px,46vh,620px)] items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
        当前没有可展示的 Agent 编队
      </div>
    );
  }

  return (
    <div className={`relative w-full overflow-hidden rounded-2xl border border-border/60 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_32%),linear-gradient(180deg,rgba(15,23,42,0.03),rgba(15,23,42,0.01))] dark:bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_32%),linear-gradient(180deg,rgba(2,6,23,0.88),rgba(15,23,42,0.74))] ${props.className || 'h-[clamp(420px,46vh,620px)]'}`}>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.10)_1px,transparent_1px)] bg-[size:32px_32px]" />
      <motion.div
        className="pointer-events-none absolute left-1/2 top-[88px] h-40 w-40 -translate-x-1/2 rounded-full bg-amber-400/10 blur-3xl"
        animate={{
          scale: props.status === 'running' || props.status === 'waiting' ? [1, 1.12, 1] : 1,
          opacity: props.status === 'failed' ? 0.18 : [0.12, 0.22, 0.12],
        }}
        transition={{ duration: props.status === 'waiting' ? 2.2 : 3.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 1.18 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        edgesFocusable={false}
        edgesUpdatable={false}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick
        minZoom={0.35}
        defaultViewport={{ x: 0, y: 0, zoom: 0.92 }}
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} />
        <Background color="rgba(148,163,184,0.28)" gap={20} />
      </ReactFlow>
    </div>
  );
}

export default function AgentFormationDiagram(props: AgentFormationDiagramProps) {
  return (
    <ReactFlowProvider>
      <AgentFormationDiagramInner {...props} />
    </ReactFlowProvider>
  );
}
