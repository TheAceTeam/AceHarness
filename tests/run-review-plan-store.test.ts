import { describe, expect, test } from 'vitest';
import type { RunReviewPlanArtifact } from '@/lib/workflow/run-review-plan';
import {
  discardRunReviewPlanArtifact,
  loadRunReviewPlanArtifact,
  saveRunReviewPlanArtifact,
} from '@/lib/workflow/run-review-plan-store';

function artifact(id: string, expiresAt = new Date(Date.now() + 60_000).toISOString()): RunReviewPlanArtifact {
  return {
    plan: {
      id,
      rootConfigFile: 'root.yaml',
      intent: 'disabled',
      baseConfigHash: 'config',
      contextHash: 'context',
      createdAt: new Date().toISOString(),
      expiresAt,
      workflows: [],
      states: [],
      warnings: [],
      blocked: false,
    },
    effectiveConfigContents: {},
    originalConfigContents: {},
    suggestions: {},
  };
}

describe('run review plan store', () => {
  test('scopes plans to their owner and supports idempotent cancellation', () => {
    const value = artifact(`owner-plan-${Date.now()}`);
    saveRunReviewPlanArtifact('owner-a', value);

    expect(loadRunReviewPlanArtifact('owner-b', value.plan.id)).toBeNull();
    expect(loadRunReviewPlanArtifact('owner-a', value.plan.id)).toBe(value);
    expect(discardRunReviewPlanArtifact('owner-b', value.plan.id)).toBe(false);
    expect(discardRunReviewPlanArtifact('owner-a', value.plan.id)).toBe(true);
    expect(discardRunReviewPlanArtifact('owner-a', value.plan.id)).toBe(false);
  });

  test('does not return expired plans', () => {
    const value = artifact(`expired-plan-${Date.now()}`, new Date(Date.now() - 1).toISOString());
    saveRunReviewPlanArtifact('owner-a', value);
    expect(loadRunReviewPlanArtifact('owner-a', value.plan.id)).toBeNull();
  });
});
