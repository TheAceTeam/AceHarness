import { requireRuntimeDatabaseGrant } from '@/lib/runtime/database-capabilities';
import { appendRuntimeDatabaseAudit } from '@/lib/runtime/database-audit';
import { createRuntimeSqliteDatabase, listRuntimeSqliteDatabases } from '@/lib/runtime/sqlite-capability';
import { errorMessage, jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';
import { readRuntimeJsonBody, runtimeSqliteError } from '@/server/api-route-runtime/runtime-database-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireRuntimeDatabaseGrant(request);
  if ('error' in auth) return jsonError(auth.error, auth.status);
  const startedAt = Date.now();
  const skillName = request.headers.get('x-aceharness-skill-name') || undefined;
  try {
    const databases = await listRuntimeSqliteDatabases(auth.grant);
    await appendRuntimeDatabaseAudit({
      grant: auth.grant,
      skillName,
      capability: 'sqlite',
      operation: 'list',
      target: '*',
      status: 'success',
      durationMs: Date.now() - startedAt,
      outputSummary: { databaseCount: databases.length },
    });
    return jsonOk({ databases });
  } catch (error) {
    await appendRuntimeDatabaseAudit({
      grant: auth.grant,
      skillName,
      capability: 'sqlite',
      operation: 'list',
      target: '*',
      status: 'error',
      durationMs: Date.now() - startedAt,
      error: errorMessage(error),
    }).catch(() => null);
    return runtimeSqliteError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireRuntimeDatabaseGrant(request);
  if ('error' in auth) return jsonError(auth.error, auth.status);
  const startedAt = Date.now();
  const skillName = request.headers.get('x-aceharness-skill-name') || undefined;
  const body = await readRuntimeJsonBody(request);
  const name = typeof body?.name === 'string' ? body.name : '';
  try {
    const result = await createRuntimeSqliteDatabase(auth.grant, name);
    await appendRuntimeDatabaseAudit({
      grant: auth.grant,
      skillName,
      capability: 'sqlite',
      operation: 'create-db',
      target: name,
      status: 'success',
      durationMs: Date.now() - startedAt,
      outputSummary: { created: true },
    });
    return jsonOk(result);
  } catch (error) {
    await appendRuntimeDatabaseAudit({
      grant: auth.grant,
      skillName,
      capability: 'sqlite',
      operation: 'create-db',
      target: name,
      status: 'error',
      durationMs: Date.now() - startedAt,
      error: errorMessage(error),
    }).catch(() => null);
    return runtimeSqliteError(error);
  }
}
