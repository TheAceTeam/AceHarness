import { requireAdmin } from '@/lib/auth/middleware';
import { getMemoryV2CutoverDiagnostics } from '@/lib/memory-v2-cutover/diagnostics';
import { jsonOk } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    return jsonOk(await getMemoryV2CutoverDiagnostics());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Memory V2 diagnostics failed' }, { status: 500 });
  }
}
