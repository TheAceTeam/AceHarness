import { createDeterministicAvatarConfig } from '@/lib/agent-personas';

export type AgentDraftTeam = 'blue' | 'red' | 'judge' | 'yellow' | 'black-gold';

export type AgentDraftState = {
  displayName: string;
  team: AgentDraftTeam;
  mission: string;
  style: string;
  specialties: string;
  canCode: 'yes' | 'no';
  canSupervise: 'yes' | 'no';
  workingDirectory?: string;
  referenceWorkflow?: string;
};

type AgentDraftPreviewInput = {
  engine: string;
  model: string;
  draft: AgentDraftState;
  existingDraft?: Record<string, any> | null;
};

export function createInitialAgentDraft(overrides?: Partial<AgentDraftState>): AgentDraftState {
  return {
    displayName: '',
    team: 'blue',
    mission: '',
    style: '理性、可靠、执行力强',
    specialties: '',
    canCode: 'yes',
    canSupervise: 'no',
    workingDirectory: '',
    referenceWorkflow: '',
    ...overrides,
  };
}

export function normalizeAgentDraft(input?: Partial<AgentDraftState> | null): AgentDraftState {
  return createInitialAgentDraft({
    displayName: input?.displayName || '',
    team: input?.team || 'blue',
    mission: input?.mission || '',
    style: input?.style || '理性、可靠、执行力强',
    specialties: input?.specialties || '',
    canCode: input?.canCode === 'no' ? 'no' : 'yes',
    canSupervise: input?.canSupervise === 'yes' ? 'yes' : 'no',
    workingDirectory: input?.workingDirectory || '',
    referenceWorkflow: input?.referenceWorkflow || '',
  });
}

export function mergeAgentDraft(input: AgentDraftState, patch?: Partial<AgentDraftState> | null): AgentDraftState {
  return normalizeAgentDraft({
    ...input,
    ...patch,
  });
}

export function extractAgentDraftCapabilities(specialties: string): string[] {
  return specialties
    .split(/[,\n，]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function buildAgentSystemPrompt(form: Pick<AgentDraftState, 'displayName' | 'mission' | 'style' | 'specialties'>): string {
  const specialties = extractAgentDraftCapabilities(form.specialties);

  const lines = [
    `你是 ${form.displayName}，这是你在 ACEHarness 中的角色身份。`,
    '',
    '你的工作目标：',
    form.mission || '负责通用协作与问题推进。',
    '',
    `你的沟通风格：${form.style || '专业、直接、可靠'}`,
  ];

  if (specialties.length > 0) {
    lines.push('', '你的擅长领域：', ...specialties.map((item) => `- ${item}`));
  }

  lines.push('', '回答时保持清晰、务实、可执行。');
  return lines.join('\n');
}

export function buildAgentDraftPreview({
  engine,
  model,
  draft,
  existingDraft,
}: AgentDraftPreviewInput): Record<string, any> | null {
  if (existingDraft) return existingDraft;
  if (!draft.displayName.trim()) return null;

  const capabilities = extractAgentDraftCapabilities(draft.specialties);
  const team = draft.canSupervise === 'yes' ? 'black-gold' : draft.team;
  const roleType = draft.canSupervise === 'yes' ? 'supervisor' : 'normal';

  return {
    name: draft.displayName.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-').replace(/^-+|-+$/g, ''),
    team,
    roleType,
    avatar: createDeterministicAvatarConfig(draft.displayName.trim(), { team, roleType }),
    engineModels: engine && model ? { [engine]: model } : {},
    activeEngine: engine || '',
    capabilities: capabilities.length > 0 ? capabilities : [draft.mission || '通用协作'],
    systemPrompt: '',
    description: draft.mission || '等待 AI 生成角色草案',
    category: 'AI创建',
    tags: ['AI创建', draft.style].filter(Boolean),
    keywords: capabilities,
  };
}
