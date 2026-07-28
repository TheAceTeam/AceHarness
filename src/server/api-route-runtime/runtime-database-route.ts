import { requireRuntimeDatabaseGrant, type RuntimeDatabaseGrant } from '@/lib/runtime/database-capabilities';
import { RuntimeSqliteError } from '@/lib/runtime/sqlite-capability';
import { errorMessage, jsonError, readJsonBody } from './request-utils';

export type RuntimeDatabaseAuth = {
  grant: RuntimeDatabaseGrant;
};

export async function requireRuntimeDatabaseAuth(request: Request): Promise<RuntimeDatabaseAuth | Response> {
  const auth = await requireRuntimeDatabaseGrant(request);
  if ('error' in auth) return jsonError(auth.error, auth.status);
  return auth;
}

export async function readRuntimeJsonBody<T = Record<string, unknown>>(request: Request): Promise<T> {
  return readJsonBody<T>(request, {} as T);
}

export function runtimeSqliteError(error: unknown): Response {
  if (error instanceof RuntimeSqliteError) return jsonError(error.code, error.status);
  return jsonError('SQLITE_QUERY_FAILED', 500);
}

export function runtimeRagError(code: string, status: number, error?: unknown): Response {
  return jsonError(code, status, error == null ? undefined : errorMessage(error));
}
