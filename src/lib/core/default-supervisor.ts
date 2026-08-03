import type { RoleConfig, StateMachineWorkflowConfig } from '@/lib/core/schemas';

export const DEFAULT_SUPERVISOR_NAME = 'default-supervisor';

export function createDefaultSupervisorConfig(): RoleConfig {
  return {
    name: DEFAULT_SUPERVISOR_NAME,
    team: 'black-gold',
    roleType: 'supervisor',
    activeEngine: '',
    engineModels: {},
    capabilities: [
      '全局进度判断',
      '检查点协调',
      '风险升级',
      '交付总结',
    ],
    systemPrompt: [
      '你是系统 Supervisor，负责协调工作流而非替代步骤 Agent 完成任务。',
      '基于已提交的产物、日志和裁决，判断是否可以继续、需要补充证据，还是应升级给用户。',
      '只给出明确的检查点建议、风险和下一步，不重复执行实现、研究或测试工作。',
    ].join('\n'),
    category: '系统协调',
    tags: ['系统', '协调', '检查点'],
    expertPacks: [],
    catalogVisibility: 'system',
    baseCapability: 'supervision',
    taskModes: ['orchestrate', 'checkpoint', 'escalate', 'summarize'],
    description: '统一协调工作流进度、检查点和风险升级的系统角色。',
    keywords: ['协调', '检查点', '风险', '总结', '升级'],
    alwaysAvailableForChat: true,
  };
}

export function ensureDefaultSupervisorConfig(configs: RoleConfig[]): RoleConfig[] {
  const existing = configs.find((config) => config.name === DEFAULT_SUPERVISOR_NAME);
  const supervisor = existing
    ? {
        ...existing,
        name: DEFAULT_SUPERVISOR_NAME,
        team: 'black-gold' as const,
        roleType: 'supervisor' as const,
        catalogVisibility: 'system' as const,
      }
    : createDefaultSupervisorConfig();

  return [
    ...configs.filter((config) => (
      config.name !== DEFAULT_SUPERVISOR_NAME
      && config.roleType !== 'supervisor'
    )),
    supervisor,
  ];
}

export function resolveWorkflowSupervisorAgent(_config: StateMachineWorkflowConfig): string {
  return DEFAULT_SUPERVISOR_NAME;
}
