import { NextRequest, NextResponse } from 'next/server';
import { writeFile, access, readFile } from 'fs/promises';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { newConfigFormSchema } from '@/lib/core/schemas';
import { ZodError } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { canAccessConfigMeta, getConfigMeta, setConfigMeta } from '@/lib/config/metadata';
import { ensureRuntimeConfigsSeeded, getRuntimeConfigsDirPath } from '@/lib/run/runtime-configs';
import { buildCreationSession, loadCreationSession, saveCreationSession, updateCreationSession } from '@/lib/spec/coding-store';
import { updateChatSessionCreationBinding } from '@/lib/chat/persistence';
import { formatValidationIssuesForResponse, validateWorkflowDraft } from '@/lib/core/creator-validation';
import { assertPersistedSpecRootReady } from '@/lib/spec/persistence';
import { compileStepTaskBindings } from '@/lib/spec/task-binding';

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

function createPhaseBasedConfig(workflowName: string, workingDirectory: string, workspaceMode: 'isolated-copy' | 'in-place', description?: string) {
  return {
    workflow: {
      name: workflowName,
      description: description || '',
      ...createDefaultWorkflowGovernance(),
      phases: [
        {
          name: '阶段 1',
          steps: [
            {
              name: '步骤 1',
              agent: 'developer',
              task: '请描述任务内容',
            },
          ],
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

function createStateMachineConfig(workflowName: string, workingDirectory: string, workspaceMode: 'isolated-copy' | 'in-place', description?: string) {
  return {
    workflow: {
      name: workflowName,
      description: description || '',
      mode: 'state-machine',
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
          steps: [
            { name: '方案设计', agent: 'architect', role: 'defender', task: '根据需求设计技术方案，输出设计文档' },
            { name: '方案挑战', agent: 'design-breaker', role: 'attacker', task: '审查设计方案，寻找潜在缺陷和风险点' },
            { name: '设计评审', agent: 'design-judge', role: 'judge', task: '综合红队方案和蓝队意见，给出评审结论和 verdict' },
          ],
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
          steps: [
            { name: '编码实施', agent: 'developer', role: 'defender', task: '根据设计方案进行编码实施' },
            { name: '代码审查', agent: 'code-hunter', role: 'attacker', task: '审查代码实现，检查安全性、性能和代码质量' },
            { name: '实施评审', agent: 'code-judge', role: 'judge', task: '综合实施结果和审查意见，给出评审结论和 verdict' },
          ],
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
          steps: [
            { name: '功能测试', agent: 'tester', role: 'defender', task: '编写并执行测试用例，验证功能正确性' },
            { name: '压力测试', agent: 'stress-tester', role: 'attacker', task: '进行边界测试和压力测试，寻找潜在问题' },
            { name: '测试评审', agent: 'code-judge', role: 'judge', task: '综合测试结果，给出最终评审结论和 verdict' },
          ],
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
          steps: [
            { name: '生成报告', agent: 'developer', role: 'defender', task: '汇总各阶段成果，生成最终报告' },
            { name: '报告审查', agent: 'code-auditor', role: 'attacker', task: '审查最终报告的完整性和准确性' },
            { name: '最终确认', agent: 'code-judge', role: 'judge', task: '确认报告质量，给出最终结论' },
          ],
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

function normalizeConfigFilename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error('无效文件名');
  }
  return normalized;
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function getWorkflowMode(config: any): 'phase-based' | 'state-machine' {
  if (config?.workflow?.mode === 'state-machine') return 'state-machine';
  if (Array.isArray(config?.workflow?.states) && !Array.isArray(config?.workflow?.phases)) return 'state-machine';
  return 'phase-based';
}

function getReferenceWorkflowMode(mode: string): 'phase-based' | 'state-machine' {
  return mode === 'state-machine' || mode === 'ai-guided' ? 'state-machine' : 'phase-based';
}

function updatePhaseSteps(phases: any[], requirements?: string) {
  return (phases || []).map((phase: any, phaseIndex: number) => ({
    ...phase,
    steps: (phase.steps || []).map((step: any, stepIndex: number) => ({
      ...step,
      task: requirements?.trim()
        ? `基于当前需求「${requirements.trim()}」，在阶段「${phase.name || `阶段 ${phaseIndex + 1}`}」中完成步骤「${step.name || `步骤 ${stepIndex + 1}`}」的任务。`
        : step.task,
    })),
  }));
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
  cloned.workflow.description = options.description || options.requirements || cloned.workflow.description || '';
  cloned.context.projectRoot = options.workingDirectory;
  cloned.context.workspaceMode = options.workspaceMode;
  cloned.context.requirements = options.requirements || cloned.context.requirements || '';

  if (Array.isArray(cloned.workflow.phases)) {
    cloned.workflow.phases = updatePhaseSteps(cloned.workflow.phases, options.requirements);
  }
  if (Array.isArray(cloned.workflow.states)) {
    cloned.workflow.states = updateStateSteps(cloned.workflow.states, options.requirements);
  }

  return cloned;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const frontendSessionId = typeof body.frontendSessionId === 'string' ? body.frontendSessionId : undefined;
    const creationSessionId = typeof body.creationSessionId === 'string' ? body.creationSessionId : undefined;
    const configDraft = body.configDraft && typeof body.configDraft === 'object' ? body.configDraft : null;
    const skipSpecCoding = body.skipSpecCoding === true;

    // 验证表单
    const validationResult = newConfigFormSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: '表单验证失败',
          details: validationResult.error.issues,
        },
        { status: 400 }
      );
    }

    const { filename, workflowName, referenceWorkflow, workingDirectory, workspaceMode, description, mode, requirements, persistMode, specRoot } = validationResult.data;
    const workflowMode = mode || 'phase-based';
    const normalizedPersistMode = skipSpecCoding ? 'none' : (persistMode === 'repository' ? 'repository' : 'none');
    const normalizedSpecRoot = normalizedPersistMode === 'repository' ? (specRoot?.trim() || '.spec') : undefined;
    if (normalizedPersistMode === 'repository') {
      assertPersistedSpecRootReady(workingDirectory, normalizedSpecRoot);
    }

    // 检查文件是否已存在
    await ensureRuntimeConfigsSeeded();
    const filepath = resolve(await getRuntimeConfigsDirPath(), filename);
    try {
      await access(filepath);
      return NextResponse.json(
        { error: '文件已存在', message: `${filename} 已存在` },
        { status: 409 }
      );
    } catch {
      // 文件不存在，继续创建
    }

    let defaultConfig: any;

    // AI 引导模式：已有 configDraft 时直接使用，跳过 referenceWorkflow 读取
    if (configDraft) {
      defaultConfig = configDraft;
    } else if (referenceWorkflow) {
      const sourceMeta = await getConfigMeta(referenceWorkflow, 'workflow');
      if (!canAccessConfigMeta(sourceMeta, auth.id, auth.role)) {
        return NextResponse.json({ error: '无权限访问参考工作流' }, { status: 403 });
      }

      const referencePath = resolve(await getRuntimeConfigsDirPath(), normalizeConfigFilename(referenceWorkflow));
      const referenceRaw = await readFile(referencePath, 'utf-8');
      const referenceConfig = parse(referenceRaw);
      const referenceMode = getWorkflowMode(referenceConfig);
      const expectedReferenceMode = getReferenceWorkflowMode(workflowMode);
      if (referenceMode !== expectedReferenceMode) {
        return NextResponse.json(
          {
            error: '参考工作流类型不匹配',
            message: expectedReferenceMode === 'state-machine'
              ? '状态机工作流只能参考状态机工作流'
              : '阶段式工作流只能参考阶段式工作流',
          },
          { status: 400 }
        );
      }
      defaultConfig = createConfigFromReference(referenceConfig, {
        workflowName,
        workingDirectory,
        workspaceMode,
        description,
        requirements,
      });
    } else if (workflowMode === 'ai-guided') {
      const port = process.env.PORT || '3000';
      try {
        const response = await fetch(`http://localhost:${port}/api/configs/ai-generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requirements, workflowName, filename, workspaceMode }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          return NextResponse.json(
            { error: 'AI 生成失败', message: result.message || result.error },
            { status: 500 }
          );
        }
        defaultConfig = result.config;
      } catch (e) {
        // 如果 AI 生成失败，使用默认模板
        defaultConfig = createStateMachineConfig(workflowName, workingDirectory, workspaceMode, description);
      }
    } else if (workflowMode === 'state-machine') {
      defaultConfig = createStateMachineConfig(workflowName, workingDirectory, workspaceMode, description);
    } else {
      defaultConfig = createPhaseBasedConfig(workflowName, workingDirectory, workspaceMode, description);
    }

    const configValidation = validateWorkflowDraft(defaultConfig);
    if (!configValidation.ok || !configValidation.normalized) {
      return NextResponse.json(
        {
          error: '工作流草案验证失败',
          details: formatValidationIssuesForResponse(configValidation),
        },
        { status: 400 }
      );
    }
    defaultConfig = configValidation.normalized;

    // Determine the generated mode for the response message
    const generatedMode = defaultConfig?.workflow?.mode === 'state-machine' ? 'state-machine' : 'phase-based';
    let message = '配置文件已创建';
    if (workflowMode === 'ai-guided') {
      message = generatedMode === 'state-machine'
        ? 'AI 已根据需求生成状态机工作流，请在设计页面调整状态和转移。'
        : 'AI 已根据需求生成阶段工作流，请在设计页面调整阶段和步骤。';
    }

    let creationSession = !skipSpecCoding && creationSessionId ? await loadCreationSession(creationSessionId) : null;
    if (creationSession?.createdBy && creationSession.createdBy !== auth.id) {
      return NextResponse.json({ error: '无权复用该创建态会话' }, { status: 403 });
    }
    if (skipSpecCoding) {
      await writeFile(filepath, stringify(defaultConfig), 'utf-8');
      await setConfigMeta(filename, {
        createdBy: auth.id,
        visibility: 'private',
        createdAt: Date.now(),
      }, 'workflow');

      return NextResponse.json({
        success: true,
        message,
        filename,
        creationSession: null,
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
        specCoding: {
          ...creationSession.specCoding,
          status: creationSession.specCoding.status === 'draft' ? 'confirmed' : creationSession.specCoding.status,
          persistMode: normalizedPersistMode,
          specRoot: normalizedSpecRoot,
          confirmedAt: creationSession.specCoding.confirmedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        generatedConfigSummary: {
          mode: defaultConfig?.workflow?.mode === 'state-machine' ? 'state-machine' : 'phase-based',
          phaseCount: Array.isArray(defaultConfig?.workflow?.phases) ? defaultConfig.workflow.phases.length : 0,
          stateCount: Array.isArray(defaultConfig?.workflow?.states) ? defaultConfig.workflow.states.length : 0,
          agentNames: [...new Set(
            (Array.isArray(defaultConfig?.workflow?.phases)
              ? defaultConfig.workflow.phases.flatMap((phase: any) => (phase.steps || []).map((step: any) => step.agent))
              : Array.isArray(defaultConfig?.workflow?.states)
                ? defaultConfig.workflow.states.flatMap((state: any) => (state.steps || []).map((step: any) => step.agent))
              : []).filter(Boolean)
          )] as string[],
        },
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
      requireExplicit: Boolean(configDraft && workflowMode === 'ai-guided'),
    });
    if (!bindingCompilation.validation.ok) {
      await updateCreationSession(creationSession.id, {
        bindingValidation: bindingCompilation.validation as any,
      });
      return NextResponse.json(
        {
          error: 'Spec task 绑定校验失败',
          message: 'AI 生成的 workflow 草案必须为每个 step 显式提供有效的 specTaskBinding.taskIds',
          bindingValidation: bindingCompilation.validation,
        },
        { status: 400 }
      );
    }
    defaultConfig = bindingCompilation.config;
    await writeFile(filepath, stringify(defaultConfig), 'utf-8');
    await setConfigMeta(filename, {
      createdBy: auth.id,
      visibility: 'private',
      createdAt: Date.now(),
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

    return NextResponse.json({
      success: true,
      message,
      filename,
      creationSession,
    });
  } catch (error: any) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: '表单验证失败',
          details: error.issues,
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: '创建配置失败', message: error.message },
      { status: 500 }
    );
  }
}
