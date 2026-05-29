import type {
  StateMachineState,
  UnifiedWorkflowConfig,
  WorkflowStep,
} from '@/lib/core/schemas';

export type DesignOptimizationWorkflowMode = 'phase-based' | 'state-machine';

export type DesignOptimizationTarget =
  | {
      scope: 'workflow';
      workflowMode: DesignOptimizationWorkflowMode;
      workflowName: string;
    }
  | {
      scope: 'step';
      workflowMode: DesignOptimizationWorkflowMode;
      containerType: 'phase' | 'state';
      containerIndex: number;
      containerName: string;
      stepIndex: number;
      stepName: string;
    }
  | {
      scope: 'state';
      workflowMode: 'state-machine';
      stateIndex: number;
      stateName: string;
    };

export type WorkflowPatchPayload = {
  filename?: string;
  summary?: string;
  scope?: DesignOptimizationTarget['scope'];
  workflowMode?: DesignOptimizationWorkflowMode;
  patch?: {
    workflow?: Record<string, any>;
    state?: StateMachineState | Record<string, any>;
    step?: WorkflowStep | Record<string, any>;
  };
};

type PromptAgentOption = {
  name: string;
  team?: string;
  roleType?: string;
  description?: string;
  capabilities?: string[];
};

type PromptSkillOption = {
  name: string;
  description?: string;
};

type PromptSpecTaskOption = {
  id: string;
  title: string;
  phaseTitle?: string;
  ownerAgents?: string[];
};

type BuildDesignOptimizationPromptInput = {
  target: DesignOptimizationTarget;
  workflowName: string;
  configFile: string;
  instruction: string;
  currentConfig: UnifiedWorkflowConfig | Record<string, any>;
  currentSpecArtifacts: {
    requirements: string;
    design: string;
    tasks: string;
  };
  requirements?: string;
  availableAgents?: PromptAgentOption[];
  availableSkills?: PromptSkillOption[];
  specTasks?: PromptSpecTaskOption[];
};

const PRESERVED_CONTEXT_KEYS = [
  'projectRoot',
  'workspaceMode',
  'requirements',
  'timeoutMinutes',
  'engine',
  'executionPolicy',
  'skills',
  'mcpServers',
];

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function truncateForPrompt(value: string, maxChars: number): string {
  const text = String(value || '');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...(truncated)...` : text;
}

function stringifyForPrompt(value: unknown, maxChars: number): string {
  return truncateForPrompt(JSON.stringify(value, null, 2), maxChars);
}

function formatAgentList(agents: PromptAgentOption[]): string {
  return agents
    .slice(0, 24)
    .map((agent) => {
      const parts = [
        agent.name,
        agent.team || '',
        agent.roleType || '',
        agent.description || '',
        Array.isArray(agent.capabilities) && agent.capabilities.length > 0
          ? `capabilities=${agent.capabilities.slice(0, 5).join(', ')}`
          : '',
      ].filter(Boolean);
      return `- ${parts.join(' | ')}`;
    })
    .join('\n');
}

function formatSkillList(skills: PromptSkillOption[]): string {
  return skills
    .slice(0, 24)
    .map((skill) => `- ${skill.name}${skill.description ? ` | ${skill.description}` : ''}`)
    .join('\n');
}

function formatSpecTaskList(tasks: PromptSpecTaskOption[]): string {
  return tasks
    .slice(0, 36)
    .map((task) => {
      const owners = Array.isArray(task.ownerAgents) && task.ownerAgents.length > 0
        ? ` | owners=${task.ownerAgents.join(', ')}`
        : '';
      return `- ${task.id} | ${task.title}${task.phaseTitle ? ` | ${task.phaseTitle}` : ''}${owners}`;
    })
    .join('\n');
}

export function getWorkflowMode(config: UnifiedWorkflowConfig | Record<string, any>): DesignOptimizationWorkflowMode {
  return (config as any)?.workflow?.mode === 'state-machine' ? 'state-machine' : 'phase-based';
}

export function getDesignOptimizationTargetLabel(target: DesignOptimizationTarget): string {
  if (target.scope === 'workflow') return `工作流 ${target.workflowName}`;
  if (target.scope === 'state') return `状态 ${target.stateName}`;
  return `${target.containerType === 'state' ? '状态' : '阶段'} ${target.containerName} / 步骤 ${target.stepName}`;
}

export function getDesignOptimizationDialogTitle(target: DesignOptimizationTarget): string {
  if (target.scope === 'workflow') return 'AI 修订工作流';
  if (target.scope === 'state') return 'AI 优化状态';
  return 'AI 优化步骤';
}

export function getDesignOptimizationScopeHint(target: DesignOptimizationTarget): string {
  if (target.scope === 'workflow') {
    return '基于最新 Spec 生成 workflow 级 patch，只替换 workflow 本体，先看 diff，再应用。';
  }
  if (target.scope === 'state') {
    return '只生成当前状态的 patch，允许调整状态描述、内部步骤和转移，不直接改动其他状态。';
  }
  return '只生成当前步骤的 patch，允许优化 agent、任务、约束、skills 与 spec 绑定，不直接改动其他节点。';
}

export function extractDesignOptimizationSnapshot(
  config: UnifiedWorkflowConfig | Record<string, any>,
  target: DesignOptimizationTarget,
): any | null {
  const workflow = (config as any)?.workflow || {};
  if (target.scope === 'workflow') return cloneValue(workflow);
  if (target.scope === 'state') {
    const state = Array.isArray(workflow.states) ? workflow.states[target.stateIndex] : null;
    return state ? cloneValue(state) : null;
  }
  const containers = target.containerType === 'state'
    ? (Array.isArray(workflow.states) ? workflow.states : [])
    : (Array.isArray(workflow.phases) ? workflow.phases : []);
  const container = containers[target.containerIndex];
  const step = Array.isArray(container?.steps) ? container.steps[target.stepIndex] : null;
  return step ? cloneValue(step) : null;
}

function preserveBaseContext(
  baseConfig: Record<string, any>,
  nextConfig: Record<string, any>,
): Record<string, any> {
  const baseContext = baseConfig?.context && typeof baseConfig.context === 'object' ? baseConfig.context : {};
  const nextContext = nextConfig?.context && typeof nextConfig.context === 'object' ? nextConfig.context : {};
  const mergedContext = {
    ...baseContext,
    ...nextContext,
  };
  for (const key of PRESERVED_CONTEXT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(baseContext, key)) {
      mergedContext[key] = cloneValue(baseContext[key]);
    }
  }
  return mergedContext;
}

export function doesWorkflowPatchMatchTarget(
  payload: WorkflowPatchPayload | null | undefined,
  target: DesignOptimizationTarget,
  baseConfig?: UnifiedWorkflowConfig | Record<string, any> | null,
): boolean {
  if (!payload) return false;
  if (payload.scope && payload.scope !== target.scope) return false;
  const expectedMode = baseConfig ? getWorkflowMode(baseConfig) : target.workflowMode;
  if (payload.workflowMode && payload.workflowMode !== expectedMode) return false;
  return true;
}

export function extractWorkflowPatchValue(
  payload: WorkflowPatchPayload | null | undefined,
  target: DesignOptimizationTarget,
): Record<string, any> | null {
  const patch = payload?.patch;
  if (!patch || typeof patch !== 'object') return null;
  if (target.scope === 'workflow') {
    return patch.workflow && typeof patch.workflow === 'object' ? cloneValue(patch.workflow) : null;
  }
  if (target.scope === 'state') {
    return patch.state && typeof patch.state === 'object' ? cloneValue(patch.state as Record<string, any>) : null;
  }
  return patch.step && typeof patch.step === 'object' ? cloneValue(patch.step as Record<string, any>) : null;
}

function patchStepIntoConfig(
  baseConfig: Record<string, any>,
  stepPatch: Record<string, any>,
  target: Extract<DesignOptimizationTarget, { scope: 'step' }>,
): Record<string, any> | null {
  const nextConfig = cloneValue(baseConfig);
  const nextWorkflow = nextConfig?.workflow || {};
  const nextContainers = target.containerType === 'state'
    ? (Array.isArray(nextWorkflow.states) ? nextWorkflow.states : [])
    : (Array.isArray(nextWorkflow.phases) ? nextWorkflow.phases : []);
  const nextContainer = nextContainers[target.containerIndex];
  if (!nextContainer || !Array.isArray(nextContainer.steps) || !nextContainer.steps[target.stepIndex]) return null;
  nextContainer.steps[target.stepIndex] = cloneValue(stepPatch);
  nextConfig.workflow = nextWorkflow;
  nextConfig.context = preserveBaseContext(baseConfig, nextConfig);
  if (Object.prototype.hasOwnProperty.call(baseConfig, 'roles')) nextConfig.roles = cloneValue(baseConfig.roles);
  return nextConfig;
}

function patchStateIntoConfig(
  baseConfig: Record<string, any>,
  statePatch: Record<string, any>,
  target: Extract<DesignOptimizationTarget, { scope: 'state' }>,
): Record<string, any> | null {
  const nextConfig = cloneValue(baseConfig);
  const nextStates = Array.isArray(nextConfig?.workflow?.states) ? nextConfig.workflow.states : [];
  if (!nextStates[target.stateIndex]) return null;
  nextStates[target.stateIndex] = cloneValue(statePatch);
  nextConfig.context = preserveBaseContext(baseConfig, nextConfig);
  if (Object.prototype.hasOwnProperty.call(baseConfig, 'roles')) nextConfig.roles = cloneValue(baseConfig.roles);
  return nextConfig;
}

function replaceWorkflowInConfig(
  baseConfig: Record<string, any>,
  workflowPatch: Record<string, any>,
): Record<string, any> | null {
  const nextConfig = cloneValue(baseConfig);
  nextConfig.workflow = cloneValue(workflowPatch);
  nextConfig.context = preserveBaseContext(baseConfig, nextConfig);
  if (Object.prototype.hasOwnProperty.call(baseConfig, 'roles')) nextConfig.roles = cloneValue(baseConfig.roles);
  return nextConfig;
}

export function applyDesignOptimizationPatch(
  baseConfig: UnifiedWorkflowConfig | Record<string, any>,
  payload: WorkflowPatchPayload | null | undefined,
  target: DesignOptimizationTarget,
): Record<string, any> | null {
  if (!doesWorkflowPatchMatchTarget(payload, target, baseConfig)) return null;
  const patchValue = extractWorkflowPatchValue(payload, target);
  if (!patchValue) return null;
  const base = cloneValue(baseConfig as Record<string, any>);
  if (target.scope === 'workflow') {
    return replaceWorkflowInConfig(base, patchValue);
  }
  if (target.scope === 'state') {
    return patchStateIntoConfig(base, patchValue, target);
  }
  return patchStepIntoConfig(base, patchValue, target);
}

function buildScopeRules(target: DesignOptimizationTarget): string[] {
  if (target.scope === 'workflow') {
    return [
      '- 允许根据最新 Spec 调整阶段/状态、步骤拆分、Agent 分工、状态转移与 specTaskBinding。',
      '- 只输出 workflow 级 patch；不要输出完整 config，也不要修改 context.projectRoot、workspaceMode、executionPolicy、skills、mcpServers 等运行时设置。',
      '- 不要移除已有的 preCommands、并发分组、人工审查和 supervisor 配置，除非用户要求或最新 Spec 明确冲突。',
    ];
  }
  if (target.scope === 'state') {
    return [
      `- 只优化状态 "${target.stateName}"；不要修改其他状态。`,
      `- 保持状态名称 "${target.stateName}" 不变。`,
      '- 可以调整该状态的描述、内部步骤、skills、Agent 选择、人工审查、最大自循环次数和转移规则。',
      '- 只输出这个状态对象的 patch；不要输出完整 workflow/config，不要修改 workflow mode、其他状态顺序、context 或运行时设置。',
    ];
  }
  return [
    `- 只优化 ${target.containerType === 'state' ? '状态' : '阶段'} "${target.containerName}" 内的步骤 "${target.stepName}"；不要修改其他步骤。`,
    `- 保持该步骤在容器中的位置不变。`,
    '- 可以调整步骤的 agent、task、constraints、skills、enableReviewPanel 与 specTaskBinding。',
    '- 只输出这个步骤对象的 patch；不要输出完整 workflow/config，不要修改其他步骤、容器内容或 workflow mode。',
  ];
}

function buildPatchSchemaHint(target: DesignOptimizationTarget, configFile: string): string {
  const targetShape = target.scope === 'workflow'
    ? `"scope":"workflow","workflowMode":"${target.workflowMode}","patch":{"workflow":{完整 workflow 对象}}`
    : target.scope === 'state'
      ? `"scope":"state","workflowMode":"state-machine","patch":{"state":{完整状态对象}}`
      : `"scope":"step","workflowMode":"${target.workflowMode}","patch":{"step":{完整步骤对象}}`;
  return `{"kind":"workflow_patch","payload":{"filename":"${configFile}","summary":"一句话摘要",${targetShape}}}`;
}

export function buildDesignOptimizationPrompt(input: BuildDesignOptimizationPromptInput): string {
  const targetSnapshot = extractDesignOptimizationSnapshot(input.currentConfig, input.target);
  const workflowMode = getWorkflowMode(input.currentConfig);
  const lines = [
    '请基于当前最新 Spec 和当前工作流配置，生成一版工作流优化候选。',
    '你只生成候选 patch，不要声称已经保存；系统会先展示 diff，由用户确认后再应用。',
    '最终必须返回 workflow_patch，不要返回完整 workflow_draft。',
    '',
    `当前优化目标：${getDesignOptimizationTargetLabel(input.target)}`,
    `工作流：${input.workflowName}`,
    `配置文件：${input.configFile}`,
    `工作流模式：${workflowMode}`,
    input.requirements ? `原始需求：${input.requirements}` : '',
    '',
    '范围规则：',
    ...buildScopeRules(input.target),
    '- 如果需要引用 spec 任务，specTaskBinding.taskIds 只能使用下面列出的真实 task id。',
    '- 保持现有主语言、术语和重要命名风格一致。',
    '',
    '用户优化要求：',
    input.instruction.trim(),
    '',
    '当前目标快照：',
    '```json',
    stringifyForPrompt(targetSnapshot, input.target.scope === 'workflow' ? 18000 : 12000),
    '```',
    '',
    '当前完整 workflow 配置：',
    '```json',
    stringifyForPrompt(input.currentConfig, 24000),
    '```',
    '',
    '当前 requirements.md：',
    '```markdown',
    truncateForPrompt(input.currentSpecArtifacts.requirements, 12000),
    '```',
    '',
    '当前 design.md：',
    '```markdown',
    truncateForPrompt(input.currentSpecArtifacts.design, 12000),
    '```',
    '',
    '当前 tasks.md：',
    '```markdown',
    truncateForPrompt(input.currentSpecArtifacts.tasks, 12000),
    '```',
  ];

  if (input.availableAgents && input.availableAgents.length > 0) {
    lines.push('', '可用 Agent：', formatAgentList(input.availableAgents));
  }

  if (input.availableSkills && input.availableSkills.length > 0) {
    lines.push('', '可用 Skills：', formatSkillList(input.availableSkills));
  }

  if (input.specTasks && input.specTasks.length > 0) {
    lines.push('', '当前可绑定的叶子 Spec 任务：', formatSpecTaskList(input.specTasks));
  }

  lines.push(
    '',
    '输出要求：',
    '1. 可以先用 1-3 句简短说明优化思路。',
    '2. 最终必须在 <result>...</result> 内输出一个 JSON 对象，不要包 ```json 代码块。',
    `3. JSON 格式必须是 ${buildPatchSchemaHint(input.target, input.configFile)}。`,
    '4. patch 必须只包含当前目标作用域对应的对象，不要夹带完整 config/context。',
    '5. 输出 </result> 后不要追加任何文字。',
  );

  return lines.filter(Boolean).join('\n\n');
}

export function workflowOptimizationModesMatch(
  baseConfig: UnifiedWorkflowConfig | Record<string, any>,
  payload: WorkflowPatchPayload | null | undefined,
  target?: DesignOptimizationTarget,
): boolean {
  const expectedMode = target?.workflowMode || getWorkflowMode(baseConfig);
  const actualMode = payload?.workflowMode || expectedMode;
  return expectedMode === actualMode;
}

export function extractWorkflowStepAt(
  config: UnifiedWorkflowConfig | Record<string, any>,
  target: Extract<DesignOptimizationTarget, { scope: 'step' }>,
): WorkflowStep | null {
  const snapshot = extractDesignOptimizationSnapshot(config, target);
  return snapshot && typeof snapshot === 'object' ? (snapshot as WorkflowStep) : null;
}

export function extractWorkflowStateAt(
  config: UnifiedWorkflowConfig | Record<string, any>,
  target: Extract<DesignOptimizationTarget, { scope: 'state' }>,
): StateMachineState | null {
  const snapshot = extractDesignOptimizationSnapshot(config, target);
  return snapshot && typeof snapshot === 'object' ? (snapshot as StateMachineState) : null;
}
