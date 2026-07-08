import { requireRuntimeDatabaseGrant, type RuntimeDatabaseGrant } from '@/lib/runtime/database-capabilities';
import { appendRuntimeDatabaseAudit } from '@/lib/runtime/database-audit';
import { jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';
import { readRuntimeJsonBody, runtimeSqliteError } from '@/server/api-route-runtime/runtime-database-route';

export async function handleRuntimeSqlitePost<T>(
  request: Request,
  operation: string,
  action: (grant: RuntimeDatabaseGrant, body: any) => Promise<T>,
) {
  const auth = await requireRuntimeDatabaseGrant(request);
  if ('error' in auth) return jsonError(auth.error, auth.status);
  const startedAt = Date.now();
  const skillName = request.headers.get('x-aceharness-skill-name') || undefined;
  const body = await readRuntimeJsonBody(request);
  const target = typeof body?.database === 'string' ? body.database : '';
  try {
    const result = await action(auth.grant, body);
    await appendRuntimeDatabaseAudit({
      grant: auth.grant,
      skillName,
      capability: 'sqlite',
      operation,
      target,
      status: 'success',
      durationMs: Date.now() - startedAt,
      inputSummary: {
        sqlPreview: typeof body?.sql === 'string' ? body.sql.slice(0, 120) : undefined,
        statementCount: Array.isArray(body?.statements) ? body.statements.length : undefined,
        paramCount: Array.isArray(body?.params) ? body.params.length : undefined,
      },
      outputSummary: result && typeof result === 'object' ? result as Record<string, unknown> : {},
    });
    return jsonOk(result);
  } catch (error) {
    await appendRuntimeDatabaseAudit({
      grant: auth.grant,
      skillName,
      capability: 'sqlite',
      operation,
      target,
      status: 'error',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => null);
    return runtimeSqliteError(error);
  }
}
