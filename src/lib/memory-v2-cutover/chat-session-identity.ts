import {
  loadChatSession,
  type PersistedChatSession,
} from '@/lib/chat/persistence';

function textValue(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

/**
 * Treats a browser frontendSessionId only as a lookup key. V2 callers may use
 * the returned identity only after the persisted session binds it to the same
 * authenticated owner.
 */
export async function loadOwnerBoundChatSession(input: {
  ownerUserId: string;
  frontendSessionId?: string | null;
}): Promise<PersistedChatSession | null> {
  const frontendSessionId = textValue(input.frontendSessionId);
  if (!frontendSessionId) return null;
  const session = await loadChatSession(frontendSessionId).catch(() => null);
  return session?.createdBy === input.ownerUserId ? session : null;
}
