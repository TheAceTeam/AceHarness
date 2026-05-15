import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow/registry';
import { requireAuth } from '@/lib/auth/middleware';
import { runWorkflowPreflight } from '@/lib/workflow/preflight';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { parse, stringify } from 'yaml';
import { getRuntimeWorkflowConfigPath } from '@/lib/run/runtime-configs';
import { createRun } from '@/lib/run/store';
import { saveRunState, type PersistedRunState } from '@/lib/run/state-persistence';
import { loadCreationSession, loadLatestCreationSessionByFilename, cloneSpecCodingForRun, updateCreationSession } from '@/lib/spec/coding-store';
import { appendChatSessionMessage, loadChatSession, saveChatSession, updateChatSessionCreationBinding, updateChatSessionWorkflowBinding } from '@/lib/chat/persistence';
import { countWorkflowSteps } from '@/lib/workflow/step-counter';
import { compileStepTaskBindings } from '@/lib/spec/task-binding';
import { writeFile } from 'fs/promises';

export { countWorkflowSteps } from '@/lib/workflow/step-counter';

async function ensureWorkflowChatSession(input: {
  frontendSessionId?: string;
  configFile: string;
  workflowName?: string;
  supervisorAgent?: string;
  userId: string;
}): Promise<string> {
  if (input.frontendSessionId) {
    const existing = await loadChatSession(input.frontendSessionId).catch(() => null);
    if (existing) return input.frontendSessionId;
  }

  const now = Date.now();
  const id = `workflow-${now}-${randomUUID().slice(0, 8)}`;
  const title = `${input.workflowName || input.configFile} · Supervisor`;
  await saveChatSession({
    id,
    title,
    model: 'claude-sonnet-4-6',
    messages: [{
      id: `${now}-workflow-run-created`,
      role: 'assistant',
      content: [
        '<workflow-event type="run-created" tags="workflow,supervisor">',
        `工作流运行会话已创建。`,
        `- 配置文件: ${input.configFile}`,
        `- Supervisor: ${input.supervisorAgent || 'default-supervisor'}`,
        '</workflow-event>',
      ].join('\n'),
      timestamp: now,
    }],
    createdAt: now,
    updatedAt: now,
    createdBy: input.userId,
    visibility: 'public',
  });
  return id;
}

function normalizeInitialContexts(input: any): { globalContext: string; phaseContexts: Record<string, string> } {
  const globalContext = typeof input?.globalContext === 'string' ? input.globalContext : '';
  const phaseEntries = Object.entries(input?.phaseContexts || {}).filter(
    ([key, value]) => typeof key === 'string' && key.trim().length > 0 && typeof value === 'string' && value.trim().length > 0
  );
  return {
    globalContext,
    phaseContexts: Object.fromEntries(phaseEntries) as Record<string, string>,
  };
}

async function startRehearsalRun(input: {
  configFile: string;
  frontendSessionId?: string;
  creationSessionId?: string;
  userId: string;
  username: string;
  preflightChecks: any[];
  initialContexts?: {
    globalContext: string;
    phaseContexts: Record<string, string>;
  };
}) {
  const configPath = await getRuntimeWorkflowConfigPath(input.configFile);
  const raw = await readFile(configPath, 'utf-8');
  const config = parse(raw) as any;
  const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const totalSteps = countWorkflowSteps(config);
  const creationSession = input.creationSessionId
    ? await loadCreationSession(input.creationSessionId).catch(() => null)
    : null;
  const runSpecCoding = creationSession?.specCoding
    ? cloneSpecCodingForRun(creationSession.specCoding, { runId, filename: input.configFile })
    : null;
  const bindingValidation = runSpecCoding
    ? compileStepTaskBindings(config, runSpecCoding).validation
    : undefined;
  const summary = '演练模式未执行真实项目改动，仅生成 SpecCoding / workflow 编排推演与风险提示。';
  const recommendedNextSteps = [
    '检查 SpecCoding 阶段拆分与 Agent 编队是否合理',
    '确认 preflight 检查、风险点和人工检查点是否齐全',
    '如方案可行，关闭演练模式后再正式启动工作流',
  ];

  await createRun({
    id: runId,
    configFile: input.configFile,
    configName: config?.workflow?.name || input.configFile,
    startTime: now,
    endTime: now,
    status: 'completed',
    currentPhase: '演练模式',
    totalSteps,
    completedSteps: 0,
  });

  const state: PersistedRunState = {
    runId,
    configFile: input.configFile,
    runOwnerId: input.userId,
    runOwnerName: input.username,
    createdBy: input.userId,
    createdByName: input.username,
    status: 'completed',
    startTime: now,
    endTime: now,
    currentPhase: '演练模式',
    currentStep: '输出推演总结',
    completedSteps: [],
    failedSteps: [],
    stepLogs: [],
    agents: [],
    iterationStates: {},
    processes: [],
    mode: config?.workflow?.mode === 'state-machine' ? 'state-machine' : 'phase-based',
    requirements: config?.context?.requirements || '',
    workingDirectory: config?.context?.projectRoot || undefined,
    supervisorAgent: config?.workflow?.supervisor?.agent || 'default-supervisor',
    supervisorSessionId: null,
    attachedAgentSessions: {},
    workflowFrontendSessionId: input.frontendSessionId || null,
    globalContext: input.initialContexts?.globalContext || '',
    phaseContexts: input.initialContexts?.phaseContexts || {},
    qualityChecks: input.preflightChecks,
    stepTaskBindingsSnapshot: bindingValidation?.bindings,
    bindingValidation: bindingValidation as any,
    latestSupervisorReview: {
      type: 'state-review',
      stateName: '演练模式',
      content: summary,
      timestamp: now,
    },
    runSpecCoding: runSpecCoding ? {
      ...runSpecCoding,
      status: 'completed',
      summary,
      updatedAt: now,
      progress: {
        ...runSpecCoding.progress,
        overallStatus: 'completed',
        summary,
      },
    } : null,
    creationSessionId: creationSession?.id,
    rehearsal: {
      enabled: true,
      summary,
      recommendedNextSteps,
    },
  };
  await saveRunState(state);

  if (input.frontendSessionId) {
    await updateChatSessionWorkflowBinding(input.frontendSessionId, {
      configFile: input.configFile,
      runId,
      supervisorAgent: state.supervisorAgent || 'default-supervisor',
      supervisorSessionId: null,
      attachedAgentSessions: {},
    }).catch(() => {});
    await updateChatSessionCreationBinding(input.frontendSessionId, {
      filename: input.configFile,
      status: 'run-bound',
    }).catch(() => {});
  }

  return { runId, summary, recommendedNextSteps };
}

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const body = await request.json();
    const { configFile, frontendSessionId, creationSessionId, skipPreflight, rehearsal, preflightChecks: inputPreflightChecks } = body;
    const initialContexts = normalizeInitialContexts(body?.initialContexts);

    if (!configFile) {
      return NextResponse.json(
        { error: '缺少配置文件参数' },
        { status: 400 }
      );
    }

    let preflightChecks = Array.isArray(inputPreflightChecks) ? inputPreflightChecks : undefined;
    if (!skipPreflight) {
      const preflight = await runWorkflowPreflight(configFile, user.personalDir || '');
      if (!preflight.ok) {
        return NextResponse.json(
          {
            error: `启动前检查未通过：${preflight.failedCount} 项失败`,
            checks: preflight.checks,
            cwd: preflight.cwd,
          },
          { status: 412 }
        );
      }
      preflightChecks = preflight.checks;
    }

    const configPath = await getRuntimeWorkflowConfigPath(configFile);
    let config = parse(await readFile(configPath, 'utf-8')) as any;
    const boundCreationSession = typeof creationSessionId === 'string'
      ? await loadCreationSession(creationSessionId).catch(() => null)
      : await loadLatestCreationSessionByFilename(configFile).catch(() => null);
    let bindingValidation: any = undefined;
    if (boundCreationSession?.specCoding) {
      const bindingCompilation = compileStepTaskBindings(config, boundCreationSession.specCoding);
      config = bindingCompilation.config;
      bindingValidation = bindingCompilation.validation;
      if (!bindingValidation.ok) {
        return NextResponse.json(
          {
            error: 'Spec task 绑定校验失败',
            bindingValidation,
          },
          { status: 400 }
        );
      }
      await writeFile(configPath, stringify(config), 'utf-8');
      await updateCreationSession(boundCreationSession.id, { bindingValidation });
    }
    const supervisorAgent = config?.workflow?.supervisor?.agent || 'default-supervisor';
    const workflowChatSessionId = await ensureWorkflowChatSession({
      frontendSessionId: typeof frontendSessionId === 'string' ? frontendSessionId : undefined,
      configFile,
      workflowName: config?.workflow?.name,
      supervisorAgent,
      userId: user.id,
    });

    if (rehearsal) {
      const result = await startRehearsalRun({
        configFile,
        frontendSessionId: workflowChatSessionId,
        creationSessionId: typeof creationSessionId === 'string' ? creationSessionId : undefined,
        userId: user.id,
        username: user.username,
        preflightChecks: preflightChecks || [],
        initialContexts,
      });
      return NextResponse.json({
        success: true,
        message: '演练模式已完成',
        frontendSessionId: workflowChatSessionId,
        rehearsal: {
          enabled: true,
          runId: result.runId,
          summary: result.summary,
          recommendedNextSteps: result.recommendedNextSteps,
        },
      });
    }

    const manager = await workflowRegistry.getManager(configFile);

    // Check if this specific config is already running
    const currentStatus = manager.getStatus();
    if (currentStatus.status === 'running' || currentStatus.status === 'preparing') {
      return NextResponse.json(
        { error: '该配置的工作流已在运行中' },
        { status: 409 }
      );
    }

    // Pass userId for createdBy tracking
    (manager as any)._createdBy = user.id;
    (manager as any)._createdByName = user.username;
    (manager as any)._userPersonalDir = user.personalDir;
    (manager as any)._frontendSessionId = workflowChatSessionId;
    (manager as any)._creationSessionId = boundCreationSession?.id || (typeof creationSessionId === 'string' ? creationSessionId : undefined);
    (manager as any)._initialContexts = initialContexts;
    const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await appendChatSessionMessage(workflowChatSessionId, {
      role: 'assistant',
      content: [
        '<workflow-event type="run-starting" tags="workflow,run,supervisor">',
        `工作流开始启动。`,
        `- 配置文件: ${configFile}`,
        `- Supervisor: ${supervisorAgent}`,
        '</workflow-event>',
      ].join('\n'),
    }, { dedupeKey: `${Date.now()}-workflow-run-starting` }).catch(() => {});
    (manager as any).start(configFile, undefined, preflightChecks, initialContexts, runId).catch((err: any) => {
      console.error(`[Workflow] start failed for ${configFile}:`, err?.message || err);
      // Ensure status reflects the failure so frontend can detect it
      try {
        (manager as any).status = 'failed';
        (manager as any).statusReason = err?.message || '启动失败';
        manager.emit('status', { status: 'failed', message: err?.message || '启动失败' });
      } catch { /* best effort */ }
    });

    return NextResponse.json({
      success: true,
      message: '工作流已启动',
      runId,
      frontendSessionId: workflowChatSessionId,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '启动工作流失败', message: error.message },
      { status: 500 }
    );
  }
}
