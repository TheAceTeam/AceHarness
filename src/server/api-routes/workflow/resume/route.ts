import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { isStateMachineManagerLike, workflowRegistry } from '@/lib/workflow/registry';
import { loadRunState } from '@/lib/run/state-persistence';

const WORKFLOW_ALREADY_RUNNING_ERROR = '已有工作流正在运行';
const WORKFLOW_ALREADY_RUNNING_RESPONSE = '该配置的工作流已在运行中';
const FAILED_STEP_TRANSITION_BLOCKED_ERROR = '当前运行存在失败步骤，请先恢复失败步骤后再继续';
const FORCE_TRANSITION_ENDPOINT_REQUIRED_ERROR = '强制跳转请使用专用接口';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const { runId, action, feedback } = body;

    if (!runId) {
      return jsonOk(
        { error: '缺少 runId 参数' },
        { status: 400 }
      );
    }

    const runState = await loadRunState(runId);
    if (!runState) {
      return jsonOk(
        { error: `找不到运行记录: ${runId}` },
        { status: 404 }
      );
    }

    // Normal resume always retries the persisted checkpoint.  Keeping force
    // recovery on its dedicated endpoint prevents a generic resume request
    // from silently changing the recovery mode.
    if (action === 'force-transition') {
      return jsonOk({ error: FORCE_TRANSITION_ENDPOINT_REQUIRED_ERROR }, { status: 400 });
    }
    const manager = await workflowRegistry.getManagerByRunId(runId) || await workflowRegistry.getManager(runState.configFile);

    const currentStatus = manager.getStatus();
    if (currentStatus.status === 'running') {
      return jsonOk(
        { error: WORKFLOW_ALREADY_RUNNING_RESPONSE },
        { status: 409 }
      );
    }

    if (action === 'iterate' || action === 'approve') {
      manager.setQueuedApprovalAction(action);
      if (action === 'iterate' && feedback) {
        manager.setIterationFeedback(feedback);
      }
    }

    if (isStateMachineManagerLike(manager)) {
      // State-machine recovery reports startup failures before the response is
      // acknowledged, while preserving its failed-step retry semantics.
      await manager.resumeInBackground(runId);
    } else {
      // Legacy phase managers only expose asynchronous resume.  Keep the
      // established behavior; failures after this call cannot be observed by
      // this HTTP response.
      const legacyManager = manager as unknown as { resume: (legacyRunId: string) => Promise<void> };
      void legacyManager.resume(runId).catch(() => {});
    }

    return jsonOk({
      success: true,
      message: `已恢复运行: ${runId}`,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'FailedStepRecoveryRequiredError') {
      return jsonOk({ error: FAILED_STEP_TRANSITION_BLOCKED_ERROR }, { status: 409 });
    }
    if (error instanceof Error && error.message === WORKFLOW_ALREADY_RUNNING_ERROR) {
      return jsonOk(
        { error: WORKFLOW_ALREADY_RUNNING_RESPONSE },
        { status: 409 }
      );
    }
    return jsonOk(
      { error: '恢复工作流失败', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
