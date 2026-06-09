import { NextRequest, NextResponse } from 'next/server';
import { loadRunState } from '@/lib/run/state-persistence';
import { loadWorkflowFinalReview } from '@/lib/workflow/experience-store';
import { getWorkflowEventStore } from '@/lib/workflow/event-store';

const DEFAULT_HISTORY_LIMIT = 200;
const DEFAULT_FLOW_LIMIT = 200;
const DEFAULT_TEXT_PREVIEW_LIMIT = 8000;

function compactText(value: unknown, limit = DEFAULT_TEXT_PREVIEW_LIMIT): unknown {
  if (typeof value !== 'string') return value;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n...[truncated ${value.length - limit} chars]`;
}

function compactStepLog(log: any) {
  if (!log || typeof log !== 'object') return log;
  const output = typeof log.output === 'string' ? log.output : '';
  const error = typeof log.error === 'string' ? log.error : '';
  const outputSize = output.length > 0
    ? output.length
    : (typeof log.outputBytes === 'number' ? log.outputBytes : 0);
  return {
    ...log,
    output: '',
    error: compactText(error),
    errorSize: error.length,
    outputSize,
    hasOutput: outputSize > 0,
  };
}

function compactReviewResult(result: any) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const stepOutputs = Array.isArray(result.stepOutputs) ? result.stepOutputs : [];
  return {
    ...result,
    summary: compactText(result.summary),
    stepOutputs: [],
    stepOutputCount: stepOutputs.length,
    stepOutputBytes: stepOutputs.reduce((sum: number, item: any) => sum + (typeof item === 'string' ? item.length : 0), 0),
  };
}

function compactPendingCheckpoint(checkpoint: any) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return checkpoint;
  return {
    ...checkpoint,
    message: compactText(checkpoint.message),
    supervisorAdvice: compactText(checkpoint.supervisorAdvice),
    result: compactReviewResult(checkpoint.result),
    humanQuestion: compactHumanQuestion(checkpoint.humanQuestion),
  };
}

function compactHumanQuestion(question: any) {
  if (!question || typeof question !== 'object' || Array.isArray(question)) return question;
  return {
    ...question,
    message: compactText(question.message),
    supervisorAdvice: compactText(question.supervisorAdvice),
    result: compactReviewResult(question.result),
    answer: compactText(question.answer),
  };
}

function compactHumanAnswerContext(item: any) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  return {
    ...item,
    question: compactText(item.question),
    answer: compactText(item.answer),
    context: compactText(item.context),
  };
}

function trimArray<T>(value: T[] | undefined, limit: number): T[] | undefined {
  if (!Array.isArray(value)) return value;
  if (value.length <= limit) return value;
  return value.slice(-limit);
}

function compactRunDetail(state: any, finalReview: any) {
  const compact = {
    ...state,
    finalReview,
    stepLogs: Array.isArray(state.stepLogs) ? state.stepLogs.map(compactStepLog) : state.stepLogs,
    humanQuestions: Array.isArray(state.humanQuestions) ? state.humanQuestions.map(compactHumanQuestion) : state.humanQuestions,
    pendingCheckpoint: compactPendingCheckpoint(state.pendingCheckpoint),
    humanAnswersContext: Array.isArray(state.humanAnswersContext)
      ? state.humanAnswersContext.map(compactHumanAnswerContext)
      : state.humanAnswersContext,
    stateHistory: trimArray(state.stateHistory, DEFAULT_HISTORY_LIMIT),
    supervisorFlow: trimArray(state.supervisorFlow, DEFAULT_FLOW_LIMIT),
    agentFlow: trimArray(state.agentFlow, DEFAULT_FLOW_LIMIT),
    __compact: true,
    __omitted: {
      stepLogOutputs: Array.isArray(state.stepLogs) && state.stepLogs.some((log: any) => typeof log?.output === 'string' && log.output.length > 0),
      stateHistory: Array.isArray(state.stateHistory) ? Math.max(0, state.stateHistory.length - DEFAULT_HISTORY_LIMIT) : 0,
      supervisorFlow: Array.isArray(state.supervisorFlow) ? Math.max(0, state.supervisorFlow.length - DEFAULT_FLOW_LIMIT) : 0,
      agentFlow: Array.isArray(state.agentFlow) ? Math.max(0, state.agentFlow.length - DEFAULT_FLOW_LIMIT) : 0,
    },
  };
  return compact;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeSessionMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [agent, sessionId] of Object.entries(value)) {
    const name = agent.trim();
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (name && normalizedSessionId) result[name] = normalizedSessionId;
  }
  return result;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasAgentSessionIds(agents: unknown): boolean {
  return Array.isArray(agents) && agents.some((agent) => nonEmptyString(agent?.sessionId));
}

function shouldBackfillRunSnapshot(snapshot: any): boolean {
  if (!isRecord(snapshot)) return false;
  const attachedAgentSessions = normalizeSessionMap(snapshot.attachedAgentSessions);
  return (
    snapshot.workflowFrontendSessionId === undefined
    || snapshot.supervisorSessionId === undefined
    || snapshot.attachedAgentSessions === undefined
    || Object.keys(attachedAgentSessions).length === 0
    || !Array.isArray(snapshot.agents)
    || !hasAgentSessionIds(snapshot.agents)
  );
}

function mergeAgentsWithSessionIds(
  snapshotAgents: unknown,
  stateAgents: unknown,
  sessionMap: Record<string, string>,
  supervisorAgent: string | null,
  supervisorSessionId: string | null,
) {
  const stateAgentByName = new Map<string, any>();
  if (Array.isArray(stateAgents)) {
    for (const agent of stateAgents) {
      const name = nonEmptyString(agent?.name);
      if (name) stateAgentByName.set(name, agent);
    }
  }

  const sourceAgents = Array.isArray(snapshotAgents) && snapshotAgents.length > 0
    ? snapshotAgents
    : Array.isArray(stateAgents)
      ? stateAgents
      : [];
  const merged = sourceAgents.map((agent: any) => {
    const name = nonEmptyString(agent?.name);
    const stateAgent = name ? stateAgentByName.get(name) : null;
    const sessionId = nonEmptyString(agent?.sessionId)
      || nonEmptyString(stateAgent?.sessionId)
      || (name ? nonEmptyString(sessionMap[name]) : null)
      || (name && supervisorAgent === name ? supervisorSessionId : null)
      || null;
    return {
      ...agent,
      sessionId,
    };
  });

  const existingNames = new Set(merged.map((agent: any) => nonEmptyString(agent?.name)).filter(Boolean));
  for (const [agentName, sessionId] of Object.entries(sessionMap)) {
    if (existingNames.has(agentName)) continue;
    const stateAgent = stateAgentByName.get(agentName);
    merged.push({
      ...(stateAgent || {}),
      name: agentName,
      sessionId,
    });
  }
  return merged;
}

function mergeSnapshotWithRunState(snapshot: any, state: any, finalReview: any) {
  const compactState = compactRunDetail(state, finalReview);
  const snapshotSessions = normalizeSessionMap(snapshot.attachedAgentSessions);
  const stateSessions = normalizeSessionMap(state.attachedAgentSessions);
  const supervisorAgent = nonEmptyString(snapshot.supervisorAgent) || nonEmptyString(state.supervisorAgent);
  const supervisorSessionId = nonEmptyString(snapshot.supervisorSessionId)
    || nonEmptyString(state.supervisorSessionId)
    || (supervisorAgent ? nonEmptyString(snapshotSessions[supervisorAgent]) || nonEmptyString(stateSessions[supervisorAgent]) : null)
    || null;
  const attachedAgentSessions = {
    ...stateSessions,
    ...snapshotSessions,
    ...(supervisorAgent && supervisorSessionId ? { [supervisorAgent]: supervisorSessionId } : {}),
  };

  return {
    ...compactState,
    ...snapshot,
    workflowFrontendSessionId: nonEmptyString(snapshot.workflowFrontendSessionId)
      || nonEmptyString(state.workflowFrontendSessionId)
      || null,
    supervisorAgent,
    supervisorSessionId,
    attachedAgentSessions,
    agents: mergeAgentsWithSessionIds(
      snapshot.agents,
      state.agents,
      attachedAgentSessions,
      supervisorAgent,
      supervisorSessionId,
    ),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    const include = request.nextUrl.searchParams.get('include');
    const full = include === 'full';
    if (!full) {
      const snapshot = await getWorkflowEventStore().getSnapshot(id).catch(() => null);
      if (snapshot?.snapshot) {
        const finalReview = await loadWorkflowFinalReview(id).catch(() => null);
        let detail = snapshot.snapshot;
        if (shouldBackfillRunSnapshot(detail)) {
          const state = await loadRunState(id, { hydrateLargeOutputs: false }).catch(() => null);
          if (state) {
            detail = mergeSnapshotWithRunState(detail, state, finalReview);
          }
        }
        return NextResponse.json({
          ...detail,
          finalReview,
          __compact: true,
          __source: 'event-store',
          __seq: snapshot.seq,
        });
      }
    }
    const [state, finalReview] = await Promise.all([
      loadRunState(id, { hydrateLargeOutputs: full }),
      loadWorkflowFinalReview(id),
    ]);
    if (!state) {
      return NextResponse.json({ error: '运行详情不存在' }, { status: 404 });
    }
    if (!full) {
      return NextResponse.json(compactRunDetail(state, finalReview));
    }
    return NextResponse.json({
      ...state,
      finalReview,
      __compact: false,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取运行详情失败', message: error.message },
      { status: 500 }
    );
  }
}
