import { NextRequest, NextResponse } from 'next/server';
import { requireRuntimeDatabaseGrant } from '@/lib/runtime/database-capabilities';
import { appendRuntimeDatabaseAudit } from '@/lib/runtime/database-audit';
import { createRuntimeSqliteDatabase, listRuntimeSqliteDatabases, RuntimeSqliteError } from '@/lib/runtime/sqlite-capability';

export const dynamic = 'force-dynamic';

function sqliteError(error: unknown) {
  if (error instanceof RuntimeSqliteError) return NextResponse.json({ error: error.code }, { status: error.status });
  return NextResponse.json({ error: 'SQLITE_QUERY_FAILED' }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const auth = await requireRuntimeDatabaseGrant(request);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
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
    return NextResponse.json({ databases });
  } catch (error) {
    await appendRuntimeDatabaseAudit({
      grant: auth.grant,
      skillName,
      capability: 'sqlite',
      operation: 'list',
      target: '*',
      status: 'error',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => null);
    return sqliteError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRuntimeDatabaseGrant(request);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const startedAt = Date.now();
  const skillName = request.headers.get('x-aceharness-skill-name') || undefined;
  const body = await request.json().catch(() => ({}));
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
    return NextResponse.json(result);
  } catch (error) {
    await appendRuntimeDatabaseAudit({
      grant: auth.grant,
      skillName,
      capability: 'sqlite',
      operation: 'create-db',
      target: name,
      status: 'error',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => null);
    return sqliteError(error);
  }
}
