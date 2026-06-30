import { NextRequest } from 'next/server';
import { handleRuntimeSqlitePost } from '@/lib/runtime/sqlite-route-handler';
import { execRuntimeSqlite } from '@/lib/runtime/sqlite-capability';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleRuntimeSqlitePost(request, 'exec', (grant, body) => execRuntimeSqlite(grant, {
    database: String(body?.database || ''),
    sql: String(body?.sql || ''),
    params: body?.params,
  }));
}
