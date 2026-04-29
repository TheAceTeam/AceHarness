import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry, isStateMachineManagerLike } from '@/lib/workflow-registry';
import { loadRunState, type HumanQuestionAnswer } from '@/lib/run-state-persistence';

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
