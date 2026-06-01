import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { NextRequest } from 'next/server';
import { getWorkspaceRunsDir } from '@/lib/core/app-paths';
import { chatSessionEvents, type ChatSessionEvent } from '@/lib/chat/persistence';
import { engineStreamStateEvents, listPublicEngineStreams, type EngineStreamStateEvent } from '@/lib/chat/stream-state';
import { loadRunState, type HumanQuestion } from '@/lib/run/state-persistence';
import { isStateMachineManagerLike, workflowRegistry } from '@/lib/workflow/registry';

export const dynamic = 'force-dynamic';

const INACTIVE_RUN_STATUSES = new Set(['stopped', 'completed', 'failed', 'crashed']);

async function listPendingHumanQuestions(): Promise<HumanQuestion[]> {
  const byId = new Map<string, HumanQuestion>();

  for (const { manager } of workflowRegistry.getRunningManagers()) {
    if (!isStateMachineManagerLike(manager)) continue;
    const managerStatus = manager.getStatus();
    for (const question of manager.getHumanQuestions()) {
      if (question.status !== 'unanswered') continue;
      byId.set(question.id, {
        ...question,
        workflowFrontendSessionId: question.workflowFrontendSessionId ?? managerStatus.workflowFrontendSessionId ?? null,
      });
    }
  }

  const runsDir = getWorkspaceRunsDir();
  if (!existsSync(runsDir)) {
    return Array.from(byId.values()).sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
  }

  const entries = await readdir(runsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const state = await loadRunState(entry.name).catch(() => null);
    if (!state?.humanQuestions?.length) continue;
    if (INACTIVE_RUN_STATUSES.has(state.status)) continue;
    for (const question of state.humanQuestions) {
      if (question.status !== 'unanswered' || byId.has(question.id)) continue;
      byId.set(question.id, {
        ...question,
        workflowFrontendSessionId: question.workflowFrontendSessionId ?? state.workflowFrontendSessionId ?? null,
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
}

function getWorkflowStatusSnapshot(configFile?: string | null): any | null {
  if (!configFile) return null;
  const entry = workflowRegistry.getAllManagers().find((item) => item.configFile === configFile);
  const status = entry?.manager?.getStatus?.();
  if (!status) return null;
  return {
    status: status.status || '',
    statusReason: status.statusReason || null,
    runId: status.runId || '',
    currentState: status.currentState || null,
    currentPhase: status.currentPhase || null,
    currentStep: status.currentStep || null,
    activeSteps: Array.isArray(status.activeSteps) ? status.activeSteps : [],
    activeConcurrencyGroups: Array.isArray(status.activeConcurrencyGroups) ? status.activeConcurrencyGroups : [],
    completedSteps: Array.isArray(status.completedSteps) ? status.completedSteps : [],
    failedSteps: Array.isArray(status.failedSteps) ? status.failedSteps : [],
    agents: Array.isArray(status.agents) ? status.agents : [],
    stateHistory: Array.isArray(status.stateHistory) ? status.stateHistory : [],
    issueTracker: Array.isArray(status.issueTracker) ? status.issueTracker : [],
    transitionCount: typeof status.transitionCount === 'number' ? status.transitionCount : 0,
    startTime: status.startTime || null,
    endTime: status.endTime || null,
    workingDirectory: status.workingDirectory || null,
    globalContext: status.globalContext,
    phaseContexts: status.phaseContexts || {},
    supervisorFlow: Array.isArray(status.supervisorFlow) ? status.supervisorFlow : [],
    agentFlow: Array.isArray(status.agentFlow) ? status.agentFlow : [],
    pendingLiveFeedback: Array.isArray(status.pendingLiveFeedback) ? status.pendingLiveFeedback : [],
    currentConfigFile: status.currentConfigFile || configFile,
    workflowFrontendSessionId: status.workflowFrontendSessionId || null,
    supervisorAgent: status.supervisorAgent || null,
    latestSupervisorReview: status.latestSupervisorReview || null,
    pendingHumanQuestionId: status.pendingHumanQuestionId || null,
    pendingHumanQuestion: status.pendingHumanQuestion || null,
    humanQuestions: Array.isArray(status.humanQuestions) ? status.humanQuestions : undefined,
    specRevisionVote: status.specRevisionVote || null,
    specRevisionVoteHistory: Array.isArray(status.specRevisionVoteHistory) ? status.specRevisionVoteHistory : [],
    runSpecCoding: status.runSpecCoding || null,
    qualityChecks: Array.isArray(status.qualityChecks) ? status.qualityChecks : [],
    persistMode: status.persistMode || null,
    specRootDir: status.specRootDir || null,
    deltaSpecMerged: status.deltaSpecMerged || false,
    deltaMergeState: status.deltaMergeState || null,
  };
}

function buildLiveSnapshot(workflowStatusesFallback: Record<string, any> = {}) {
  const workflowStatuses: Record<string, any> = { ...workflowStatusesFallback };
  const runStatusById: Record<string, string> = {};

  for (const entry of workflowRegistry.getAllManagers()) {
    const statusSnapshot = getWorkflowStatusSnapshot(entry.configFile);
    const configFile = statusSnapshot?.currentConfigFile || entry.configFile;
    if (!configFile) continue;
    workflowStatuses[configFile] = statusSnapshot;
    if (statusSnapshot?.runId && statusSnapshot?.status) {
      runStatusById[String(statusSnapshot.runId)] = String(statusSnapshot.status);
    }
  }

  return {
    workflowStatuses,
    runStatusById,
    chatStreams: listPublicEngineStreams(),
  };
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      const sendEvent = (data: any) => {
        if (closed) return;
        const message = `data: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(message));
        } catch {
          closed = true;
        }
      };

      // Normalized event handlers — forward from registry which tags with __configFile
      const handlers: Record<string, (data: any) => void> = {};
      const eventTypes = [
        'status', 'phase', 'step', 'result', 'checkpoint', 'agents',
        'iteration', 'iteration-complete', 'escalation', 'token-usage',
        'feedback-injected', 'feedback-recalled', 'context-updated',
        'route-decision',
        // State machine events forwarded with normalized type names
        'state-change', 'step-start', 'step-complete', 'transition',
        'force-transition', 'transition-forced', 'human-approval-required',
        'human-question-required', 'human-question-answered', 'human-question-updated',
        'agent-flow', 'supervisor-review', 'state-executing',
        'parallel-group-start', 'parallel-group-complete', 'circuit-breaker',
      ];

      // Map SM events to frontend-compatible types
      const smTypeMap: Record<string, string> = {
        'state-change': 'phase',
        'step-start': 'step',
        'step-complete': 'result',
        transition: 'sm-transition',
      };
      const workflowStatusesFallback: Record<string, any> = {};

      for (const evt of eventTypes) {
        handlers[evt] = (data: any) => {
          const { __configFile, ...rest } = data;
          const mappedType = smTypeMap[evt];
          const configFile = typeof __configFile === 'string' ? __configFile : undefined;
          const statusSnapshot = getWorkflowStatusSnapshot(configFile);
          if (configFile && statusSnapshot) {
            workflowStatusesFallback[configFile] = statusSnapshot;
          }

          if (evt === 'state-change') {
            sendEvent({
              type: 'phase',
              data: {
                phase: rest.state,
                message: rest.message,
                configFile,
                statusSnapshot,
              },
            });
          } else if (evt === 'step-start') {
            sendEvent({
              type: 'step',
              data: {
                ...rest,
                step: `${rest.state}-${rest.step}`,
                configFile,
                statusSnapshot,
              },
            });
          } else if (evt === 'step-complete') {
            sendEvent({
              type: 'result',
              data: {
                ...rest,
                step: `${rest.state}-${rest.step}`,
                configFile,
                statusSnapshot,
              },
            });
          } else {
            sendEvent({
              type: mappedType || evt,
              data: {
                ...rest,
                configFile,
                statusSnapshot,
              },
            });
          }
        };
        workflowRegistry.on(evt, handlers[evt]);
      }

      const onEngineStreamState = (event: EngineStreamStateEvent) => {
        sendEvent({
          type: event.type === 'remove' ? 'chat-stream-removed' : 'chat-stream-state',
          data: event.type === 'remove'
            ? event
            : event.state,
        });
      };
      engineStreamStateEvents.on('change', onEngineStreamState);

      const onChatSessionEvent = (event: ChatSessionEvent) => {
        sendEvent({
          type: event.type === 'removed' ? 'chat-session-removed' : 'chat-session-updated',
          data: {
            sessionId: event.sessionId,
            updatedAt: event.updatedAt,
            removed: event.type === 'removed',
          },
        });
      };
      chatSessionEvents.on('change', onChatSessionEvent);

      request.signal.addEventListener('abort', () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        for (const evt of eventTypes) {
          workflowRegistry.off(evt, handlers[evt]);
        }
        engineStreamStateEvents.off('change', onEngineStreamState);
        chatSessionEvents.off('change', onChatSessionEvent);
        try {
          controller.close();
        } catch {}
      });

      sendEvent({ type: 'connected', data: { message: '已连接到事件流' } });
      heartbeatTimer = setInterval(() => {
        sendEvent({ type: 'heartbeat', data: { timestamp: Date.now() } });
      }, 15000);
      const pendingHumanQuestions = await listPendingHumanQuestions().catch(() => []);
      sendEvent({
        type: 'snapshot',
        data: {
          ...buildLiveSnapshot(workflowStatusesFallback),
          pendingHumanQuestions,
        },
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
