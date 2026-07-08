import { handleRuntimeSqlitePost } from '@/lib/runtime/sqlite-route-handler';
import { transactionRuntimeSqlite } from '@/lib/runtime/sqlite-capability';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleRuntimeSqlitePost(request, 'transaction', (grant, body) => transactionRuntimeSqlite(grant, {
    database: String(body?.database || ''),
    statements: Array.isArray(body?.statements) ? body.statements : [],
  }));
}
