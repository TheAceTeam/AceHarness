import { MarketplaceClient } from '@/lib/marketplace/client';
import { CACHE_DURATION } from '@/constants/marketplace';
import { errorMessage, jsonOk } from '@/server/api-route-runtime/request-utils';

let categoriesCache: {
  data: any;
  timestamp: number;
} | null = null;

export async function GET() {
  try {
    if (categoriesCache && Date.now() - categoriesCache.timestamp < CACHE_DURATION) {
      return jsonOk({
        success: true,
        data: categoriesCache.data,
      });
    }

    const client = new MarketplaceClient();
    const categoryMap = await client.getAllCategories();

    const categories = Array.from(categoryMap.entries())
      .map(([id, value]) => ({
        id,
        enName: value.enName,
        cnName: value.cnName,
        count: value.count,
      }))
      .sort((a, b) => b.count - a.count);

    const result = { categories };

    categoriesCache = {
      data: result,
      timestamp: Date.now(),
    };

    return jsonOk({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Categories API error:', error);

    return jsonOk({
      success: false,
      error: errorMessage(error) || 'Internal server error',
    }, { status: 500 });
  }
}
