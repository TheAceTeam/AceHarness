import { NextRequest, NextResponse } from 'next/server';
import { requireRuntimeDatabaseGrant } from '@/lib/runtime/database-capabilities';
import { appendRuntimeDatabaseAudit } from '@/lib/runtime/database-audit';
import { deleteRuntimeSqliteDatabase, RuntimeSqliteError } from '@/lib/runtime/sqlite-capability';

export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest, context: { params: Promise<{ name: string }> | { name: string } }) {
  const auth = await requireRuntimeDatabaseGrant(request);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
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
    return NextResponse.json(result);
  } catch (error) {
    await appendRuntimeDatabaseAudit({
      grant: auth.grant,
      skillName,
      capability: 'sqlite',
      operation: 'delete-db',
      target: name,
      status: 'error',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => null);
    if (error instanceof RuntimeSqliteError) return NextResponse.json({ error: error.code }, { status: error.status });
    return NextResponse.json({ error: 'SQLITE_QUERY_FAILED' }, { status: 500 });
  }
}
