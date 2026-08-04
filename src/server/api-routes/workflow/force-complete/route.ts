import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { workflowRegistry } from '@/lib/workflow/registry';
import { requireAuth } from '@/lib/auth/middleware';
import { canAccessRunState } from '@/lib/workflow/run-access';
import { appendWorkflowAuditEvent, getWorkflowAuditRequestMeta } from '@/lib/workflow/audit-log';

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const body = await readJsonBody<any>(request, {});
    const { configFile, target } = body;

    const manager = workflowRegistry.getRunningManager(configFile);
    if (!manager) {
      return jsonOk(
        { error: '当前没有运行中的工作流' },
        { status: 400 }
      );
    }
    const status = manager.getStatus?.() || {};
    if (!canAccessRunState(auth, status, 'operate')) {
      return jsonOk({ error: '无权操作该工作流运行' }, { status: 403 });
    }

    const result = await (manager as any).forceCompleteStep({
      target: target === 'child-current-step' ? 'child-current-step' : 'parent-step',
      actor: { id: auth.id, name: auth.username },
    });
    if (!result) {
      return jsonOk(
        {
          error: target === 'child-current-step'
            ? '当前没有可强制完成的子工作流步骤'
            : '当前没有正在运行的父流程步骤；如果父流程正在等待子工作流，可使用 target=child-current-step',
        },
        { status: 400 }
      );
    }
    await appendWorkflowAuditEvent({
      action: 'force-complete',
      runId: status.runId || undefined,
      rootRunId: (status as any).rootRunId || status.runId || undefined,
      childRunId: target === 'child-current-step' ? status.activeSubworkflowRunId || undefined : undefined,
      configFile: status.currentConfigFile || configFile,
      actorId: auth.id,
      actorName: auth.username,
      ...getWorkflowAuditRequestMeta(request),
      before: {
        status: status.status,
        currentState: status.currentState,
        currentStep: status.currentStep,
        activeSubworkflowRunId: status.activeSubworkflowRunId,
      },
      after: {
        target: result.target || target || 'parent-step',
        step: result.step,
      },
    });
    return jsonOk({
      success: true,
      step: result.step,
      target: result.target || target || 'parent-step',
      outputLength: result.output.length,
      message: `步骤 "${result.step}" 已强制完成`,
    });
  } catch (error: any) {
    console.error('[force-complete] error:', error);
    return jsonOk(
      { error: '强制完成失败', message: error.message },
      { status: 500 }
    );
  }
}
