import { NextRequest, NextResponse } from 'next/server';
import { writeFile, access, readFile } from 'fs/promises';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { newConfigFormSchema } from '@/lib/schemas';
import { ZodError } from 'zod';
import { requireAuth } from '@/lib/auth-middleware';
import { getConfigMeta, setConfigMeta } from '@/lib/config-metadata';
import { ensureRuntimeConfigsSeeded, getRuntimeConfigsDirPath } from '@/lib/runtime-configs';
import { buildCreationSession, loadCreationSession, saveCreationSession, updateCreationSession } from '@/lib/openspec-store';
import { updateChatSessionCreationBinding } from '@/lib/chat-persistence';
import { formatValidationIssuesForResponse, validateWorkflowDraft } from '@/lib/creator-validation';

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
          description: '执行设计任务，蓝队实施、红队挑战、裁判评审',
          isInitial: true,
          isFinal: false,
          maxSelfTransitions: 3,
          position: { x: 100, y: 200 },
          steps: [
            { name: '方案设计', agent: 'architect', role: 'defender', task: '根据需求设计技术方案，输出设计文档' },
            { name: '方案挑战', agent: 'design-breaker', role: 'attacker', task: '审查设计方案，寻找潜在缺陷和风险点' },
            { name: '设计评审', agent: 'design-judge', role: 'judge', task: '综合蓝队方案和红队意见，给出评审结论和 verdict' },
          ],
          transitions: [
            { to: '实施', condition: { verdict: 'pass' }, priority: 1, label: '设计通过' },
            { to: '设计', condition: { verdict: 'conditional_pass' }, priority: 2, label: '需要修改' },
            { to: '设计', condition: { verdict: 'fail' }, priority: 3, label: '重新设计' },
          ],
        },
        {
          name: '实施',
          description: '执行实施任务，蓝队编码、红队审查、裁判验收',
          isInitial: false,
          isFinal: false,
          maxSelfTransitions: 3,
          position: { x: 400, y: 200 },
          steps: [
            { name: '编码实施', agent: 'developer', role: 'defender', task: '根据设计方案进行编码实施' },
            { name: '代码审查', agent: 'code-hunter', role: 'attacker', task: '审查代码实现，检查安全性、性能和代码质量' },
            { name: '实施评审', agent: 'code-judge', role: 'judge', task: '综合实施结果和审查意见，给出评审结论和 verdict' },
          ],
          transitions: [
            { to: '测试', condition: { verdict: 'pass' }, priority: 1, label: '实施完成' },
            { to: '实施', condition: { verdict: 'conditional_pass' }, priority: 2, label: '需要修改' },
            { to: '设计', condition: { verdict: 'fail' }, priority: 3, label: '设计有问题' },
          ],
        },
        {
          name: '测试',
          description: '执行测试验证，蓝队测试、红队攻击、裁判判定',
          isInitial: false,
          isFinal: false,
          maxSelfTransitions: 3,
          position: { x: 700, y: 200 },
          steps: [
            { name: '功能测试', agent: 'tester', role: 'defender', task: '编写并执行测试用例，验证功能正确性' },
            { name: '压力测试', agent: 'stress-tester', role: 'attacker', task: '进行边界测试和压力测试，寻找潜在问题' },
            { name: '测试评审', agent: 'code-judge', role: 'judge', task: '综合测试结果，给出最终评审结论和 verdict' },
          ],
          transitions: [
            { to: '完成', condition: { verdict: 'pass' }, priority: 1, label: '测试通过' },
            { to: '实施', condition: { verdict: 'conditional_pass' }, priority: 2, label: '需要修复' },
            { to: '设计', condition: { verdict: 'fail' }, priority: 3, label: '严重问题' },
          ],
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

    const { filename, workflowName, referenceWorkflow, workingDirectory, workspaceMode, description, mode, requirements } = validationResult.data;
    const workflowMode = mode || 'phase-based';

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
    let referenceConfig: any = null;

    if (referenceWorkflow) {
      const sourceMeta = await getConfigMeta(referenceWorkflow, 'workflow');
      if (sourceMeta?.visibility === 'private' && sourceMeta.createdBy && sourceMeta.createdBy !== auth.id && auth.role !== 'admin') {
        return NextResponse.json({ error: '无权限访问参考工作流' }, { status: 403 });
      }

      const referencePath = resolve(await getRuntimeConfigsDirPath(), normalizeConfigFilename(referenceWorkflow));
      const referenceRaw = await readFile(referencePath, 'utf-8');
      referenceConfig = parse(referenceRaw);
    }

    // AI 引导模式：调用 AI 生成接口
    if (configDraft) {
      defaultConfig = configDraft;
    } else if (referenceConfig) {
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

    const yamlContent = stringify(defaultConfig);
    await writeFile(filepath, yamlContent, 'utf-8');
    await setConfigMeta(filename, {
      createdBy: auth.id,
      visibility: 'private',
      createdAt: Date.now(),
    }, 'workflow');

    // Determine the generated mode for the response message
    const generatedMode = defaultConfig?.workflow?.mode === 'state-machine' ? 'state-machine' : 'phase-based';
    let message = '配置文件已创建';
    if (workflowMode === 'ai-guided') {
      message = generatedMode === 'state-machine'
        ? 'AI 已根据需求生成状态机工作流，请在设计页面调整状态和转移。'
        : 'AI 已根据需求生成阶段工作流，请在设计页面调整阶段和步骤。';
    }

    let creationSession = creationSessionId ? await loadCreationSession(creationSessionId) : null;
    if (creationSession?.createdBy && creationSession.createdBy !== auth.id) {
      return NextResponse.json({ error: '无权复用该创建态会话' }, { status: 403 });
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
        openSpec: {
          ...creationSession.openSpec,
          status: creationSession.openSpec.status === 'draft' ? 'confirmed' : creationSession.openSpec.status,
          confirmedAt: creationSession.openSpec.confirmedAt || new Date().toISOString(),
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
        openSpecStatus: 'confirmed',
        filename,
        workflowName,
        mode: workflowMode,
        workingDirectory,
        workspaceMode,
        description,
        requirements,
        referenceWorkflow,
        config: defaultConfig,
      });
      await saveCreationSession(creationSession);
    }
    if (!creationSession) {
      throw new Error('创建态会话生成失败');
    }
    if (frontendSessionId) {
      await updateChatSessionCreationBinding(frontendSessionId, {
        creationSessionId: creationSession.id,
        filename,
        workflowName,
        status: creationSession.status,
        openSpecId: creationSession.openSpec.id,
      });
    }

    return NextResponse.json({
      success: true,
      message: '配置文件已创建',
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
