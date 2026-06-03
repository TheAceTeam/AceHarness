import { NextRequest, NextResponse } from 'next/server';
import { isStateMachineManagerLike, workflowRegistry } from '@/lib/workflow/registry';
import { loadRunState, type PersistedRunState } from '@/lib/run/state-persistence';
import { getRuntimeWorkflowConfigPath } from '@/lib/run/runtime-configs';
import { readFile } from 'fs/promises';
import { parse } from 'yaml';

async function validateStateMachineTarget(runState: PersistedRunState, targetState: string): Promise<NextResponse | null> {
  const configPath = await getRuntimeWorkflowConfigPath(runState.configFile);
  const configContent = await readFile(configPath, 'utf-8');
  const workflowConfig = parse(configContent);
  if (workflowConfig?.workflow?.mode !== 'state-machine') {
    return NextResponse.json({ error: '目标运行不是状态机工作流' }, { status: 400 });
  }
  const states = Array.isArray(workflowConfig.workflow.states) ? workflowConfig.workflow.states : [];
  if (!states.some((state: any) => state?.name === targetState)) {
    return NextResponse.json({ error: `找不到目标状态: ${targetState}` }, { status: 400 });
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const { targetState, instruction, configFile, runId } = await request.json();
    if (!targetState) {
      return NextResponse.json({ error: '缺少目标状态参数' }, { status: 400 });
    }

    if (runId) {
      const runState = await loadRunState(runId);
      if (!runState) {
        return NextResponse.json({ error: `找不到运行记录: ${runId}` }, { status: 404 });
      }
      const targetValidationError = await validateStateMachineTarget(runState, targetState);
      if (targetValidationError) return targetValidationError;

      const manager = await workflowRegistry.getManagerByRunId(runId) || await workflowRegistry.getManager(runState.configFile);
      if (!isStateMachineManagerLike(manager)) {
        return NextResponse.json({ error: '目标运行不是状态机工作流' }, { status: 400 });
      }

      const currentStatus = manager.getStatus();
      const canDirectTransition =
        currentStatus.status === 'running'
        && currentStatus.runId === runId
        && currentStatus.currentState === '__human_approval__';

      if (canDirectTransition) {
        const pendingQuestion = currentStatus.pendingHumanQuestion;
        if (pendingQuestion?.answerSchema?.type === 'approval-transition') {
          await manager.answerHumanQuestion(pendingQuestion.id, { selectedState: targetState, instruction });
          return NextResponse.json({ success: true, message: `已回答人工审查并请求跳转到: ${targetState}` });
        }
        manager.setQueuedApprovalAction('approve');
        manager.forceTransition(targetState, instruction);
        return NextResponse.json({ success: true, message: `已请求强制跳转到: ${targetState}` });
      }

      if (currentStatus.status === 'running' && currentStatus.runId === runId) {
        manager.forceTransition(targetState, instruction);
        return NextResponse.json({ success: true, message: `已请求强制跳转到: ${targetState}` });
      }
      if (currentStatus.status === 'running' && currentStatus.runId !== runId) {
        return NextResponse.json({ error: '该配置已有其他运行正在执行，无法强制恢复目标运行' }, { status: 409 });
      }

      manager.forceJumpToState(runId, targetState, instruction).catch((error) => {
        console.error('[workflow/force-transition] force jump failed:', error);
      });
      return NextResponse.json({ success: true, message: `正在强制恢复并跳转到: ${targetState}` });
    }

    const manager = workflowRegistry.getRunningManager(configFile);
    if (!isStateMachineManagerLike(manager)) {
      return NextResponse.json({ error: '没有运行中的状态机工作流' }, { status: 400 });
    }
    const pendingQuestion = manager.getPendingHumanQuestion();
    if (pendingQuestion?.answerSchema?.type === 'approval-transition') {
      await manager.answerHumanQuestion(pendingQuestion.id, { selectedState: targetState, instruction });
      return NextResponse.json({ success: true, message: `已回答人工审查并请求跳转到: ${targetState}` });
    }
    manager.forceTransition(targetState, instruction);
    return NextResponse.json({ success: true, message: `已请求强制跳转到: ${targetState}` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
