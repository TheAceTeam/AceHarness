import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry, isStateMachineManagerLike } from '@/lib/workflow/registry';
import { loadRunState, type HumanQuestionAnswer } from '@/lib/run/state-persistence';

const INACTIVE_RUN_STATUSES = new Set(['stopped', 'completed', 'failed', 'crashed']);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ questionId: string }> }
) {
  try {
    const { questionId } = await params;
    const body = await request.json();
    const runId = typeof body?.runId === 'string' ? body.runId : '';
    const configFile = typeof body?.configFile === 'string' ? body.configFile : '';
    const answer = (body?.answer || {}) as HumanQuestionAnswer;

    if (!questionId) {
      return NextResponse.json({ error: '缺少 questionId 参数' }, { status: 400 });
    }
    if (!runId && !configFile) {
      return NextResponse.json({ error: '缺少 runId 或 configFile 参数' }, { status: 400 });
    }

    const persisted = runId ? await loadRunState(runId) : null;
    if (runId && !persisted) {
      return NextResponse.json({ error: `找不到运行记录: ${runId}` }, { status: 404 });
    }
    if (persisted && configFile && persisted.configFile !== configFile) {
      return NextResponse.json({ error: '运行记录与配置文件不匹配' }, { status: 400 });
    }
    if (persisted && INACTIVE_RUN_STATUSES.has(persisted.status)) {
      const staleQuestion = persisted.humanQuestions?.find((question) => question.id === questionId) || null;
      return NextResponse.json({
        question: staleQuestion ? {
          ...staleQuestion,
          status: staleQuestion.status === 'unanswered' ? 'dismissed' : staleQuestion.status,
        } : null,
        stale: true,
        message: `该人工审查问题来自已停止的工作流（${persisted.status}），已视为失效。`,
      });
    }

    const manager = runId
      ? await workflowRegistry.getManagerByRunId(runId)
      : workflowRegistry.getRunningManager(configFile);
    if (!isStateMachineManagerLike(manager)) {
      return NextResponse.json({ error: '目标运行不是状态机工作流' }, { status: 400 });
    }

    const status = manager.getStatus();
    if (runId && status.runId !== runId) {
      return NextResponse.json({ error: '目标工作流运行未处于活动状态' }, { status: 409 });
    }
    if (configFile && status.currentConfigFile !== configFile) {
      return NextResponse.json({ error: '目标工作流配置不匹配' }, { status: 409 });
    }

    const question = await manager.answerHumanQuestion(questionId, answer);
    return NextResponse.json({ question });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '回答 Supervisor 消息失败' }, { status: 400 });
  }
}
