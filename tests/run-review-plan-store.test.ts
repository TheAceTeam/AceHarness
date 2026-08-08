import { describe, expect, test, vi } from 'vitest';
import type { RunReviewPlanArtifact } from '@/lib/workflow/run-review-plan';
import {
  discardRunReviewPlanArtifact,
  loadRunReviewPlanArtifact,
  RUN_REVIEW_PLAN_PER_USER_LIMIT,
  saveRunReviewPlanArtifact,
} from '@/lib/workflow/run-review-plan-store';
import { withIsolatedAceHome } from './helpers/module-helpers';

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
  test('scopes plans to their owner and supports idempotent cancellation', async () => {
    await withIsolatedAceHome(async () => {
      const value = artifact(`owner-plan-${Date.now()}`);
      saveRunReviewPlanArtifact('owner-a', value);

      expect(loadRunReviewPlanArtifact('owner-b', value.plan.id)).toBeNull();
      expect(loadRunReviewPlanArtifact('owner-a', value.plan.id)).toEqual(value);
      expect(discardRunReviewPlanArtifact('owner-b', value.plan.id)).toBe(false);
      expect(discardRunReviewPlanArtifact('owner-a', value.plan.id)).toBe(true);
      expect(discardRunReviewPlanArtifact('owner-a', value.plan.id)).toBe(false);
    });
  });

  test('does not return expired plans', async () => {
    await withIsolatedAceHome(async () => {
      const value = artifact(`expired-plan-${Date.now()}`, new Date(Date.now() - 1).toISOString());
      saveRunReviewPlanArtifact('owner-a', value);
      expect(loadRunReviewPlanArtifact('owner-a', value.plan.id)).toBeNull();
    });
  });

  test('survives a module reload and caps each owner independently', async () => {
    await withIsolatedAceHome(async () => {
      const otherOwnerPlan = artifact('other-owner-plan');
      saveRunReviewPlanArtifact('owner-b', otherOwnerPlan);
      for (let index = 0; index <= RUN_REVIEW_PLAN_PER_USER_LIMIT; index++) {
        saveRunReviewPlanArtifact('owner-a', artifact(`owner-a-plan-${index}`));
      }

      vi.resetModules();
      const reloadedStore = await import('@/lib/workflow/run-review-plan-store');
      expect(reloadedStore.loadRunReviewPlanArtifact('owner-a', 'owner-a-plan-0')).toBeNull();
      expect(reloadedStore.loadRunReviewPlanArtifact('owner-a', `owner-a-plan-${RUN_REVIEW_PLAN_PER_USER_LIMIT}`)).not.toBeNull();
      expect(reloadedStore.loadRunReviewPlanArtifact('owner-b', otherOwnerPlan.plan.id)).toEqual(otherOwnerPlan);
    });
  });
});
