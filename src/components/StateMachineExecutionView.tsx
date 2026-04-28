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
import AgentFlowVisualizer from './AgentFlowVisualizer';
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

interface StateMachineExecutionViewProps {
  // 配置数据
  states: StateMachineState[];

  // 运行时数据
  currentState: string | null;
  currentStep?: string | null;
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
      setActiveTab(activeTabOverride);
    }
  }, [activeTabOverride]);

  const handleOverviewStateClick = (stateName: string) => {
    setActiveTab('diagram');
    onStateClick?.(stateName);
  };

  return (
    <div className="h-full flex flex-col">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-6 mb-4">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            <span>总览</span>
          </TabsTrigger>
          <TabsTrigger value="timeline" className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            <span>时序图</span>
          </TabsTrigger>
          <TabsTrigger value="flow" className="flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            <span>流转图</span>
          </TabsTrigger>
          <TabsTrigger value="supervisor" className="flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            <span>Supervisor</span>
          </TabsTrigger>
          <TabsTrigger value="agent-flow" className="flex items-center gap-2">
            <Bot className="w-4 h-4" />
            <span>Agent 流程</span>
          </TabsTrigger>
          <TabsTrigger value="diagram" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            <span>状态图</span>
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

        {/* 时序图视图 */}
        <TabsContent value="timeline" className="flex-1 overflow-auto">
          <StateTransitionTimeline
            stateHistory={stateHistory}
            currentState={currentState}
            status={status}
          />
        </TabsContent>

        {/* 流转图视图 */}
        <TabsContent value="flow" className="flex-1 overflow-auto">
          <StateFlowVisualizer
            stateHistory={stateHistory}
            currentState={currentState}
          />
        </TabsContent>

        {/* Supervisor 流转视图 */}
        <TabsContent value="supervisor" className="flex-1 overflow-auto">
          <SupervisorFlowVisualizer
            flow={supervisorFlow}
          />
        </TabsContent>

        {/* Agent 工作流视图 */}
        <TabsContent value="agent-flow" className="flex-1 overflow-hidden">
          <div className="h-full">
            <AgentFlowDiagram
              flow={agentFlow}
              states={states}
              currentStep={currentStep}
            />
          </div>
        </TabsContent>

        {/* 状态图视图 */}
        <TabsContent value="diagram" className="flex-1 overflow-hidden">
          <div className="h-full">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
