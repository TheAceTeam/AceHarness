import { handleRuntimeSqlitePost } from '@/lib/runtime/sqlite-route-handler';
import { queryRuntimeSqlite } from '@/lib/runtime/sqlite-capability';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleRuntimeSqlitePost(request, 'query', (grant, body) => queryRuntimeSqlite(grant, {
    database: String(body?.database || ''),
    sql: String(body?.sql || ''),
    params: body?.params,
    limit: Number(body?.limit || 200),
  }));
}
