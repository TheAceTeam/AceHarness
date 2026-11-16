import { listMarketplaceCategories } from '@/lib/marketplace/provider';
import { getMarketplaceSource } from '@/lib/marketplace/sources';
import { isMarketplaceSource } from '@/lib/marketplace/validators';
import { CACHE_DURATION } from '@/constants/marketplace';
import { requireAuth } from '@/lib/auth/middleware';
import { errorMessage, jsonOk } from '@/server/api-route-runtime/request-utils';
import type { MarketplaceCategory, MarketplaceSource } from '@/types/marketplace';

const categoriesCache = new Map<MarketplaceSource, { categories: MarketplaceCategory[]; timestamp: number }>();

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get('source') || 'matrix';
  if (!isMarketplaceSource(source)) {
    return jsonOk({ success: false, error: 'Invalid marketplace source' }, { status: 400 });
  }
  try {
    if (source !== 'matrix') {
      const auth = await requireAuth(request);
      if (auth instanceof Response) return auth;
    }

    const selected = await getMarketplaceSource(source);
    if (!selected) return jsonOk({ success: false, error: '该市场来源不存在' }, { status: 404 });
    const cached = categoriesCache.get(source);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return jsonOk({ success: true, data: { categories: cached.categories } });
    }
    const categories = await listMarketplaceCategories(selected);
    categoriesCache.set(source, { categories, timestamp: Date.now() });
    return jsonOk({ success: true, data: { categories } });
  } catch (error) {
    console.error('Categories API error:', error);
    return jsonOk({ success: false, error: errorMessage(error) || 'Internal server error' }, { status: 502 });
  }
}
