import { access, readdir, readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { ZodError } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { updateChatSessionCreationBinding } from '@/lib/chat/persistence';
import { canAccessConfigMeta, getConfigMeta, setConfigMeta } from '@/lib/config/metadata';
import { isWorkflowStepSelectableAgent } from '@/lib/agent/catalog';
import { formatValidationIssuesForResponse, validateWorkflowDraft } from '@/lib/core/creator-validation';
import { newConfigFormSchema } from '@/lib/core/schemas';
import { ensureRuntimeConfigsSeeded, getRuntimeAgentsDirPath, getRuntimeConfigsDirPath } from '@/lib/run/runtime-configs';
import { assertPersistedSpecRootReady } from '@/lib/spec/persistence';
import { buildCreationSession, loadCreationSession, saveCreationSession, updateCreationSession } from '@/lib/spec/coding-store';
import { compileStepTaskBindings } from '@/lib/spec/task-binding';
import { validateSubworkflowDependenciesForConfig } from '@/lib/workflow/subworkflow-config';
import {
  LIGHTWEIGHT_TASKLIST_SKILL,
  LIGHTWEIGHT_WORKFLOW_TIMEOUT_MINUTES,
  LIGHTWEIGHT_WORKFLOW_DESCRIPTION,
  LIGHTWEIGHT_WORKFLOW_PROFILE,
} from '@/lib/workflow/lightweight';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import {
  normalizeWorkflowReviewAssessment,
  type WorkflowCreationAdversarialIntent,
  type WorkflowCreationJourney,
} from '@/lib/ai/workflow-creation-review-protocol';

type CreationMode = 'lightweight' | 'state-machine';

class CreationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreationInputError';
  }
}

function createDefaultWorkflowGovernance() {
  return {
    supervisor: {
      enabled: true,
      agent: 'default-supervisor',
      stageReviewEnabled: true,
      checkpointAdviceEnabled: true,
      scoringEnabled: true,
      experienceEnabled: true,
    },
  };
}

function createVerdictTransitions(input: {
  passTo: string;
  conditionalPassTo: string;
  failTo: string;
  passLabel: string;
  conditionalPassLabel: string;
  failLabel: string;
}) {
  return [
    { to: input.passTo, condition: { verdict: 'pass' }, priority: 10, label: input.passLabel },
    { to: input.conditionalPassTo, condition: { verdict: 'conditional_pass' }, priority: 20, label: input.conditionalPassLabel },
    { to: input.failTo, condition: { verdict: 'fail' }, priority: 30, label: input.failLabel },
  ];
}

function createStateMachineConfig(
  workflowName: string,
  workingDirectory: string,
  workspaceMode: 'isolated-copy' | 'in-place',
  description?: string,
  creationAdversarialIntent?: WorkflowCreationAdversarialIntent,
) {
  const reviewPolicy = creationAdversarialIntent === 'disabled'
    ? {
        mode: 'standard' as const,
        source: 'user' as const,
        locked: true,
        confidence: 'high' as const,
        riskSignals: [],
        rationale: '用户创建工作流时选择不开启对抗，全部非终态强制使用标准模式。',
      }
    : creationAdversarialIntent === 'on-demand'
      ? {
          mode: 'adversarial' as const,
          source: 'default' as const,
          locked: false,
          confidence: 'medium' as const,
          riskSignals: ['默认状态机模板包含高代价设计、实施和验证边界'],
          rationale: '直接状态机模板包含设计、实施和测试边界，缺少 AI 判断证据时按保守默认启用对抗审查。',
        }
      : undefined;
  const stateSteps = (standardStep: any, attacker: any, judge: any) => creationAdversarialIntent === 'disabled'
    ? [{
        ...standardStep,
        role: undefined,
        task: `${standardStep.task}\n\n在同一次输出中给出严格 JSON 裁决，verdict 只能是 pass、conditional_pass 或 fail。`,
      }]
    : [standardStep, attacker, judge];
  return {
    workflow: {
      name: workflowName,
      description: description || '',
      mode: 'state-machine' as const,
      maxTransitions: 30,
      ...createDefaultWorkflowGovernance(),
      states: [
        {
          name: '设计',
          description: '执行设计任务，红队实施、蓝队挑战、裁判评审',
          isInitial: true,
          isFinal: false,
          maxSelfTransitions: 3,
          position: { x: 100, y: 200 },
          ...(reviewPolicy ? { reviewPolicy } : {}),
          steps: stateSteps(
            { name: '方案设计', agent: 'architect', role: 'defender', task: '根据需求设计技术方案，输出设计文档' },
            { name: '方案挑战', agent: 'solution-breaker', role: 'attacker', task: '审查设计方案，寻找潜在缺陷和风险点' },
            { name: '设计评审', agent: 'design-judge', role: 'judge', task: '综合红队方案和蓝队意见，给出评审结论和 verdict' },
          ),
          transitions: createVerdictTransitions({
            passTo: '实施',
            conditionalPassTo: '设计',
            failTo: '设计',
            passLabel: '设计通过',
            conditionalPassLabel: '需要修改',
            failLabel: '重新设计',
          }),
        },
        {
          name: '实施',
          description: '执行实施任务，红队编码、蓝队审查、裁判验收',
          isInitial: false,
          isFinal: false,
          maxSelfTransitions: 3,
          position: { x: 400, y: 200 },
          ...(reviewPolicy ? { reviewPolicy } : {}),
          steps: stateSteps(
            { name: '编码实施', agent: 'developer', role: 'defender', task: '根据设计方案进行编码实施' },
            { name: '代码审查', agent: 'code-hunter', role: 'attacker', task: '审查代码实现，检查安全性、性能和代码质量' },
            { name: '实施评审', agent: 'code-judge', role: 'judge', task: '综合实施结果和审查意见，给出评审结论和 verdict' },
          ),
          transitions: createVerdictTransitions({
            passTo: '测试',
            conditionalPassTo: '实施',
            failTo: '设计',
            passLabel: '实施完成',
            conditionalPassLabel: '需要修改',
            failLabel: '设计有问题',
          }),
        },
        {
          name: '测试',
          description: '执行测试验证，红队测试、蓝队攻击、裁判判定',
          isInitial: false,
          isFinal: false,
          maxSelfTransitions: 3,
          position: { x: 700, y: 200 },
          ...(reviewPolicy ? { reviewPolicy } : {}),
          steps: stateSteps(
            { name: '功能测试', agent: 'tester', role: 'defender', task: '编写并执行测试用例，验证功能正确性' },
            { name: '压力测试', agent: 'stress-tester', role: 'attacker', task: '进行边界测试和压力测试，寻找潜在问题' },
            { name: '测试评审', agent: 'code-judge', role: 'judge', task: '综合测试结果，给出最终评审结论和 verdict' },
          ),
          transitions: createVerdictTransitions({
            passTo: '完成',
            conditionalPassTo: '实施',
            failTo: '设计',
            passLabel: '测试通过',
            conditionalPassLabel: '需要修复',
            failLabel: '严重问题',
          }),
        },
        {
          name: '完成',
          description: '工作流结束，生成总结报告',
          isInitial: false,
          isFinal: true,
          position: { x: 1000, y: 200 },
          steps: [{ name: '生成报告', agent: 'developer', task: '汇总各阶段成果、验证证据和剩余风险，生成最终报告；终态不输出 verdict' }],
          transitions: [],
        },
      ],
    },
    context: {
      projectRoot: workingDirectory,
      workspaceMode,
      requirements: '',
    },
  };
}

function createLightweightConfig(input: {
  filename: string;
  workflowName: string;
  workingDirectory: string;
  workspaceMode: 'isolated-copy' | 'in-place';
  description?: string;
  agent: string;
  task: string;
}) {
  return {
    workflow: {
      name: input.workflowName,
      description: input.description || '',
      mode: 'state-machine' as const,
      profile: LIGHTWEIGHT_WORKFLOW_PROFILE,
      lightweight: {},
      states: [
        {
          name: '执行',
          description: LIGHTWEIGHT_WORKFLOW_DESCRIPTION,
          isInitial: true,
          isFinal: true,
          position: { x: 120, y: 160 },
          steps: [
            {
              name: '执行任务',
              type: 'agent' as const,
              agent: input.agent.trim(),
              task: input.task.trim(),
              skills: [LIGHTWEIGHT_TASKLIST_SKILL],
            },
          ],
          transitions: [],
        },
      ],
    },
    context: {
      projectRoot: input.workingDirectory,
      workspaceMode: input.workspaceMode,
      requirements: input.task,
      timeoutMinutes: LIGHTWEIGHT_WORKFLOW_TIMEOUT_MINUTES,
    },
  };
}

function normalizeConfigFilename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw new CreationInputError('无效文件名');
  }
  return normalized;
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLightweightStep(step: any): any {
  const normalized = {
    ...step,
    skills: [LIGHTWEIGHT_TASKLIST_SKILL],
  };
  delete normalized.specTaskBinding;
  return normalized;
}

function normalizeLightweightConfigDraft(configDraft: any): any {
  const cloned = structuredCloneSafe(configDraft || {});
  cloned.workflow = cloned.workflow || {};
  cloned.context = cloned.context || {};
  cloned.workflow.mode = 'state-machine';
  cloned.workflow.profile = LIGHTWEIGHT_WORKFLOW_PROFILE;
  if (cloned.context.timeoutMinutes === undefined) {
    cloned.context.timeoutMinutes = LIGHTWEIGHT_WORKFLOW_TIMEOUT_MINUTES;
  }
  delete cloned.workflow.supervisor;
  delete cloned.workflow.maxTransitions;
  if (Array.isArray(cloned.workflow.states)) {
    cloned.workflow.states = cloned.workflow.states.map((state: any) => ({
      ...state,
      reviewPolicy: undefined,
      steps: Array.isArray(state?.steps)
        ? state.steps.map((step: any) => {
            const normalized = normalizeLightweightStep(step);
            delete normalized.role;
            delete normalized.agentInstanceId;
            delete normalized.provenance;
            return normalized;
          })
        : state?.steps,
    }));
  }
  cloned.workflow.lightweight = {};
  return cloned;
}

function readCreationJourney(value: unknown): WorkflowCreationJourney | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'direct' || value === 'ai-guided') return value;
  throw new CreationInputError('creationJourney 只能是 direct 或 ai-guided');
}

function readCreationAdversarialIntent(value: unknown): WorkflowCreationAdversarialIntent | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'disabled' || value === 'on-demand') return value;
  throw new CreationInputError('creationAdversarialIntent 只能是 disabled 或 on-demand');
}

async function listAvailableWorkflowAgentNames(): Promise<string[]> {
  const agentsDirectory = await getRuntimeAgentsDirPath();
  const files = (await readdir(agentsDirectory))
    .filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'))
    .sort((left, right) => left.localeCompare(right));
  const names: string[] = [];
  for (const file of files) {
    try {
      const agent = parse(await readFile(resolve(agentsDirectory, file), 'utf8'));
      const name = typeof agent?.name === 'string' ? agent.name.trim() : '';
      if (name && isWorkflowStepSelectableAgent(agent) && !names.includes(name)) names.push(name);
    } catch {
      // Malformed Agent configs are not safe workflow execution targets.
    }
  }
  return names;
}

function applyAvailableAgentRoster(config: any, availableAgentNames: string[]): any {
  if (availableAgentNames.length === 0) {
    throw new CreationInputError('当前没有可执行的普通 Agent，无法创建可运行的工作流。请先创建或启用至少一个普通执行 Agent。');
  }
  const cloned = structuredCloneSafe(config || {});
  if (!Array.isArray(cloned?.workflow?.states)) return cloned;
  let fallbackIndex = 0;
  cloned.workflow.states = cloned.workflow.states.map((state: any) => ({
    ...state,
    steps: Array.isArray(state?.steps)
      ? state.steps.map((step: any) => ({
          ...step,
          agent: availableAgentNames.includes(String(step?.agent || '').trim())
            ? step.agent
            : availableAgentNames[fallbackIndex++ % availableAgentNames.length],
        }))
      : state?.steps,
  }));
  return cloned;
}

function forceDisabledReviewConfig(config: any): any {
  const cloned = structuredCloneSafe(config || {});
  if (cloned?.workflow?.profile === LIGHTWEIGHT_WORKFLOW_PROFILE) {
    return normalizeLightweightConfigDraft(cloned);
  }
  if (!Array.isArray(cloned?.workflow?.states)) return cloned;
  cloned.workflow.states = cloned.workflow.states.map((state: any) => {
    if (state?.isFinal) {
      const finalState = {
        ...state,
        steps: Array.isArray(state?.steps)
          ? state.steps.map((step: any) => {
              const next = { ...step };
              delete next.role;
              delete next.agentInstanceId;
              return next;
            })
          : state?.steps,
      };
      delete finalState.reviewPolicy;
      return finalState;
    }
    const steps = Array.isArray(state?.steps) ? state.steps.map((step: any) => {
      const next = { ...step };
      delete next.role;
      delete next.agentInstanceId;
      return next;
    }) : [];
    if (steps.length > 0) {
      const last = steps[steps.length - 1];
      const instruction = '在同一次输出中给出严格 JSON 裁决，verdict 只能是 pass、conditional_pass 或 fail。';
      if (!String(last.task || '').includes(instruction)) {
        last.task = `${String(last.task || '').trim()}\n\n${instruction}`.trim();
      }
    }
    return {
      ...state,
      reviewPolicy: {
        mode: 'standard',
        source: 'user',
        locked: true,
        confidence: 'high',
        riskSignals: [],
        rationale: '用户创建工作流时选择不开启对抗，全部非终态强制使用标准模式。',
      },
      steps,
    };
  });
  return cloned;
}

function getWorkflowMode(config: any): CreationMode | null {
  if (config?.workflow?.mode !== 'state-machine' || !Array.isArray(config?.workflow?.states)) return null;
  return config?.workflow?.profile === LIGHTWEIGHT_WORKFLOW_PROFILE ? 'lightweight' : 'state-machine';
}

function updateStateSteps(states: any[], requirements?: string) {
  return (states || []).map((state: any, stateIndex: number) => ({
    ...state,
    steps: (state.steps || []).map((step: any, stepIndex: number) => ({
      ...step,
      task: requirements?.trim()
        ? `基于当前需求「${requirements.trim()}」，在状态「${state.name || `状态 ${stateIndex + 1}`}」中完成步骤「${step.name || `步骤 ${stepIndex + 1}`}」的任务。`
        : step.task,
    })),
  }));
}

function createConfigFromReference(referenceConfig: any, options: {
  workflowName: string;
  workingDirectory: string;
  workspaceMode: 'isolated-copy' | 'in-place';
  description?: string;
  requirements?: string;
}) {
  const cloned = structuredCloneSafe(referenceConfig || {});
  cloned.workflow = cloned.workflow || {};
  cloned.context = cloned.context || {};
  cloned.workflow.name = options.workflowName;
  cloned.workflow.mode = 'state-machine';
  cloned.workflow.description = options.description || options.requirements || cloned.workflow.description || '';
  cloned.context.projectRoot = options.workingDirectory;
  cloned.context.workspaceMode = options.workspaceMode;
  cloned.context.requirements = options.requirements || cloned.context.requirements || '';

  if (Array.isArray(cloned.workflow.states)) {
    cloned.workflow.states = updateStateSteps(cloned.workflow.states, options.requirements);
  }

  return cloned;
}

function readRequiredString(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new CreationInputError(`${label}不能为空`);
  return normalized;
}

function readCreationMode(value: unknown): CreationMode {
  if (value === 'lightweight' || value === 'state-machine') return value;
  if (value === undefined || value === null || value === '') return 'state-machine';
  throw new CreationInputError('工作流类型只能是 lightweight 或 state-machine');
}

function summarizeGeneratedConfig(config: any) {
  const states = Array.isArray(config?.workflow?.states) ? config.workflow.states : [];
  return {
    mode: 'state-machine' as const,
    stateCount: states.length,
    agentNames: [...new Set(
      states.flatMap((state: any) => (state.steps || []).map((step: any) => step.agent)).filter(Boolean),
    )] as string[],
  };
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;

    const body = await readJsonBody<Record<string, any>>(request, {});
    const frontendSessionId = typeof body.frontendSessionId === 'string' ? body.frontendSessionId : undefined;
    const creationSessionId = typeof body.creationSessionId === 'string' ? body.creationSessionId : undefined;
    const configDraft = body.configDraft && typeof body.configDraft === 'object' ? body.configDraft : null;
    const skipSpecCoding = body.skipSpecCoding === true;
    const creationJourney = readCreationJourney(body.creationJourney);
    const creationAdversarialIntent = readCreationAdversarialIntent(body.creationAdversarialIntent);
    const creationReviewAssessment = normalizeWorkflowReviewAssessment(body.creationReviewAssessment);
    const creationUiState = creationJourney && creationAdversarialIntent
      ? {
          workflowMode: creationJourney === 'ai-guided' ? 'ai-guided' as const : readCreationMode(body.mode),
          creationJourney,
          targetWorkflowKind: body.targetWorkflowKind === 'lightweight' || body.targetWorkflowKind === 'state-machine'
            ? body.targetWorkflowKind
            : undefined,
          creationAdversarialIntent,
          clarificationAnswers: {},
        }
      : undefined;
    const mergeCreationUiState = (existing?: {
      clarificationAnswers: Record<string, { optionIds: string[]; note: string }>;
      [key: string]: unknown;
    }) => creationUiState
      ? { ...(existing || {}), ...creationUiState, clarificationAnswers: existing?.clarificationAnswers ?? {} }
      : existing;
    const form = newConfigFormSchema.safeParse(body);
    if (!form.success) {
      return jsonOk({ error: '表单验证失败', details: form.error.issues }, { status: 400 });
    }

    const {
      filename,
      workflowName,
      referenceWorkflow,
      workingDirectory,
      workspaceMode,
      description,
      requirements,
      persistMode,
      specRoot,
    } = form.data;
    const requestedWorkflowMode = readCreationMode(form.data.mode);
    const draftWorkflowMode = configDraft?.workflow?.profile === LIGHTWEIGHT_WORKFLOW_PROFILE
      ? 'lightweight'
      : getWorkflowMode(configDraft);
    const workflowMode = draftWorkflowMode || requestedWorkflowMode;
    if (
      workflowMode === 'lightweight'
      && Boolean(creationJourney)
      && creationAdversarialIntent === 'on-demand'
      && (!creationReviewAssessment || creationReviewAssessment.requiresAdversarial || creationReviewAssessment.confidence === 'low')
    ) {
      throw new CreationInputError('按需开启的 lightweight 草案必须包含明确的低风险整体判断；需要对抗或低置信度时请重新规划为 state-machine');
    }
    const specCodingEnabled = workflowMode !== 'lightweight' && !skipSpecCoding;
    const normalizedPersistMode = specCodingEnabled && persistMode === 'repository' ? 'repository' : 'none';
    const normalizedSpecRoot = normalizedPersistMode === 'repository' ? (specRoot?.trim() || '.spec') : undefined;
    if (normalizedPersistMode === 'repository') {
      assertPersistedSpecRootReady(workingDirectory, normalizedSpecRoot);
    }

    await ensureRuntimeConfigsSeeded();
    const availableWorkflowAgentNames = await listAvailableWorkflowAgentNames();
    if (availableWorkflowAgentNames.length === 0) {
      throw new CreationInputError('当前没有可执行的普通 Agent，无法创建可运行的工作流。请先创建或启用至少一个普通执行 Agent。');
    }
    const configsDirectory = await getRuntimeConfigsDirPath();
    const filepath = resolve(configsDirectory, filename);
    try {
      await access(filepath);
      return jsonOk({ error: '文件已存在', message: `${filename} 已存在` }, { status: 409 });
    } catch {
      // The target does not exist yet.
    }

    const lightweightInput = workflowMode === 'lightweight' && !configDraft
      ? {
          agent: readRequiredString(body.lightweight?.agent, '执行 Agent'),
          task: readRequiredString(body.lightweight?.task, '执行任务'),
        }
      : null;

    let defaultConfig: any;
    if (workflowMode === 'lightweight') {
      defaultConfig = configDraft
        ? normalizeLightweightConfigDraft(configDraft)
        : createLightweightConfig({
            filename,
            workflowName,
            workingDirectory,
            workspaceMode,
            description,
            agent: lightweightInput!.agent,
            task: lightweightInput!.task,
          });
    } else if (configDraft) {
      defaultConfig = configDraft;
    } else if (referenceWorkflow) {
      const sourceMeta = await getConfigMeta(referenceWorkflow, 'workflow');
      if (!canAccessConfigMeta(sourceMeta, auth.id, auth.role)) {
        return jsonError('无权限访问参考工作流', 403);
      }

      const referencePath = resolve(configsDirectory, normalizeConfigFilename(referenceWorkflow));
      const referenceConfig = parse(await readFile(referencePath, 'utf-8'));
      if (getWorkflowMode(referenceConfig) !== 'state-machine') {
        return jsonOk({
          error: '参考工作流类型不匹配',
          message: '状态机工作流只能参考状态机工作流',
        }, { status: 400 });
      }
      defaultConfig = createConfigFromReference(referenceConfig, {
        workflowName,
        workingDirectory,
        workspaceMode,
        description,
        requirements,
      });
    } else {
      defaultConfig = createStateMachineConfig(
        workflowName,
        workingDirectory,
        workspaceMode,
        description,
        creationAdversarialIntent,
      );
    }

    defaultConfig = applyAvailableAgentRoster(defaultConfig, availableWorkflowAgentNames);

    if (creationAdversarialIntent === 'disabled') {
      defaultConfig = forceDisabledReviewConfig(defaultConfig);
    }

    const configValidation = validateWorkflowDraft(defaultConfig, {
      materializeIds: true,
      workflowKey: filename,
      // Creating a workflow is the explicit opt-in: the caller just answered the
      // global adversarial intent, so the new config adopts the protocol.
      adoptLegacyPolicy: true,
    });
    if (!configValidation.ok || !configValidation.normalized) {
      return jsonOk({
        error: '工作流草案验证失败',
        details: formatValidationIssuesForResponse(configValidation),
      }, { status: 400 });
    }
    defaultConfig = configValidation.normalized;
    if (workflowMode === 'lightweight') {
      delete defaultConfig.workflow.supervisor;
      delete defaultConfig.workflow.maxTransitions;
      defaultConfig.workflow.states = (defaultConfig.workflow.states || []).map((state: any) => ({
        ...state,
        steps: (state.steps || []).map(normalizeLightweightStep),
      }));
    }
    const dependencyIssues = await validateSubworkflowDependenciesForConfig(defaultConfig);
    if (dependencyIssues.length > 0) {
      return jsonOk({ error: '工作流草案验证失败', details: dependencyIssues }, { status: 400 });
    }

    const lightweightSession = workflowMode === 'lightweight'
      ? (() => {
          const lightweightStep = defaultConfig.workflow.states?.[0]?.steps?.[0] || {};
          return {
            agent: typeof lightweightStep.agent === 'string' ? lightweightStep.agent : lightweightInput?.agent,
            task: typeof lightweightStep.task === 'string' ? lightweightStep.task : lightweightInput?.task,
            skills: Array.isArray(lightweightStep.skills)
              ? lightweightStep.skills.filter((skill: unknown): skill is string => typeof skill === 'string')
              : [],
          };
        })()
      : undefined;

    const message = workflowMode === 'lightweight' ? '轻量工作流已创建' : '配置文件已创建';
    let creationSession = creationSessionId && (workflowMode === 'lightweight' || specCodingEnabled)
      ? await loadCreationSession(creationSessionId)
      : null;
    if (creationSession?.createdBy && creationSession.createdBy !== auth.id) {
      return jsonError('无权复用该创建态会话', 403);
    }
    if (creationSession && creationSession.mode !== workflowMode) {
      return jsonError('创建态会话类型与当前工作流类型不匹配', 400);
    }
    if (!specCodingEnabled) {
      if (workflowMode === 'lightweight') {
        if (creationSession) {
          creationSession = await updateCreationSession(creationSession.id, {
            status: 'config-generated',
            mode: 'lightweight',
            filename,
            workflowName,
            workingDirectory,
            workspaceMode,
            description,
            requirements,
            referenceWorkflow: undefined,
            lightweight: lightweightSession,
            uiState: mergeCreationUiState(creationSession.uiState),
            generatedConfigSummary: summarizeGeneratedConfig(defaultConfig),
          }) || creationSession;
        } else {
          creationSession = buildCreationSession({
            chatSessionId: frontendSessionId,
            createdBy: auth.id,
            status: 'config-generated',
            specCodingStatus: 'confirmed',
            filename,
            workflowName,
            mode: 'lightweight',
            workingDirectory,
            workspaceMode,
            description,
            requirements,
            persistMode: 'none',
            config: defaultConfig,
            lightweight: lightweightSession,
            uiState: mergeCreationUiState(),
          });
          await saveCreationSession(creationSession);
        }
      }

      await writeFile(filepath, stringify(defaultConfig), 'utf-8');
      await setConfigMeta(filename, {
        createdBy: auth.id,
        visibility: 'private',
        createdAt: Date.now(),
        specCodingEnabled: false,
        specCodingSkipped: true,
      }, 'workflow');

      if (frontendSessionId && creationSession) {
        await updateChatSessionCreationBinding(frontendSessionId, {
          creationSessionId: creationSession.id,
          filename,
          workflowName,
          status: creationSession.status,
          specCodingId: creationSession.specCoding.id,
        });
      }

      return jsonOk({
        success: true,
        message,
        filename,
        creationSession,
        specCodingSkipped: true,
      });
    }

    if (creationSession) {
      creationSession = await updateCreationSession(creationSession.id, {
        chatSessionId: frontendSessionId || creationSession.chatSessionId,
        status: 'config-generated',
        mode: workflowMode,
        filename,
        workflowName,
        workingDirectory,
        workspaceMode,
        description,
        requirements,
        referenceWorkflow,
        lightweight: lightweightSession,
        uiState: mergeCreationUiState(creationSession.uiState),
        specCoding: {
          ...creationSession.specCoding,
          status: creationSession.specCoding.status === 'draft' ? 'confirmed' : creationSession.specCoding.status,
          persistMode: normalizedPersistMode,
          specRoot: normalizedSpecRoot,
          confirmedAt: creationSession.specCoding.confirmedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        generatedConfigSummary: summarizeGeneratedConfig(defaultConfig),
      });
    } else {
      creationSession = buildCreationSession({
        chatSessionId: frontendSessionId,
        createdBy: auth.id,
        status: 'config-generated',
        specCodingStatus: 'confirmed',
        filename,
        workflowName,
        mode: workflowMode,
        workingDirectory,
        workspaceMode,
        description,
        requirements,
        referenceWorkflow,
        lightweight: lightweightSession,
        uiState: mergeCreationUiState(),
        persistMode: normalizedPersistMode,
        specRoot: normalizedSpecRoot,
        config: defaultConfig,
      });
      await saveCreationSession(creationSession);
    }
    if (!creationSession) {
      throw new Error('创建态会话生成失败');
    }

    const bindingCompilation = compileStepTaskBindings(defaultConfig, creationSession.specCoding, {
      requireExplicit: false,
    });
    if (!bindingCompilation.validation.ok) {
      await updateCreationSession(creationSession.id, {
        bindingValidation: bindingCompilation.validation as any,
      });
      return jsonOk({
        error: 'Spec task 绑定校验失败',
        message: '工作流草案必须为每个 step 提供有效的 specTaskBinding.taskIds',
        bindingValidation: bindingCompilation.validation,
      }, { status: 400 });
    }
    defaultConfig = bindingCompilation.config;
    await writeFile(filepath, stringify(defaultConfig), 'utf-8');
    await setConfigMeta(filename, {
      createdBy: auth.id,
      visibility: 'private',
      createdAt: Date.now(),
      specCodingEnabled: true,
      specCodingSkipped: false,
    }, 'workflow');
    creationSession = await updateCreationSession(creationSession.id, {
      bindingValidation: bindingCompilation.validation as any,
    }) || creationSession;
    if (frontendSessionId) {
      await updateChatSessionCreationBinding(frontendSessionId, {
        creationSessionId: creationSession.id,
        filename,
        workflowName,
        status: creationSession.status,
        specCodingId: creationSession.specCoding.id,
      });
    }

    return jsonOk({
      success: true,
      message,
      filename,
      creationSession,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonOk({ error: '表单验证失败', details: error.issues }, { status: 400 });
    }
    if (error instanceof CreationInputError) {
      return jsonError('创建配置失败', 400, error.message);
    }
    return jsonError('创建配置失败', 500, errorMessage(error));
  }
}
