export interface OfficeOrgClarificationOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface OfficeOrgClarificationQuestion {
  id: string;
  label: string;
  question: string;
  selectionMode: 'single' | 'multiple';
  options: OfficeOrgClarificationOption[];
  placeholder?: string;
  required?: boolean;
}

export interface OfficeOrgClarificationResult {
  type: 'office_org_clarification';
  summary: string;
  knownFacts: string[];
  missingFields: string[];
  questions: OfficeOrgClarificationQuestion[];
}

function normalizeRequirement(requirement: string): string {
  return requirement.trim().replace(/\s+/g, ' ');
}

export function createOfficeOrgClarification(input: {
  requirement?: string;
  availableAgentCount?: number;
}): OfficeOrgClarificationResult {
  const requirement = normalizeRequirement(input.requirement || '');
  const knownFacts = requirement ? [`目标：${requirement}`] : [];
  if (typeof input.availableAgentCount === 'number') {
    knownFacts.push(`当前可用 Agent 数量：${input.availableAgentCount}`);
  }

  return {
    type: 'office_org_clarification',
    summary: requirement
      ? `准备围绕「${requirement}」组织一人公司团队。`
      : '准备组织一人公司团队。',
    knownFacts,
    missingFields: ['目标产物', '首期范围', '团队规模', '用户参与方式', '是否允许创建新 Agent'],
    questions: [
      {
        id: 'deliverable',
        label: '目标产物',
        question: '这支团队第一阶段要交付什么？',
        selectionMode: 'single',
        required: true,
        options: [
          { id: 'app', label: 'App / 产品', description: '优先补齐产品、设计、工程和质量角色。', recommended: true },
          { id: 'automation', label: '自动化流程', description: '优先补齐工程、运营和质量角色。' },
          { id: 'content', label: '内容增长', description: '优先补齐增长、文案和运营角色。' },
        ],
        placeholder: '例如：先做一个可用的 MVP，并能快速迭代。',
      },
      {
        id: 'team_size',
        label: '团队规模',
        question: '你希望先组建多大的核心团队？',
        selectionMode: 'single',
        required: true,
        options: [
          { id: 'lean', label: '精简 4-6 人', description: '适合先跑通闭环。', recommended: true },
          { id: 'standard', label: '标准 6-8 人', description: '覆盖产品、设计、工程、质量、增长和决策。' },
          { id: 'large', label: '完整 8-12 人', description: '适合复杂目标和多线并行。' },
        ],
      },
      {
        id: 'user_role',
        label: '你的角色',
        question: '你希望自己在团队中承担什么位置？',
        selectionMode: 'single',
        required: true,
        options: [
          { id: 'ceo', label: '我做 CEO', description: 'AI 成员围绕你的决策协作。', recommended: true },
          { id: 'advisor', label: '我做顾问', description: 'AI 总裁负责日常协调，你做关键确认。' },
          { id: 'operator', label: '我做执行者', description: 'AI 负责规划，你参与具体交付。' },
        ],
      },
      {
        id: 'agent_policy',
        label: '成员来源',
        question: '如果现有 Agent 不够匹配，应该怎么处理？',
        selectionMode: 'single',
        required: true,
        options: [
          { id: 'existing_only', label: '只用现有 Agent', description: '先不创建新角色，缺口会标出来。', recommended: true },
          { id: 'suggest_new', label: '建议新 Agent', description: '草案里列出缺口和建议，但不自动创建。' },
          { id: 'allow_create', label: '允许创建 Agent', description: '后续确认后可进入创建 Agent 流程。' },
        ],
      },
    ],
  };
}
