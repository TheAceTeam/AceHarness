import { requireAdmin } from '@/lib/auth/middleware';
import { runModelDiagnostics } from '@/lib/models/diagnostics';
import { errorMessage, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody(request, {});
    const result = await runModelDiagnostics(body || {});
    return jsonOk(result);
  } catch (error) {
    return jsonOk(
      { ok: false, error: errorMessage(error) || 'Failed to run diagnostics' },
      { status: 500 },
    );
  }
}
