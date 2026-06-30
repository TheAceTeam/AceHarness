import type { AuthenticatedUser } from '@/lib/auth/middleware';
import type { PersistedRunState } from '@/lib/run/state-persistence';

export type WorkflowRunCapability = 'view' | 'operate' | 'review' | 'admin';

type RunAccessLike = Pick<PersistedRunState, 'runOwnerId' | 'createdBy'> & {
  runAccess?: {
    viewers?: string[];
    operators?: string[];
    reviewers?: string[];
    admins?: string[];
    teamId?: string;
    tenantId?: string;
  };
};

export function getRunOwnerId(runState: Pick<PersistedRunState, 'runOwnerId' | 'createdBy'> | null | undefined): string | undefined {
  return runState?.runOwnerId || runState?.createdBy || undefined;
}

export function canAccessRunState(
  auth: Pick<AuthenticatedUser, 'id' | 'role'>,
  runState: RunAccessLike | null | undefined,
  capability: WorkflowRunCapability = 'view',
): boolean {
  if (auth.role === 'admin') return true;
  const ownerId = getRunOwnerId(runState);
  if (!ownerId) return true;
  if (ownerId === auth.id) return true;
  const access = runState?.runAccess;
  if (!access) return false;
  if (access.admins?.includes(auth.id)) return true;
  if (capability === 'admin') return false;
  if (capability === 'operate') return Boolean(access.operators?.includes(auth.id));
  if (capability === 'review') return Boolean(access.reviewers?.includes(auth.id) || access.operators?.includes(auth.id));
  return Boolean(
    access.viewers?.includes(auth.id)
    || access.reviewers?.includes(auth.id)
    || access.operators?.includes(auth.id)
  );
}
