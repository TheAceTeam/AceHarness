'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from '@/lib/navigation/dynamic';
import StateMachineExecutionView from '@/components/StateMachineExecutionView';
import LightweightWorkflowExecutionView from '@/components/workflow/LightweightWorkflowExecutionView';
import HumanQuestionCard from '@/components/workflow/HumanQuestionCard';
import { configApi, processApi, streamApi, workflowApi } from '@/lib/core/api';
import type { useWorkflowLiveState } from '@/lib/workflow/live-store';
import type { ChatSession } from '@/contexts/ChatContext';
import type { HumanQuestion, HumanQuestionAnswer } from '@/lib/run/state-persistence';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';

const DocumentsPanel = dynamic(() => import('@/components/DocumentsPanel'), {
  ssr: false,
  loading: () => (
    <div className="space-y-3 rounded-lg border bg-background p-3">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-20 rounded-lg" />
      <Skeleton className="h-20 rounded-lg" />
    </div>
  ),
});

interface WorkflowRuntimeRightRailProps {
  session: ChatSession | null;
  live: ReturnType<typeof useWorkflowLiveState>;
}

function normalizeRuntimeStatus(status: unknown): 'idle' | 'running' | 'completed' | 'failed' | 'waiting' | 'stopped' {
  const value = String(status || '').toLowerCase();
  if (value === 'preparing' || value === 'running') return 'running';
  if (value === 'completed') return 'completed';
  if (value === 'failed' || value === 'crashed') return 'failed';
  if (value === 'waiting') return 'waiting';
  if (value === 'stopped') return 'stopped';
  return 'idle';
}

function isRunningStatus(status: unknown): boolean {
  const value = String(status || '').toLowerCase();
  return value === 'preparing' || value === 'running' || value === 'waiting';
}

function resolveRuntimeStateName(status: any): string {
  return String(status?.currentState || status?.currentPhase || '').trim();
}

function resolveRuntimeActiveSteps(status: any): string[] {
  const terminal = ['completed', 'failed', 'stopped', 'crashed'].includes(String(status?.status || ''));
  if (terminal) return [];
  return Array.from(new Set([
    ...(Array.isArray(status?.activeSteps) ? status.activeSteps : []),
    status?.currentStep,
  ].map((step) => String(step || '').trim()).filter(Boolean)));
}

const RICH_RUNTIME_ARRAY_FIELDS = [
  'stateHistory',
  'supervisorFlow',
  'agentFlow',
  'issueTracker',
  'completedSteps',
  'failedSteps',
  'activeSteps',
  'activeConcurrencyGroups',
  'subworkflowRuns',
] as const;

export function mergeRuntimeStatus(liveStatus: any | null | undefined, fallbackStatus: any | null | undefined, runId?: string | null) {
  const live = liveStatus || null;
  const fallback = fallbackStatus || null;
  if (!live && !fallback) return null;

  const wantedRunId = String(runId || '').trim();
  if (wantedRunId && live?.runId && String(live.runId) !== wantedRunId) {
    return fallback && (!fallback.runId || String(fallback.runId) === wantedRunId) ? fallback : live;
  }
  if (!live) return fallback;
  if (!fallback) return live;

  const merged = { ...fallback, ...live };
  for (const field of RICH_RUNTIME_ARRAY_FIELDS) {
    const liveArray = Array.isArray(live[field]) ? live[field] : null;
    const fallbackArray = Array.isArray(fallback[field]) ? fallback[field] : null;
    if ((!liveArray || liveArray.length === 0) && fallbackArray && fallbackArray.length > 0) {
      merged[field] = fallbackArray;
    }
  }
  if (!live.executionTrace && fallback.executionTrace) merged.executionTrace = fallback.executionTrace;
  if (!live.subworkflowSummary && fallback.subworkflowSummary) merged.subworkflowSummary = fallback.subworkflowSummary;
  if (!live.pendingHumanQuestion && fallback.pendingHumanQuestion) merged.pendingHumanQuestion = fallback.pendingHumanQuestion;
  return merged;
}

function selectRuntimeBinding(session: ChatSession | null) {
  const binding = session?.workflowBinding;
  const embeddedWorkflow = session?.sessionWorkbenchState?.embeddedWorkflow;
  return {
    configFile: binding?.configFile || embeddedWorkflow?.configFile || '',
    runId: binding?.runId || embeddedWorkflow?.runId || '',
  };
}

function WorkflowRuntimeLoading() {
  return (
    <div className="space-y-4 p-1">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-56" />
      </div>
      <Skeleton className="h-[420px] w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    </div>
  );
}

const CHUNK_BOUNDARY_REGEX = /\r?\n*\s*<!--\s*chunk-boundary\s*-->\s*\r?\n*/gi;

function splitLiveStreamChunks(content: string): string[] {
  return String(content || '').split(CHUNK_BOUNDARY_REGEX).filter(Boolean);
}

function resolveLiveSourceStep(workflow: any, status: any, rawStepName?: string | null) {
  const trimmed = String(rawStepName || '').trim();
  const rawBase = trimmed.replace(/-迭代\d+$/, '');
  const currentState = resolveRuntimeStateName(status);
  const states = Array.isArray(workflow?.states) ? workflow.states : [];
  for (const state of states) {
    for (const step of state.steps || []) {
      const stepName = String(step?.name || '').trim();
      const stepBase = stepName.replace(/-迭代\d+$/, '');
      if (
        rawBase === stepName
        || rawBase === stepBase
        || rawBase === `${state.name}-${stepName}`
        || rawBase === `${state.name}-${stepBase}`
        || rawBase.endsWith(`-${stepName}`)
        || rawBase.endsWith(`-${stepBase}`)
      ) {
        return { stateName: state.name, stepName };
      }
    }
  }
  return { stateName: currentState || null, stepName: rawBase || trimmed || null };
}

type LiveOutputSource = {
  key: string;
  runId: string;
  stepKey: string;
  label: string;
  scope: string;
  stateName: string | null;
  stepName: string | null;
};

function normalizeActiveWorkflowSteps(input: {
  activeSteps?: unknown;
  currentStep?: unknown;
  currentPhase?: unknown;
  currentState?: unknown;
  completedSteps?: unknown;
  failedSteps?: unknown;
  terminal?: boolean;
}): string[] {
  if (input.terminal) return [];
  const rawSteps = Array.isArray(input.activeSteps)
    ? input.activeSteps.map((step) => String(step || '').trim()).filter(Boolean)
    : [];
  const currentStep = typeof input.currentStep === 'string' ? input.currentStep.trim() : '';
  const currentState = String(input.currentPhase || input.currentState || '').trim();
  const completed = new Set(Array.isArray(input.completedSteps) ? input.completedSteps.map((step) => String(step || '').trim()).filter(Boolean) : []);
  const failed = new Set(Array.isArray(input.failedSteps) ? input.failedSteps.map((step) => String(step || '').trim()).filter(Boolean) : []);
  const normalized = rawSteps.filter((step) => {
    if (currentStep && step === currentStep) return true;
    if (currentState && !step.startsWith(`${currentState}-`)) return false;
    return !completed.has(step) && !failed.has(step);
  });
  if (currentStep && (!currentState || currentStep.startsWith(`${currentState}-`)) && !normalized.includes(currentStep)) {
    normalized.unshift(currentStep);
  }
  return Array.from(new Set(normalized));
}

function buildLiveOutputSources({
  workflow,
  status,
  runId,
  activeSteps,
  currentStep,
}: {
  workflow: any;
  status: any;
  runId: string;
  activeSteps: string[];
  currentStep?: string | null;
}): LiveOutputSource[] {
  const sources: LiveOutputSource[] = [];
  const seen = new Set<string>();
  const pushSource = (input: {
    runId?: string | null;
    stepKey?: string | null;
    scope: string;
    workflow?: any;
    status?: any;
  }) => {
    const sourceRunId = String(input.runId || '').trim();
    const stepKey = String(input.stepKey || '').trim();
    if (!sourceRunId || !stepKey) return;
    const key = `${sourceRunId}::${stepKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    const resolved = resolveLiveSourceStep(input.workflow || workflow, input.status || status, stepKey);
    sources.push({
      key,
      runId: sourceRunId,
      stepKey,
      label: [input.scope, resolved.stateName || '', resolved.stepName || stepKey].filter(Boolean).join(' / '),
      scope: input.scope,
      stateName: resolved.stateName,
      stepName: resolved.stepName || stepKey,
    });
  };

  const parentRunId = runId || status?.runId || '';
  const rootActiveSteps = normalizeActiveWorkflowSteps({
    activeSteps,
    currentStep,
    currentPhase: status?.currentPhase,
    currentState: status?.currentState,
    completedSteps: status?.completedSteps,
    failedSteps: status?.failedSteps,
    terminal: ['completed', 'failed', 'stopped', 'crashed'].includes(String(status?.status || '').toLowerCase()),
  });
  for (const stepKey of rootActiveSteps) {
    pushSource({ runId: parentRunId, stepKey, scope: '当前工作流' });
  }

  const appendChild = (child: any, depth: number) => {
    const childRunId = child?.runId || child?.status?.runId;
    const childStatus = child?.status || child;
    const childSteps = normalizeActiveWorkflowSteps({
      activeSteps: childStatus?.activeSteps,
      currentStep: childStatus?.currentStep,
      currentPhase: childStatus?.currentPhase,
      currentState: childStatus?.currentState,
      completedSteps: childStatus?.completedSteps,
      failedSteps: childStatus?.failedSteps,
      terminal: ['completed', 'failed', 'stopped', 'crashed'].includes(String(childStatus?.status || '').toLowerCase()),
    });
    const scope = `${'子'.repeat(Math.max(1, depth))}工作流${child?.parentStepName ? ` · ${child.parentStepName}` : ''}`;
    for (const stepKey of childSteps) {
      pushSource({ runId: childRunId, stepKey, scope, status: childStatus } as any);
    }
    for (const nested of Array.isArray(childStatus?.subworkflowRuns) ? childStatus.subworkflowRuns : []) {
      appendChild(nested, depth + 1);
    }
  };
  for (const child of Array.isArray(status?.subworkflowRuns) ? status.subworkflowRuns : []) {
    appendChild(child, 1);
  }

  return sources;
}

function WorkflowLiveOutputPanel({
  runId,
  workflow,
  activeSteps,
  currentStep,
  status,
}: {
  runId: string;
  workflow: any;
  activeSteps: string[];
  currentStep?: string | null;
  status: any;
}) {
  const sources = useMemo(() => buildLiveOutputSources({ workflow, status, runId, activeSteps, currentStep }), [activeSteps, currentStep, runId, status, workflow]);
  const [selectedSourceKey, setSelectedSourceKey] = useState('');
  const [chunks, setChunks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sources.length) {
      setSelectedSourceKey('');
      return;
    }
    if (!selectedSourceKey || !sources.some((source) => source.key === selectedSourceKey)) {
      setSelectedSourceKey(sources[0].key);
    }
  }, [selectedSourceKey, sources]);

  const selectedSource = sources.find((source) => source.key === selectedSourceKey) || sources[0] || null;

  useEffect(() => {
    if (!selectedSource?.runId || !selectedSource?.stepKey) {
      setChunks([]);
      return;
    }
    let cancelled = false;
    let eventSource: EventSource | null = null;
    let timer: number | null = null;
    let raw = '';
    const applyContent = (content: string) => {
      if (cancelled) return;
      raw = content;
      setChunks(splitLiveStreamChunks(content));
    };
    const refresh = async () => {
      try {
        setLoading(true);
        const content = await streamApi.getStreamContent(selectedSource.runId, selectedSource.stepKey);
        if (content && content !== raw) {
          applyContent(content);
          return;
        }
        const { processes } = await processApi.list();
        const running = processes.find((process: any) => (
          process.runId === selectedSource.runId
          && process.step === selectedSource.stepKey
          && process.streamContent
        ));
        if (running?.streamContent && running.streamContent !== raw) {
          applyContent(running.streamContent);
        }
      } catch {
        // Keep the last visible output; transient stream misses are common during step switches.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setChunks([]);
    setLoading(true);
    eventSource = streamApi.connectLiveStream(
      selectedSource.runId,
      selectedSource.stepKey,
      (content) => {
        const nextRaw = raw && content.startsWith(raw) ? content : raw + content;
        applyContent(nextRaw);
        setLoading(false);
      },
      () => setLoading(false),
    );
    void refresh();
    timer = window.setInterval(refresh, isRunningStatus(status?.status) ? 2000 : 6000);
    return () => {
      cancelled = true;
      eventSource?.close();
      if (timer) window.clearInterval(timer);
    };
  }, [selectedSource?.runId, selectedSource?.stepKey, status?.status]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <span className="material-symbols-outlined text-[15px] text-primary">terminal</span>
          <span>实时输出</span>
        </div>
        {sources.length > 1 ? (
          <select
            value={selectedSourceKey}
            onChange={(event) => setSelectedSourceKey(event.target.value)}
            className="min-w-0 max-w-[58%] rounded-md border bg-background px-2 py-1 text-[11px]"
            title="切换实时步骤"
          >
            {sources.map((source) => (
              <option key={source.key} value={source.key}>{source.label}</option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {selectedSource ? (
          chunks.length ? (
            <div className="space-y-3">
              {chunks.map((chunk, index) => (
                <pre key={`${selectedSource.key}:${index}`} className="whitespace-pre-wrap break-words rounded-lg border bg-muted/25 p-3 font-mono text-[11px] leading-5 text-muted-foreground">{chunk}</pre>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">{loading ? '正在读取实时输出...' : '当前步骤暂未产生输出。'}</div>
          )
        ) : (
          <div className="text-xs text-muted-foreground">工作流运行到步骤后会在这里显示实时输出。</div>
        )}
      </div>
    </div>
  );
}

function WorkflowWorkspacePanel({ workspacePath }: { workspacePath: string }) {
  const openWorkspace = () => {
    if (!workspacePath || typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('ace:open-workspace-path', {
      detail: { workspacePath },
    }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto bg-background p-3">
      <div className="rounded-lg border p-3 text-xs">
        <div className="font-medium">运行工作区</div>
        {workspacePath ? (
          <code className="mt-2 block break-all font-mono text-[11px] text-muted-foreground">{workspacePath}</code>
        ) : (
          <div className="mt-2 text-muted-foreground">工作区正在准备，运行开始后会显示可打开的目录。</div>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={openWorkspace} disabled={!workspacePath}>
        打开工作区
      </Button>
    </div>
  );
}

export default function WorkflowRuntimeRightRail({ session, live }: WorkflowRuntimeRightRailProps) {
  const { configFile, runId } = selectRuntimeBinding(session);
  const [configState, setConfigState] = useState<{ config: any; agents: any[] } | null>(null);
  const [fallbackStatus, setFallbackStatus] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittingQuestionId, setSubmittingQuestionId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<'workflow' | 'documents' | 'live' | 'workspace'>('workflow');

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setConfigState(null);
    if (!configFile) return;
    configApi.getConfig(configFile)
      .then((result) => {
        if (cancelled) return;
        setConfigState({ config: result.config, agents: result.agents || [] });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || '加载工作流配置失败');
      });
    return () => {
      cancelled = true;
    };
  }, [configFile]);

  useEffect(() => {
    let cancelled = false;
    setFallbackStatus(null);
    if (!configFile) return;
    workflowApi.getStatus(configFile, runId || undefined)
      .then((status) => {
        if (cancelled) return;
        setFallbackStatus(status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [configFile, runId]);

  useEffect(() => {
    setActivePanel('workflow');
  }, [configFile, runId]);

  const liveStatus = configFile ? live.workflowStatusByConfig[configFile] : null;
  const status = useMemo(() => {
    return mergeRuntimeStatus(liveStatus, fallbackStatus, runId);
  }, [fallbackStatus, liveStatus, runId]);

  const pendingQuestion = useMemo<HumanQuestion | null>(() => {
    const statusQuestion = status?.pendingHumanQuestion;
    if (statusQuestion?.status === 'unanswered') return statusQuestion;
    return live.pendingHumanQuestions.find((question) => (
      question.status === 'unanswered'
      && (
        question.workflowFrontendSessionId === session?.id
        || (runId && question.runId === runId)
        || (configFile && question.configFile === configFile)
      )
    )) || null;
  }, [configFile, live.pendingHumanQuestions, runId, session?.id, status?.pendingHumanQuestion]);

  const workflow = configState?.config?.workflow;
  const agents = status?.agents?.length ? status.agents : configState?.agents || [];
  const completedSteps = Array.isArray(status?.completedSteps) ? status.completedSteps : [];
  const failedSteps = Array.isArray(status?.failedSteps) ? status.failedSteps : [];
  const currentStep = status?.currentStep || '';
  const activeSteps = resolveRuntimeActiveSteps(status);
  const terminal = ['completed', 'failed', 'stopped', 'crashed'].includes(String(status?.status || ''));
  const isLightweightWorkflow = workflow?.profile === 'lightweight';
  const workspacePath = String(
    status?.workingDirectory
    || session?.sessionWorkbenchState?.chatWorkspace?.workingDirectory
    || '',
  ).trim();

  const submitHumanQuestion = async (question: HumanQuestion, answer: HumanQuestionAnswer) => {
    setSubmittingQuestionId(question.id);
    try {
      const result = await workflowApi.answerHumanQuestion({
        questionId: question.id,
        runId: question.runId || runId || undefined,
        configFile: question.configFile || configFile || undefined,
        answer,
      });
      setFallbackStatus((prev: any) => prev ? { ...prev, pendingHumanQuestion: result.question.status === 'unanswered' ? result.question : null } : prev);
    } finally {
      setSubmittingQuestionId(null);
    }
  };

  if (!configFile) {
    return <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">工作流启动后会在这里显示运行状态。</div>;
  }

  if (error) {
    return <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-xs text-destructive">{error}</div>;
  }

  if (!workflow || !status) {
    return <WorkflowRuntimeLoading />;
  }

  return (
    <div className="flex h-full min-h-[520px] flex-col gap-3 overflow-hidden">
      <div className="shrink-0 rounded-lg border bg-background px-3 py-2 text-xs">
        <div className="truncate font-medium">{workflow.name || configState?.config?.name || configFile}</div>
        <div className="mt-0.5 truncate text-muted-foreground">{configFile}{runId ? ` · ${runId}` : ''}</div>
      </div>
      {pendingQuestion ? (
        <div className="shrink-0">
          <HumanQuestionCard
            question={pendingQuestion}
            submitting={submittingQuestionId === pendingQuestion.id}
            collapsible={false}
            onSubmit={(answer) => submitHumanQuestion(pendingQuestion, answer)}
          />
        </div>
      ) : null}
      <Tabs value={activePanel} onValueChange={(value) => setActivePanel(value as typeof activePanel)} className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-background">
        <div className="border-b px-2 pt-2">
          <TabsList className="grid h-8 w-full grid-cols-4" aria-label="工作流运行面板">
            <TabsTrigger value="workflow" className="text-xs">{isLightweightWorkflow ? '执行' : '工作流'}</TabsTrigger>
            <TabsTrigger value="documents" className="text-xs">{isLightweightWorkflow ? '任务文档' : '文档'}</TabsTrigger>
            <TabsTrigger value="live" className="text-xs">输出</TabsTrigger>
            <TabsTrigger value="workspace" className="text-xs">工作区</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="workflow" className="m-0 h-[calc(100%-49px)] min-h-0 overflow-hidden">
          <div key={`${configFile}:${runId}:diagram`} className="h-full min-h-0 w-full overflow-hidden">
            {isLightweightWorkflow ? (
              <LightweightWorkflowExecutionView
                workflow={workflow}
                runId={runId || status.runId || null}
                status={String(status.status || '')}
                currentState={resolveRuntimeStateName(status) || null}
                currentStep={terminal ? null : currentStep || null}
                activeSteps={activeSteps}
                completedSteps={completedSteps}
                failedSteps={failedSteps}
                onOpenTaskDocuments={() => setActivePanel('documents')}
                onOpenRuntimeOutput={() => setActivePanel('live')}
                onOpenWorkspace={() => setActivePanel('workspace')}
                workspaceAvailable={Boolean(workspacePath)}
              />
            ) : (
              <StateMachineExecutionView
                states={workflow.states || []}
                agents={agents}
                currentState={resolveRuntimeStateName(status) || null}
                currentStep={terminal ? null : currentStep || null}
                activeSteps={activeSteps}
                activeConcurrencyGroups={terminal ? [] : (Array.isArray(status.activeConcurrencyGroups) ? status.activeConcurrencyGroups : [])}
                completedSteps={completedSteps}
                stateHistory={Array.isArray(status.stateHistory) ? status.stateHistory : []}
                issueTracker={Array.isArray(status.issueTracker) ? status.issueTracker : []}
                transitionCount={typeof status.transitionCount === 'number' ? status.transitionCount : 0}
                maxTransitions={workflow.maxTransitions || status.maxTransitions || 50}
                status={normalizeRuntimeStatus(status.status)}
                isRunning={isRunningStatus(status.status)}
                allowForceTransition={false}
                focusedState={resolveRuntimeStateName(status) || null}
                startTime={status.startTime || null}
                endTime={status.endTime || null}
                accumulatedWaitMs={typeof status.accumulatedWaitMs === 'number' ? status.accumulatedWaitMs : 0}
                waitStartedAt={status.waitStartedAt || null}
                supervisorFlow={Array.isArray(status.supervisorFlow) ? status.supervisorFlow : []}
                agentFlow={Array.isArray(status.agentFlow) ? status.agentFlow : []}
                tokenAnalytics={status.tokenAnalytics}
                executionTrace={status.executionTrace || null}
                subworkflowRuns={Array.isArray(status.subworkflowRuns) ? status.subworkflowRuns : []}
                subworkflowSummary={status.subworkflowSummary || null}
                activeSubworkflowRunId={status.activeSubworkflowRunId || null}
                defaultActiveTab="trace"
                hasPendingHumanQuestion={Boolean(pendingQuestion)}
                pendingHumanQuestion={pendingQuestion as any}
              />
            )}
          </div>
        </TabsContent>
        <TabsContent value="documents" className="m-0 h-[calc(100%-49px)] min-h-0 overflow-hidden">
          <DocumentsPanel runId={runId || status.runId || null} />
        </TabsContent>
        <TabsContent value="live" className="m-0 h-[calc(100%-49px)] min-h-0 overflow-hidden">
          <WorkflowLiveOutputPanel
            runId={runId || status.runId || ''}
            workflow={workflow}
            activeSteps={activeSteps}
            currentStep={terminal ? null : currentStep || null}
            status={status}
          />
        </TabsContent>
        <TabsContent value="workspace" className="m-0 h-[calc(100%-49px)] min-h-0 overflow-hidden">
          <WorkflowWorkspacePanel workspacePath={workspacePath} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
