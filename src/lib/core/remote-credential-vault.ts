import crypto from 'crypto';
import { requireAuth, type AuthenticatedUser } from '@/lib/auth/middleware';
import { WorkspacePathError } from '@/lib/core/workspace-path-safety';
import { isRemoteWorkspace, normalizeRemoteWorkspaceUrl, type RemoteCredentials } from '@/lib/core/remote-workspace';

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

interface VaultEntry {
  id: string;
  userId: string;
  workspaceKey: string;
  credentials: RemoteCredentials;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
}

const vault = new Map<string, VaultEntry>();

function now(): number {
  return Date.now();
}

function entryKey(userId: string, workspaceKey: string): string {
  return `${userId}:${workspaceKey}`;
}

export function buildRemoteWorkspaceKey(workspace: string): string {
  return crypto.createHash('sha256').update(normalizeRemoteWorkspaceUrl(workspace)).digest('hex');
}

export function pruneExpiredRemoteCredentials(): void {
  const current = now();
  for (const [key, entry] of vault) {
    if (entry.expiresAt <= current) vault.delete(key);
  }
}

export function putRemoteCredentials(input: {
  userId: string;
  workspace: string;
  credentials: RemoteCredentials;
  ttlMs?: number;
}): { id: string; expiresAt: number } {
  if (!isRemoteWorkspace(input.workspace)) {
    throw new WorkspacePathError('workspace 不是远程地址');
  }
  pruneExpiredRemoteCredentials();
  const workspaceKey = buildRemoteWorkspaceKey(input.workspace);
  const key = entryKey(input.userId, workspaceKey);
  const existing = vault.get(key);
  const current = now();
  const entry: VaultEntry = {
    id: existing?.id || crypto.randomUUID(),
    userId: input.userId,
    workspaceKey,
    credentials: input.credentials,
    createdAt: existing?.createdAt || current,
    lastUsedAt: current,
    expiresAt: current + (input.ttlMs || DEFAULT_TTL_MS),
  };
  vault.set(key, entry);
  return { id: entry.id, expiresAt: entry.expiresAt };
}

export function getRemoteCredentials(input: { userId: string; workspace: string }): RemoteCredentials {
  pruneExpiredRemoteCredentials();
  const workspaceKey = buildRemoteWorkspaceKey(input.workspace);
  const key = entryKey(input.userId, workspaceKey);
  const entry = vault.get(key);
  if (!entry) {
    throw new WorkspacePathError('远程 workspace 需要连接凭据', 428);
  }
  entry.lastUsedAt = now();
  entry.expiresAt = now() + DEFAULT_TTL_MS;
  return entry.credentials;
}

export function forgetRemoteCredentials(input: { userId: string; workspace: string }): void {
  const workspaceKey = buildRemoteWorkspaceKey(input.workspace);
  vault.delete(entryKey(input.userId, workspaceKey));
}

export async function requireRemoteWorkspaceAuth(request: Request): Promise<AuthenticatedUser | Response> {
  return requireAuth(request);
}

export function remoteCredentialErrorBody(workspace: string) {
  return {
    error: '远程 workspace 需要连接凭据',
    message: '远程 workspace 需要连接凭据',
    code: 'REMOTE_CREDENTIAL_REQUIRED',
    workspace: normalizeRemoteWorkspaceUrl(workspace),
  };
}
