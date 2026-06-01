import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { workflowRegistry } from '@/lib/workflow/registry';
import { loadRunState } from '@/lib/run/state-persistence';
import { loadCreationSession, loadLatestCreationSessionByFilename } from '@/lib/spec/coding-store';
import {
  findRelevantWorkflowExperiences,
  listWorkflowExperiences,
  loadWorkflowFinalReview,
} from '@/lib/workflow/experience-store';
import { getRuntimeWorkflowConfigPath } from '@/lib/run/runtime-configs';
import { getSpecRootDir } from '@/lib/spec/persistence';
import { resolve } from 'path';
import type { SpecCodingDocument } from '@/lib/core/schemas';
import {
  listMemoryEntries,
  type MemoryEntry,
} from '@/lib/workflow/memory-store';
import { compactWorkflowStatusForLive } from '@/lib/workflow/live-status';

export const dynamic = 'force-dynamic';

type WorkflowStructureMapping = {
  mode: 'phase-based' | 'state-machine' | 'unknown';
  yamlSourceOfTruth: string[];
  derivedIntoSpecCoding: string[];
  runtimeSpecCodingSourceOfTruth: string[];
  counts: {
    yamlPhases: number;
    yamlStates: number;
    yamlSteps: number;
    yamlCheckpoints: number;
    specCodingPhases: number;
    specCodingTasks: number;
    specCodingAssignments: number;
    specCodingCheckpoints: number;
  };
};

async function buildWorkflowStructureMapping(configFile: string, specCoding: SpecCodingDocument): Promise<WorkflowStructureMapping | null> {
  try {
    const configPath = await getRuntimeWorkflowConfigPath(configFile);
    const raw = await readFile(configPath, 'utf-8');
    const config = parse(raw) as any;
    const workflow = config?.workflow || {};
    const phases = Array.isArray(workflow.phases) ? workflow.phases : [];
    const states = Array.isArray(workflow.states) ? workflow.states : [];
    const yamlSteps = (phases.length > 0 ? phases : states)
      .reduce((sum: number, item: any) => sum + (Array.isArray(item?.steps) ? item.steps.length : 0), 0);
    const yamlCheckpoints = phases.reduce((sum: number, phase: any) => sum + (phase?.checkpoint ? 1 : 0), 0);

    return {
      mode: workflow.mode === 'state-machine'
        ? 'state-machine'
        : phases.length > 0
          ? 'phase-based'
          : 'unknown',
      yamlSourceOfTruth: [
        'workflow.name / workflow.description',
        phases.length > 0 ? 'workflow.phases[].name / steps[] / checkpoint' : '',
        states.length > 0 ? 'workflow.states[].name / description / steps[] / transitions[]' : '',
        'roles[]',
        'context.projectRoot / workspaceMode / requirements',
        'workflow.supervisor',
      ].filter(Boolean),
      derivedIntoSpecCoding: [
        'specCoding.workflowName <- workflow.name',
        'specCoding.summary <- workflow.description / requirements',
        phases.length > 0
          ? 'specCoding.phases <- workflow.phases[].name + steps[].task'
          : 'specCoding.phases <- workflow.states[].name + description / steps[].task',
        'specCoding.assignments <- steps[].agent 聚合',
        'specCoding.checkpoints <- workflow.phases[].checkpoint',
      ],
      runtimeSpecCodingSourceOfTruth: [
        'specCoding.progress',
        'specCoding.tasks <- artifacts.tasks 的结构化状态投影',
        'specCoding.revisions',
        'run snapshot status',
        'Supervisor 非状态修订摘要',
      ],
      counts: {
        yamlPhases: phases.length,
        yamlStates: states.length,
        yamlSteps,
        yamlCheckpoints,
        specCodingPhases: specCoding.phases.length,
        specCodingTasks: specCoding.tasks.length,
        specCodingAssignments: specCoding.assignments.length,
        specCodingCheckpoints: specCoding.checkpoints.length,
      },
    };
  } catch {
    return null;
  }
}

async function loadWorkflowRuntimeMeta(configFile: string): Promise<{
  workflowName?: string;
  projectRoot?: string;
  requirements?: string;
  specRoot?: string;
}> {
  try {
    const configPath = await getRuntimeWorkflowConfigPath(configFile);
    const raw = await readFile(configPath, 'utf-8');
    const config = parse(raw) as any;
    return {
      workflowName: typeof config?.workflow?.name === 'string' ? config.workflow.name : undefined,
      projectRoot: typeof config?.context?.projectRoot === 'string' ? config.context.projectRoot : undefined,
      requirements: typeof config?.context?.requirements === 'string' ? config.context.requirements : undefined,
      specRoot: typeof config?.specCoding?.specRoot === 'string' ? config.specCoding.specRoot : undefined,
    };
  } catch {
    return {};
  }
}

function compactMemory(entries: MemoryEntry[]) {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    content: entry.content,
    source: entry.source,
    createdAt: entry.createdAt,
    tags: entry.tags || [],
  }));
}

function buildSpecCodingPayload(specCoding: SpecCodingDocument, source: 'run' | 'creation') {
  return {
    specCodingSummary: {
      id: specCoding.id,
      version: specCoding.version,
      status: specCoding.status,
      source,
      summary: specCoding.summary,
      phaseCount: specCoding.phases.length,
      taskCount: specCoding.tasks.length,
      assignmentCount: specCoding.assignments.length,
      checkpointCount: specCoding.checkpoints.length,
      revisionCount: specCoding.revisions.length,
      progress: specCoding.progress,
      latestRevision: specCoding.revisions.at(-1) || null,
    },
    specCodingDetails: {
      phases: specCoding.phases,
      tasks: specCoding.tasks,
      assignments: specCoding.assignments,
      checkpoints: specCoding.checkpoints,
      revisions: specCoding.revisions,
      artifacts: specCoding.artifacts,
    },
  };
}

function enrichPersistentSpecStatus(status: any, runtimeMeta: WorkflowConfigMetaLike) {
  const persistMode = status?.persistMode || status?.runSpecCoding?.persistMode;
  const workingDirectory = status?.workingDirectory || runtimeMeta.projectRoot;
  const specRoot = status?.runSpecCoding?.specRoot || runtimeMeta.specRoot;
  const masterSpecPath = persistMode === 'repository' && (status?.specRootDir || workingDirectory)
    ? resolve(status?.specRootDir || getSpecRootDir(workingDirectory, specRoot), 'spec.md')
    : undefined;

  return {
    ...status,
    persistMode,
    deltaSpecMerged: status?.deltaSpecMerged,
    deltaMergeState: status?.deltaMergeState,
    masterSpecPath,
  };
}

type WorkflowConfigMetaLike = {
  projectRoot?: string;
  specRoot?: string;
};

async function withCreationSession(status: any, requestedConfigFile?: string | null) {
  const configFile = requestedConfigFile || status?.currentConfigFile;
  if (!configFile) return status;

  const finalReview = status?.runId ? await loadWorkflowFinalReview(status.runId).catch(() => null) : null;
  const runtimeMeta = await loadWorkflowRuntimeMeta(configFile);
  status = enrichPersistentSpecStatus(status, runtimeMeta);
  const creationSession = status?.creationSessionId
    ? await loadCreationSession(status.creationSessionId).catch(() => null)
    : await loadLatestCreationSessionByFilename(configFile).catch(() => null);
  const historicalExperiences = configFile
    ? await listWorkflowExperiences({ configFile, limit: 5 }).catch(() => [])
    : [];
  const recalledExperiences = await findRelevantWorkflowExperiences({
    configFile,
    workflowName: runtimeMeta.workflowName,
    requirements: runtimeMeta.requirements,
    projectRoot: status?.workingDirectory || runtimeMeta.projectRoot,
    excludeRunId: status?.runId || undefined,
    limit: 5,
  }).catch(() => []);
  const runSpecCoding = status?.runSpecCoding || null;
  const creationSpecCoding = creationSession?.specCoding || null;
  const displaySpecCoding = runSpecCoding || creationSpecCoding || null;
  const runSpecCodingPayload = runSpecCoding
    ? buildSpecCodingPayload(runSpecCoding, 'run')
    : null;
  const creationSpecCodingPayload = creationSpecCoding
    ? buildSpecCodingPayload(creationSpecCoding, 'creation')
    : null;
  const specCodingPayload = runSpecCodingPayload || creationSpecCodingPayload || {};
  const sourceOfTruth = displaySpecCoding
    ? await buildWorkflowStructureMapping(configFile, displaySpecCoding)
    : null;
  const supervisorName = status?.supervisorAgent || finalReview?.supervisorAgent || 'default-supervisor';
  const workflowMemories = await listMemoryEntries({
    scope: 'workflow',
    key: configFile,
    limit: 4,
  }).catch(() => []);
  const projectMemories = await listMemoryEntries({
    scope: 'project',
    key: status?.workingDirectory || runtimeMeta.projectRoot || configFile,
    limit: 4,
  }).catch(() => []);
  const roleMemories = await listMemoryEntries({
    scope: 'role',
    key: supervisorName,
    limit: 4,
  }).catch(() => []);
  const chatMemories = status?.supervisorSessionId
    ? await listMemoryEntries({
        scope: 'chat',
        key: `${supervisorName}:${status.supervisorSessionId}`,
        limit: 4,
      }).catch(() => [])
    : [];

  return {
    ...status,
    creationSession: creationSession ? {
      id: creationSession.id,
      workflowName: creationSession.workflowName,
      filename: creationSession.filename,
      status: creationSession.status,
      updatedAt: creationSession.updatedAt,
      bindingValidation: creationSession.bindingValidation,
    } : null,
    ...specCodingPayload,
    creationSpecCodingSummary: creationSpecCodingPayload?.specCodingSummary || null,
    creationSpecCodingDetails: creationSpecCodingPayload?.specCodingDetails || null,
    runSpecCodingSummary: runSpecCodingPayload?.specCodingSummary || null,
    runSpecCodingDetails: runSpecCodingPayload?.specCodingDetails || null,
    sourceOfTruth,
    finalReview,
    qualityChecks: status?.qualityChecks || [],
    memoryLayers: {
      schema: {
        scopes: ['role', 'project', 'workflow', 'chat'],
        rules: [
          'role: Agent 长期记忆，可跨 run 复用',
          'project: 当前工程共享经验，不跨项目扩散',
          'workflow: 当前配置/运行相关设计与复盘',
          'chat: 单次会话补充记忆，只在本会话复用',
        ],
      },
      runtime: {
        specCodingSummary: runSpecCoding
          ? {
              id: runSpecCoding.id,
              version: runSpecCoding.version,
              summary: runSpecCoding.summary,
              progressSummary: runSpecCoding.progress?.summary,
            }
          : null,
        qualityChecks: status?.qualityChecks || [],
      },
      review: finalReview
        ? {
            summary: finalReview.summary,
            nextFocus: finalReview.nextFocus,
            experience: finalReview.experience,
            generatedAt: finalReview.generatedAt,
          }
        : null,
      history: historicalExperiences
        .filter((item) => item.runId !== status?.runId)
        .map((item) => ({
          runId: item.runId,
          status: item.status,
          summary: item.summary,
          nextFocus: item.nextFocus,
          experience: item.experience,
          generatedAt: item.generatedAt,
        })),
      role: {
        agent: supervisorName,
        memories: compactMemory(roleMemories),
      },
      project: {
        key: status?.workingDirectory || runtimeMeta.projectRoot || configFile,
        memories: compactMemory(projectMemories),
      },
      workflow: {
        key: configFile,
        memories: compactMemory(workflowMemories),
      },
      chat: {
        sessionId: status?.supervisorSessionId || null,
        memories: compactMemory(chatMemories),
      },
      recalledExperiences: recalledExperiences.map((item) => ({
        runId: item.runId,
        status: item.status,
        summary: item.summary,
        nextFocus: item.nextFocus,
        experience: item.experience,
        generatedAt: item.generatedAt,
      })),
    },
  };
}

async function resolveWorkflowStatusPayload(configFile?: string | null, requestedRunId?: string | null) {
  if (configFile) {
    const runningManager = workflowRegistry.getRunningManager(configFile);
    const runningStatus = runningManager?.getStatus?.();
    if (runningStatus && (!requestedRunId || runningStatus.runId === requestedRunId)) {
      return withCreationSession(runningStatus, configFile);
    }

    if (requestedRunId) {
      const runState = await loadRunState(requestedRunId);
      if (runState && runState.configFile === configFile) {
        const pendingHumanQuestion = runState.pendingHumanQuestionId
          ? runState.humanQuestions?.find((question) => question.id === runState.pendingHumanQuestionId && question.status === 'unanswered') || null
          : runState.pendingCheckpoint?.humanQuestion || null;
        const pendingQuestionWithSession = pendingHumanQuestion
          ? {
              ...pendingHumanQuestion,
              workflowFrontendSessionId: pendingHumanQuestion.workflowFrontendSessionId ?? runState.workflowFrontendSessionId ?? null,
            }
          : null;
        const restoredStatus = {
          ...runState,
          runId: runState.runId,
          currentConfigFile: runState.configFile,
          currentPhase: runState.currentPhase || runState.currentState || null,
          logs: [],
          iterationStates: runState.iterationStates || {},
          agents: runState.agents || [],
          stepLogs: runState.stepLogs || [],
          completedSteps: runState.completedSteps || [],
          failedSteps: runState.failedSteps || [],
          workingDirectory: runState.workingDirectory || null,
          pendingHumanQuestion: pendingQuestionWithSession,
        };
        return withCreationSession(restoredStatus, configFile);
      }
    }

    const manager = await workflowRegistry.getManager(configFile);
    return withCreationSession(manager.getStatus(), configFile);
  }

  const running = workflowRegistry.getRunningManagers();
  if (running.length > 0) {
    return withCreationSession(running[0].manager.getStatus());
  }

  const all = workflowRegistry.getAllManagers();
  if (all.length > 0) {
    return withCreationSession(all[all.length - 1].manager.getStatus());
  }

  return { status: 'idle' };
}

async function resolveWorkflowLiveStatusPayload(configFile?: string | null, requestedRunId?: string | null) {
  if (configFile) {
    const runningManager = workflowRegistry.getRunningManager(configFile);
    const runningStatus = runningManager?.getStatus?.();
    if (runningStatus && (!requestedRunId || runningStatus.runId === requestedRunId)) {
      return compactWorkflowStatusForLive(runningStatus, configFile);
    }

    if (requestedRunId) {
      const runState = await loadRunState(requestedRunId);
      if (runState && runState.configFile === configFile) {
        return compactWorkflowStatusForLive({
          ...runState,
          runId: runState.runId,
          currentConfigFile: runState.configFile,
          currentPhase: runState.currentPhase || runState.currentState || null,
          pendingHumanQuestion: runState.pendingHumanQuestionId
            ? runState.humanQuestions?.find((question) => question.id === runState.pendingHumanQuestionId && question.status === 'unanswered') || null
            : runState.pendingCheckpoint?.humanQuestion || null,
        }, configFile);
      }
    }

    const manager = await workflowRegistry.getManager(configFile);
    return compactWorkflowStatusForLive(manager.getStatus(), configFile);
  }

  const running = workflowRegistry.getRunningManagers();
  if (running.length > 0) {
    return compactWorkflowStatusForLive(running[0].manager.getStatus(), running[0].configFile);
  }

  const all = workflowRegistry.getAllManagers();
  if (all.length > 0) {
    const entry = all[all.length - 1];
    return compactWorkflowStatusForLive(entry.manager.getStatus(), entry.configFile);
  }

  return { status: 'idle' };
}

function createWorkflowStatusStream(request: NextRequest, configFile?: string | null, requestedRunId?: string | null) {
  const encoder = new TextEncoder();
  let closed = false;
  let lastSignature = '';
  let timer: ReturnType<typeof setInterval> | null = null;
  const eventTypes = [
    'status', 'phase', 'step', 'result', 'checkpoint', 'agents',
    'iteration', 'iteration-complete', 'escalation', 'token-usage',
    'feedback-injected', 'feedback-recalled', 'context-updated',
    'route-decision', 'state-change', 'step-start', 'step-complete',
    'transition', 'force-transition', 'transition-forced',
    'human-approval-required', 'human-question-required',
    'human-question-answered', 'human-question-updated',
    'agent-flow', 'supervisor-review', 'state-executing',
    'parallel-group-start', 'parallel-group-complete', 'circuit-breaker',
  ];
  const handlers = new Map<string, (data: any) => void>();
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    for (const [type, handler] of handlers) {
      workflowRegistry.off(type, handler);
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const sendStatus = async (reason: string, force = false) => {
        if (closed) return;
        try {
          const status: any = await resolveWorkflowLiveStatusPayload(configFile, requestedRunId);
          const signature = JSON.stringify({
            status: status?.status,
            runId: status?.runId,
            currentPhase: status?.currentPhase,
            currentState: status?.currentState,
            currentStep: status?.currentStep,
            completedSteps: status?.completedSteps,
            failedSteps: status?.failedSteps,
            activeSteps: status?.activeSteps,
            activeConcurrencyGroups: status?.activeConcurrencyGroups,
            agents: Array.isArray(status?.agents)
              ? status.agents.map((agent: any) => ({
                  name: agent?.name,
                  status: agent?.status,
                  currentTask: agent?.currentTask,
                  completedTasks: agent?.completedTasks,
                }))
              : [],
            stepLogCount: Array.isArray(status?.stepLogs) ? status.stepLogs.length : 0,
            stateHistoryCount: Array.isArray(status?.stateHistory) ? status.stateHistory.length : 0,
            transitionCount: status?.transitionCount,
            issueCount: Array.isArray(status?.issueTracker) ? status.issueTracker.length : 0,
            supervisorFlowCount: Array.isArray(status?.supervisorFlow) ? status.supervisorFlow.length : 0,
            agentFlowCount: Array.isArray(status?.agentFlow) ? status.agentFlow.length : 0,
            pendingLiveFeedback: status?.pendingLiveFeedback,
            pendingHumanQuestionId: status?.pendingHumanQuestionId,
            pendingHumanQuestion: status?.pendingHumanQuestion,
            specRevisionVote: status?.specRevisionVote,
            specRevisionVoteHistory: status?.specRevisionVoteHistory,
            latestSupervisorReview: status?.latestSupervisorReview,
            deltaMergeState: status?.deltaMergeState,
            updatedAt: status?.updatedAt,
          });
          if (!force && signature === lastSignature) return;
          lastSignature = signature;
          send({ type: 'status', reason, data: status });
        } catch (error: any) {
          send({ type: 'error', reason, error: error?.message || '获取状态失败' });
        }
      };

      for (const type of eventTypes) {
        const handler = (payload: any) => {
          const eventConfigFile = typeof payload?.__configFile === 'string' ? payload.__configFile : undefined;
          if (configFile && eventConfigFile && eventConfigFile !== configFile) return;
          void sendStatus(type);
        };
        handlers.set(type, handler);
        workflowRegistry.on(type, handler);
      }

      request.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });

      send({ type: 'connected', data: { configFile: configFile || null, runId: requestedRunId || null } });
      void sendStatus('initial', true);
      timer = setInterval(() => {
        send({ type: 'heartbeat', data: { timestamp: Date.now() } });
        void sendStatus('heartbeat');
      }, 5000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const configFile = request.nextUrl.searchParams.get('configFile');
    const requestedRunId = request.nextUrl.searchParams.get('runId');
    const live = request.nextUrl.searchParams.get('live') === '1';

    if (live) {
      return createWorkflowStatusStream(request, configFile, requestedRunId);
    }

    return NextResponse.json(await resolveWorkflowStatusPayload(configFile, requestedRunId));
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取状态失败', message: error.message },
      { status: 500 }
    );
  }
}
