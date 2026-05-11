'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Badge } from './ui/badge';
import { GitBranch, Activity, MessageSquare, CheckCircle2 } from 'lucide-react';
import StateMachineRuntimePanel from './StateMachineRuntimePanel';
import StateMachineDiagram from './StateMachineDiagram';
import type { StateTransitionRecord, Issue, StateMachineState } from '@/lib/schemas';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}分${remainingSeconds}秒`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}小时${remainingMinutes}分`;
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
  focusedState?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  supervisorFlow?: SupervisorFlowRecord[];
  agentFlow?: AgentFlowRecord[];
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
  activeTabOverride?: string | null;
  hasPendingHumanQuestion?: boolean;

  // 回调
  onStateClick?: (stateName: string) => void;
  onStepClick?: (step: any) => void;
  onForceTransition?: (targetState: string) => void;
}

export default function StateMachineExecutionView({
  states,
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
  focusedState,
  startTime,
  endTime,
  supervisorFlow = [],
  agentFlow = [],
  overviewFooter,
  supervisorInteractionPanel,
  activeTabOverride,
  hasPendingHumanQuestion,
  onStateClick,
  onStepClick,
  onForceTransition,
}: StateMachineExecutionViewProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [flowKindFilter, setFlowKindFilter] = useState<'all' | 'supervisor' | 'agent' | 'state' | 'concurrency'>('all');

  useEffect(() => {
    if (activeTabOverride) {
      setActiveTab(activeTabOverride === 'overview'
        ? 'overview'
        : activeTabOverride === 'history' || activeTabOverride === 'timeline' || activeTabOverride === 'agent-flow'
          ? 'history'
          : activeTabOverride === 'supervisor'
          ? 'supervisor'
          : 'trace');
    }
  }, [activeTabOverride]);

  const handleOverviewStateClick = (stateName: string) => {
    setActiveTab('trace');
    onStateClick?.(stateName);
  };

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
      const title = item.type === 'decision'
        ? `Supervisor 路由：${item.from} → ${item.to}`
        : `Supervisor 询问：${item.to}`;
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
      items.push({
        id: `state-${index}`,
        timestamp: item.timestamp,
        kind: 'state',
        title: `${item.from || '起点'} → ${item.to}`,
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

      const eventTags: string[] = [];
      if (isHuman) eventTags.push('human-question');
      if (isRollback) eventTags.push('rollback');
      if (hasIssues) eventTags.push('state-error');

      items.push({
        id: `state-flow-${index}`,
        timestamp: item.timestamp,
        kind: 'state',
        actor: item.from || '起点',
        target: item.to,
        title: isHuman
          ? (item.to === '__human_approval__' ? '进入人工审查' : '人工审查完成')
          : isRollback
            ? `回退：${item.from} → ${item.to}`
            : `${item.from || '起点'} → ${item.to}`,
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

    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = new Date(sorted[i].timestamp).getTime();
      const next = new Date(sorted[i + 1].timestamp).getTime();
      const diff = Math.floor((next - curr) / 1000);
      if (diff > 0) sorted[i].duration = diff;
    }

    return sorted;
  }, [activeConcurrencyGroups, agentFlow, stateHistory, supervisorFlow]);

  const flowRoutes = useMemo(() => {
    const seen = new Set<string>();
    return flowHistory
      .map((item) => ({
        id: `${item.actor}->${item.target}`,
        actor: item.actor,
        target: item.target,
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

  const supervisorWaitingForHuman = currentState === '__human_approval__' || status === 'waiting';

  return (
    <div className="h-full flex flex-col">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-4 mb-4">
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
        </TabsList>

        {/* 总览视图 */}
        <TabsContent value="overview" className="flex-1 overflow-auto">
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
                      {hs.state}
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
        <TabsContent value="trace" className="flex-1 overflow-hidden">
          <StateMachineDiagram
            states={states}
            currentState={currentState}
            currentStep={currentStep}
            completedSteps={completedSteps}
            stateHistory={stateHistory}
            isRunning={isRunning}
            focusedState={focusedState}
            supervisorFlow={supervisorFlow}
            onStateClick={onStateClick}
            onStepClick={onStepClick}
            onForceTransition={onForceTransition}
          />
        </TabsContent>


        <TabsContent value="history" className="flex-1 overflow-auto">
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

        <TabsContent value="supervisor" className="flex-1 overflow-auto">
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-blue-500" />
                    <h3 className="font-semibold">Supervisor 工作台</h3>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    用会话方式查看 Supervisor 的决策、Agent 交互、人工等待和执行任务状态。
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

            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">会话记录</h3>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Supervisor 与 Agent、人类、状态机之间的关键交互，按时间汇总。
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px]">{supervisorTimeline.length} 条</Badge>
              </div>

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
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
