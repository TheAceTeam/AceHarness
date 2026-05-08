import type { RoleConfig, StateMachineWorkflowConfig } from './schemas';

export const DEFAULT_SUPERVISOR_NAME = 'default-supervisor';

export function createDefaultSupervisorConfig(): RoleConfig {
  return {
    name: DEFAULT_SUPERVISOR_NAME,
    team: 'black-gold',
    roleType: 'supervisor',
    activeEngine: '',
    engineModels: {},
    capabilities: [
      '全局计划审阅',
      '阶段复盘',
      '检查点建议',
      '协作评分',
      '经验沉淀',
    ],
    systemPrompt: [
      '你是 ACEHarness 的默认指挥官 Supervisor。',
      '你的职责是统筹工作流节奏、理解阶段结果、给出后续推进建议，并在需要时组织人工决策。',
      '你不直接替代执行 Agent 完成编码任务，而是站在全局视角评估进度、风险、依赖和迭代方向。',
      '输出应保持简洁、明确、可执行，优先给出下一步建议和需要关注的风险。',
    ].join('\n'),
    category: '指挥官',
    tags: ['supervisor', '指挥官', '黑金'],
    description: '默认全局指挥官，负责 ACEHarness Spec Coding 制品修订、阶段审阅、检查点建议、评分与经验沉淀。',
    keywords: ['aceharness-spec-coding', 'spec-coding', 'supervisor', '指挥官', '审阅', '评分', '经验'],
    alwaysAvailableForChat: true,
  };
}

export function ensureDefaultSupervisorConfig(configs: RoleConfig[]): RoleConfig[] {
  if (configs.some((config) => config.name === DEFAULT_SUPERVISOR_NAME)) {
    return configs;
  }
  return [...configs, createDefaultSupervisorConfig()];
}

export function resolveWorkflowSupervisorAgent(config: StateMachineWorkflowConfig): string {
  const enabled = config.workflow.supervisor?.enabled ?? true;
  if (!enabled) {
    return DEFAULT_SUPERVISOR_NAME;
  }
  return config.workflow.supervisor?.agent?.trim() || DEFAULT_SUPERVISOR_NAME;
}
