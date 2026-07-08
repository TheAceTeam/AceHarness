import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { isStateMachineManagerLike, workflowRegistry } from '@/lib/workflow/registry';
import { loadRunState, type PersistedRunState } from '@/lib/run/state-persistence';
import { getRuntimeWorkflowConfigPath } from '@/lib/run/runtime-configs';
import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { requireAuth } from '@/lib/auth/middleware';
import { canAccessRunState } from '@/lib/workflow/run-access';
import { appendWorkflowAuditEvent, getWorkflowAuditRequestMeta } from '@/lib/workflow/audit-log';

async function validateStateMachineTarget(runState: PersistedRunState, targetState: string): Promise<Response | null> {
  const configPath = await getRuntimeWorkflowConfigPath(runState.configFile);
  const configContent = await readFile(configPath, 'utf-8');
  const workflowConfig = parse(configContent);
  if (workflowConfig?.workflow?.mode !== 'state-machine') {
    return jsonOk({ error: '目标运行不是状态机工作流' }, { status: 400 });
  }
  const states = Array.isArray(workflowConfig.workflow.states) ? workflowConfig.workflow.states : [];
  if (!states.some((state: any) => state?.name === targetState)) {
    return jsonOk({ error: `找不到目标状态: ${targetState}` }, { status: 400 });
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const { targetState, instruction, configFile, runId } = await readJsonBody<any>(request, {});
    if (!targetState) {
      return jsonOk({ error: '缺少目标状态参数' }, { status: 400 });
    }

    if (runId) {
      const runState = await loadRunState(runId);
      if (!runState) {
        return jsonOk({ error: `找不到运行记录: ${runId}` }, { status: 404 });
      }
      if (!canAccessRunState(auth, runState, 'operate')) {
        return jsonOk({ error: '无权操作该工作流运行' }, { status: 403 });
      }
      const targetValidationError = await validateStateMachineTarget(runState, targetState);
      if (targetValidationError) return targetValidationError;

      const manager = await workflowRegistry.getManagerByRunId(runId) || await workflowRegistry.getManager(runState.configFile);
      if (!isStateMachineManagerLike(manager)) {
        return jsonOk({ error: '目标运行不是状态机工作流' }, { status: 400 });
      }

      const currentStatus = manager.getStatus();
      const canDirectTransition =
        currentStatus.status === 'running'
        && currentStatus.runId === runId
        && currentStatus.currentState === '__human_approval__';

      if (canDirectTransition) {
        const pendingQuestion = currentStatus.pendingHumanQuestion;
        if (pendingQuestion?.answerSchema?.type === 'approval-transition') {
          await manager.answerHumanQuestion(pendingQuestion.id, { selectedState: targetState, instruction }, { id: auth.id, name: auth.username });
          await appendWorkflowAuditEvent({
            action: 'force-transition',
            runId,
            rootRunId: runState.rootRunId || runId,
            configFile: runState.configFile,
            actorId: auth.id,
            actorName: auth.username,
            ...getWorkflowAuditRequestMeta(request),
            before: { status: currentStatus.status, currentState: currentStatus.currentState },
            after: { targetState, via: 'approval-transition-answer' },
            details: { instruction },
          });
          return jsonOk({ success: true, message: `已回答人工审查并请求跳转到: ${targetState}` });
        }
        manager.setQueuedApprovalAction('approve');
        manager.forceTransition(targetState, instruction, { id: auth.id, name: auth.username });
        await appendWorkflowAuditEvent({
          action: 'force-transition',
          runId,
          rootRunId: runState.rootRunId || runId,
          configFile: runState.configFile,
          actorId: auth.id,
          actorName: auth.username,
          ...getWorkflowAuditRequestMeta(request),
          before: { status: currentStatus.status, currentState: currentStatus.currentState },
          after: { targetState },
          details: { instruction },
        });
        return jsonOk({ success: true, message: `已请求强制跳转到: ${targetState}` });
      }

      if (currentStatus.status === 'running' && currentStatus.runId === runId) {
        manager.forceTransition(targetState, instruction, { id: auth.id, name: auth.username });
        await appendWorkflowAuditEvent({
          action: 'force-transition',
          runId,
          rootRunId: runState.rootRunId || runId,
          configFile: runState.configFile,
          actorId: auth.id,
          actorName: auth.username,
          ...getWorkflowAuditRequestMeta(request),
          before: { status: currentStatus.status, currentState: currentStatus.currentState },
          after: { targetState },
          details: { instruction },
        });
        return jsonOk({ success: true, message: `已请求强制跳转到: ${targetState}` });
      }
      if (currentStatus.status === 'running' && currentStatus.runId !== runId) {
        return jsonOk({ error: '该配置已有其他运行正在执行，无法强制恢复目标运行' }, { status: 409 });
      }

      manager.forceJumpToState(runId, targetState, instruction, { id: auth.id, name: auth.username }).catch((error) => {
        console.error('[workflow/force-transition] force jump failed:', error);
      });
      await appendWorkflowAuditEvent({
        action: 'force-transition',
        runId,
        rootRunId: runState.rootRunId || runId,
        configFile: runState.configFile,
        actorId: auth.id,
        actorName: auth.username,
        ...getWorkflowAuditRequestMeta(request),
        before: { status: runState.status, currentState: runState.currentState },
        after: { targetState, forceJump: true },
        details: { instruction },
      });
      return jsonOk({ success: true, message: `正在强制恢复并跳转到: ${targetState}` });
    }

    const manager = workflowRegistry.getRunningManager(configFile);
    if (!isStateMachineManagerLike(manager)) {
      return jsonOk({ error: '没有运行中的状态机工作流' }, { status: 400 });
    }
    const status: any = manager.getStatus();
    if (!canAccessRunState(auth, status, 'operate')) {
      return jsonOk({ error: '无权操作该工作流运行' }, { status: 403 });
    }
    const pendingQuestion = manager.getPendingHumanQuestion();
    if (pendingQuestion?.answerSchema?.type === 'approval-transition') {
      await manager.answerHumanQuestion(pendingQuestion.id, { selectedState: targetState, instruction }, { id: auth.id, name: auth.username });
      await appendWorkflowAuditEvent({
        action: 'force-transition',
        runId: status.runId || undefined,
        rootRunId: status.rootRunId || status.runId || undefined,
        configFile: status.currentConfigFile || configFile || undefined,
        actorId: auth.id,
        actorName: auth.username,
        ...getWorkflowAuditRequestMeta(request),
        before: { status: status.status, currentState: status.currentState },
        after: { targetState, via: 'approval-transition-answer' },
        details: { instruction },
      });
      return jsonOk({ success: true, message: `已回答人工审查并请求跳转到: ${targetState}` });
    }
    manager.forceTransition(targetState, instruction, { id: auth.id, name: auth.username });
    await appendWorkflowAuditEvent({
      action: 'force-transition',
      runId: status.runId || undefined,
      rootRunId: status.rootRunId || status.runId || undefined,
      configFile: status.currentConfigFile || configFile || undefined,
      actorId: auth.id,
      actorName: auth.username,
      ...getWorkflowAuditRequestMeta(request),
      before: { status: status.status, currentState: status.currentState },
      after: { targetState },
      details: { instruction },
    });
    return jsonOk({ success: true, message: `已请求强制跳转到: ${targetState}` });
  } catch (error: any) {
    return jsonOk({ error: error.message }, { status: 400 });
  }
}
