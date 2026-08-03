export const AGENT_CATALOG_VISIBILITIES = ['default', 'optional', 'system'] as const;

export type AgentCatalogVisibility = typeof AGENT_CATALOG_VISIBILITIES[number];

export const EXPERT_PACKS = [
  { id: 'core', label: '通用协作' },
  { id: 'software-delivery', label: '软件交付' },
  { id: 'product-experience', label: '产品与体验' },
  { id: 'research-content', label: '研究与内容' },
  { id: 'data-decision', label: '数据与决策' },
  { id: 'business-strategy', label: '商业策略' },
] as const;

export const RETIRED_CATALOG_AGENT_NAMES = [
  'ceo-founder',
  'code-auditor',
  'design-breaker',
  'fix-architect',
  'fix-developer',
  'fix-breaker',
  'fix-hunter',
  'fix-judge',
  'fix-reviewer',
] as const;

export function isRetiredCatalogAgentName(value: unknown): boolean {
  const name = typeof value === 'string' ? value.trim() : '';
  return Boolean(name && RETIRED_CATALOG_AGENT_NAMES.includes(name as typeof RETIRED_CATALOG_AGENT_NAMES[number]));
}

export function isRetiredCatalogAgent(agent: {
  name?: unknown;
} | null | undefined): boolean {
  return isRetiredCatalogAgentName(agent?.name);
}

export function isSystemCatalogAgent(agent: {
  name?: unknown;
  team?: unknown;
  roleType?: unknown;
  catalogVisibility?: unknown;
} | null | undefined): boolean {
  if (!agent) return false;
  return agent.catalogVisibility === 'system'
    || agent.roleType === 'supervisor'
    || agent.name === 'default-supervisor';
}

export function isWorkflowStepSelectableAgent(agent: {
  name?: unknown;
  team?: unknown;
  roleType?: unknown;
  catalogVisibility?: unknown;
} | null | undefined): boolean {
  return !isSystemCatalogAgent(agent) && !isRetiredCatalogAgent(agent);
}
