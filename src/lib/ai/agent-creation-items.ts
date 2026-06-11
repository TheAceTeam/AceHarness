import { extractJsonObject, extractStructuredResult, getResultSections } from '@/lib/ai/result-channel';
import { buildAgentSystemPrompt, extractAgentDraftCapabilities } from '@/lib/agent/draft';
import { createDeterministicAvatarConfig, normalizeAgentAvatar } from '@/lib/agent/personas';
import type { ClarificationFormResult, ClarificationQuestionItem } from '@/lib/ai/result-normalizers';

export const AGENT_CLARIFICATION_SUMMARY_KIND = 'agent_clarification_summary';
export const AGENT_CLARIFICATION_FACTS_KIND = 'agent_clarification_facts';
export const AGENT_CLARIFICATION_GAPS_KIND = 'agent_clarification_gaps';
export const AGENT_CLARIFICATION_QUESTION_KIND = 'agent_clarification_question';
export const AGENT_ROLE_PROFILE_KIND = 'agent_role_profile';
export const AGENT_EXECUTION_PROFILE_KIND = 'agent_execution_profile';
export const AGENT_CONFIG_KIND = 'agent_config';

export type AgentCreationItemKind =
  | typeof AGENT_CLARIFICATION_SUMMARY_KIND
  | typeof AGENT_CLARIFICATION_FACTS_KIND
  | typeof AGENT_CLARIFICATION_GAPS_KIND
  | typeof AGENT_CLARIFICATION_QUESTION_KIND
  | typeof AGENT_ROLE_PROFILE_KIND
  | typeof AGENT_EXECUTION_PROFILE_KIND
  | typeof AGENT_CONFIG_KIND;

export type AgentCreationItemResult = {
  kind: AgentCreationItemKind;
  data: Record<string, any>;
};

export type AgentCreationItemExtraction =
  | { ok: true; result: AgentCreationItemResult }
  | { ok: false; error: string };

export interface AgentCreationState {
  clarification: {
    summary: string;
    knownFacts: string[];
    missingFields: string[];
    openQuestions: string[];
    questions: ClarificationQuestionItem[];
  };
  profile: {
    displayName: string;
    name: string;
    team: 'blue' | 'red' | 'judge' | 'black-gold';
    roleType: 'normal' | 'supervisor';
    mission: string;
    style: string;
    specialties: string[];
  };
  execution: {
    capabilities: string[];
    constraints: string[];
    keywords: string[];
    systemPrompt: string;
    description: string;
    tags: string[];
    category: string;
  };
  config: Record<string, any> | null;
}

export const AGENT_CREATION_ITEM_KINDS = new Set<string>([
  AGENT_CLARIFICATION_SUMMARY_KIND,
  AGENT_CLARIFICATION_FACTS_KIND,
  AGENT_CLARIFICATION_GAPS_KIND,
  AGENT_CLARIFICATION_QUESTION_KIND,
  AGENT_ROLE_PROFILE_KIND,
  AGENT_EXECUTION_PROFILE_KIND,
  AGENT_CONFIG_KIND,
]);

export const REQUIRED_AGENT_CREATION_ITEM_KINDS: AgentCreationItemKind[] = [
  AGENT_CLARIFICATION_SUMMARY_KIND,
  AGENT_ROLE_PROFILE_KIND,
  AGENT_EXECUTION_PROFILE_KIND,
  AGENT_CONFIG_KIND,
];

const TEAM_VALUES = ['blue', 'red', 'judge', 'black-gold'] as const;
const ROLE_TYPE_VALUES = ['normal', 'supervisor'] as const;

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown, limit = 12): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanString(item))
      .filter(Boolean)
      .slice(0, limit);
  }
  const single = cleanString(value);
  return single ? [single] : [];
}

function uniqueStrings(values: string[], limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

function normalizeTeam(value: unknown, fallback: AgentCreationState['profile']['team'] = 'red') {
  return TEAM_VALUES.includes(value as any) ? value as AgentCreationState['profile']['team'] : fallback;
}

function normalizeRoleType(value: unknown, team: AgentCreationState['profile']['team']) {
  if (team === 'black-gold') return 'supervisor' as const;
  return ROLE_TYPE_VALUES.includes(value as any) ? value as AgentCreationState['profile']['roleType'] : 'normal';
}

function slugifyAgentName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `agent-${Date.now()}`;
}

function getPayload(raw: any): Record<string, any> {
  const payload = raw?.payload && typeof raw.payload === 'object' ? raw.payload : raw;
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return data && typeof data === 'object' ? data : {};
}

function normalizeQuestion(data: Record<string, any>, index: number): ClarificationQuestionItem | null {
  const source = data.question && typeof data.question === 'object' ? data.question : data;
  const id = cleanString(source.id) || `q${index + 1}`;
  const label = cleanString(source.label) || cleanString(source.title) || `问题 ${index + 1}`;
  const question = cleanString(source.question) || cleanString(source.text);
  const selectionMode = source.selectionMode === 'multiple' || source.mode === 'multiple' ? 'multiple' : 'single';
  const options: ClarificationQuestionItem['options'] = (Array.isArray(source.options) ? source.options : [])
    .map((option: any, optionIndex: number) => ({
      id: cleanString(option?.id) || `opt${optionIndex + 1}`,
      label: cleanString(option?.label) || cleanString(option?.text) || `选项 ${optionIndex + 1}`,
      description: cleanString(option?.description) || cleanString(option?.detail) || undefined,
      recommended: option?.recommended === true,
    }))
    .filter((option: ClarificationQuestionItem['options'][number]) => option.label);
  if (!question || options.length < 2) return null;
  if (!options.some((option: ClarificationQuestionItem['options'][number]) => option.recommended)) {
    options[0] = { ...options[0], recommended: true };
  }
  return {
    id,
    label,
    question,
    selectionMode,
    options: options.slice(0, 4),
    placeholder: cleanString(source.placeholder) || cleanString(source.defaultAssumption) || '如果跳过，系统会采用保守默认假设继续。',
    required: source.required === false ? false : true,
  };
}

function previewValue(value: unknown, limit = 220): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text && text.length > limit ? `${text.slice(0, limit)}...` : String(text || value);
}

function itemShapeHint(kind?: AgentCreationItemKind): string {
  return `<result>{"kind":"${kind || 'agent_config'}","data":{...}}</result>`;
}

function validationError(path: string, problem: string, fix: string): string {
  return `字段：${path}。当前情况：${problem}。目标结构：${fix}`;
}

function extractionDiagnostic(markdown: string, expectedKind?: AgentCreationItemKind): string {
  const sections = getResultSections(markdown);
  if (sections.length === 0) {
    return [
      `当前需要 ${expectedKind || 'Agent 创建'} 结构化结果。`,
      `目标结构：${itemShapeHint(expectedKind)}。`,
      '结果块内为单个 JSON 对象，顶层包含 kind 和 data。',
    ].join('\n');
  }

  const diagnostics = sections.map((section, index) => {
    const parsed = extractJsonObject(section.content);
    if (!parsed || typeof parsed !== 'object') {
      return `第 ${index + 1} 个结果块解析情况：${previewValue(section.content, 300)}`;
    }
    return `第 ${index + 1} 个结果块：kind=${cleanString((parsed as any).kind) || '(empty)'}，keys=${Object.keys(parsed).join(', ') || 'none'}`;
  });

  return [
    `当前需要 kind=${expectedKind || 'agent_config'} 的结构化结果。`,
    ...diagnostics,
    `目标结构：${itemShapeHint(expectedKind)}。`,
  ].join('\n');
}

function normalizeItem(raw: any): AgentCreationItemResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const kind = cleanString(raw.kind) as AgentCreationItemKind;
  if (!AGENT_CREATION_ITEM_KINDS.has(kind)) return null;
  return { kind, data: getPayload(raw) };
}

export function extractAgentCreationItemResult(
  markdown: string,
  expectedKind?: AgentCreationItemKind,
): AgentCreationItemExtraction {
  const parsed = extractStructuredResult<any>(markdown, (value: any): value is any => (
    AGENT_CREATION_ITEM_KINDS.has(cleanString(value?.kind))
    && (!expectedKind || cleanString(value?.kind) === expectedKind)
  ));
  const result = normalizeItem(parsed);
  if (!result) return { ok: false, error: extractionDiagnostic(markdown, expectedKind) };
  if (expectedKind && result.kind !== expectedKind) {
    return {
      ok: false,
      error: validationError('kind', `kind=${result.kind}`, itemShapeHint(expectedKind)),
    };
  }
  const validation = validateAgentCreationItem(result);
  if (!validation.ok) return { ok: false, error: validation.errors.join('\n') };
  return { ok: true, result };
}

export function validateAgentCreationItem(result: AgentCreationItemResult): { ok: boolean; errors: string[] } {
  const data = result.data || {};
  const errors: string[] = [];

  if (result.kind === AGENT_CLARIFICATION_SUMMARY_KIND) {
    if (!cleanString(data.summary)) {
      errors.push(validationError('data.summary', 'summary 为空', '写入 1-2 句对角色需求的理解摘要。'));
    }
  } else if (result.kind === AGENT_CLARIFICATION_FACTS_KIND) {
    if (stringArray(data.facts || data.knownFacts).length === 0) {
      errors.push(validationError('data.facts', 'facts 为空', '把已确认事实写成字符串数组，例如 "facts":["事实 1","事实 2"]。'));
    }
  } else if (result.kind === AGENT_CLARIFICATION_GAPS_KIND) {
    if (stringArray(data.gaps || data.missingFields).length === 0) {
      errors.push(validationError('data.gaps', 'gaps 为空', '把待补信息写成字符串数组，并用 blocking/optional 标出优先级。'));
    }
  } else if (result.kind === AGENT_CLARIFICATION_QUESTION_KIND) {
    const source = data.question && typeof data.question === 'object' ? data.question : data;
    if (!cleanString(source.question) && !cleanString(source.text)) {
      errors.push(validationError('data.question', 'question 为空', '在 data.question 写入具体问题，并说明这个答案会影响什么决策。'));
    }
    if (!Array.isArray(source.options) || source.options.length < 2) {
      errors.push(validationError('data.options', 'options 缺失或少于 2 个', '提供 2-4 个选项对象，每个选项包含 id、label、description。'));
    }
    if (Array.isArray(source.options) && source.options.length >= 2 && !source.options.some((option: any) => option?.recommended === true)) {
      errors.push(validationError('data.options', '没有 recommended=true 的选项', '在最稳妥的默认选项上设置 "recommended":true。'));
    }
  } else if (result.kind === AGENT_ROLE_PROFILE_KIND) {
    if (!cleanString(data.displayName) && !cleanString(data.name)) {
      errors.push(validationError('data.displayName', '显示名称为空', '写入用户可读的 Agent 显示名称。'));
    }
    if (!TEAM_VALUES.includes(data.team)) {
      errors.push(validationError('data.team', `team=${previewValue(data.team)}`, '取值为 blue、red、judge、black-gold。'));
    }
    if (!cleanString(data.mission)) {
      errors.push(validationError('data.mission', '职责为空', '写入这个 Agent 的核心职责边界。'));
    }
  } else if (result.kind === AGENT_EXECUTION_PROFILE_KIND) {
    if (stringArray(data.capabilities).length === 0) {
      errors.push(validationError('data.capabilities', '能力标签为空', '写入至少一个能力标签字符串。'));
    }
    if (!cleanString(data.systemPrompt)) {
      errors.push(validationError('data.systemPrompt', '系统提示词为空', '写入完整可用的 Agent systemPrompt。'));
    }
  } else if (result.kind === AGENT_CONFIG_KIND) {
    const agent = data.agent && typeof data.agent === 'object' ? data.agent : data;
    if (!cleanString(agent.name)) {
      errors.push(validationError('data.agent.name', 'Agent 文件名为空', '写入 kebab-case 或中文短名。'));
    }
    if (!TEAM_VALUES.includes(agent.team)) {
      errors.push(validationError('data.agent.team', `team=${previewValue(agent.team)}`, '取值为 blue、red、judge、black-gold。'));
    }
    if (!agent.engineModels || typeof agent.engineModels !== 'object' || Array.isArray(agent.engineModels)) {
      errors.push(validationError('data.agent.engineModels', 'engineModels 不是对象', '写入对象，例如 {} 或 {"codex":"gpt-5"}。'));
    }
    if (!Array.isArray(agent.capabilities) || agent.capabilities.length === 0) {
      errors.push(validationError('data.agent.capabilities', 'capabilities 为空', '写入至少一个能力标签。'));
    }
    if (!cleanString(agent.systemPrompt)) {
      errors.push(validationError('data.agent.systemPrompt', '系统提示词为空', '写入完整可用的 Agent systemPrompt。'));
    }
  }

  return { ok: errors.length === 0, errors };
}

export function createEmptyAgentCreationState(): AgentCreationState {
  return {
    clarification: {
      summary: '',
      knownFacts: [],
      missingFields: [],
      openQuestions: [],
      questions: [],
    },
    profile: {
      displayName: '',
      name: '',
      team: 'red',
      roleType: 'normal',
      mission: '',
      style: '',
      specialties: [],
    },
    execution: {
      capabilities: [],
      constraints: [],
      keywords: [],
      systemPrompt: '',
      description: '',
      tags: [],
      category: 'AI创建',
    },
    config: null,
  };
}

export function applyAgentCreationItem(state: AgentCreationState, result: AgentCreationItemResult): AgentCreationState {
  const next: AgentCreationState = JSON.parse(JSON.stringify(state || createEmptyAgentCreationState()));
  const data = result.data || {};

  if (result.kind === AGENT_CLARIFICATION_SUMMARY_KIND) {
    next.clarification.summary = cleanString(data.summary) || next.clarification.summary;
    next.clarification.knownFacts = uniqueStrings([...next.clarification.knownFacts, ...stringArray(data.knownFacts || data.facts, 8)], 8);
    next.clarification.openQuestions = uniqueStrings([...next.clarification.openQuestions, ...stringArray(data.openQuestions || data.questions, 6)], 6);
  } else if (result.kind === AGENT_CLARIFICATION_FACTS_KIND) {
    next.clarification.knownFacts = uniqueStrings([...next.clarification.knownFacts, ...stringArray(data.facts || data.knownFacts, 12)], 12);
  } else if (result.kind === AGENT_CLARIFICATION_GAPS_KIND) {
    next.clarification.missingFields = uniqueStrings([...next.clarification.missingFields, ...stringArray(data.gaps || data.missingFields, 12)], 12);
  } else if (result.kind === AGENT_CLARIFICATION_QUESTION_KIND) {
    const question = normalizeQuestion(data, next.clarification.questions.length);
    if (question) {
      next.clarification.questions = [
        ...next.clarification.questions.filter((item) => item.id !== question.id),
        question,
      ];
    }
  } else if (result.kind === AGENT_ROLE_PROFILE_KIND) {
    const team = normalizeTeam(data.team, next.profile.team);
    const roleType = normalizeRoleType(data.roleType, team);
    const displayName = cleanString(data.displayName || data.title) || next.profile.displayName;
    next.profile = {
      displayName,
      name: cleanString(data.name) || next.profile.name || slugifyAgentName(displayName),
      team,
      roleType,
      mission: cleanString(data.mission || data.description) || next.profile.mission,
      style: cleanString(data.style) || next.profile.style,
      specialties: uniqueStrings([...next.profile.specialties, ...stringArray(data.specialties || data.specialtyTags, 12)], 12),
    };
  } else if (result.kind === AGENT_EXECUTION_PROFILE_KIND) {
    next.execution = {
      capabilities: uniqueStrings([...next.execution.capabilities, ...stringArray(data.capabilities, 12)], 12),
      constraints: uniqueStrings([...next.execution.constraints, ...stringArray(data.constraints, 12)], 12),
      keywords: uniqueStrings([...next.execution.keywords, ...stringArray(data.keywords, 12)], 12),
      systemPrompt: cleanString(data.systemPrompt) || next.execution.systemPrompt,
      description: cleanString(data.description) || next.execution.description,
      tags: uniqueStrings([...next.execution.tags, ...stringArray(data.tags, 12)], 12),
      category: cleanString(data.category) || next.execution.category || 'AI创建',
    };
  } else if (result.kind === AGENT_CONFIG_KIND) {
    next.config = data.agent && typeof data.agent === 'object' ? data.agent : data;
  }

  return next;
}

export function assembleAgentClarificationForm(state: AgentCreationState): ClarificationFormResult {
  return {
    type: 'clarification_form',
    summary: state.clarification.summary,
    knownFacts: state.clarification.knownFacts,
    missingFields: state.clarification.missingFields,
    questions: state.clarification.questions,
  };
}

export function buildAgentConfigFromCreationState(input: {
  state: AgentCreationState;
  displayName: string;
  team?: string;
  mission: string;
  style?: string;
  specialties?: string;
  engine?: string;
  model?: string;
}): Record<string, any> {
  const state = input.state || createEmptyAgentCreationState();
  const profile = state.profile;
  const config = state.config || {};
  const displayName = cleanString(profile.displayName) || input.displayName;
  const name = cleanString(config.name) || cleanString(profile.name) || slugifyAgentName(displayName);
  const team = normalizeTeam(config.team || profile.team || input.team);
  const roleType = normalizeRoleType(config.roleType || profile.roleType, team);
  const mission = cleanString(profile.mission) || input.mission;
  const style = cleanString(profile.style) || input.style || '专业、直接、可靠';
  const specialtyText = profile.specialties.length ? profile.specialties.join('，') : input.specialties || '';
  const fallbackCapabilities = extractAgentDraftCapabilities(specialtyText);
  const capabilities = uniqueStrings([
    ...stringArray(config.capabilities, 12),
    ...state.execution.capabilities,
    ...fallbackCapabilities,
    mission,
  ], 12);
  const systemPrompt = cleanString(config.systemPrompt)
    || state.execution.systemPrompt
    || buildAgentSystemPrompt({
      displayName,
      mission,
      style,
      specialties: specialtyText,
    });
  const engineModels = config.engineModels && typeof config.engineModels === 'object' && !Array.isArray(config.engineModels)
    ? config.engineModels
    : input.engine && input.model
      ? { [input.engine]: input.model }
      : {};
  const activeEngine = typeof config.activeEngine === 'string' ? config.activeEngine : input.engine || '';

  return {
    ...config,
    name,
    team,
    roleType,
    avatar: normalizeAgentAvatar(
      config.avatar || createDeterministicAvatarConfig(displayName, { team, roleType }),
      name,
      { team, roleType },
    ),
    engineModels,
    activeEngine,
    capabilities: capabilities.length > 0 ? capabilities : ['通用协作'],
    systemPrompt,
    description: cleanString(config.description) || state.execution.description || mission,
    constraints: uniqueStrings([...stringArray(config.constraints, 12), ...state.execution.constraints], 12),
    keywords: uniqueStrings([...stringArray(config.keywords, 12), ...state.execution.keywords, ...fallbackCapabilities], 12),
    tags: uniqueStrings(['AI创建', ...stringArray(config.tags, 12), ...state.execution.tags, style], 12),
    category: cleanString(config.category) || state.execution.category || 'AI创建',
  };
}
