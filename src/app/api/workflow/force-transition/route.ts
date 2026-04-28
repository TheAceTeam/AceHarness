import { NextRequest, NextResponse } from 'next/server';
import { isStateMachineManagerLike, workflowRegistry } from '@/lib/workflow-registry';
import { loadRunState } from '@/lib/run-state-persistence';

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
        manager.setQueuedApprovalAction('approve');
        manager.forceTransition(targetState, instruction);
        return NextResponse.json({ success: true, message: `已请求强制跳转到: ${targetState}` });
      }

      manager.setQueuedApprovalAction('approve');
      setTimeout(() => {
        try {
          manager.forceTransition(targetState, instruction);
        } catch {
          // ignore late transition race; resume path will surface failures via status/logs
        }
      }, 500);
      manager.resume(runId).catch(() => {});
      return NextResponse.json({ success: true, message: `正在恢复并跳转到: ${targetState}` });
    }

    const manager = workflowRegistry.getRunningManager(configFile);
    if (!isStateMachineManagerLike(manager)) {
      return NextResponse.json({ error: '没有运行中的状态机工作流' }, { status: 400 });
    }
    manager.forceTransition(targetState, instruction);
    return NextResponse.json({ success: true, message: `已请求强制跳转到: ${targetState}` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
