import { requireRuntimeDatabaseGrant } from '@/lib/runtime/database-capabilities';
import { appendRuntimeDatabaseAudit } from '@/lib/runtime/database-audit';
import { deleteRuntimeSqliteDatabase } from '@/lib/runtime/sqlite-capability';
import { errorMessage, jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';
import { runtimeSqliteError } from '@/server/api-route-runtime/runtime-database-route';

export const dynamic = 'force-dynamic';

export async function DELETE(request: Request, context: { params: { name: string } | Promise<{ name: string }> | { name: string } }) {
  const auth = await requireRuntimeDatabaseGrant(request);
  if ('error' in auth) return jsonError(auth.error, auth.status);
  const startedAt = Date.now();
  const skillName = request.headers.get('x-aceharness-skill-name') || undefined;
  const params = await context.params;
  const name = params.name;
  try {
    const result = await deleteRuntimeSqliteDatabase(auth.grant, name);
    await appendRuntimeDatabaseAudit({
      grant: auth.grant,
      skillName,
      capability: 'sqlite',
      operation: 'delete-db',
      target: name,
      status: 'success',
      durationMs: Date.now() - startedAt,
      outputSummary: { deleted: true },
    });
    return jsonOk(result);
  } catch (error) {
    await appendRuntimeDatabaseAudit({
      grant: auth.grant,
      skillName,
      capability: 'sqlite',
      operation: 'delete-db',
      target: name,
      status: 'error',
      durationMs: Date.now() - startedAt,
      error: errorMessage(error),
    }).catch(() => null);
    return runtimeSqliteError(error);
  }
}
