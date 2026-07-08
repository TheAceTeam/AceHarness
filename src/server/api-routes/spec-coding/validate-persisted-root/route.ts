import { requireAuth } from '@/lib/auth/middleware';
import { assertPersistedSpecRootReady } from '@/lib/spec/persistence';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<any>(request, {});
    const persistMode = body.persistMode === 'repository' ? 'repository' : 'none';
    if (persistMode !== 'repository') {
      return jsonOk({ valid: true });
    }

    const workingDirectory = String(body.workingDirectory || '').trim();
    const specRoot = String(body.specRoot || '').trim() || '.spec';
    if (!workingDirectory) {
      return jsonOk({ error: '缺少 workingDirectory' }, { status: 400 });
    }

    const specRootDir = assertPersistedSpecRootReady(workingDirectory, specRoot);
    return jsonOk({ valid: true, specRootDir });
  } catch (error: any) {
    return jsonOk({ error: error?.message || '持久化 Spec 校验失败' }, { status: 400 });
  }
}
