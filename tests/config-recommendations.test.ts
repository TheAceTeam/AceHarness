import { describe, expect, test } from 'vitest';
import {
  DEFAULT_RECOMMENDED_AGENT_FALLBACK,
  buildRecommendedAgents,
} from '@/lib/config/recommendations';

describe('config recommendations', () => {
  test('uses a shippable general delivery lineup', () => {
    expect(Array.from(DEFAULT_RECOMMENDED_AGENT_FALLBACK)).toEqual([
      'generalist',
      'architect',
      'developer',
      'tester',
      'documentation-writer',
    ]);
  });

  test('excludes retired references, excludes Supervisor, deduplicates, and caps to six', () => {
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
      ],
      relationshipHints: [],
    });

    expect(recommended).toEqual([
      'developer',
      'architect',
      'tester',
      'documentation-writer',
      'ux-designer',
      'generalist',
    ]);
  });

  test('adds only active positive relationship hints in descending synergy order before fallback fill', () => {
    const recommended = buildRecommendedAgents({
      availableAgents: new Set(),
      referenceAgents: ['architect'],
      relationshipHints: [
        { agent: 'developer', counterpart: 'tester', synergyScore: 3 },
        { agent: 'code-auditor', counterpart: 'documentation-writer', synergyScore: 9 },
        { agent: 'qa-lead', counterpart: 'release-coordinator', synergyScore: 0 },
      ],
    });

    expect(recommended).toEqual([
      'architect',
      'documentation-writer',
      'developer',
      'tester',
      'generalist',
    ]);
  });

  test('does not inject optional adversarial roles only because they are available', () => {
    const recommended = buildRecommendedAgents({
      availableAgents: new Set(['architect', 'tester', 'code-hunter', 'documentation-writer']),
      referenceAgents: ['developer', 'architect'],
      relationshipHints: [
        { agent: 'code-auditor', counterpart: 'tester', synergyScore: 7 },
        { agent: 'documentation-writer', counterpart: 'missing-agent', synergyScore: 4 },
      ],
    });

    expect(recommended).toEqual(['architect', 'tester', 'documentation-writer']);
  });

  test('preserves explicitly referenced optional adversarial roles', () => {
    const recommended = buildRecommendedAgents({
      availableAgents: new Set(['architect', 'tester', 'code-hunter', 'documentation-writer']),
      referenceAgents: ['architect', 'code-hunter'],
      relationshipHints: [],
    });

    expect(recommended).toEqual(['architect', 'code-hunter', 'tester', 'documentation-writer']);
  });
});
