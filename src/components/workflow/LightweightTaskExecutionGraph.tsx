'use client';

import { useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { GitBranch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/core/utils';
import {
  adaptLightweightTaskBoardEvidence,
  type LightweightTaskBoardInput,
  type LightweightTaskBoardTask,
  type LightweightTaskStatus,
} from './lightweight-task-board-evidence';

type TaskGraphMode = 'serial' | 'parallel' | 'mixed' | 'unknown';

export interface LightweightTaskExecutionGraphModel {
  available: boolean;
  nodes: Node[];
  edges: Edge[];
  hasExplicitDependencies: boolean;
  parallelGroups: Array<{ id: string; taskIds: string[] }>;
  serialTaskIds: string[];
  mode: TaskGraphMode;
}

interface LightweightTaskExecutionGraphProps extends LightweightTaskBoardInput {
  tasks?: LightweightTaskBoardTask[];
  className?: string;
}

interface LightweightTaskExecutionGraphInnerProps {
  tasks: LightweightTaskBoardTask[];
  provisional?: boolean;
  className?: string;
}

const TASK_NODE_WIDTH = 252;
const TASK_NODE_HEIGHT = 118;
const COLUMN_GAP = 330;
const ROW_GAP = 150;

const statusLabel: Record<LightweightTaskStatus, string> = {
  pending: '待处理',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  blocked: '阻塞',
  skipped: '已跳过',
  unknown: '状态未知',
};

function text(value: unknown): string {
  return String(value || '').trim();
}

function normalizeAlias(value: unknown): string {
  return text(value).toLowerCase();
}

function statusNodeClass(status: LightweightTaskStatus, mode: TaskGraphMode): string {
  const modeClass = mode === 'parallel'
    ? 'border-cyan-400 bg-cyan-50 dark:bg-cyan-950/50'
    : mode === 'serial'
      ? 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900'
      : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900';
  if (status === 'running') return 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-500/10 dark:bg-blue-950/50';
  if (status === 'completed') return 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40';
  if (status === 'failed') return 'border-red-500 bg-red-50 dark:bg-red-950/40';
  if (status === 'blocked') return 'border-amber-500 bg-amber-50 dark:bg-amber-950/40';
  return modeClass;
}

function statusBadgeClass(status: LightweightTaskStatus): string {
  if (status === 'running') return 'bg-blue-500 text-white';
  if (status === 'completed') return 'bg-emerald-500 text-white';
  if (status === 'failed') return 'bg-red-500 text-white';
  if (status === 'blocked') return 'bg-amber-500 text-black';
  return '';
}

function taskMode(task: LightweightTaskBoardTask): TaskGraphMode {
  if (task.executionMode === 'parallel' || task.parallelGroup) return 'parallel';
  if (task.executionMode === 'serial') return 'serial';
  return 'unknown';
}

function graphMode(tasks: LightweightTaskBoardTask[]): TaskGraphMode {
  const hasParallel = tasks.some((task) => taskMode(task) === 'parallel');
  const hasSerial = tasks.some((task) => taskMode(task) === 'serial');
  if (hasParallel && hasSerial) return 'mixed';
  if (hasParallel) return 'parallel';
  if (hasSerial) return 'serial';
  return 'unknown';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function runtimeFallbackStatus(input: LightweightTaskBoardInput, stepName: string): LightweightTaskStatus {
  const currentStep = text(input.run?.currentStep);
  const aliases = [stepName, currentStep].filter(Boolean);
  const matches = (value: unknown) => {
    const entries = stringList(value);
    return aliases.some((alias) => entries.some((entry) => entry === alias || entry.endsWith(`-${alias}`)));
  };
  if (matches(input.run?.failedSteps)) return 'failed';
  if (matches(input.run?.completedSteps)) return 'completed';
  if (matches(input.run?.activeSteps)) return 'running';

  const status = text(input.run?.status).toLowerCase().replace(/[\s_]+/g, '-');
  if (['failed', 'crashed', 'error'].includes(status)) return 'failed';
  if (['completed', 'complete', 'success', 'succeeded'].includes(status)) return 'completed';
  if (['running', 'in-progress', 'active'].includes(status)) return 'running';
  if (['blocked', 'waiting', 'paused'].includes(status)) return 'blocked';
  if (['cancelled', 'canceled', 'stopped'].includes(status)) return 'skipped';
  return 'pending';
}

export function buildLightweightRuntimeFallbackTask(
  input: LightweightTaskBoardInput,
): LightweightTaskBoardTask | null {
  const configuredStep = input.workflow?.states
    ?.flatMap((state) => state.steps || [])
    .find((step) => text(step.name) || text(step.agent));
  const currentStep = text(input.run?.currentStep);
  const stepName = text(configuredStep?.name)
    || (currentStep.includes('-') ? currentStep.slice(currentStep.indexOf('-') + 1) : currentStep)
    || '执行任务';
  if (!stepName) return null;

  return {
    id: 'lightweight-runtime-step',
    title: stepName,
    owner: text(configuredStep?.agent) || text(input.workflow?.primaryAgent) || text(input.run?.primaryAgent) || null,
    dependencies: [],
    parallelGroup: null,
    executionMode: 'serial',
    status: runtimeFallbackStatus(input, stepName),
    progressPercent: runtimeFallbackStatus(input, stepName) === 'completed' ? 100 : null,
  };
}

function resolveTaskAliasMap(tasks: LightweightTaskBoardTask[]): Map<string, string> {
  const aliases = new Map<string, string>();
  tasks.forEach((task) => {
    const taskId = text(task.id);
    if (!taskId) return;
    aliases.set(normalizeAlias(task.id), taskId);
    aliases.set(normalizeAlias(task.title), taskId);
  });
  return aliases;
}

function resolveKnownDependencies(tasks: LightweightTaskBoardTask[]): Map<string, string[]> {
  const aliases = resolveTaskAliasMap(tasks);
  const dependencies = new Map<string, string[]>();
  tasks.forEach((task) => {
    const taskId = text(task.id);
    const known = Array.from(new Set(
      task.dependencies
        .map((dependency) => aliases.get(normalizeAlias(dependency)) || '')
        .filter((dependencyId) => dependencyId && dependencyId !== taskId),
    ));
    dependencies.set(taskId, known);
  });
  return dependencies;
}

function calculateTaskDepths(tasks: LightweightTaskBoardTask[], dependencies: Map<string, string[]>): Map<string, number> {
  const taskIds = new Set(tasks.map((task) => task.id));
  const visiting = new Set<string>();
  const depths = new Map<string, number>();

  const depthFor = (taskId: string): number => {
    if (depths.has(taskId)) return depths.get(taskId) || 0;
    if (visiting.has(taskId)) return 0;
    visiting.add(taskId);
    const dependencyDepths = (dependencies.get(taskId) || [])
      .filter((dependencyId) => taskIds.has(dependencyId))
      .map((dependencyId) => depthFor(dependencyId) + 1);
    visiting.delete(taskId);
    const depth = dependencyDepths.length ? Math.max(...dependencyDepths) : 0;
    depths.set(taskId, depth);
    return depth;
  };

  tasks.forEach((task) => depthFor(task.id));
  return depths;
}

function edgeColorForStatus(source: LightweightTaskBoardTask, target: LightweightTaskBoardTask): string {
  if (target.status === 'running') return '#2563eb';
  if (target.status === 'failed' || source.status === 'failed') return '#dc2626';
  if (source.status === 'completed') return '#059669';
  return '#64748b';
}

export function buildLightweightTaskExecutionGraphModel(
  tasks: LightweightTaskBoardTask[],
): LightweightTaskExecutionGraphModel {
  if (!tasks.length) {
    return {
      available: false,
      nodes: [],
      edges: [],
      hasExplicitDependencies: false,
      parallelGroups: [],
      serialTaskIds: [],
      mode: 'unknown',
    };
  }

  const dependencies = resolveKnownDependencies(tasks);
  const depths = calculateTaskDepths(tasks, dependencies);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const maxDepth = Math.max(0, ...Array.from(depths.values()));
  const columns = Array.from({ length: maxDepth + 1 }, () => [] as LightweightTaskBoardTask[]);
  tasks.forEach((task) => {
    const depth = depths.get(task.id) || 0;
    columns[depth].push(task);
  });

  const parallelGroups = Array.from(new Map(
    tasks
      .filter((task) => task.parallelGroup)
      .map((task) => [task.parallelGroup as string, tasks.filter((item) => item.parallelGroup === task.parallelGroup).map((item) => item.id)]),
  )).map(([id, taskIds]) => ({ id, taskIds }));
  const serialTaskIds = tasks.filter((task) => taskMode(task) === 'serial').map((task) => task.id);

  const nodes: Node[] = [];
  columns.forEach((columnTasks, columnIndex) => {
    const sorted = [...columnTasks].sort((left, right) => {
      const leftGroup = left.parallelGroup || '';
      const rightGroup = right.parallelGroup || '';
      if (leftGroup !== rightGroup) return leftGroup.localeCompare(rightGroup, 'zh-CN');
      return tasks.indexOf(left) - tasks.indexOf(right);
    });
    const columnHeight = Math.max(0, (sorted.length - 1) * ROW_GAP);
    sorted.forEach((task, rowIndex) => {
      nodes.push({
        id: task.id,
        type: 'lightweightTask',
        position: {
          x: 40 + columnIndex * COLUMN_GAP,
          y: 40 + rowIndex * ROW_GAP - columnHeight / 2,
        },
        data: {
          task,
          mode: taskMode(task),
          unresolvedDependencyCount: task.dependencies.length - (dependencies.get(task.id)?.length || 0),
        },
        style: { width: TASK_NODE_WIDTH, minHeight: TASK_NODE_HEIGHT },
      });
    });
  });

  const edges: Edge[] = [];
  dependencies.forEach((dependencyIds, taskId) => {
    const target = taskById.get(taskId);
    if (!target) return;
    dependencyIds.forEach((dependencyId) => {
      const source = taskById.get(dependencyId);
      if (!source) return;
      const color = edgeColorForStatus(source, target);
      edges.push({
        id: `${dependencyId}->${taskId}`,
        source: dependencyId,
        target: taskId,
        sourceHandle: 'right',
        targetHandle: 'left',
        label: '依赖',
        type: 'smoothstep',
        animated: target.status === 'running',
        style: {
          stroke: color,
          strokeWidth: target.status === 'running' ? 3 : 2,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
          width: 16,
          height: 16,
        },
      });
    });
  });

  return {
    available: true,
    nodes,
    edges,
    hasExplicitDependencies: edges.length > 0,
    parallelGroups,
    serialTaskIds,
    mode: graphMode(tasks),
  };
}

function TaskNode({ data }: { data: { task: LightweightTaskBoardTask; mode: TaskGraphMode; unresolvedDependencyCount: number } }) {
  const { task, mode, unresolvedDependencyCount } = data;
  return (
    <div
      className={cn(
        'rounded-lg border-2 px-3 py-2 shadow-sm transition-all',
        statusNodeClass(task.status, mode),
      )}
      data-testid={`lightweight-task-graph-node-${task.id}`}
    >
      <Handle type="target" position={Position.Left} id="left" className="!bg-slate-400" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-slate-400" />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold">{task.title}</div>
          <div className="mt-1 truncate text-[10px] text-muted-foreground">{task.id}</div>
        </div>
        <Badge variant={task.status === 'unknown' ? 'outline' : 'secondary'} className={cn('shrink-0 px-1 py-0 text-[10px]', statusBadgeClass(task.status))}>
          {statusLabel[task.status]}
        </Badge>
      </div>

      <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
        <Badge variant="outline" className="px-1 py-0 text-[10px]">
          {mode === 'parallel' ? '并行任务' : mode === 'serial' ? '串行任务' : '执行方式未知'}
        </Badge>
        {task.parallelGroup ? (
          <Badge variant="outline" className="border-cyan-300 bg-cyan-500/10 px-1 py-0 text-[10px] text-cyan-700 dark:text-cyan-300">
            {task.parallelGroup}
          </Badge>
        ) : null}
      </div>

      {task.owner ? <div className="mt-2 truncate text-[10px] text-muted-foreground">负责人：{task.owner}</div> : null}
      {task.progressPercent !== null ? (
        <div className="mt-2">
          <Progress value={task.progressPercent} className="h-1.5" aria-label={`${task.title} 完成 ${task.progressPercent}%`} />
        </div>
      ) : null}
      {unresolvedDependencyCount > 0 ? (
        <div className="mt-2 text-[10px] text-muted-foreground">另有 {unresolvedDependencyCount} 项依赖未匹配到任务节点</div>
      ) : null}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  lightweightTask: TaskNode,
};

function LightweightTaskExecutionGraphInner({ tasks = [], provisional = false, className }: LightweightTaskExecutionGraphInnerProps) {
  const model = useMemo(() => buildLightweightTaskExecutionGraphModel(tasks), [tasks]);

  if (!model.available) {
    return (
      <div className={cn('rounded-md border border-dashed p-6 text-center', className)} role="status" aria-label="执行关系数据状态">
        <p className="text-sm font-medium">暂无可用执行关系</p>
        <p className="mt-1 text-xs text-muted-foreground">任务清单证据到达后才会绘制任务关系图。</p>
      </div>
    );
  }

  return (
    <div className={cn('flex min-h-[420px] flex-col overflow-hidden rounded-lg border bg-slate-50 dark:bg-slate-950', className)} aria-label="任务执行关系图">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-background/95 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <GitBranch className="h-4 w-4 text-primary" aria-hidden="true" />
            任务执行关系图
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {provisional
              ? '任务尚未拆分，先展示当前工作流执行节点；任务清单生成后会自动展开。'
              : '基于任务清单证据绘制依赖、串行/并行分组和运行状态。'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 text-[10px]">
          <Badge variant="outline">任务 {tasks.length}</Badge>
          <Badge variant="outline">依赖边 {model.edges.length}</Badge>
          {provisional ? <Badge variant="outline">等待任务拆分</Badge> : null}
          {model.parallelGroups.length ? <Badge variant="outline">并行组 {model.parallelGroups.length}</Badge> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={model.nodes}
          edges={model.edges}
          nodeTypes={nodeTypes}
          defaultViewport={{ x: 30, y: 120, zoom: 0.85 }}
          minZoom={0.35}
          maxZoom={1.4}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.22 }}
          attributionPosition="bottom-left"
        >
          <Controls />
          <Background />
          <Panel position="bottom-right">
            <div className="rounded-lg border bg-white/95 p-3 text-xs shadow-lg dark:bg-slate-900/95">
              <div className="mb-2 font-semibold">图例</div>
              <div className="space-y-1">
                <div className="flex items-center gap-2"><div className="h-0 w-8 border-t-[3px] border-blue-600" /><span>执行中依赖</span></div>
                <div className="flex items-center gap-2"><div className="h-0 w-8 border-t-[2px] border-emerald-600" /><span>已满足依赖</span></div>
                <div className="flex items-center gap-2"><div className="h-3 w-3 rounded border-2 border-cyan-400 bg-cyan-50" /><span>并行任务</span></div>
                <div className="flex items-center gap-2"><div className="h-3 w-3 rounded border-2 border-slate-300 bg-white" /><span>串行/普通任务</span></div>
              </div>
              {!model.hasExplicitDependencies ? (
                <div className="mt-2 border-t pt-2 text-[10px] text-muted-foreground">
                  暂无显式依赖边，仅展示任务节点与分组。
                </div>
              ) : null}
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}

export default function LightweightTaskExecutionGraph(props: LightweightTaskExecutionGraphProps) {
  const adapted = adaptLightweightTaskBoardEvidence(props);
  if (!adapted.isLightweight) return null;
  const evidenceTasks = props.tasks || adapted.tasks;
  const fallbackTask = evidenceTasks.length ? null : buildLightweightRuntimeFallbackTask(props);
  const tasks = evidenceTasks.length ? evidenceTasks : fallbackTask ? [fallbackTask] : [];
  return (
    <ReactFlowProvider>
      <LightweightTaskExecutionGraphInner {...props} tasks={tasks} provisional={!evidenceTasks.length && Boolean(fallbackTask)} />
    </ReactFlowProvider>
  );
}
