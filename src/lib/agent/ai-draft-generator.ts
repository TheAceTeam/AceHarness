import { createEngine, getConfiguredEngine, resolveRequestedEngineType, type EngineType } from '@/lib/engines/engine-factory';
import { executeEngineWithContextRecovery } from '@/lib/engines/context-recovery';
import { createDeterministicAvatarConfig } from '@/lib/agent/personas';
import { buildAgentCreationItemRepairPrompt, buildAgentDraftPrompt } from '@/lib/agent/ai-draft-prompt';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import {
  applyAgentCreationItem,
  assembleAgentClarificationForm,
  buildAgentConfigFromCreationState,
  createEmptyAgentCreationState,
  extractAgentCreationItemResult,
  AGENT_CLARIFICATION_FACTS_KIND,
  AGENT_CLARIFICATION_GAPS_KIND,
  AGENT_CLARIFICATION_QUESTION_KIND,
  AGENT_CLARIFICATION_SUMMARY_KIND,
  REQUIRED_AGENT_CREATION_ITEM_KINDS,
  type AgentCreationItemKind,
  type AgentCreationItemResult,
} from '@/lib/ai/agent-creation-items';
import {
  buildWorkflowExperiencePromptBlock,
  findRelevantWorkflowExperiences,
} from '@/lib/workflow/experience-store';
import {
  buildMemoryPromptBlock,
  listMemoryEntries,
} from '@/lib/workflow/memory-store';
import { getRuntimeConfigsDirPath } from '@/lib/run/runtime-configs';
import { listAgentRelationships } from '@/lib/agent/relationship-store';
import { formatValidationIssuesForResponse, validateAgentDraft } from '@/lib/core/creator-validation';
import type { ClarificationFormResult } from '@/lib/ai/result-normalizers';

export type AgentDraftRecommendation = {
  experiences: Array<{
    runId: string;
    workflowName?: string;
    configFile: string;
    summary: string;
  }>;
  referenceWorkflow: null | {
    filename: string;
    name?: string;
    description?: string;
    projectRoot?: string;
    agents: string[];
    phases: string[];
    states: string[];
  };
  relationshipHints: Array<{
    agent: string;
    counterpart: string;
    synergyScore: number;
    strengths: string[];
  }>;
};

export type AgentDraftStreamEvent =
  | { type: 'progress'; stage: string; message: string }
  | { type: 'delta'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'session'; sessionId: string }
  | { type: 'engine_error'; message: string }
  | { type: 'item'; item: AgentCreationItemResult }
  | { type: 'repair'; event: AgentDraftRepairEvent }
  | { type: 'validation'; validation: ReturnType<typeof formatValidationIssuesForResponse> };

export type AgentClarificationStreamEvent =
  | { type: 'progress'; stage: string; message: string }
  | { type: 'delta'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'session'; sessionId: string }
  | { type: 'engine_error'; message: string }
  | { type: 'item'; item: AgentCreationItemResult }
  | { type: 'form'; form: ClarificationFormResult }
  | { type: 'repair'; event: AgentDraftRepairEvent };

export type AgentDraftRepairEvent = {
  kind: AgentCreationItemKind;
  attempt: number;
  maxAttempts: number;
  reason: string;
  failedOutput: string;
  repairPrompt: string;
};

export type AgentDraftGenerationResult = {
  draft: any;
  raw: string;
  fallback?: boolean;
  items?: AgentCreationItemResult[];
  creationState?: any;
  repairEvents?: AgentDraftRepairEvent[];
  protocol?: string;
  initialRaw?: string;
  experienceHints?: any[];
  recommendations: AgentDraftRecommendation;
  validation: ReturnType<typeof formatValidationIssuesForResponse>;
  sessionId?: string | null;
};

type AgentDraftInput = {
  displayName?: string;
  team?: string;
  mission?: string;
  style?: string;
  specialties?: string;
  workingDirectory?: string;
  referenceWorkflow?: string;
  engine?: string;
  model?: string;
  mode?: 'create' | 'revise';
  baseAgent?: Record<string, any> | null;
  clarificationAnswers?: string;
  sessionId?: string | null;
};

type AgentClarificationInput = Pick<
  AgentDraftInput,
  'displayName' | 'team' | 'mission' | 'style' | 'specialties' | 'workingDirectory' | 'referenceWorkflow' | 'engine' | 'model' | 'sessionId'
> & {
  mode?: 'create' | 'revise';
  baseAgent?: Record<string, any> | null;
};

export type AgentClarificationGenerationResult = {
  form: ClarificationFormResult;
  raw: string;
  fallback?: boolean;
  sessionId?: string | null;
};

function inferDisplayNameFromMission(mission: string): string {
  const normalized = String(mission || '').replace(/\s+/g, ' ').trim();
  const headline = normalized.split(/[。！？!?；;\n]/)[0]?.trim() || normalized;
  return headline.slice(0, 18) || '新 Agent';
}

function mergeWithBaseAgent(baseAgent: Record<string, any> | null, draft: Record<string, any>) {
  if (!baseAgent) return draft;
  return {
    ...baseAgent,
    ...draft,
    name: baseAgent.name || draft.name,
    avatar: draft.avatar || baseAgent.avatar,
    engineModels: draft.engineModels && typeof draft.engineModels === 'object'
      ? draft.engineModels
      : (baseAgent.engineModels || {}),
    activeEngine: typeof draft.activeEngine === 'string' ? draft.activeEngine : (baseAgent.activeEngine || ''),
    tags: Array.from(new Set([...(baseAgent.tags || []), ...(draft.tags || [])].filter(Boolean))),
  };
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `agent-${Date.now()}`;
}

function fallbackDraft(input: {
  displayName: string;
  team?: string;
  mission: string;
  style?: string;
  specialties?: string;
  engine?: string;
  model?: string;
}) {
  const keywords = (input.specialties || '')
    .split(/[,\n，]/)
    .map((item) => item.trim())
    .filter(Boolean);

  const normalizedTeam = ['blue', 'red', 'judge', 'black-gold'].includes(input.team || '') ? input.team : 'red';

  return {
    name: slugify(input.displayName),
    team: normalizedTeam,
    roleType: input.team === 'black-gold' ? 'supervisor' : 'normal',
    avatar: createDeterministicAvatarConfig(input.displayName, {
      team: normalizedTeam as any,
      roleType: input.team === 'black-gold' ? 'supervisor' : 'normal',
    }),
    engineModels: input.engine && input.model ? { [input.engine]: input.model } : {},
    activeEngine: input.engine || '',
    capabilities: keywords.length > 0 ? keywords : [input.mission],
    systemPrompt: [
      `你是 ${input.displayName}，这是你在 ACEHarness 中的角色身份。`,
      '',
      '你的工作目标：',
      input.mission,
      '',
      `你的沟通风格：${input.style || '专业、直接、可靠'}`,
      '',
      '回答时保持清晰、务实、可执行。',
    ].join('\n'),
    description: input.mission,
    keywords,
    tags: ['AI创建', input.style || '默认风格'].filter(Boolean),
    category: '首页创建',
  };
}

function fallbackAgentClarification(input: {
  displayName: string;
  team: string;
  mission: string;
  specialties?: string;
  mode?: 'create' | 'revise';
}): ClarificationFormResult {
  const isRevise = input.mode === 'revise';
  return {
    type: 'clarification_form',
    summary: isRevise
      ? `需要先确认 ${input.displayName} 的修订目标、保留范围和验证方式。`
      : `需要先确认 ${input.displayName} 的职责边界、协作方式和交付标准。`,
    knownFacts: [
      input.displayName ? `角色名称：${input.displayName}` : '',
      input.team ? `建议阵营：${input.team}` : '',
      input.specialties ? `擅长领域：${input.specialties}` : '',
    ].filter(Boolean),
    missingFields: isRevise
      ? ['修订目标', '必须保留的现有能力', '验收标准']
      : ['职责边界', '协作对象', '成功标准'],
    questions: [
      {
        id: 'agent_responsibility',
        label: isRevise ? '修订目标' : '职责边界',
        question: isRevise ? '这次修订最希望强化哪一类能力？' : '这个 Agent 最核心的职责边界是什么？',
        selectionMode: 'single',
        options: [
          { id: 'execution', label: '执行推进', description: '偏实现、修复、补测试和落地交付。', recommended: input.team === 'red' || input.team === 'black-gold' },
          { id: 'review', label: '审查裁定', description: '偏复核、判定、风险归因和质量门禁。', recommended: input.team === 'judge' },
          { id: 'challenge', label: '挑战压测', description: '偏攻击、反例、边界条件和鲁棒性挑战。', recommended: input.team === 'blue' },
        ],
        placeholder: isRevise ? '例如：保持原修复能力，同时加强回归验证。' : '例如：只负责代码修复和回归验证，不负责需求裁定。',
        required: true,
      },
      {
        id: 'agent_collaboration',
        label: '协作关系',
        question: '它应该主要和哪些角色或工作流环节配合？',
        selectionMode: 'multiple',
        options: [
          { id: 'supervisor', label: 'Supervisor', description: '接收指挥官派发任务并回传结论。', recommended: true },
          { id: 'peer_agents', label: '同阵营 Agent', description: '与同阵营角色共享上下文、互补能力。' },
          { id: 'opposing_agents', label: '对抗阵营 Agent', description: '接受挑战、质疑或裁定反馈。' },
        ],
        placeholder: '例如：主要和 default-supervisor、judge-agent 配合。',
        required: true,
      },
      {
        id: 'agent_evidence',
        label: '验证证据',
        question: '它完成任务时应该输出哪类证据，方便工作流归档和裁定？',
        selectionMode: 'multiple',
        options: [
          { id: 'summary', label: '结论摘要', description: '稳定输出简洁结论和下一步建议。', recommended: true },
          { id: 'commands', label: '命令与结果', description: '记录执行过的命令、测试和关键输出。' },
          { id: 'files', label: '文件变更说明', description: '说明读写文件、改动范围和风险点。' },
        ],
        placeholder: '例如：每次必须输出结论、证据和未决风险。',
        required: false,
      },
    ],
  };
}

type AgentClarificationItemStep = {
  kind: AgentCreationItemKind;
  name: string;
  title: string;
  guidance: string;
};

function buildAgentClarificationItemExample(kind: AgentCreationItemKind, name: string): AgentCreationItemResult {
  if (kind === AGENT_CLARIFICATION_SUMMARY_KIND) {
    return {
      kind,
      data: {
        summary: '用 1-2 句概括当前 Agent 目标、阵营倾向和最大不确定性。',
      },
    };
  }
  if (kind === AGENT_CLARIFICATION_FACTS_KIND) {
    return {
      kind,
      data: {
        facts: ['已确认的角色目标', '已确认的运行环境或参考工作流'],
      },
    };
  }
  if (kind === AGENT_CLARIFICATION_GAPS_KIND) {
    return {
      kind,
      data: {
        gaps: ['blocking: 会影响职责边界的待确认信息', 'optional: 可后续补充的信息'],
      },
    };
  }
  if (kind === AGENT_CLARIFICATION_QUESTION_KIND) {
    return {
      kind,
      data: {
        id: name,
        label: '问题标签',
        question: '具体问题，并说明这个答案会影响什么决策。',
        selectionMode: 'single',
        options: [
          { id: 'recommended', label: '推荐选项', description: '说明默认方案和影响。', recommended: true },
          { id: 'alternative', label: '备选方案', description: '说明取舍。' },
        ],
        placeholder: '跳过时系统采用的保守假设。',
        required: true,
      },
    };
  }
  return {
    kind,
    data: {},
  };
}

function summarizeAgentClarificationStateForPrompt(state: ReturnType<typeof createEmptyAgentCreationState>): string {
  return JSON.stringify({
    clarification: state.clarification,
  }, null, 2).slice(0, 5000);
}

function buildAgentClarificationItemSystemPrompt(step: AgentClarificationItemStep, baseContext: string): string {
  return [
    '你正在 ACEHarness 的 Agent 创建引导中工作。',
    `当前小点名称：${step.name}`,
    `当前小点类型：${step.kind}`,
    '当前阶段只产出补充问答小点。',
    '请完成当前小点，并在回复末尾输出机器可读结果。',
    '机器可读结果必须放在 <result>...</result> 内，且 <result> 内只放一个裸 JSON 对象，不使用 Markdown 代码块。',
    `JSON 顶层固定为 {"kind":"${step.kind}","data":{...}}。`,
    '可以在 <result> 外用 1-3 句简短说明你的判断。',
    '输出 </result> 后结束回复。',
    '',
    '当前小点说明：',
    step.guidance,
    '',
    '格式示例：',
    '<result>',
    JSON.stringify(buildAgentClarificationItemExample(step.kind, step.name), null, 2),
    '</result>',
    '',
    '创建上下文：',
    baseContext,
  ].join('\n\n');
}

function buildAgentClarificationItemUserMessage(
  step: AgentClarificationItemStep,
  state: ReturnType<typeof createEmptyAgentCreationState>,
): string {
  return [
    `请生成小点：${step.title}`,
    `小点名称：${step.name}`,
    `小点类型：${step.kind}`,
    '',
    step.guidance,
    '',
    '系统已确认的小点：',
    '```json',
    summarizeAgentClarificationStateForPrompt(state),
    '```',
    '',
    '当前回复只包含当前小点；已确认小点作为上下文沿用。',
  ].filter(Boolean).join('\n');
}

function normalizeConfigFilename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error('无效工作流文件名');
  }
  return normalized;
}

function collectWorkflowAgents(referenceConfig: any): string[] {
  const names = new Set<string>();
  const phases = Array.isArray(referenceConfig?.workflow?.phases) ? referenceConfig.workflow.phases : [];
  const states = Array.isArray(referenceConfig?.workflow?.states) ? referenceConfig.workflow.states : [];

  for (const phase of phases) {
    for (const step of phase?.steps || []) {
      if (typeof step?.agent === 'string' && step.agent.trim()) names.add(step.agent.trim());
    }
  }
  for (const state of states) {
    for (const step of state?.steps || []) {
      if (typeof step?.agent === 'string' && step.agent.trim()) names.add(step.agent.trim());
    }
  }
  return Array.from(names);
}

function buildReferenceWorkflowPromptBlock(input: {
  referenceWorkflow?: string;
  referenceConfig?: any;
  relationshipHints: string[];
}): string {
  if (!input.referenceWorkflow || !input.referenceConfig) return '';

  const workflow = input.referenceConfig.workflow || {};
  const context = input.referenceConfig.context || {};
  const agentNames = collectWorkflowAgents(input.referenceConfig);
  const phaseNames = Array.isArray(workflow.phases) ? workflow.phases.map((phase: any) => phase?.name).filter(Boolean) : [];
  const stateNames = Array.isArray(workflow.states) ? workflow.states.map((state: any) => state?.name).filter(Boolean) : [];

  return [
    '## 参考工作流',
    `- 文件: ${input.referenceWorkflow}`,
    workflow.name ? `- 名称: ${workflow.name}` : '',
    workflow.description ? `- 描述: ${workflow.description}` : '',
    context.projectRoot ? `- 工程目录: ${context.projectRoot}` : '',
    phaseNames.length ? `- 阶段: ${phaseNames.slice(0, 6).join('、')}` : '',
    stateNames.length ? `- 状态: ${stateNames.slice(0, 6).join('、')}` : '',
    agentNames.length ? `- 已有角色: ${agentNames.slice(0, 10).join('、')}` : '',
    input.relationshipHints.length ? '- 相关协作关系:' : '',
    ...input.relationshipHints.map((line) => `  - ${line}`),
    '- 要求: 如果当前要创建的 Agent 与参考工作流中的角色职责接近，请复用其分工风格、命名粒度和能力边界；如果是补位角色，请避免与现有角色重复。',
  ].filter(Boolean).join('\n');
}

function buildDraftRecommendations(input: {
  relatedExperiences: Awaited<ReturnType<typeof findRelevantWorkflowExperiences>>;
  referenceWorkflow?: string;
  referenceConfig?: any;
  relationshipEntries: Array<{
    agent: string;
    counterpart: string;
    synergyScore: number;
    strengths: string[];
  }>;
}): AgentDraftRecommendation {
  const workflow = input.referenceConfig?.workflow || {};
  const context = input.referenceConfig?.context || {};

  return {
    experiences: input.relatedExperiences.slice(0, 3).map((entry) => ({
      runId: entry.runId,
      workflowName: entry.workflowName,
      configFile: entry.configFile,
      summary: entry.summary,
    })),
    referenceWorkflow: input.referenceWorkflow && input.referenceConfig ? {
      filename: input.referenceWorkflow,
      name: typeof workflow.name === 'string' ? workflow.name : undefined,
      description: typeof workflow.description === 'string' ? workflow.description : undefined,
      projectRoot: typeof context.projectRoot === 'string' ? context.projectRoot : undefined,
      agents: collectWorkflowAgents(input.referenceConfig).slice(0, 10),
      phases: Array.isArray(workflow.phases)
        ? workflow.phases.map((phase: any) => phase?.name).filter((value: unknown): value is string => typeof value === 'string').slice(0, 8)
        : [],
      states: Array.isArray(workflow.states)
        ? workflow.states.map((state: any) => state?.name).filter((value: unknown): value is string => typeof value === 'string').slice(0, 8)
        : [],
    } : null,
    relationshipHints: input.relationshipEntries.slice(0, 8),
  };
}

export async function generateAgentClarification(
  input: AgentClarificationInput,
  emit?: (event: AgentClarificationStreamEvent) => void,
): Promise<AgentClarificationGenerationResult> {
  const baseAgent = input.baseAgent && typeof input.baseAgent === 'object' ? input.baseAgent : null;
  const mode = input.mode === 'revise' || baseAgent ? 'revise' : 'create';
  const mission = String(input.mission || '').trim();
  const displayName = String(input.displayName || baseAgent?.name || '').trim() || inferDisplayNameFromMission(mission);
  const style = String(input.style || '').trim();
  const specialties = String(input.specialties || '').trim();
  const team = String(input.team || baseAgent?.team || 'red').trim();
  const workingDirectory = String(input.workingDirectory || '').trim();
  const referenceWorkflow = String(input.referenceWorkflow || '').trim();
  const requestedEngine = (input.engine || '') as EngineType | '';
  const requestedModel = String(input.model || '').trim();
  const requestedSessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';

  if (!mission) {
    throw Object.assign(new Error(mode === 'revise' ? '修订要求不能为空' : 'Agent 需求不能为空'), { status: 400 });
  }

  const fallback = fallbackAgentClarification({ displayName, team, mission, specialties, mode });
  const progress = (stage: string, message: string) => emit?.({ type: 'progress', stage, message });

  progress('engine', '正在准备补充问答生成引擎。');
  const engineType = requestedEngine
    ? await resolveRequestedEngineType(requestedEngine)
    : await getConfiguredEngine();
  const engine = await createEngine(engineType);
  if (!engine) {
    progress('fallback', '当前引擎不可用，已生成本地补充问答。');
    emit?.({ type: 'form', form: fallback });
    return {
      form: fallback,
      raw: JSON.stringify(fallback, null, 2),
      fallback: true,
      sessionId: null,
    };
  }

  const baseContext = [
    `模式：${mode === 'revise' ? '修订现有 Agent' : '创建新 Agent'}`,
    `显示名称：${displayName}`,
    `建议阵营：${team}`,
    `用户描述：${mission}`,
    style ? `风格关键词：${style}` : '',
    specialties ? `擅长领域：${specialties}` : '',
    workingDirectory ? `工作目录：${workingDirectory}` : '',
    referenceWorkflow ? `参考工作流：${referenceWorkflow}` : '',
    baseAgent ? `现有 Agent JSON：\n${JSON.stringify(baseAgent, null, 2).slice(0, 4000)}` : '',
  ].filter(Boolean).join('\n\n');
  const steps: AgentClarificationItemStep[] = [
    {
      kind: AGENT_CLARIFICATION_SUMMARY_KIND,
      name: 'current_understanding',
      title: '当前理解摘要',
      guidance: '用用户主语言概括当前 Agent 目标、阵营倾向、协作场景和最关键的不确定性。',
    },
    {
      kind: AGENT_CLARIFICATION_FACTS_KIND,
      name: 'confirmed_facts',
      title: '已确认事实',
      guidance: '列出 3-6 条已经从用户描述、默认配置或参考工作流中确认的信息；把每条事实写成字符串。',
    },
    {
      kind: AGENT_CLARIFICATION_GAPS_KIND,
      name: 'decision_gaps',
      title: '待补信息',
      guidance: '列出会影响职责边界、协作对象、输出证据、技能/模型约束或验收标准的缺口；用 blocking/optional 前缀标出优先级。',
    },
    {
      kind: AGENT_CLARIFICATION_QUESTION_KIND,
      name: 'responsibility_boundary',
      title: '澄清问题：职责边界',
      guidance: '生成一个关于 Agent 核心职责、明确不负责事项或成功标准的问题。id 固定为 responsibility_boundary，提供 2-4 个选项和默认推荐项。',
    },
    {
      kind: AGENT_CLARIFICATION_QUESTION_KIND,
      name: 'collaboration_context',
      title: '澄清问题：协作关系',
      guidance: '生成一个关于它主要服务的 workflow 环节、上游/下游 Agent 或对抗/裁定关系的问题。id 固定为 collaboration_context，selectionMode 可用 multiple。',
    },
    {
      kind: AGENT_CLARIFICATION_QUESTION_KIND,
      name: 'evidence_contract',
      title: '澄清问题：输出证据',
      guidance: '生成一个关于它完成任务时应归档哪些结论、命令、文件或风险证据的问题。id 固定为 evidence_contract。',
    },
    {
      kind: AGENT_CLARIFICATION_QUESTION_KIND,
      name: 'runtime_constraints',
      title: '澄清问题：运行约束',
      guidance: '生成一个关于模型、技能、读写权限、工具偏好或必须保留能力的问题。id 固定为 runtime_constraints，required 可以为 false。',
    },
  ];

  const streamChunks: string[] = [];
  let currentSessionId = requestedSessionId || '';
  const onStream = (event: any) => {
    if (!event) return;
    if ((event.type === 'text' || event.type === 'tool') && event.content) {
      streamChunks.push(event.content);
      emit?.({ type: 'delta', content: event.content });
    } else if (event.type === 'thought' && event.content) {
      emit?.({ type: 'thinking', content: event.content });
    } else if (event.type === 'session' && event.content) {
      currentSessionId = String(event.content);
      emit?.({ type: 'session', sessionId: currentSessionId });
    } else if (event.type === 'error' && event.content) {
      emit?.({ type: 'engine_error', message: event.content });
    }
  };
  engine.on('stream', onStream);

  try {
    const rawOutputs: string[] = [];
    const repairEvents: AgentDraftRepairEvent[] = [];
    const maxAttempts = 3;
    let state = createEmptyAgentCreationState();

    const runClarificationStep = async (
      step: AgentClarificationItemStep,
      message: string,
      attempt: number,
    ): Promise<{ result: AgentCreationItemResult; finalContent: string }> => {
      progress(step.kind, `AI 正在生成${step.title}。`);
      const streamStartIndex = streamChunks.length;
      const result = await executeEngineWithContextRecovery(engine, {
        agent: 'agent-creator',
        step: `agent-clarification-${step.name}`,
        prompt: message,
        systemPrompt: buildAgentClarificationItemSystemPrompt(step, baseContext),
        model: requestedModel,
        workingDirectory: workingDirectory || process.cwd(),
        sessionId: currentSessionId || undefined,
      });
      if (result.sessionId) {
        currentSessionId = result.sessionId;
        emit?.({ type: 'session', sessionId: currentSessionId });
      }
      const streamedOutput = streamChunks.slice(streamStartIndex).join('');
      const finalContent = result.output || streamedOutput;
      if (!streamedOutput && finalContent) {
        emit?.({ type: 'delta', content: finalContent });
      }
      const extraction = extractAgentCreationItemResult(finalContent, step.kind);
      if (extraction.ok) {
        return { result: extraction.result, finalContent };
      }
      if (attempt >= maxAttempts) {
        throw new Error(`${step.title} 连续 ${maxAttempts} 次后仍未返回合法结果：${extraction.error}`);
      }
      const repairPrompt = buildAgentCreationItemRepairPrompt({
        kind: step.kind,
        reason: extraction.error,
        displayName,
        team,
        mission,
        style,
        specialties,
        currentState: state,
      });
      const repairEvent = {
        kind: step.kind,
        attempt: attempt + 1,
        maxAttempts,
        reason: extraction.error,
        failedOutput: finalContent,
        repairPrompt,
      };
      repairEvents.push(repairEvent);
      emit?.({ type: 'repair', event: repairEvent });
      return runClarificationStep(step, repairPrompt, attempt + 1);
    };

    for (const step of steps) {
      const output = await runClarificationStep(
        step,
        buildAgentClarificationItemUserMessage(step, state),
        1,
      );
      rawOutputs.push(output.finalContent);
      state = applyAgentCreationItem(state, output.result);
      emit?.({ type: 'item', item: output.result });
      const partialForm = assembleAgentClarificationForm(state);
      if (partialForm.questions.length > 0 || partialForm.summary || partialForm.knownFacts.length || partialForm.missingFields.length) {
        emit?.({ type: 'form', form: partialForm });
      }
    }

    const form = assembleAgentClarificationForm(state);
    if (form.questions.length === 0) {
      throw new Error('补充问答小点已生成，但没有可展示的问题');
    }
    progress('done', '补充问答已生成。');
    return {
      form,
      raw: rawOutputs.join('\n\n'),
      sessionId: currentSessionId || null,
    };
  } finally {
    try { engine.off('stream', onStream); } catch {}
    engine.cancel();
  }
}

export async function generateAgentDraft(
  input: AgentDraftInput,
  emit?: (event: AgentDraftStreamEvent) => void,
): Promise<AgentDraftGenerationResult> {
  const baseAgent = input.baseAgent && typeof input.baseAgent === 'object' ? input.baseAgent : null;
  const mode = input.mode === 'revise' || baseAgent ? 'revise' : 'create';
  const mission = String(input.mission || '').trim();
  const displayName = String(input.displayName || baseAgent?.name || '').trim() || inferDisplayNameFromMission(mission);
  const style = String(input.style || '').trim();
  const specialties = String(input.specialties || '').trim();
  const team = String(input.team || baseAgent?.team || 'red').trim();
  const workingDirectory = String(input.workingDirectory || '').trim();
  const referenceWorkflow = String(input.referenceWorkflow || '').trim();
  const requestedEngine = (input.engine || '') as EngineType | '';
  const requestedModel = String(input.model || '').trim();
  const clarificationAnswers = String(input.clarificationAnswers || '').trim();
  const requestedSessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';

  if (!mission) {
    throw Object.assign(new Error(mode === 'revise' ? '修订要求不能为空' : 'Agent 需求不能为空'), { status: 400 });
  }

  const progress = (stage: string, message: string) => emit?.({ type: 'progress', stage, message });

  const systemPrompt = [
    '你是 ACEHarness Agent 创建助手。',
    '你的任务是把用户的角色需求整理成可解析的结构化 Agent 创建 item。',
    '机器结果统一使用 <result> 包裹，result 内是单个 JSON 对象，顶层包含 kind 和 data。',
    '自然语言说明保持简短，结构化字段使用用户输入语言。',
  ].join('\n');

  progress('context', '正在读取历史经验、项目记忆和参考工作流。');
  const relatedExperiences = await findRelevantWorkflowExperiences({
    requirements: [mission, specialties].filter(Boolean).join('\n'),
    projectRoot: workingDirectory || undefined,
    workflowName: displayName,
    limit: 3,
  }).catch(() => []);
  const projectMemories = workingDirectory
    ? await listMemoryEntries({
        scope: 'project',
        key: workingDirectory,
        limit: 3,
      }).catch(() => [])
    : [];

  let referenceConfig: any = null;
  if (referenceWorkflow) {
    try {
      const referencePath = resolve(await getRuntimeConfigsDirPath(), normalizeConfigFilename(referenceWorkflow));
      const referenceRaw = await readFile(referencePath, 'utf-8');
      referenceConfig = parse(referenceRaw);
    } catch {
      referenceConfig = null;
    }
  }

  const referenceAgents = referenceConfig ? collectWorkflowAgents(referenceConfig).slice(0, 6) : [];
  const relationshipEntries = (await Promise.all(
    referenceAgents.map(async (agentName) => {
      const relations = await listAgentRelationships(agentName, 3).catch(() => []);
      return relations
        .filter((item) => referenceAgents.includes(item.counterpart))
        .slice(0, 2)
        .map((item) => ({
          agent: agentName,
          counterpart: item.counterpart,
          synergyScore: item.synergyScore,
          strengths: item.strengths.slice(0, 2),
        }));
    })
  )).flat();
  const experienceBlock = buildWorkflowExperiencePromptBlock(relatedExperiences, '与当前角色职责相关的历史经验');
  const projectMemoryBlock = buildMemoryPromptBlock('当前工程的项目记忆', projectMemories, { maxItems: 3 });
  const referenceWorkflowBlock = buildReferenceWorkflowPromptBlock({
    referenceWorkflow,
    referenceConfig,
    relationshipHints: Array.from(new Set(
      relationshipEntries.map((item) => (
        `${item.agent} <-> ${item.counterpart} 协作倾向 ${item.synergyScore >= 0 ? '+' : ''}${item.synergyScore}${item.strengths.length ? `，强项：${item.strengths.join('；')}` : ''}`
      ))
    )).slice(0, 8),
  });
  const recommendations = buildDraftRecommendations({
    relatedExperiences,
    referenceWorkflow,
    referenceConfig,
    relationshipEntries,
  });

  const prompt = buildAgentDraftPrompt({
    displayName,
    team,
    mission: [
      mode === 'revise' ? '修订现有 Agent：' : '',
      mission,
      clarificationAnswers ? `\n\n补充问答：\n${clarificationAnswers}` : '',
      baseAgent ? `\n\n现有 Agent 基线 JSON：\n${JSON.stringify(baseAgent, null, 2).slice(0, 8000)}` : '',
      baseAgent ? '\n\n修订要求：以基线 Agent 为基础生成完整候选配置；默认沿用现有 name，只更新用户要求相关的职责、能力、约束、提示词、标签、阵营或模型配置。' : '',
    ].filter(Boolean).join(''),
    style,
    specialties,
    workingDirectory,
    referenceWorkflow,
    experienceBlock,
    projectMemoryBlock,
    referenceWorkflowBlock,
  });

  progress('engine', '正在准备生成引擎。');
  const engineType = requestedEngine
    ? await resolveRequestedEngineType(requestedEngine)
    : await getConfiguredEngine();
  const engine = await createEngine(engineType);
  if (!engine) {
    progress('fallback', '当前引擎不可用，已生成本地兜底草案。');
    const draft = mergeWithBaseAgent(
      baseAgent,
      fallbackDraft({ displayName, team, mission, style, specialties, engine: requestedEngine, model: requestedModel }),
    );
    const validation = validateAgentDraft(draft);
    emit?.({ type: 'validation', validation: formatValidationIssuesForResponse(validation) });
    return {
      draft: validation.normalized || draft,
      raw: JSON.stringify(draft, null, 2),
      fallback: true,
      experienceHints: relatedExperiences,
      recommendations,
      validation: formatValidationIssuesForResponse(validation),
      sessionId: null,
    };
  }

  const streamChunks: string[] = [];
  let currentSessionId = requestedSessionId || '';
  const onStream = (event: any) => {
    if (!event) return;
    if ((event.type === 'text' || event.type === 'tool') && event.content) {
      streamChunks.push(event.content);
      emit?.({ type: 'delta', content: event.content });
    } else if (event.type === 'thought' && event.content) {
      emit?.({ type: 'thinking', content: event.content });
    } else if (event.type === 'session' && event.content) {
      currentSessionId = String(event.content);
      emit?.({ type: 'session', sessionId: currentSessionId });
    } else if (event.type === 'error' && event.content) {
      emit?.({ type: 'engine_error', message: event.content });
    }
  };
  engine.on('stream', onStream);

  try {
    const rawOutputs: string[] = [];
    const repairEvents: AgentDraftRepairEvent[] = [];
    const maxAttempts = 3;

    const runAgentCreator = async (runPrompt: string, step: string, message: string) => {
      progress(step, message);
      const streamStartIndex = streamChunks.length;
      const result = await executeEngineWithContextRecovery(engine, {
        agent: 'agent-creator',
        step,
        prompt: runPrompt,
        systemPrompt,
        model: requestedModel,
        workingDirectory: workingDirectory || process.cwd(),
        sessionId: currentSessionId || undefined,
      });
      if (result.sessionId) {
        currentSessionId = result.sessionId;
        emit?.({ type: 'session', sessionId: currentSessionId });
      }
      const streamedOutput = streamChunks.slice(streamStartIndex).join('');
      const output = result.output || streamedOutput;
      if (!streamedOutput && output) {
        emit?.({ type: 'delta', content: output });
      }
      rawOutputs.push(output);
      return output;
    };

    let state = createEmptyAgentCreationState();
    const items: AgentCreationItemResult[] = [];
    const initialRaw = await runAgentCreator(prompt, 'draft-agent', 'AI 正在生成角色创建 item。');

    for (const kind of REQUIRED_AGENT_CREATION_ITEM_KINDS) {
      progress(`parse-${kind}`, `正在解析 ${kind}。`);
      let sourceRaw = rawOutputs.join('\n\n');
      let extraction = extractAgentCreationItemResult(sourceRaw, kind);
      let attempt = 1;
      while (!extraction.ok && attempt < maxAttempts) {
        attempt += 1;
        const repairPrompt = buildAgentCreationItemRepairPrompt({
          kind,
          reason: extraction.error,
          displayName,
          team,
          mission,
          style,
          specialties,
          currentState: state,
        });
        const repairEvent = {
          kind,
          attempt,
          maxAttempts,
          reason: extraction.error,
          failedOutput: sourceRaw,
          repairPrompt,
        };
        repairEvents.push(repairEvent);
        emit?.({ type: 'repair', event: repairEvent });
        sourceRaw = await runAgentCreator(repairPrompt, `repair-${kind}-${attempt}`, `${kind} 缺失或不合规，正在自动补齐。`);
        extraction = extractAgentCreationItemResult(sourceRaw, kind);
      }
      if (extraction.ok) {
        items.push(extraction.result);
        state = applyAgentCreationItem(state, extraction.result);
        emit?.({ type: 'item', item: extraction.result });
      }
    }

    progress('assemble', '正在装配 Agent 配置草案并运行校验。');
    let draft = mergeWithBaseAgent(baseAgent, buildAgentConfigFromCreationState({
      state,
      displayName,
      team,
      mission,
      style,
      specialties,
      engine: requestedEngine,
      model: requestedModel,
    }));

    let validation = validateAgentDraft(draft);
    let validationRepairAttempt = 1;
    while (!validation.ok && validationRepairAttempt < maxAttempts) {
      validationRepairAttempt += 1;
      const repairPrompt = buildAgentCreationItemRepairPrompt({
        kind: 'agent_config',
        reason: formatValidationIssuesForResponse(validation).issues
          .map((issue: any) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
          .join('\n'),
        displayName,
        team,
        mission,
        style,
        specialties,
        currentState: state,
      });
      const repairEvent = {
        kind: 'agent_config' as AgentCreationItemKind,
        attempt: validationRepairAttempt,
        maxAttempts,
        reason: 'Agent 配置校验需要补齐字段',
        failedOutput: JSON.stringify(draft, null, 2),
        repairPrompt,
      };
      repairEvents.push(repairEvent);
      emit?.({ type: 'repair', event: repairEvent });
      const repairRaw = await runAgentCreator(repairPrompt, `repair-agent-config-validation-${validationRepairAttempt}`, 'Agent 配置校验未通过，正在让 AI 补齐配置。');
      const repaired = extractAgentCreationItemResult(repairRaw, 'agent_config');
      if (repaired.ok) {
        items.push(repaired.result);
        state = applyAgentCreationItem(state, repaired.result);
        emit?.({ type: 'item', item: repaired.result });
        draft = mergeWithBaseAgent(baseAgent, buildAgentConfigFromCreationState({
          state,
          displayName,
          team,
          mission,
          style,
          specialties,
          engine: requestedEngine,
          model: requestedModel,
        }));
        validation = validateAgentDraft(draft);
      } else {
        break;
      }
    }

    const formattedValidation = formatValidationIssuesForResponse(validation);
    emit?.({ type: 'validation', validation: formattedValidation });
    progress('done', 'Agent 草案已生成。');

    return {
      draft: validation.normalized || draft,
      raw: rawOutputs.join('\n\n'),
      items,
      creationState: state,
      repairEvents,
      protocol: 'agent-creation-items',
      initialRaw,
      experienceHints: relatedExperiences,
      recommendations,
      validation: formattedValidation,
      sessionId: currentSessionId || null,
    };
  } finally {
    try { engine.off('stream', onStream); } catch {}
    engine.cancel();
  }
}
