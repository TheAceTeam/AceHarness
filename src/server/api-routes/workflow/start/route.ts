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
import {
  applyRunReviewPlanOverrides,
  validateRunReviewPlanArtifact,
  type RunReviewPlanArtifact,
} from '@/lib/workflow/run-review-plan';
import {
  consumeRunReviewPlanArtifact,
  loadRunReviewPlanArtifact,
} from '@/lib/workflow/run-review-plan-store';
import type { RunReviewOverride } from '@/lib/workflow/run-review-types';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import { getEffectiveWorkflowStepSkills, isLightweightWorkflowConfig } from '@/lib/workflow/lightweight';
import { resolveLightweightTasklistDirectory } from '@/lib/workflow/lightweight-runtime';
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
  runId?: string,
): PersistedLightweightRunMetadata | undefined {
  if (!isLightweightWorkflowConfig(config)) return undefined;

  const state = config.workflow?.states?.[0];
  const step = state?.steps?.[0];
  const projectRoot = typeof config.context?.projectRoot === 'string'
    ? config.context.projectRoot.trim()
    : '';
  if (!state || !step || !projectRoot || !runId) {
    throw new Error('Lightweight workflow cannot resolve its tasklist workspace');
  }

  const resolved = resolveLightweightTasklistDirectory({
    runId,
    workspaceRoot: resolve(userPersonalDir || getWorkspaceRoot(), projectRoot),
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

function normalizeRunReviewOverrides(input: any): RunReviewOverride[] {
  if (!Array.isArray(input)) return [];
  return input.map((item) => {
    const configFile = String(item?.configFile || '').trim();
    if (!configFile) throw new Error('运行级覆盖缺少配置文件');
    if (item?.kind === 'lightweight') {
      if (![true, false, null].includes(item?.requiresAdversarial)) throw new Error('轻量工作流运行级覆盖格式无效');
      return {
        kind: 'lightweight',
        configFile,
        requiresAdversarial: item.requiresAdversarial,
      };
    }
    const stateId = String(item?.stateId || '').trim();
    const mode = item?.mode === null ? null : String(item?.mode || '');
    if (!stateId || !['standard', 'adversarial', null].includes(mode as any)) {
      throw new Error('逐状态运行级覆盖格式无效');
    }
    return { kind: 'state', configFile, stateId, mode } as RunReviewOverride;
  });
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
  configContent?: string;
  configContentOverrides?: Record<string, string>;
  runReviewPlan?: RunReviewPlanArtifact['plan'];
  preflightChecks: any[];
  initialContexts?: {
    globalContext: string;
    phaseContexts: Record<string, string>;
    taskInput?: WorkflowTaskInput;
    workingDirectory?: string;
  };
}) {
  const configPath = await getRuntimeWorkflowConfigPath(input.configFile);
  const raw = input.configContent ?? await readFile(configPath, 'utf-8');
  const config = parse(raw) as any;
  if (input.initialContexts?.workingDirectory) {
    config.context = {
      ...(config.context || {}),
      projectRoot: input.initialContexts.workingDirectory,
    };
  }
  const runId = input.runId;
  const workflowSnapshot = await createWorkflowConfigSnapshot({
    rootConfigFile: input.configFile,
    runId,
    contentOverrides: input.configContentOverrides,
  });
  const now = new Date().toISOString();
  const totalSteps = countWorkflowSteps(config);
  if (input.lightweight) {
    await mkdir(input.lightweight.resolvedTasklistDirectory, { recursive: true });
  }
  const creationSession = input.creationSessionId
    ? await loadCreationSession(input.creationSessionId).catch(() => null)
    : null;
  const runSpecCoding = !isLightweightWorkflowConfig(config) && creationSession?.specCoding
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
    ...(input.lightweight ? {} : {
      supervisorAgent: config?.workflow?.supervisor?.agent || 'default-supervisor',
      supervisorSessionId: null,
    }),
    attachedAgentSessions: {},
    workflowFrontendSessionId: input.frontendSessionId || null,
    globalContext: input.initialContexts?.globalContext || '',
    phaseContexts: input.initialContexts?.phaseContexts || {},
    taskInput: input.initialContexts?.taskInput,
    qualityChecks: input.preflightChecks,
    stepTaskBindingsSnapshot: bindingValidation?.bindings,
    bindingValidation: bindingValidation as any,
    ...(input.lightweight ? {} : {
      latestSupervisorReview: {
        type: 'state-review' as const,
        stateName: '演练模式',
        content: summary,
        timestamp: now,
      },
    }),
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
    runReviewPlan: input.runReviewPlan,
    workflowSnapshotRoot: workflowSnapshot.root,
    workflowSnapshotManifestHash: workflowSnapshot.manifestHash,
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
    speakerName: state.supervisorAgent,
    dedupeKey: `workflow-rehearsal-created-${runId}`,
    createdAt: now,
  }, input.configFile);
  await appendAndFanoutWorkflowRuntimeTranscript({
    runId,
    type: 'run-starting',
    title: '演练开始',
    body: [
      `配置文件：${input.configFile}`,
      input.lightweight ? '' : `协调嘉宾：${state.supervisorAgent}`,
      getWorkflowTaskInputTitle(input.initialContexts?.taskInput)
        ? `本次任务：${getWorkflowTaskInputTitle(input.initialContexts?.taskInput)}`
        : '',
    ].filter(Boolean).join('\n'),
    speakerName: state.supervisorAgent,
    dedupeKey: `workflow-rehearsal-starting-${runId}`,
    createdAt: now,
  }, input.configFile);
  if (!input.lightweight) {
    await appendAndFanoutWorkflowRuntimeTranscript({
      runId,
      type: 'state-review',
      title: '演练总结',
      body: [
        summary,
        recommendedNextSteps.length ? `建议：${recommendedNextSteps.join('；')}` : '',
      ].filter(Boolean).join('\n'),
      speakerName: state.supervisorAgent,
      dedupeKey: `workflow-rehearsal-completed-${runId}`,
      createdAt: (Date.parse(now) || Date.now()) + 1,
    }, input.configFile);
  }

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
    const {
      configFile,
      frontendSessionId,
      creationSessionId,
      skipPreflight,
      rehearsal,
      preflightChecks: inputPreflightChecks,
      startPlanId,
    } = body;
    const initialContexts = normalizeInitialContexts(body?.initialContexts);

    if (!configFile) {
      return jsonOk(
        { error: '缺少配置文件参数' },
        { status: 400 }
      );
    }

    let runReviewArtifact: RunReviewPlanArtifact | null = null;
    if (typeof startPlanId === 'string' && startPlanId.trim()) {
      const stored = loadRunReviewPlanArtifact(user.id, startPlanId.trim());
      if (!stored) return jsonOk({ error: '本次运行方案不存在或已过期，请重新确认' }, { status: 409 });
      if (stored.plan.rootConfigFile !== configFile) {
        return jsonOk({ error: '本次运行方案与工作流配置不匹配' }, { status: 409 });
      }
      if (body?.adversarialIntent && body.adversarialIntent !== stored.plan.intent) {
        return jsonOk({ error: '本次运行方案与全局意愿不匹配' }, { status: 409 });
      }
      try {
        await validateRunReviewPlanArtifact({ artifact: stored, initialContexts, rehearsal: Boolean(rehearsal) });
        runReviewArtifact = await applyRunReviewPlanOverrides({
          artifact: stored,
          overrides: normalizeRunReviewOverrides(body?.reviewOverrides),
        });
      } catch (error: any) {
        return jsonOk({ error: '本次运行方案已失效', message: error?.message || String(error) }, { status: 409 });
      }
      if (runReviewArtifact.plan.blocked) {
        return jsonOk({ error: '本次运行方案存在未解决问题', plan: runReviewArtifact.plan }, { status: 409 });
      }
    } else if (body?.adversarialIntent) {
      return jsonOk({ error: '缺少已确认的本次运行方案' }, { status: 400 });
    } else {
      console.warn(`[Workflow] deprecated start without run-level adversarial intent: ${configFile}`);
    }

    const configPath = await getRuntimeWorkflowConfigPath(configFile);
    let config = parse(
      runReviewArtifact?.effectiveConfigContents[configFile]
        ?? await readFile(configPath, 'utf-8'),
    ) as any;
    const boundCreationSession = typeof creationSessionId === 'string'
      ? await loadCreationSession(creationSessionId).catch(() => null)
      : await loadLatestCreationSessionByFilename(configFile).catch(() => null);
    let bindingValidation: any = undefined;
    if (!isLightweightWorkflowConfig(config) && boundCreationSession?.specCoding) {
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
      if (runReviewArtifact) {
        runReviewArtifact.effectiveConfigContents[configFile] = stringify(config);
      } else {
        await writeFile(configPath, stringify(config), 'utf-8');
      }
      await updateCreationSession(boundCreationSession.id, { bindingValidation });
    }

    let preflightChecks = Array.isArray(inputPreflightChecks) ? inputPreflightChecks : undefined;
    // The run-review plan, effective config hash, schema, agent bindings and
    // snapshot are validated independently from project quality commands.
    // An explicit skip only bypasses lint/build/test/custom preflight commands;
    // it must not bypass those structural launch safeguards.
    if (!skipPreflight) {
      const preflight = await runWorkflowPreflight(
        configFile,
        user.personalDir || '',
        initialContexts.workingDirectory,
        runReviewArtifact
          ? { configContents: runReviewArtifact.effectiveConfigContents }
          : {},
      );
      if (!preflight.ok) {
        return jsonOk(
          {
            error: `启动前检查未通过：${preflight.failedCount} 项失败`,
            checks: preflight.checks,
            cwd: preflight.cwd,
          },
          { status: 412 },
        );
      }
      preflightChecks = preflight.checks;
    } else if (runReviewArtifact) {
      // Planned starts cannot trust stale client-side results from a different
      // projection. Persist no quality result when the user explicitly skips
      // project checks; the structural validations above still remain active.
      preflightChecks = [];
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
    const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const lightweight = prepareLightweightRunMetadata(executionConfig, user.personalDir, runId);
    const supervisorAgent = lightweight
      ? undefined
      : (executionConfig?.workflow?.supervisor?.agent || 'default-supervisor');

    if (rehearsal) {
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
          configContent: runReviewArtifact?.effectiveConfigContents[configFile],
          configContentOverrides: runReviewArtifact?.effectiveConfigContents,
          runReviewPlan: runReviewArtifact?.plan,
        });
        if (runReviewArtifact) consumeRunReviewPlanArtifact(user.id, runReviewArtifact.plan.id);
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
    }

    try {
      await createWorkflowConfigSnapshot({
        rootConfigFile: configFile,
        runId,
        contentOverrides: runReviewArtifact?.effectiveConfigContents,
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
    try {
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
      manager._rootRunId = runId;
      manager._runReviewPlan = runReviewArtifact?.plan;
      const startPromise = manager.start(configFile, undefined, preflightChecks, initialContexts, runId);
      void Promise.resolve(startPromise)
        .catch((err: any) => {
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
          lightweight ? '' : `协调嘉宾：${supervisorAgent}`,
          getWorkflowTaskInputTitle(initialContexts.taskInput)
            ? `本次任务：${getWorkflowTaskInputTitle(initialContexts.taskInput)}`
            : '',
        ].filter(Boolean).join('\n'),
        speakerName: supervisorAgent,
        dedupeKey: `workflow-run-starting-${runId}`,
      }, configFile, manager);

      if (runReviewArtifact) consumeRunReviewPlanArtifact(user.id, runReviewArtifact.plan.id);

      return jsonOk({
        success: true,
        message: '工作流已启动',
        runId,
        frontendSessionId: workflowConversation.sessionId,
        sessionWorkbenchState: workflowConversation.sessionWorkbenchState,
      });
    } finally {
      workflowStartLocks.delete(configFile);
    }
  } catch (error: any) {
    return jsonOk(
      { error: '启动工作流失败', message: error.message },
      { status: 500 }
    );
  }
}
