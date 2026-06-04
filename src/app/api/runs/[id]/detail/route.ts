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
        return NextResponse.json({
          ...snapshot.snapshot,
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
