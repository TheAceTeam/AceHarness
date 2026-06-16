'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { GitBranch, Activity, MessageSquare, CheckCircle2, Maximize2, X } from 'lucide-react';
import StateMachineRuntimePanel, { formatStateName } from './StateMachineRuntimePanel';
import StateMachineDiagram from './StateMachineDiagram';
import AgentFormationDiagram from './AgentFormationDiagram';
import type { StateTransitionRecord, Issue, StateMachineState } from '@/lib/core/schemas';
import type { AgentAvatarConfig, AgentRoleType, AgentTeam } from '@/lib/agent/personas';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}分${remainingSeconds}秒`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}小时${remainingMinutes}分`;
}

function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.round(value)));
}

const EVENT_TAG_CONFIG: Record<string, { label: string; className: string }> = {
  'supervisor-review': { label: 'Supervisor审阅', className: 'border-blue-500/40 text-blue-600' },
  'agent-handoff': { label: 'Agent交接', className: 'border-emerald-500/40 text-emerald-600' },
  'human-question': { label: '人工交互', className: 'border-orange-500/40 text-orange-600' },
  'parallel-fork': { label: '并发分叉', className: 'border-purple-500/40 text-purple-600' },
  'parallel-join': { label: '并发汇合', className: 'border-purple-500/40 text-purple-600' },
  'route-decision': { label: '路由决策', className: 'border-blue-500/40 text-blue-600' },
  'state-error': { label: '异常', className: 'border-red-500/40 text-red-600' },
  'rollback': { label: '回退', className: 'border-orange-500/40 text-orange-600' },
};

const TOKEN_SERIES_COLORS = ['#38bdf8', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#14b8a6'];
const TOKEN_COMPOSITION_COLORS = {
  input: '#38bdf8',
  output: '#8b5cf6',
  cacheWrite: '#22c55e',
  cacheRead: '#f59e0b',
};

interface SupervisorFlowRecord {
  type: string;
  from: string;
  to: string;
  question?: string;
  method?: string;
  round: number;
  timestamp: string;
}

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

interface ActiveConcurrencyGroupView {
  id: string;
  stateName: string;
  steps: string[];
  joinPolicy?: {
    mode?: string;
    quorum?: number;
    timeoutMinutes?: number;
    onTimeout?: string;
  } | null;
  status: 'running' | 'completed' | 'failed';
}

interface StateMachineExecutionViewProps {
  // 配置数据
  states: StateMachineState[];
  agents?: Array<{
    name: string;
    team?: AgentTeam;
  }>;

  // 运行时数据
  currentState: string | null;
  currentStep?: string | null;
  activeSteps?: string[];
  activeConcurrencyGroups?: ActiveConcurrencyGroupView[];
  completedSteps?: string[];
  stateHistory: StateTransitionRecord[];
  issueTracker: Issue[];
  transitionCount: number;
  maxTransitions: number;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'waiting' | 'stopped';
  isRunning?: boolean;
  allowForceTransition?: boolean;
  focusedState?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  accumulatedWaitMs?: number;
  waitStartedAt?: string | null;
  supervisorFlow?: SupervisorFlowRecord[];
  agentFlow?: AgentFlowRecord[];
  tokenAnalytics?: {
    total: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens: number;
      cacheReadInputTokens: number;
      totalTokens: number;
    };
    byAgent: Array<{
      name: string;
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens: number;
      cacheReadInputTokens: number;
      totalTokens: number;
    }>;
    byPhase: Array<{
      name: string;
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens: number;
      cacheReadInputTokens: number;
      totalTokens: number;
    }>;
    hasData: boolean;
  };
  executionTrace?: {
    designTitle: string;
    designStatus?: string | null;
    designSummary?: string | null;
    activePhaseTitle?: string | null;
    activePhaseStatus?: string | null;
    activeStepName?: string | null;
    latestSupervisorReview?: {
      type?: string | null;
      stateName?: string | null;
      content?: string | null;
      affectedArtifacts?: string[] | null;
      impact?: string[] | null;
    } | null;
    latestRevision?: {
      version: number;
      summary: string;
      createdBy?: string;
    } | null;
    finalReview?: {
      status: string;
      summary: string;
    } | null;
  } | null;
  overviewFooter?: ReactNode;
  supervisorInteractionPanel?: ReactNode;
  supervisorDirectPanel?: ReactNode;
  supervisorFooter?: ReactNode;
  activeTabOverride?: string | null;
  hasPendingHumanQuestion?: boolean;
  formationAgents?: Array<{
    name: string;
    team?: AgentTeam;
    roleType?: AgentRoleType;
    avatar?: AgentAvatarConfig | string | null;
  }>;
  supervisorAgent?: string | null;

  // 回调
  onStateClick?: (stateName: string) => void;
  onStepClick?: (step: any) => void;
  onForceTransition?: (targetState: string) => void;
}

export default function StateMachineExecutionView({
  states,
  agents = [],
  currentState,
  currentStep,
  activeSteps = [],
  activeConcurrencyGroups = [],
  completedSteps = [],
  stateHistory,
  issueTracker,
  transitionCount,
  maxTransitions,
  status,
  isRunning = false,
  allowForceTransition = isRunning,
  focusedState,
  startTime,
  endTime,
  accumulatedWaitMs,
  waitStartedAt,
  supervisorFlow = [],
  agentFlow = [],
  tokenAnalytics,
  overviewFooter,
  supervisorInteractionPanel,
  supervisorDirectPanel,
  supervisorFooter,
  activeTabOverride,
  hasPendingHumanQuestion,
  formationAgents = [],
  supervisorAgent,
  onStateClick,
  onStepClick,
  onForceTransition,
}: StateMachineExecutionViewProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [flowKindFilter, setFlowKindFilter] = useState<'all' | 'supervisor' | 'agent' | 'state' | 'concurrency'>('all');
  const [supervisorTimelineOpen, setSupervisorTimelineOpen] = useState(false);
  const [supervisorPanelTab, setSupervisorPanelTab] = useState<'formation' | 'human' | 'timeline' | 'summary'>('human');
  const [formationFullscreenOpen, setFormationFullscreenOpen] = useState(false);

  // 运行进行中时每秒推进一次"当前时间"，用于给最新（进行中）的流转条目实时累计耗时。
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (status !== 'running' && status !== 'waiting') return;
    setNowTs(Date.now());
    const timer = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (activeTabOverride) {
      setActiveTab(activeTabOverride === 'overview'
        ? 'overview'
        : activeTabOverride === 'history' || activeTabOverride === 'timeline' || activeTabOverride === 'agent-flow'
          ? 'history'
          : activeTabOverride === 'supervisor'
            ? 'supervisor'
            : activeTabOverride === 'token'
              ? 'token'
              : 'trace');
    }
  }, [activeTabOverride]);

  useEffect(() => {
    if (hasPendingHumanQuestion) {
      setSupervisorPanelTab('human');
    }
  }, [hasPendingHumanQuestion]);

  const handleOverviewStateClick = (stateName: string) => {
    setActiveTab('trace');
    onStateClick?.(stateName);
  };

  const renderFormationDiagram = (className?: string) => (
    <div className={className}>
      <AgentFormationDiagram
        states={states}
        agents={formationAgents}
        supervisorAgent={supervisorAgent}
        currentStep={currentStep}
        activeSteps={activeSteps}
        status={status}
        className={className ? 'h-full' : undefined}
      />
    </div>
  );

  const visibleConcurrencyGroups = activeConcurrencyGroups.filter((group) => group.status === 'running');
  const concurrencyGroupsToDisplay = visibleConcurrencyGroups.length > 0
    ? visibleConcurrencyGroups
    : activeConcurrencyGroups.slice(-3);

  const formatJoinPolicy = (joinPolicy?: ActiveConcurrencyGroupView['joinPolicy']) => {
    if (!joinPolicy?.mode) return 'all';
    const details = [
      joinPolicy.mode,
      joinPolicy.mode === 'quorum' && joinPolicy.quorum ? `quorum=${joinPolicy.quorum}` : '',
      joinPolicy.timeoutMinutes ? `timeout=${joinPolicy.timeoutMinutes}m` : '',
      joinPolicy.onTimeout ? `onTimeout=${joinPolicy.onTimeout}` : '',
    ].filter(Boolean);
    return details.join(' · ');
  };

  const supervisorTimeline = useMemo(() => {
    const items: Array<{
      id: string;
      timestamp: string;
      kind: 'supervisor' | 'agent' | 'state';
      title: string;
      body?: string;
      tags: string[];
    }> = [];

    supervisorFlow.forEach((item, index) => {
      const displayFrom = formatStateName(item.from || 'Supervisor');
      const displayTo = formatStateName(item.to || '下一节点');
      const title = item.type === 'decision'
        ? `Supervisor 路由：${displayFrom} → ${displayTo}`
        : `Supervisor 询问：${displayTo}`;
      items.push({
        id: `supervisor-${index}`,
        timestamp: item.timestamp,
        kind: 'supervisor',
        title,
        body: item.question || (item.method ? `决策方式：${item.method}` : undefined),
        tags: [
          item.type === 'decision' ? '路由决策' : '人工/Agent 问答',
          item.method || '',
          item.round ? `round ${item.round}` : '',
        ].filter(Boolean),
      });
    });

    agentFlow.forEach((item, index) => {
      items.push({
        id: `agent-${index}`,
        timestamp: item.timestamp,
        kind: 'agent',
        title: `${item.fromAgent} → ${item.toAgent}`,
        body: item.message,
        tags: [
          item.type,
          item.stateName,
          item.stepName,
          item.round ? `round ${item.round}` : '',
        ].filter(Boolean),
      });
    });

    stateHistory.slice(-12).forEach((item, index) => {
      const displayFrom = formatStateName(item.from || '起点');
      const displayTo = formatStateName(item.to || '未知状态');
      items.push({
        id: `state-${index}`,
        timestamp: item.timestamp,
        kind: 'state',
        title: `${displayFrom} → ${displayTo}`,
        body: item.reason || undefined,
        tags: ['状态流转', item.issues?.length ? `${item.issues.length} issue` : ''],
      });
    });

    return items
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-30);
  }, [agentFlow, stateHistory, supervisorFlow]);

  const flowHistory = useMemo(() => {
    type FlowItem = {
      id: string;
      timestamp: string;
      kind: 'supervisor' | 'agent' | 'state' | 'concurrency';
      actor: string;
      target: string;
      title: string;
      body?: string;
      tags: string[];
      eventTags: string[];
      duration?: number;
      isRollback?: boolean;
      hasIssues?: boolean;
    };
    const items: FlowItem[] = [];

    // --- Supervisor events ---
    supervisorFlow.forEach((item, index) => {
      const isDecision = item.type === 'decision';
      items.push({
        id: `supervisor-flow-${index}`,
        timestamp: item.timestamp,
        kind: 'supervisor',
        actor: item.from || 'Supervisor',
        target: item.to || '下一节点',
        title: isDecision ? 'Supervisor 路由决策' : 'Supervisor 发起询问',
        body: item.question || (item.method ? `决策方式：${item.method}` : undefined),
        tags: [
          item.method || '',
          item.round ? `round ${item.round}` : '',
        ].filter(Boolean),
        eventTags: [isDecision ? 'route-decision' : 'supervisor-review'],
      });
    });

    // --- Agent events ---
    agentFlow.forEach((item, index) => {
      const isHandoff = item.type === 'stream' && item.fromAgent !== item.toAgent;
      items.push({
        id: `agent-flow-${index}`,
        timestamp: item.timestamp,
        kind: 'agent',
        actor: item.fromAgent,
        target: item.toAgent,
        title: isHandoff ? 'Agent 交接' : 'Agent 协作消息',
        body: item.message,
        tags: [
          item.stateName,
          item.stepName,
          item.round ? `round ${item.round}` : '',
        ].filter(Boolean),
        eventTags: isHandoff ? ['agent-handoff'] : [item.type],
      });
    });

    // --- State transition events (with rollback + human + error detection) ---
    const stateOrder: Record<string, number> = {};
    let orderIdx = 0;
    stateHistory.forEach((record) => {
      if (!(record.from in stateOrder)) stateOrder[record.from] = orderIdx++;
      if (!(record.to in stateOrder)) stateOrder[record.to] = orderIdx++;
    });

    stateHistory.forEach((item, index) => {
      const isHuman = item.from === '__human_approval__' || item.to === '__human_approval__';
      const isRealFrom = item.from && item.from !== '__origin__' && item.from !== '__human_approval__';
      const isRealTo = item.to && item.to !== '__origin__' && item.to !== '__human_approval__';
      const isRollback = isRealFrom && isRealTo && (stateOrder[item.to] ?? 0) < (stateOrder[item.from] ?? 0);
      const hasIssues = item.issues?.length > 0;
      const displayFrom = formatStateName(item.from || '起点');
      const displayTo = formatStateName(item.to || '未知状态');

      const eventTags: string[] = [];
      if (isHuman) eventTags.push('human-question');
      if (isRollback) eventTags.push('rollback');
      if (hasIssues) eventTags.push('state-error');

      items.push({
        id: `state-flow-${index}`,
        timestamp: item.timestamp,
        kind: 'state',
        actor: displayFrom,
        target: displayTo,
        title: isHuman
          ? (item.to === '__human_approval__' ? '进入人工审查' : '人工审查完成')
          : isRollback
            ? `回退：${displayFrom} → ${displayTo}`
            : `${displayFrom} → ${displayTo}`,
        body: item.reason || undefined,
        tags: [
          item.issues?.length ? `${item.issues.length} 个问题` : '',
        ].filter(Boolean),
        eventTags,
        isRollback: !!isRollback,
        hasIssues,
      });
    });

    // --- Concurrency group snapshots ---
    activeConcurrencyGroups.forEach((group) => {
      const isFork = group.status === 'running';
      const isFailed = group.status === 'failed';
      const eventTags = [isFork ? 'parallel-fork' : 'parallel-join'];
      if (isFailed) eventTags.push('state-error');

      items.push({
        id: `concurrency-${group.id}-${group.stateName}`,
        timestamp: new Date().toISOString(),
        kind: 'concurrency',
        actor: group.stateName,
        target: group.steps.join(', '),
        title: isFork ? `并发分叉：${group.stateName}` : `并发汇合：${group.stateName}`,
        body: `步骤：${group.steps.join('、')}${group.joinPolicy?.mode ? ` · Join: ${group.joinPolicy.mode}` : ''}`,
        tags: [group.status],
        eventTags,
        hasIssues: isFailed,
      });
    });

    // Sort by time and compute durations
    const sorted = items
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-30);

    // 每条耗时 = 本条开始 → 下一条开始；最后一条（进行中）用当前时间实时累计，
    // 已结束用结束时间。Agent 交接是瞬时切换，不计耗时。
    const runActive = status === 'running' || status === 'waiting';
    const endTs = endTime ? new Date(endTime).getTime() : null;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].eventTags?.includes('agent-handoff')) continue;
      const curr = new Date(sorted[i].timestamp).getTime();
      const next = i < sorted.length - 1
        ? new Date(sorted[i + 1].timestamp).getTime()
        : (runActive ? nowTs : endTs);
      if (next == null) continue;
      // 终态事件可能晚于 endTime（收尾汇总在 endTime 之后才发出，导致差值为负），
      // 钳到 >= 0，保证每条（Agent 交接除外）都显示耗时。
      sorted[i].duration = Math.max(0, Math.floor((next - curr) / 1000));
    }

    return sorted;
  }, [activeConcurrencyGroups, agentFlow, stateHistory, supervisorFlow, status, endTime, nowTs]);

  const flowRoutes = useMemo(() => {
    const seen = new Set<string>();
    const formatRouteEndpoint = (value: string, kind: string) => {
      if (kind === 'state' || kind === 'concurrency') return formatStateName(value);
      if (value === '__origin__' || value === '__human_approval__') return formatStateName(value);
      return value;
    };
    return flowHistory
      .map((item) => ({
        id: `${item.actor}->${item.target}`,
        actor: formatRouteEndpoint(item.actor, item.kind),
        target: formatRouteEndpoint(item.target, item.kind),
        kind: item.kind,
      }))
      .filter((route) => {
        if (seen.has(route.id)) return false;
        seen.add(route.id);
        return true;
      })
      .slice(-8);
  }, [flowHistory]);

  const hotspotStates = useMemo(() => {
    const visits: Record<string, number> = {};
    stateHistory.forEach((r) => {
      if (r.from && r.from !== '__origin__') visits[r.from] = (visits[r.from] || 0) + 1;
      if (r.to && r.to !== '__origin__') visits[r.to] = (visits[r.to] || 0) + 1;
    });
    return Object.entries(visits)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([state, count]) => ({ state, visits: count }));
  }, [stateHistory]);

  const rollbackCount = useMemo(
    () => flowHistory.filter((item) => item.isRollback).length,
    [flowHistory]
  );

  const totalIssueCount = useMemo(
    () => flowHistory.filter((item) => item.hasIssues).length,
    [flowHistory]
  );

  const filteredFlowHistory = useMemo(
    () => flowKindFilter === 'all'
      ? flowHistory
      : flowHistory.filter((item) => item.kind === flowKindFilter),
    [flowHistory, flowKindFilter]
  );

  const tokenByAgentChartData = useMemo(
    () => (tokenAnalytics?.byAgent || [])
      .slice()
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 8)
      .map((item, index) => ({
        name: item.name,
        totalTokens: item.totalTokens,
        fill: TOKEN_SERIES_COLORS[index % TOKEN_SERIES_COLORS.length],
      })),
    [tokenAnalytics]
  );

  const tokenByPhaseChartData = useMemo(
    () => (tokenAnalytics?.byPhase || [])
      .slice()
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 8)
      .map((item, index) => ({
        name: formatStateName(item.name),
        totalTokens: item.totalTokens,
        fill: TOKEN_SERIES_COLORS[index % TOKEN_SERIES_COLORS.length],
      })),
    [tokenAnalytics]
  );

  const tokenCompositionData = useMemo(() => {
    const total = tokenAnalytics?.total;
    if (!total) return [];
    return [
      { name: '输入', value: total.inputTokens || 0, fill: TOKEN_COMPOSITION_COLORS.input },
      { name: '输出', value: total.outputTokens || 0, fill: TOKEN_COMPOSITION_COLORS.output },
      { name: '缓存写入', value: total.cacheCreationInputTokens || 0, fill: TOKEN_COMPOSITION_COLORS.cacheWrite },
      { name: '缓存读取', value: total.cacheReadInputTokens || 0, fill: TOKEN_COMPOSITION_COLORS.cacheRead },
    ].filter((item) => item.value > 0);
  }, [tokenAnalytics]);

  const supervisorWaitingForHuman = currentState === '__human_approval__' || status === 'waiting';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-border/60 bg-background/95 px-4 pb-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              <span>总览</span>
            </TabsTrigger>
            <TabsTrigger value="trace" className="flex items-center gap-2">
              <GitBranch className="w-4 h-4" />
              <span>状态图</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <GitBranch className="w-4 h-4" />
              <span>流转历史</span>
            </TabsTrigger>
            <TabsTrigger
              value="supervisor"
              className={`flex items-center gap-2 ${
                hasPendingHumanQuestion
                  ? 'border border-amber-300 bg-amber-100 text-amber-900 shadow-sm data-[state=active]:bg-amber-500 data-[state=active]:text-black animate-pulse'
                  : ''
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>{hasPendingHumanQuestion ? 'Supervisor 待处理' : 'Supervisor'}</span>
              {hasPendingHumanQuestion && (
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-amber-200" />
              )}
            </TabsTrigger>
            <TabsTrigger value="token" className="flex items-center gap-2">
              <span className="material-symbols-outlined text-base">toll</span>
              <span>Token</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* 总览视图 */}
        <TabsContent value="overview" className="min-h-0 flex-1 overflow-auto">
          <div className="space-y-6">
            {concurrencyGroupsToDisplay.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">并发组运行态</h3>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      连续同组 step 会并发执行；后续串行 step 接收并发组汇总上下文。
                    </p>
                  </div>
                  {activeSteps.length > 0 ? (
                    <Badge variant="secondary" className="text-[10px]">
                      active {activeSteps.length}
                    </Badge>
                  ) : null}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {concurrencyGroupsToDisplay.map((group) => (
                    <div key={`${group.stateName}-${group.id}`} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">{group.stateName} / {group.id}</div>
                        <Badge
                          variant={group.status === 'failed' ? 'destructive' : group.status === 'running' ? 'secondary' : 'outline'}
                          className="text-[10px]"
                        >
                          {group.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        Join: {formatJoinPolicy(group.joinPolicy)}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.steps.map((step) => (
                          <Badge key={step} variant="outline" className="text-[10px]">
                            {step}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 实时统计面板 */}
            <StateMachineRuntimePanel
              currentState={currentState}
              stateHistory={stateHistory}
              issueTracker={issueTracker}
              transitionCount={transitionCount}
              maxTransitions={maxTransitions}
              status={status}
              startTime={startTime}
              endTime={endTime}
              accumulatedWaitMs={accumulatedWaitMs}
              waitStartedAt={waitStartedAt}
              onStateClick={handleOverviewStateClick}
            />

            {/* Hotspot states summary */}
            {hotspotStates.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
                  <span className="material-symbols-outlined text-base">warning</span>
                  热点状态 · {rollbackCount} 次回滚 · {totalIssueCount} 个异常
                </div>
                <div className="flex flex-wrap gap-2">
                  {hotspotStates.map((hs) => (
                    <button
                      key={hs.state}
                      type="button"
                      className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-gray-800 dark:hover:bg-amber-900/40"
                      onClick={() => handleOverviewStateClick(hs.state)}
                    >
                      {formatStateName(hs.state)}
                      <span className="ml-1.5 text-amber-600 dark:text-amber-400">×{hs.visits}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {overviewFooter}

          </div>
        </TabsContent>

        {/* 状态图视图 */}
        <TabsContent value="trace" className="min-h-0 flex-1 overflow-hidden">
          <StateMachineDiagram
            states={states}
            agents={agents}
            currentState={currentState}
            currentStep={currentStep}
            activeSteps={activeSteps}
            completedSteps={completedSteps}
            stateHistory={stateHistory}
            isRunning={isRunning}
            allowForceTransition={allowForceTransition}
            focusedState={focusedState}
            supervisorFlow={supervisorFlow}
            onStateClick={onStateClick}
            onStepClick={onStepClick}
            onForceTransition={onForceTransition}
          />
        </TabsContent>


        <TabsContent value="history" className="min-h-0 flex-1 overflow-auto">
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">流转历史</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Supervisor 决策、Agent 协作、人工交互与并发/路由事件的完整链路。
                </p>
              </div>
              <Badge variant="outline" className="text-[10px]">{filteredFlowHistory.length}/{flowHistory.length} 条</Badge>
            </div>

            <div className="mb-4 flex flex-wrap gap-1.5">
              {(['all', 'supervisor', 'agent', 'state', 'concurrency'] as const).map((kind) => {
                const labels: Record<string, string> = { all: '全部', supervisor: 'Supervisor', agent: 'Agent', state: '状态机', concurrency: '并发' };
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setFlowKindFilter(kind)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      flowKindFilter === kind
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {labels[kind]}
                  </button>
                );
              })}
            </div>

            <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
              <div className="rounded-2xl border bg-muted/20 p-3">
                <div className="mb-3 text-xs font-medium text-muted-foreground">参与者流程</div>
                {flowRoutes.length ? (
                  <div className="space-y-2">
                    {flowRoutes.map((route) => (
                      <div key={route.id} className="flex items-center gap-2 text-xs">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${
                          route.kind === 'supervisor'
                            ? 'bg-purple-500'
                            : route.kind === 'agent'
                              ? 'bg-emerald-500'
                              : route.kind === 'concurrency'
                                ? 'bg-cyan-500'
                                : 'bg-slate-400'
                        }`} />
                        <span className="min-w-0 flex-1 truncate font-medium">{route.actor}</span>
                        <span className="material-symbols-outlined text-sm text-muted-foreground">arrow_forward</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{route.target}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                    暂无参与者流程数据
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {filteredFlowHistory.length ? filteredFlowHistory.slice(-15).reverse().map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-2xl border p-3 ${
                      item.isRollback
                        ? 'border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20'
                        : item.hasIssues
                          ? 'border-amber-200 bg-amber-50/30 dark:border-amber-800 dark:bg-amber-950/20'
                          : item.eventTags.includes('supervisor-review') || item.eventTags.includes('route-decision')
                            ? 'border-purple-200 bg-purple-50/30 dark:border-purple-800 dark:bg-purple-950/20'
                            : item.eventTags.includes('human-question')
                              ? 'border-amber-200 bg-amber-50/30 dark:border-amber-800 dark:bg-amber-950/20'
                              : item.eventTags.includes('parallel-fork') || item.eventTags.includes('parallel-join')
                                ? 'border-cyan-200 bg-cyan-50/30 dark:border-cyan-800 dark:bg-cyan-950/20'
                                : 'bg-muted/20'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {item.kind === 'supervisor' ? 'Supervisor' : item.kind === 'agent' ? 'Agent' : item.kind === 'concurrency' ? '并发' : '状态机'}
                        </Badge>
                        <span className="truncate text-sm font-medium">{item.title}</span>
                        <span className="text-xs text-muted-foreground">{item.actor} {'->'} {item.target}</span>
                      </div>
                      {item.duration != null && (
                        <Badge variant="outline" className="text-[10px]">{formatDuration(item.duration)}</Badge>
                      )}
                    </div>
                    {item.body ? (
                      <div className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {item.body}
                      </div>
                    ) : null}
                    {item.eventTags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.eventTags.map((t, index) => {
                          const cfg = EVENT_TAG_CONFIG[t];
                          return cfg ? (
                            <span key={`${item.id}-event-tag-${t}-${index}`} className={`inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.className}`}>
                              {cfg.label}
                            </span>
                          ) : null;
                        })}
                      </div>
                    )}
                  </div>
                )) : (
                  <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    暂无参与者流程数据
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="supervisor" className={supervisorDirectPanel ? 'min-h-0 flex-1 overflow-hidden' : 'overflow-visible'}>
          {supervisorDirectPanel ? (
            <div className="h-full min-h-0 overflow-hidden">
              {supervisorDirectPanel}
            </div>
          ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-blue-500" />
                    <h3 className="font-semibold">Supervisor 工作台</h3>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Supervisor 仍负责智能路由、阶段审阅和人工等待；协作消息由议场承载。
                  </p>
                </div>
                <Badge variant={supervisorWaitingForHuman ? 'destructive' : status === 'running' ? 'secondary' : 'outline'} className="text-[10px]">
                  {supervisorWaitingForHuman ? '等待人工回复' : status}
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {currentState ? <Badge variant="outline" className="text-[10px]">状态：{currentState}</Badge> : null}
                {currentStep ? <Badge variant="outline" className="text-[10px]">步骤：{currentStep}</Badge> : null}
                <Badge variant="outline" className="text-[10px]">已完成 {completedSteps.length}</Badge>
                {activeSteps.length ? <Badge variant="secondary" className="text-[10px]">运行中 {activeSteps.length}</Badge> : null}
                {issueTracker.length ? <Badge variant="destructive" className="text-[10px]">问题 {issueTracker.length}</Badge> : null}
                {supervisorFlow.length ? <Badge variant="outline" className="text-[10px]">Supervisor 记录 {supervisorFlow.length}</Badge> : null}
                {agentFlow.length ? <Badge variant="outline" className="text-[10px]">Agent 交互 {agentFlow.length}</Badge> : null}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Supervisor 协作</h3>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    默认聚焦当前 Supervisor 绑定的协作消息与人工处理入口，编队状态和会话记录按需展开。
                  </p>
                </div>
                <Tabs value={supervisorPanelTab} onValueChange={(value) => setSupervisorPanelTab(value as typeof supervisorPanelTab)} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:grid-cols-4">
                    <TabsTrigger value="human" className={hasPendingHumanQuestion ? 'text-amber-700' : ''}>协作消息</TabsTrigger>
                    <TabsTrigger value="formation">编队状态</TabsTrigger>
                    <TabsTrigger value="timeline">会话记录</TabsTrigger>
                    <TabsTrigger value="summary">结算总结</TabsTrigger>
                  </TabsList>

                  <TabsContent value="human" className="mt-4">
                    {supervisorInteractionPanel ? (
                      supervisorInteractionPanel
                    ) : (
                      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          当前没有待人工回复
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="formation" className="mt-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">Agent 编队状态图</div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{formationAgents.length} 个参与者</Badge>
                        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setFormationFullscreenOpen(true)}>
                          <Maximize2 className="mr-1 h-3.5 w-3.5" />
                          全屏查看
                        </Button>
                      </div>
                    </div>
                    {renderFormationDiagram()}
                  </TabsContent>

                  <TabsContent value="timeline" className="mt-4">
                    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">会话记录</h3>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{supervisorTimeline.length} 条</Badge>
                          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setSupervisorTimelineOpen(true)}>
                            打开会话记录
                          </Button>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="summary" className="mt-4">
                    {supervisorFooter ? (
                      supervisorFooter
                    ) : (
                      <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                        当前还没有可展示的结算总结
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
          )}
        </TabsContent>

        <TabsContent value="token" className="min-h-0 flex-1 overflow-auto">
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-amber-500">toll</span>
                    <h3 className="font-semibold">Token 消耗统计</h3>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    按 Agent 和阶段两个维度统计当前 run 的 token 消耗，包含输入、输出和缓存命中。
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  总计 {formatTokenCount(tokenAnalytics?.total.totalTokens || 0)}
                </Badge>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <div className="rounded-xl border bg-muted/20 p-3">
                  <div className="text-[10px] text-muted-foreground">输入</div>
                  <div className="mt-1 text-lg font-semibold">{formatTokenCount(tokenAnalytics?.total.inputTokens || 0)}</div>
                </div>
                <div className="rounded-xl border bg-muted/20 p-3">
                  <div className="text-[10px] text-muted-foreground">输出</div>
                  <div className="mt-1 text-lg font-semibold">{formatTokenCount(tokenAnalytics?.total.outputTokens || 0)}</div>
                </div>
                <div className="rounded-xl border bg-muted/20 p-3">
                  <div className="text-[10px] text-muted-foreground">缓存写入</div>
                  <div className="mt-1 text-lg font-semibold">{formatTokenCount(tokenAnalytics?.total.cacheCreationInputTokens || 0)}</div>
                </div>
                <div className="rounded-xl border bg-muted/20 p-3">
                  <div className="text-[10px] text-muted-foreground">缓存读取</div>
                  <div className="mt-1 text-lg font-semibold">{formatTokenCount(tokenAnalytics?.total.cacheReadInputTokens || 0)}</div>
                </div>
              </div>
            </div>

            {tokenAnalytics?.hasData ? (
              <div className="grid gap-4">
                <div className="grid gap-4 xl:grid-cols-12">
                  <div className="xl:col-span-7 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">Agent Token 排名</h3>
                        <div className="mt-1 text-xs text-muted-foreground">按总 token 排序，优先展示消耗最高的参与者。</div>
                      </div>
                      <Badge variant="outline" className="text-[10px]">Top {tokenByAgentChartData.length}</Badge>
                    </div>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={tokenByAgentChartData} layout="vertical" margin={{ top: 8, right: 12, left: 16, bottom: 0 }}>
                        <CartesianGrid horizontal strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                        <XAxis type="number" hide />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={120}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                        />
                        <Tooltip formatter={(value) => formatTokenCount(Number(value ?? 0))} />
                        <Bar dataKey="totalTokens" radius={[0, 10, 10, 0]}>
                          {tokenByAgentChartData.map((entry, index) => (
                            <Cell key={`${entry.name}-${index}`} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="xl:col-span-5 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">Token 构成</h3>
                        <div className="mt-1 text-xs text-muted-foreground">观察输入、输出与缓存相关 token 的占比。</div>
                      </div>
                      <Badge variant="outline" className="text-[10px]">{formatTokenCount(tokenAnalytics?.total.totalTokens || 0)}</Badge>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
                      <div className="mx-auto h-[180px] w-[180px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={tokenCompositionData} dataKey="value" nameKey="name" innerRadius={46} outerRadius={74} paddingAngle={2}>
                              {tokenCompositionData.map((entry) => (
                                <Cell key={entry.name} fill={entry.fill} />
                              ))}
                            </Pie>
                        <Tooltip formatter={(value) => formatTokenCount(Number(value ?? 0))} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-2">
                        {tokenCompositionData.map((item) => (
                          <div key={item.name} className="flex items-center justify-between rounded-xl border bg-muted/20 px-3 py-2">
                            <div className="inline-flex items-center gap-2 text-sm">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.fill }} />
                              <span>{item.name}</span>
                            </div>
                            <span className="text-sm font-medium">{formatTokenCount(item.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="font-semibold">按 Agent</h3>
                    <Badge variant="outline" className="text-[10px]">{tokenAnalytics.byAgent.length} 个</Badge>
                  </div>
                  <div className="space-y-2">
                    {tokenAnalytics.byAgent.map((item) => (
                      <div key={item.name} className="rounded-xl border bg-muted/20 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{item.name}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              输入 {formatTokenCount(item.inputTokens)} · 输出 {formatTokenCount(item.outputTokens)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold">{formatTokenCount(item.totalTokens)}</div>
                            <div className="text-[10px] text-muted-foreground">total</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">阶段 Token 排名</h3>
                      <div className="mt-1 text-xs text-muted-foreground">按状态/阶段聚合后的总 token 消耗。</div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">Top {tokenByPhaseChartData.length}</Badge>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={tokenByPhaseChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} interval={0} height={42} />
                      <YAxis hide />
                        <Tooltip formatter={(value) => formatTokenCount(Number(value ?? 0))} />
                      <Bar dataKey="totalTokens" radius={[10, 10, 0, 0]}>
                        {tokenByPhaseChartData.map((entry, index) => (
                          <Cell key={`${entry.name}-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="font-semibold">按阶段</h3>
                    <Badge variant="outline" className="text-[10px]">{tokenAnalytics.byPhase.length} 个</Badge>
                  </div>
                  <div className="space-y-2">
                    {tokenAnalytics.byPhase.map((item) => (
                      <div key={item.name} className="rounded-xl border bg-muted/20 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{formatStateName(item.name)}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              输入 {formatTokenCount(item.inputTokens)} · 输出 {formatTokenCount(item.outputTokens)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold">{formatTokenCount(item.totalTokens)}</div>
                            <div className="text-[10px] text-muted-foreground">total</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                当前 run 还没有可统计的 token 数据。
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
      <Dialog open={supervisorTimelineOpen} onOpenChange={setSupervisorTimelineOpen}>
        <DialogContent className="max-w-4xl w-[92vw] h-[80vh] p-0 flex flex-col gap-0">
          <DialogTitle className="sr-only">Supervisor 会话记录</DialogTitle>
          <div className="border-b px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">会话记录</h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Supervisor 与 Agent、人类、状态机之间的关键交互，按时间汇总。
                </p>
              </div>
              <Badge variant="outline" className="text-[10px]">{supervisorTimeline.length} 条</Badge>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-5">
            {supervisorTimeline.length ? (
              <div className="space-y-3">
                {supervisorTimeline.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-2xl border p-3 ${
                      item.kind === 'supervisor'
                        ? 'border-blue-500/30 bg-blue-500/8'
                        : item.kind === 'agent'
                          ? 'border-emerald-500/30 bg-emerald-500/8'
                          : 'bg-muted/20'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium">{item.title}</div>
                      <span className="text-[10px] text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</span>
                    </div>
                    {item.body ? (
                      <div className="mt-2 text-xs leading-5 text-muted-foreground whitespace-pre-line line-clamp-5">
                        {item.body}
                      </div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.tags.map((tag) => (
                        <Badge key={`${item.id}-${tag}`} variant="outline" className="text-[10px]">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                暂无 Supervisor 会话记录。
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={formationFullscreenOpen} onOpenChange={setFormationFullscreenOpen}>
        <DialogContent className="max-w-none w-[96vw] h-[92vh] p-0 flex flex-col gap-0">
          <DialogTitle className="sr-only">Agent 编队状态图</DialogTitle>
          <div className="border-b px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Agent 编队状态图</h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  以全屏视图查看 Supervisor 与各 Agent 的当前编队和运行态。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{formationAgents.length} 个参与者</Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setFormationFullscreenOpen(false)}
                  aria-label="关闭编队状态图全屏视图"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-hidden p-5">
            {renderFormationDiagram('h-full')}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
