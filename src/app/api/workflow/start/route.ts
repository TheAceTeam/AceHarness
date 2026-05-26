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
import { loadChatSession, saveChatSession, updateChatSessionCreationBinding, updateChatSessionWorkflowBinding } from '@/lib/chat/persistence';
import {
  appendWorkflowAgoraMessage,
  appendWorkflowAgoraOpeningMessages,
  createWorkflowAgoraWorkbenchState,
  createWorkflowParticipants,
  ensureWorkflowAgoraSession,
  extractWorkflowParticipantNames,
} from '@/lib/agora/workflow-topic';
import { countWorkflowSteps } from '@/lib/workflow/step-counter';
import { compileStepTaskBindings } from '@/lib/spec/task-binding';
import { writeFile } from 'fs/promises';

export { countWorkflowSteps } from '@/lib/workflow/step-counter';

async function ensureWorkflowChatSession(input: {
  frontendSessionId?: string;
  configFile: string;
  workflowName?: string;
  supervisorAgent?: string;
  participantNames?: string[];
  participants?: ReturnType<typeof createWorkflowParticipants>;
  agentSessions?: Record<string, string>;
  workspacePath?: string;
  userId: string;
}): Promise<{ sessionId: string; sessionWorkbenchState: any }> {
  const title = `${input.workflowName || input.configFile} · 工作流协作`;
  const participants = input.participants?.length ? input.participants : createWorkflowParticipants(input.participantNames?.length
    ? input.participantNames
    : [input.supervisorAgent || 'default-supervisor'], { coordinatorAgent: input.supervisorAgent });
  if (input.frontendSessionId) {
    const existing = await loadChatSession(input.frontendSessionId).catch(() => null);
    if (existing) {
      const sessionWorkbenchState = await ensureWorkflowAgoraSession({
        sessionId: input.frontendSessionId,
        title,
        participants,
        workspacePath: input.workspacePath,
        agentSessions: input.agentSessions,
      });
      await appendWorkflowAgoraOpeningMessages({
        sessionId: input.frontendSessionId,
        participants,
        workspacePath: input.workspacePath,
        agentSessions: input.agentSessions,
      });
      return { sessionId: input.frontendSessionId, sessionWorkbenchState };
    }
  }

  const now = Date.now();
  const id = `workflow-${now}-${randomUUID().slice(0, 8)}`;
  const sessionWorkbenchState = createWorkflowAgoraWorkbenchState({
    title,
    participants,
    workspacePath: input.workspacePath,
    agentSessions: input.agentSessions,
  });
  await saveChatSession({
    id,
    title,
    model: 'claude-sonnet-4-6',
    sessionWorkbenchState,
    messages: [],
    createdAt: now,
    updatedAt: now,
    createdBy: input.userId,
    visibility: 'public',
  });
  await appendWorkflowAgoraOpeningMessages({
    sessionId: id,
    participants,
    workspacePath: input.workspacePath,
    agentSessions: input.agentSessions,
    createdAt: now,
  });
  await appendWorkflowAgoraMessage({
    sessionId: id,
    type: 'run-created',
    title: '工作流协作议题已创建',
    speakerName: input.supervisorAgent || '工作流协作',
    dedupeKey: `${now}-workflow-run-created`,
    participants,
    workspacePath: input.workspacePath,
    agentSessions: input.agentSessions,
  });
  return { sessionId: id, sessionWorkbenchState };
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

function logWorkflowStartFailure(configFile: string, err: any) {
  const message = err?.message || String(err);
  console.error(`[Workflow] start failed for ${configFile}:`, message);
}

async function startRehearsalRun(input: {
  configFile: string;
  workflowSessionId?: string;
  participants?: ReturnType<typeof createWorkflowParticipants>;
  agentSessions?: Record<string, string>;
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

  const workflowSessionId = input.workflowSessionId || input.frontendSessionId;
  if (workflowSessionId) {
    const workspacePath = config?.context?.projectRoot || config?.context?.workingDirectory;
    await appendWorkflowAgoraMessage({
      sessionId: workflowSessionId,
      type: 'run-starting',
      title: '演练开始',
      body: [`配置文件：${input.configFile}`, `协调嘉宾：${state.supervisorAgent || 'default-supervisor'}`].join('\n'),
      speakerName: state.supervisorAgent || 'default-supervisor',
      dedupeKey: `workflow-rehearsal-starting-${runId}`,
      participants: input.participants,
      agentSessions: input.agentSessions,
      workspacePath,
      createdAt: Date.parse(now) || Date.now(),
    }).catch(() => {});
    await appendWorkflowAgoraMessage({
      sessionId: workflowSessionId,
      type: 'state-review',
      title: '演练总结',
      body: [
        summary,
        recommendedNextSteps.length ? `建议：${recommendedNextSteps.join('；')}` : '',
      ].filter(Boolean).join('\n'),
      speakerName: state.supervisorAgent || 'default-supervisor',
      dedupeKey: `workflow-rehearsal-completed-${runId}`,
      participants: input.participants,
      agentSessions: input.agentSessions,
      workspacePath,
      createdAt: (Date.parse(now) || Date.now()) + 1,
    }).catch(() => {});
  }

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
    const participantNames = extractWorkflowParticipantNames(config, supervisorAgent);
    const workflowParticipants = createWorkflowParticipants(participantNames, { coordinatorAgent: supervisorAgent });
    const workflowChatSession = await ensureWorkflowChatSession({
      frontendSessionId: typeof frontendSessionId === 'string' ? frontendSessionId : undefined,
      configFile,
      workflowName: config?.workflow?.name,
      supervisorAgent,
      participantNames,
      participants: workflowParticipants,
      workspacePath: config?.context?.projectRoot || config?.context?.workingDirectory,
      userId: user.id,
    });
    const workflowChatSessionId = workflowChatSession.sessionId;

    if (rehearsal) {
      const result = await startRehearsalRun({
        configFile,
        workflowSessionId: workflowChatSessionId,
        participants: workflowParticipants,
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
        sessionWorkbenchState: workflowChatSession.sessionWorkbenchState,
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
    Promise.resolve((manager as any).start(configFile, undefined, preflightChecks, initialContexts, runId))
      .catch((err: any) => {
        logWorkflowStartFailure(configFile, err);
        // The manager owns its own status transitions. Mutating it here can
        // corrupt an already-running workflow when a duplicate start is rejected.
      });
    await appendWorkflowAgoraMessage({
      sessionId: workflowChatSessionId,
      type: 'run-starting',
      title: '工作流开始启动',
      body: [`配置文件：${configFile}`, `协调嘉宾：${supervisorAgent}`].join('\n'),
      speakerName: supervisorAgent,
      dedupeKey: `workflow-run-starting-${runId}`,
      participants: workflowParticipants,
      workspacePath: config?.context?.projectRoot || config?.context?.workingDirectory,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: '工作流已启动',
      runId,
      frontendSessionId: workflowChatSessionId,
      sessionWorkbenchState: workflowChatSession.sessionWorkbenchState,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '启动工作流失败', message: error.message },
      { status: 500 }
    );
  }
}
