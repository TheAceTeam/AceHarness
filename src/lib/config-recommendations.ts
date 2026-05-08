import { DEFAULT_SUPERVISOR_NAME } from '@/lib/default-supervisor';

export const DEFAULT_RECOMMENDED_AGENT_FALLBACK = [
  'architect',
  'developer',
  'tester',
  'code-auditor',
  'documentation-writer',
] as const;

export interface RecommendationRelationshipHint {
  agent: string;
  counterpart: string;
  synergyScore: number;
}

export function buildRecommendedAgents(input: {
  availableAgents: Set<string>;
  referenceAgents: string[];
  relationshipHints: RecommendationRelationshipHint[];
}): string[] {
  const lineup: string[] = [];

  const add = (name?: string) => {
    const normalized = typeof name === 'string' ? name.trim() : '';
    if (!normalized) return;
    if (input.availableAgents.size > 0 && !input.availableAgents.has(normalized)) return;
    if (!lineup.includes(normalized) && normalized !== DEFAULT_SUPERVISOR_NAME) {
      lineup.push(normalized);
    }
  };

  input.referenceAgents.forEach(add);

  input.relationshipHints
    .filter((item) => item.synergyScore > 0)
    .sort((a, b) => b.synergyScore - a.synergyScore)
    .forEach((item) => {
      add(item.agent);
      add(item.counterpart);
    });

  DEFAULT_RECOMMENDED_AGENT_FALLBACK.forEach(add);

  return lineup.slice(0, 6);
}
