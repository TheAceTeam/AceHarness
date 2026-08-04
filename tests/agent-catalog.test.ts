import { describe, expect, test } from 'vitest';
import {
  isRetiredCatalogAgentName,
  isWorkflowStepSelectableAgent,
} from '@/lib/agent/catalog';

describe('Agent catalog boundaries', () => {
  test('marks deleted identities as retired without redirecting them', () => {
    expect(isRetiredCatalogAgentName('fix-developer')).toBe(true);
    expect(isRetiredCatalogAgentName('code-auditor')).toBe(true);
    expect(isRetiredCatalogAgentName('developer')).toBe(false);
  });

  test('excludes system and retired identities from ordinary workflow steps', () => {
    expect(isWorkflowStepSelectableAgent({ name: 'developer', team: 'red' })).toBe(true);
    expect(isWorkflowStepSelectableAgent({ name: 'default-supervisor', roleType: 'supervisor' })).toBe(false);
    expect(isWorkflowStepSelectableAgent({ name: 'fix-developer', team: 'red' })).toBe(false);
  });
});
