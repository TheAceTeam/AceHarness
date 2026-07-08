import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { workflowRegistry } from '@/lib/workflow/registry';
import { loadRunState } from '@/lib/run/state-persistence';
import { requireAuth } from '@/lib/auth/middleware';
import { canAccessRunState } from '@/lib/workflow/run-access';
import { appendWorkflowAuditEvent, getWorkflowAuditRequestMeta } from '@/lib/workflow/audit-log';

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const body = await readJsonBody<any>(request, {});
    const { runId, stepName } = body;

    if (!runId || !stepName) {
      return jsonOk(
        { error: '缺少 runId 或 stepName 参数' },
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
    if (!canAccessRunState(auth, runState, 'operate')) {
      return jsonOk({ error: '无权操作该工作流运行' }, { status: 403 });
    }

    const manager = await workflowRegistry.getManager(runState.configFile);

    const currentStatus = manager.getStatus();
    if (currentStatus.status === 'running') {
      return jsonOk(
        { error: '该配置的工作流已在运行中' },
        { status: 409 }
      );
    }

    manager.rerunFromStep(runId, stepName, { id: auth.id, name: auth.username }).catch(() => {});
    await appendWorkflowAuditEvent({
      action: 'rerun-from-step',
      runId,
      rootRunId: runState.rootRunId || runId,
      configFile: runState.configFile,
      actorId: auth.id,
      actorName: auth.username,
      ...getWorkflowAuditRequestMeta(request),
      before: { status: runState.status, currentState: runState.currentState },
      after: { stepName },
    });

    return jsonOk({
      success: true,
      message: `正在从步骤 "${stepName}" 重新运行`,
    });
  } catch (error: any) {
    return jsonOk(
      { error: '重新运行失败', message: error.message },
      { status: 500 }
    );
  }
}
