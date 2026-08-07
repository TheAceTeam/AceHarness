import type { RunReviewPlanArtifact } from '@/lib/workflow/run-review-plan';

type StoredRunReviewPlan = {
  ownerId: string;
  artifact: RunReviewPlanArtifact;
};

const GLOBAL_STORE_KEY = '__aceRunReviewPlanStore';
const globalStore = globalThis as typeof globalThis & {
  [GLOBAL_STORE_KEY]?: Map<string, StoredRunReviewPlan>;
};

function store(): Map<string, StoredRunReviewPlan> {
  globalStore[GLOBAL_STORE_KEY] ||= new Map();
  return globalStore[GLOBAL_STORE_KEY]!;
}

function pruneExpiredPlans(): void {
  const now = Date.now();
  for (const [id, entry] of store()) {
    if (now >= Date.parse(entry.artifact.plan.expiresAt)) store().delete(id);
  }
}

export function saveRunReviewPlanArtifact(ownerId: string, artifact: RunReviewPlanArtifact): void {
  pruneExpiredPlans();
  store().set(artifact.plan.id, { ownerId, artifact });
}

export function loadRunReviewPlanArtifact(ownerId: string, id: string): RunReviewPlanArtifact | null {
  pruneExpiredPlans();
  const entry = store().get(id);
  if (!entry || entry.ownerId !== ownerId) return null;
  return entry.artifact;
}

export function replaceRunReviewPlanArtifact(ownerId: string, artifact: RunReviewPlanArtifact): void {
  const current = store().get(artifact.plan.id);
  if (!current || current.ownerId !== ownerId) throw new Error('找不到本次运行方案');
  store().set(artifact.plan.id, { ownerId, artifact });
}

export function consumeRunReviewPlanArtifact(ownerId: string, id: string): RunReviewPlanArtifact | null {
  const artifact = loadRunReviewPlanArtifact(ownerId, id);
  if (artifact) store().delete(id);
  return artifact;
}

export function discardRunReviewPlanArtifact(ownerId: string, id: string): boolean {
  pruneExpiredPlans();
  const entry = store().get(id);
  if (!entry || entry.ownerId !== ownerId) return false;
  return store().delete(id);
}
