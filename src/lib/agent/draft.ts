import { createDeterministicAvatarConfig } from '@/lib/agent/personas';

export type AgentDraftTeam = 'blue' | 'red' | 'judge' | 'black-gold';

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

const AGENT_DRAFT_TEAMS: AgentDraftTeam[] = ['blue', 'red', 'judge', 'black-gold'];
const DEFAULT_AGENT_DRAFT_STATE: AgentDraftState = {
  displayName: '',
  team: 'red',
  mission: '',
  style: '理性、可靠、执行力强',
  specialties: '',
  canCode: 'yes',
  canSupervise: 'no',
  workingDirectory: '',
  referenceWorkflow: '',
};

type AgentDraftPreviewInput = {
  engine: string;
  model: string;
  draft: AgentDraftState;
  existingDraft?: Record<string, any> | null;
};

function coerceText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return value
      .map((item) => coerceText(item))
      .filter((item): item is string => Boolean(item))
      .join('，');
  }
  return undefined;
}

export function formatAgentDraftText(value: unknown, fallback = ''): string {
  const text = coerceText(value);
  if (text !== undefined) return text;
  if (value && typeof value === 'object') {
    const candidate = value as { seed?: unknown; name?: unknown; label?: unknown; style?: unknown; mode?: unknown };
    return coerceText(candidate.seed)
      || coerceText(candidate.name)
      || coerceText(candidate.label)
      || coerceText(candidate.style)
      || coerceText(candidate.mode)
      || fallback;
  }
  return fallback;
}

function normalizeTeam(value: unknown, fallback?: AgentDraftTeam): AgentDraftTeam | undefined {
  return AGENT_DRAFT_TEAMS.includes(value as AgentDraftTeam) ? value as AgentDraftTeam : fallback;
}

function normalizeYesNo(value: unknown, fallback?: 'yes' | 'no'): 'yes' | 'no' | undefined {
  if (value === 'yes' || value === 'no') return value;
  return fallback;
}

function normalizeTextList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => formatAgentDraftText(item).trim())
      .filter(Boolean);
  }
  const single = formatAgentDraftText(value).trim();
  return single ? [single] : [];
}

function normalizePlainObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function normalizeAgentDraftPatch(input?: Partial<AgentDraftState> | null): Partial<AgentDraftState> {
  if (!input || typeof input !== 'object') return {};
  const source = input as Record<string, unknown>;
  const patch: Partial<AgentDraftState> = {};
  const textFields: Array<keyof Pick<AgentDraftState, 'displayName' | 'mission' | 'style' | 'specialties' | 'workingDirectory' | 'referenceWorkflow'>> = [
    'displayName',
    'mission',
    'style',
    'specialties',
    'workingDirectory',
    'referenceWorkflow',
  ];

  for (const field of textFields) {
    if (source[field] === undefined) continue;
    const text = coerceText(source[field]);
    if (text !== undefined) patch[field] = text;
  }

  const team = normalizeTeam(source.team);
  if (team) patch.team = team;

  const canCode = normalizeYesNo(source.canCode);
  if (canCode) patch.canCode = canCode;

  const canSupervise = normalizeYesNo(source.canSupervise);
  if (canSupervise) patch.canSupervise = canSupervise;

  return patch;
}

function slugifyAgentName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    || 'agent';
}

export function normalizeAgentDraftPreview(
  input?: Record<string, any> | null,
  fallback?: {
    engine?: string;
    model?: string;
    draft?: Partial<AgentDraftState> | null;
  }
): Record<string, any> | null {
  if (!input || typeof input !== 'object') return null;

  const draft = normalizeAgentDraft(fallback?.draft || null);
  const team = normalizeTeam(input.team, draft.canSupervise === 'yes' ? 'black-gold' : draft.team) || 'red';
  const roleType = input.roleType === 'supervisor' || team === 'black-gold' ? 'supervisor' : 'normal';
  const name = formatAgentDraftText(input.name).trim()
    || slugifyAgentName(draft.displayName)
    || 'agent';
  const capabilities = normalizeTextList(input.capabilities);
  const tags = normalizeTextList(input.tags);
  const keywords = normalizeTextList(input.keywords);
  const engineModels = normalizePlainObject(input.engineModels);

  return {
    ...input,
    name,
    team,
    roleType,
    avatar: input.avatar,
    engineModels,
    activeEngine: formatAgentDraftText(input.activeEngine, fallback?.engine || ''),
    capabilities: capabilities.length > 0 ? capabilities : [draft.mission || '通用协作'],
    systemPrompt: formatAgentDraftText(input.systemPrompt),
    description: formatAgentDraftText(input.description, draft.mission || '等待 AI 生成角色草案'),
    category: formatAgentDraftText(input.category, 'AI创建'),
    tags: tags.length > 0 ? tags : ['AI创建', draft.style].filter(Boolean),
    keywords,
  };
}

export function createInitialAgentDraft(overrides?: Partial<AgentDraftState>): AgentDraftState {
  return {
    ...DEFAULT_AGENT_DRAFT_STATE,
    ...normalizeAgentDraftPatch(overrides),
  };
}

export function normalizeAgentDraft(input?: Partial<AgentDraftState> | null): AgentDraftState {
  return createInitialAgentDraft(input || undefined);
}

export function mergeAgentDraft(input: AgentDraftState, patch?: Partial<AgentDraftState> | null): AgentDraftState {
  return {
    ...normalizeAgentDraft(input),
    ...normalizeAgentDraftPatch(patch),
  };
}

export function extractAgentDraftCapabilities(specialties: string): string[] {
  return formatAgentDraftText(specialties)
    .split(/[,\n，]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function buildAgentSystemPrompt(form: Pick<AgentDraftState, 'displayName' | 'mission' | 'style' | 'specialties'>): string {
  const displayName = formatAgentDraftText(form.displayName);
  const mission = formatAgentDraftText(form.mission);
  const style = formatAgentDraftText(form.style);
  const specialties = extractAgentDraftCapabilities(formatAgentDraftText(form.specialties));

  const lines = [
    `你是 ${displayName}，这是你在 ACEHarness 中的角色身份。`,
    '',
    '你的工作目标：',
    mission || '负责通用协作与问题推进。',
    '',
    `你的沟通风格：${style || '专业、直接、可靠'}`,
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
  const normalizedDraft = normalizeAgentDraft(draft);
  if (existingDraft) {
    return normalizeAgentDraftPreview(existingDraft, { engine, model, draft: normalizedDraft });
  }
  if (!normalizedDraft.displayName.trim()) return null;

  const capabilities = extractAgentDraftCapabilities(normalizedDraft.specialties);
  const team = normalizedDraft.canSupervise === 'yes' ? 'black-gold' : normalizedDraft.team;
  const roleType = normalizedDraft.canSupervise === 'yes' ? 'supervisor' : 'normal';

  return {
    name: slugifyAgentName(normalizedDraft.displayName),
    team,
    roleType,
    avatar: createDeterministicAvatarConfig(normalizedDraft.displayName.trim(), { team, roleType }),
    engineModels: engine && model ? { [engine]: model } : {},
    activeEngine: engine || '',
    capabilities: capabilities.length > 0 ? capabilities : [normalizedDraft.mission || '通用协作'],
    systemPrompt: '',
    description: normalizedDraft.mission || '等待 AI 生成角色草案',
    category: 'AI创建',
    tags: ['AI创建', normalizedDraft.style].filter(Boolean),
    keywords: capabilities,
  };
}
