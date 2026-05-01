'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Badge } from './ui/badge';
import { GitBranch, BarChart3, Activity, Clock, Bot } from 'lucide-react';
import StateTransitionTimeline from './StateTransitionTimeline';
import StateFlowVisualizer from './StateFlowVisualizer';
import StateMachineRuntimePanel from './StateMachineRuntimePanel';
import StateMachineDiagram from './StateMachineDiagram';
import SupervisorFlowVisualizer from './SupervisorFlowVisualizer';
import AgentFlowDiagram from './AgentFlowDiagram';
import type { StateTransitionRecord, Issue, StateMachineState } from '@/lib/schemas';

interface SupervisorFlowRecord {
  type: 'question' | 'decision';
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
  status: 'idle' | 'running' | 'completed' | 'failed';
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
  activeTabOverride?: string | null;

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
  executionTrace,
  overviewFooter,
  activeTabOverride,
  onStateClick,
  onStepClick,
  onForceTransition,
}: StateMachineExecutionViewProps) {
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    if (activeTabOverride) {
      setActiveTab(activeTabOverride === 'overview' ? 'overview' : activeTabOverride === 'timeline' || activeTabOverride === 'supervisor' || activeTabOverride === 'agent-flow' ? 'replay' : 'trace');
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

  return (
    <div className="h-full flex flex-col">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-3 mb-4">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            <span>总览</span>
          </TabsTrigger>
          <TabsTrigger value="trace" className="flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            <span>执行追踪</span>
          </TabsTrigger>
          <TabsTrigger value="replay" className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            <span>事件回放</span>
          </TabsTrigger>
        </TabsList>

        {/* 总览视图 */}
        <TabsContent value="overview" className="flex-1 overflow-auto">
          <div className="space-y-6">
            {executionTrace && (
              <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">设计到执行映射</h3>
                  <div className="flex flex-wrap gap-2">
                    {executionTrace.designStatus ? (
                      <Badge variant="outline" className="text-[10px]">
                        设计 {executionTrace.designStatus}
                      </Badge>
                    ) : null}
                    {executionTrace.activePhaseStatus ? (
                      <Badge variant="secondary" className="text-[10px]">
                        执行 {executionTrace.activePhaseStatus}
                      </Badge>
                    ) : null}
                    {executionTrace.finalReview?.status ? (
                      <Badge variant="outline" className="text-[10px]">
                        结算 {executionTrace.finalReview.status}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-lg border p-3 space-y-1">
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">1. 设计基线</div>
                    <div className="text-sm font-medium">{executionTrace.designTitle}</div>
                    {executionTrace.designSummary ? (
                      <div className="text-xs leading-5 text-gray-600 dark:text-gray-400">
                        {executionTrace.designSummary}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-lg border p-3 space-y-1">
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">2. 当前执行</div>
                    <div className="text-sm font-medium">{executionTrace.activePhaseTitle || '未进入阶段'}</div>
                    {executionTrace.activeStepName ? (
                      <div className="text-xs leading-5 text-gray-600 dark:text-gray-400">
                        当前步骤：{executionTrace.activeStepName}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-lg border p-3 space-y-1">
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">3. 审阅与修订</div>
                    {executionTrace.latestSupervisorReview?.content ? (
                      <>
                        <div className="text-sm font-medium">
                          {executionTrace.latestSupervisorReview.type === 'checkpoint-advice'
                            ? `检查点建议 · ${executionTrace.latestSupervisorReview.stateName || '当前阶段'}`
                            : executionTrace.latestSupervisorReview.stateName || 'Supervisor 审阅'}
                        </div>
                        <div className="text-xs leading-5 text-gray-600 dark:text-gray-400 whitespace-pre-line line-clamp-5">
                          {executionTrace.latestSupervisorReview.content}
                        </div>
                      </>
                    ) : executionTrace.latestRevision ? (
                      <>
                        <div className="text-sm font-medium">v{executionTrace.latestRevision.version}</div>
                        <div className="text-xs leading-5 text-gray-600 dark:text-gray-400 line-clamp-4">
                          {executionTrace.latestRevision.summary}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-gray-500 dark:text-gray-400">暂无审阅或修订记录</div>
                    )}
                  </div>
                  <div className="rounded-lg border p-3 space-y-1">
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">4. 结算输出</div>
                    {executionTrace.finalReview ? (
                      <>
                        <div className="text-sm font-medium">{executionTrace.finalReview.status}</div>
                        <div className="text-xs leading-5 text-gray-600 dark:text-gray-400 line-clamp-4">
                          {executionTrace.finalReview.summary}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-gray-500 dark:text-gray-400">运行尚未生成最终结算</div>
                    )}
                  </div>
                </div>
              </div>
            )}

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

            {/* 快速流转预览 */}
            {stateHistory.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold mb-4">最近流转</h3>
                <StateFlowVisualizer
                  stateHistory={stateHistory.slice(-10)}
                  currentState={currentState}
                  onStateClick={handleOverviewStateClick}
                />
              </div>
            )}

            {overviewFooter}
          </div>
        </TabsContent>

        {/* 执行追踪视图 */}
        <TabsContent value="trace" className="flex-1 overflow-auto">
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-4 h-4" />
                <h3 className="font-semibold">状态图</h3>
              </div>
              <div className="h-[520px] min-h-[360px]">
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
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-4">
                <GitBranch className="w-4 h-4" />
                <h3 className="font-semibold">流转图</h3>
              </div>
              <StateFlowVisualizer
                stateHistory={stateHistory}
                currentState={currentState}
              />
            </div>
          </div>
        </TabsContent>

        {/* 事件回放视图 */}
        <TabsContent value="replay" className="flex-1 overflow-auto">
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4" />
                <h3 className="font-semibold">状态时序</h3>
              </div>
              <StateTransitionTimeline
                stateHistory={stateHistory}
                currentState={currentState}
                status={status}
              />
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-4">
                <GitBranch className="w-4 h-4" />
                <h3 className="font-semibold">Supervisor 事件</h3>
              </div>
              <SupervisorFlowVisualizer
                flow={supervisorFlow}
              />
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-4">
                <Bot className="w-4 h-4" />
                <h3 className="font-semibold">Agent 事件</h3>
              </div>
              <div className="h-[520px] min-h-[360px]">
                <AgentFlowDiagram
                  flow={agentFlow}
                  states={states}
                  currentStep={currentStep}
                />
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
