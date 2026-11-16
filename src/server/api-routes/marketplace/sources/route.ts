import { requireAdmin, requireAuth } from '@/lib/auth/middleware';
import { BUILTIN_MARKETPLACE_SOURCES } from '@/constants/marketplace';
import { searchMarketplaceSource } from '@/lib/marketplace/provider';
import { listMarketplaceSources, parseMarketplaceSource, updateCustomSources } from '@/lib/marketplace/sources';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  return jsonOk({ sources: await listMarketplaceSources(), canManage: auth.role === 'admin' });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;
  try {
    const source = parseMarketplaceSource(await readJsonBody(request, {}));
    if ((await listMarketplaceSources()).some((entry) => entry.protocol === source.protocol && entry.url === source.url)) {
      return jsonError('该市场来源已存在。', 409);
    }
    await searchMarketplaceSource(source, 1, 1);
    await updateCustomSources((sources) => {
      if (sources.some((entry) => entry.id === source.id)) throw new Error('该市场来源已存在。');
      return [...sources, source];
    });
    return jsonOk({ source });
  } catch (error) {
    return jsonError(errorMessage(error) || '无法添加市场来源。', 400);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;
  const id = new URL(request.url).searchParams.get('id');
  if (!id || BUILTIN_MARKETPLACE_SOURCES.some((source) => source.id === id)) {
    return jsonError('请选择要移除的第三方市场。', 400);
  }
  await updateCustomSources((sources) => sources.filter((source) => source.id !== id));
  return jsonOk({ success: true });
}
