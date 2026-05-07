import { describe, expect, test } from 'vitest';
import {
  DEFAULT_RECOMMENDED_AGENT_FALLBACK,
  buildRecommendedAgents,
} from '@/lib/config-recommendations';

describe('config recommendations', () => {
  test('default recommendation fallback is the intended default delivery lineup', () => {
    expect(Array.from(DEFAULT_RECOMMENDED_AGENT_FALLBACK)).toEqual([
      'architect',
      'developer',
      'tester',
      'code-auditor',
      'documentation-writer',
    ]);
  });

  test('prioritizes reference agents, normalizes names, deduplicates, excludes supervisor, and caps to six', () => {
    const recommended = buildRecommendedAgents({
      availableAgents: new Set(),
      referenceAgents: [
        ' developer ',
        'architect',
        'developer',
        'default-supervisor',
        'tester',
        'code-auditor',
        'documentation-writer',
        'ux-designer',
        'security-reviewer',
      ],
      relationshipHints: [],
    });

    expect(recommended).toEqual([
      'developer',
      'architect',
      'tester',
      'code-auditor',
      'documentation-writer',
      'ux-designer',
    ]);
  });

  test('adds only positive relationship hints in descending synergy order before fallback fill', () => {
    const recommended = buildRecommendedAgents({
      availableAgents: new Set(),
      referenceAgents: ['architect'],
      relationshipHints: [
        { agent: 'developer', counterpart: 'tester', synergyScore: 3 },
        { agent: 'code-auditor', counterpart: 'documentation-writer', synergyScore: 9 },
        { agent: 'qa-lead', counterpart: 'release-coordinator', synergyScore: 0 },
        { agent: 'ux-designer', counterpart: 'security-reviewer', synergyScore: -2 },
      ],
    });

    expect(recommended).toEqual([
      'architect',
      'code-auditor',
      'documentation-writer',
      'developer',
      'tester',
    ]);
  });

  test('filters recommendations by available agents when availability is known', () => {
    const recommended = buildRecommendedAgents({
      availableAgents: new Set(['architect', 'tester', 'documentation-writer', 'ux-designer']),
      referenceAgents: ['developer', 'architect'],
      relationshipHints: [
        { agent: 'code-auditor', counterpart: 'tester', synergyScore: 7 },
        { agent: 'documentation-writer', counterpart: 'missing-agent', synergyScore: 4 },
      ],
    });

    expect(recommended).toEqual(['architect', 'tester', 'documentation-writer']);
  });
});
