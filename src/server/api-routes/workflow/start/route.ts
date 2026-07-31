import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { workflowRegistry } from '@/lib/workflow/registry';
import { requireAuth } from '@/lib/auth/middleware';
import { runWorkflowPreflight } from '@/lib/workflow/preflight';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { getRuntimeWorkflowConfigPath } from '@/lib/run/runtime-configs';
import { createRun } from '@/lib/run/store';
import {
  saveRunState,
  type PersistedLightweightRunMetadata,
  type PersistedRunState,
} from '@/lib/run/state-persistence';
import { loadCreationSession, loadLatestCreationSessionByFilename, cloneSpecCodingForRun, updateCreationSession } from '@/lib/spec/coding-store';
import { updateChatSessionCreationBinding } from '@/lib/chat/persistence';
import { countWorkflowSteps } from '@/lib/workflow/step-counter';
import { compileStepTaskBindings } from '@/lib/spec/task-binding';
import { createWorkflowConfigSnapshot } from '@/lib/workflow/subworkflow-config';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import { getEffectiveWorkflowStepSkills, isLightweightWorkflowConfig } from '@/lib/workflow/lightweight';
import {
  LightweightTasklistDirectoryConflictError,
  releaseLightweightTasklistDirectory,
  reserveLightweightTasklistDirectory,
  resolveLightweightTasklistDirectory,
} from '@/lib/workflow/lightweight-runtime';
import { bindWorkflowRunToConversation, ensureWorkflowRuntimeConversation } from '@/lib/workflow/runtime-session';
import {
  appendWorkflowRuntimeTranscript,
  toWorkflowRuntimeTranscriptLiveEvent,
  type WorkflowRuntimeTranscriptInput,
} from '@/lib/workflow/runtime-transcript';
import type { StateMachineWorkflowManager } from '@/lib/state-machine/workflow-manager';
import {
  getWorkflowTaskInputTitle,
  normalizeWorkflowTaskInput,
  type WorkflowTaskInput,
} from '@/lib/workflow/task-input';

export { countWorkflowSteps } from '@/lib/workflow/step-counter';

const globalForWorkflowStart = globalThis as unknown as {
  __workflowStartLocks?: Set<string>;
};
const workflowStartLocks = globalForWorkflowStart.__workflowStartLocks ??= new Set<string>();

async function appendAndFanoutWorkflowRuntimeTranscript(
  input: WorkflowRuntimeTranscriptInput,
  configFile: string,
  manager?: StateMachineWorkflowManager,
): Promise<void> {
  const event = await appendWorkflowRuntimeTranscript(input).catch(() => null);
  if (!event) return;

  const liveEvent = toWorkflowRuntimeTranscriptLiveEvent(event);
  if (manager) {
    try {
      manager.emit('runtime-transcript', liveEvent);
    } catch {
      // Transcript persistence must not turn a successfully-started run into an HTTP failure.
    }
    return;
  }
  if (typeof workflowRegistry.emit === 'function') {
    try {
      workflowRegistry.emit('runtime-transcript', { ...liveEvent, __configFile: configFile });
    } catch {
      // The persisted transcript remains available even when an SSE listener is unstable.
    }
  }
}

function prepareLightweightRunMetadata(
  config: any,
  userPersonalDir?: string,
): PersistedLightweightRunMetadata | undefined {
  if (!isLightweightWorkflowConfig(config)) return undefined;

  const state = config.workflow?.states?.[0];
  const step = state?.steps?.[0];
  const projectRoot = typeof config.context?.projectRoot === 'string'
    ? config.context.projectRoot.trim()
    : '';
  if (!state || !step || !projectRoot) {
    throw new Error('Lightweight workflow cannot resolve its tasklist workspace');
  }

  const resolved = resolveLightweightTasklistDirectory({
    workspaceRoot: resolve(userPersonalDir || getWorkspaceRoot(), projectRoot),
    tasklistDirectory: config.workflow.lightweight?.tasklistDirectory,
  });
  const roleConfig = config.roles?.find((role: any) => role.name === step.agent);
  return {
    profile: 'lightweight',
    ...resolved,
    stateName: state.name,
    stepName: step.name,
    effectiveStepSkills: getEffectiveWorkflowStepSkills({ config, step, roleConfig }),
  };
}

function normalizeInitialContexts(input: any): { globalContext: string; phaseContexts: Record<string, string>; taskInput: WorkflowTaskInput; workingDirectory?: string } {
  const globalContext = typeof input?.globalContext === 'string' ? input.globalContext : '';
  const workingDirectory = typeof input?.workingDirectory === 'string' ? input.workingDirectory.trim() : '';
  const phaseEntries = Object.entries(input?.phaseContexts || {}).filter(
    ([key, value]) => typeof key === 'string' && key.trim().length > 0 && typeof value === 'string' && value.trim().length > 0
  );
  return {
    globalContext,
    phaseContexts: Object.fromEntries(phaseEntries) as Record<string, string>,
    taskInput: normalizeWorkflowTaskInput(input?.taskInput),
    workingDirectory: workingDirectory || undefined,
  };
}

function logWorkflowStartFailure(configFile: string, err: any) {
  const message = err?.message || String(err);
  console.error(`[Workflow] start failed for ${configFile}:`, message);
}

async function startRehearsalRun(input: {
  runId: string;
  configFile: string;
  frontendSessionId?: string;
  creationSessionId?: string;
  userId: string;
  username: string;
  lightweight?: PersistedLightweightRunMetadata;
  preflightChecks: any[];
  initialContexts?: {
    globalContext: string;
    phaseContexts: Record<string, string>;
    taskInput?: WorkflowTaskInput;
    workingDirectory?: string;
  };
}) {
  const configPath = await getRuntimeWorkflowConfigPath(input.configFile);
  const raw = await readFile(configPath, 'utf-8');
  const config = parse(raw) as any;
  if (input.initialContexts?.workingDirectory) {
    config.context = {
      ...(config.context || {}),
      projectRoot: input.initialContexts.workingDirectory,
    };
  }
  const runId = input.runId;
  const now = new Date().toISOString();
  const totalSteps = countWorkflowSteps(config);
  if (input.lightweight) {
    await mkdir(input.lightweight.resolvedTasklistDirectory, { recursive: true });
  }
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
    taskTitle: getWorkflowTaskInputTitle(input.initialContexts?.taskInput) || undefined,
    taskIssueUrl: input.initialContexts?.taskInput?.issueUrl,
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
    mode: 'state-machine',
    lightweight: input.lightweight,
    requirements: config?.context?.requirements || '',
    workingDirectory: input.lightweight?.workspaceRoot || input.initialContexts?.workingDirectory || config?.context?.projectRoot || undefined,
    supervisorAgent: config?.workflow?.supervisor?.agent || 'default-supervisor',
    supervisorSessionId: null,
    attachedAgentSessions: {},
    workflowFrontendSessionId: input.frontendSessionId || null,
    globalContext: input.initialContexts?.globalContext || '',
    phaseContexts: input.initialContexts?.phaseContexts || {},
    taskInput: input.initialContexts?.taskInput,
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

  await bindWorkflowRunToConversation({
    sessionId: input.frontendSessionId,
    runId,
    configFile: input.configFile,
    status: 'completed',
    supervisorAgent: state.supervisorAgent,
    supervisorSessionId: null,
    attachedAgentSessions: {},
    lightweight: input.lightweight,
    requireLightweightMetadata: Boolean(input.lightweight),
  }).catch(() => {});
  await appendAndFanoutWorkflowRuntimeTranscript({
    runId,
    type: 'run-created',
    title: '工作流运行已创建',
    speakerName: state.supervisorAgent || 'default-supervisor',
    dedupeKey: `workflow-rehearsal-created-${runId}`,
    createdAt: now,
  }, input.configFile);
  await appendAndFanoutWorkflowRuntimeTranscript({
    runId,
    type: 'run-starting',
    title: '演练开始',
    body: [
      `配置文件：${input.configFile}`,
      `协调嘉宾：${state.supervisorAgent || 'default-supervisor'}`,
      getWorkflowTaskInputTitle(input.initialContexts?.taskInput)
        ? `本次任务：${getWorkflowTaskInputTitle(input.initialContexts?.taskInput)}`
        : '',
    ].filter(Boolean).join('\n'),
    speakerName: state.supervisorAgent || 'default-supervisor',
    dedupeKey: `workflow-rehearsal-starting-${runId}`,
    createdAt: now,
  }, input.configFile);
  await appendAndFanoutWorkflowRuntimeTranscript({
    runId,
    type: 'state-review',
    title: '演练总结',
    body: [
      summary,
      recommendedNextSteps.length ? `建议：${recommendedNextSteps.join('；')}` : '',
    ].filter(Boolean).join('\n'),
    speakerName: state.supervisorAgent || 'default-supervisor',
    dedupeKey: `workflow-rehearsal-completed-${runId}`,
    createdAt: (Date.parse(now) || Date.now()) + 1,
  }, input.configFile);

  if (input.frontendSessionId) {
    await updateChatSessionCreationBinding(input.frontendSessionId, {
      filename: input.configFile,
      status: 'run-bound',
    }).catch(() => {});
  }

  return { runId, summary, recommendedNextSteps };
}

export async function POST(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const body = await readJsonBody<any>(request, {});
    const { configFile, frontendSessionId, creationSessionId, skipPreflight, rehearsal, preflightChecks: inputPreflightChecks } = body;
    const initialContexts = normalizeInitialContexts(body?.initialContexts);

    if (!configFile) {
      return jsonOk(
        { error: '缺少配置文件参数' },
        { status: 400 }
      );
    }

    let preflightChecks = Array.isArray(inputPreflightChecks) ? inputPreflightChecks : undefined;
    if (!skipPreflight) {
      const preflight = await runWorkflowPreflight(configFile, user.personalDir || '', initialContexts.workingDirectory);
      if (!preflight.ok) {
        return jsonOk(
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
        return jsonOk(
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

    if (config?.workflow?.mode !== 'state-machine') {
      return jsonOk(
        { error: '仅支持状态机工作流配置' },
        { status: 400 },
      );
    }

    const executionConfig = initialContexts.workingDirectory
      ? {
          ...config,
          context: {
            ...(config.context || {}),
            projectRoot: initialContexts.workingDirectory,
          },
        }
      : config;
    const supervisorAgent = executionConfig?.workflow?.supervisor?.agent || 'default-supervisor';
    const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const lightweight = prepareLightweightRunMetadata(executionConfig, user.personalDir);

    if (rehearsal) {
      let lightweightDirectoryReserved = false;
      try {
        if (lightweight) {
          await reserveLightweightTasklistDirectory({
            runId,
            resolvedTasklistDirectory: lightweight.resolvedTasklistDirectory,
          });
          lightweightDirectoryReserved = true;
        }

        const workflowConversation = await ensureWorkflowRuntimeConversation({
          frontendSessionId: typeof frontendSessionId === 'string' ? frontendSessionId : undefined,
          configFile,
          runId,
          workflowName: executionConfig?.workflow?.name,
          userId: user.id,
        });
        const result = await startRehearsalRun({
          runId,
          configFile,
          frontendSessionId: workflowConversation.sessionId,
          creationSessionId: typeof creationSessionId === 'string' ? creationSessionId : undefined,
          userId: user.id,
          username: user.username,
          lightweight,
          preflightChecks: preflightChecks || [],
          initialContexts,
        });
        return jsonOk({
          success: true,
          message: '演练模式已完成',
          frontendSessionId: workflowConversation.sessionId,
          sessionWorkbenchState: workflowConversation.sessionWorkbenchState,
          rehearsal: {
            enabled: true,
            runId: result.runId,
            summary: result.summary,
            recommendedNextSteps: result.recommendedNextSteps,
          },
        });
      } catch (error) {
        if (error instanceof LightweightTasklistDirectoryConflictError) {
          return jsonOk(
            {
              error: '轻量工作流任务文档目录已被活动运行占用',
              runId: error.conflictingRunId,
            },
            { status: 409 },
          );
        }
        throw error;
      } finally {
        if (lightweightDirectoryReserved && lightweight) {
          releaseLightweightTasklistDirectory({
            runId,
            resolvedTasklistDirectory: lightweight.resolvedTasklistDirectory,
          });
        }
      }
    }

    try {
      await createWorkflowConfigSnapshot({
        rootConfigFile: configFile,
        runId,
      });
    } catch (error: any) {
      return jsonOk(
        {
          error: '子工作流依赖校验失败',
          message: error?.message || '无法创建工作流配置快照',
        },
        { status: 400 }
      );
    }

    const manager: StateMachineWorkflowManager = await workflowRegistry.getManager(configFile);

    // Check if this specific config is already running
    const currentStatus = manager.getStatus();
    if (currentStatus.status === 'running' || currentStatus.status === 'preparing') {
      return jsonOk(
        { error: '该配置的工作流已在运行中' },
        { status: 409 }
      );
    }
    if (workflowStartLocks.has(configFile)) {
      return jsonOk(
        { error: '该配置的工作流正在启动中' },
        { status: 409 }
      );
    }
    workflowStartLocks.add(configFile);
    let lightweightDirectoryReserved = false;
    let managerStartHandedOff = false;

    try {
      if (lightweight) {
        await reserveLightweightTasklistDirectory({
          runId,
          resolvedTasklistDirectory: lightweight.resolvedTasklistDirectory,
        });
        lightweightDirectoryReserved = true;
      }

      const workflowConversation = await ensureWorkflowRuntimeConversation({
        frontendSessionId: typeof frontendSessionId === 'string' ? frontendSessionId : undefined,
        configFile,
        runId,
        workflowName: executionConfig?.workflow?.name,
        userId: user.id,
      });

      // Pass user-owned run context into the state-machine manager.
      manager._createdBy = user.id;
      manager._createdByName = user.username;
      manager._userPersonalDir = user.personalDir;
      manager._frontendSessionId = workflowConversation.sessionId;
      manager._creationSessionId = boundCreationSession?.id || (typeof creationSessionId === 'string' ? creationSessionId : undefined);
      const startPromise = manager.start(configFile, undefined, preflightChecks, initialContexts, runId);
      managerStartHandedOff = true;
      void Promise.resolve(startPromise)
        .catch((err: any) => {
          if (lightweight) {
            releaseLightweightTasklistDirectory({
              runId,
              resolvedTasklistDirectory: lightweight.resolvedTasklistDirectory,
            });
          }
          logWorkflowStartFailure(configFile, err);
          // The manager owns its own status transitions. Mutating it here can
          // corrupt an already-running workflow when a duplicate start is rejected.
        });
      await appendAndFanoutWorkflowRuntimeTranscript({
        runId,
        type: 'run-created',
        title: '工作流运行已创建',
        speakerName: supervisorAgent,
        dedupeKey: `workflow-run-created-${runId}`,
      }, configFile, manager);
      await appendAndFanoutWorkflowRuntimeTranscript({
        runId,
        type: 'run-starting',
        title: '工作流开始启动',
        body: [
          `配置文件：${configFile}`,
          `协调嘉宾：${supervisorAgent}`,
          getWorkflowTaskInputTitle(initialContexts.taskInput)
            ? `本次任务：${getWorkflowTaskInputTitle(initialContexts.taskInput)}`
            : '',
        ].filter(Boolean).join('\n'),
        speakerName: supervisorAgent,
        dedupeKey: `workflow-run-starting-${runId}`,
      }, configFile, manager);

      return jsonOk({
        success: true,
        message: '工作流已启动',
        runId,
        frontendSessionId: workflowConversation.sessionId,
        sessionWorkbenchState: workflowConversation.sessionWorkbenchState,
      });
    } catch (error) {
      if (error instanceof LightweightTasklistDirectoryConflictError) {
        return jsonOk(
          {
            error: '轻量工作流任务文档目录已被活动运行占用',
            runId: error.conflictingRunId,
          },
          { status: 409 },
        );
      }
      throw error;
    } finally {
      if (lightweightDirectoryReserved && !managerStartHandedOff && lightweight) {
        releaseLightweightTasklistDirectory({
          runId,
          resolvedTasklistDirectory: lightweight.resolvedTasklistDirectory,
        });
      }
      workflowStartLocks.delete(configFile);
    }
  } catch (error: any) {
    return jsonOk(
      { error: '启动工作流失败', message: error.message },
      { status: 500 }
    );
  }
}
