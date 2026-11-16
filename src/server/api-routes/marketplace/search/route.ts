import { DEFAULT_PAGE_SIZE } from '@/constants/marketplace';
import { searchMarketplaceSource } from '@/lib/marketplace/provider';
import { getMarketplaceSource } from '@/lib/marketplace/sources';
import { validateSearchRequest } from '@/lib/marketplace/validators';
import { requireAuth } from '@/lib/auth/middleware';
import { errorMessage, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request, {});
    if (!validateSearchRequest(body)) {
      return jsonOk({ success: false, error: 'Invalid request parameters' }, { status: 400 });
    }

    const { source = 'matrix', keyword, category, pageNum = 1, pageSize = DEFAULT_PAGE_SIZE } = body;
    if (source !== 'matrix') {
      const auth = await requireAuth(request);
      if (auth instanceof Response) return auth;
    }

    const selected = await getMarketplaceSource(source);
    if (!selected) {
      return jsonOk({ success: false, error: '该市场来源不存在' }, { status: 404 });
    }

    const page = await searchMarketplaceSource(selected, pageNum, pageSize, keyword, category).catch((error) => {
      console.warn('[marketplace] Search failed for ' + selected.id, errorMessage(error));
      return null;
    });
    if (!page) {
      return jsonOk({ success: false, error: '当前技能市场暂不可用，请稍后重试。' }, { status: 502 });
    }
    const { skills, total } = page;
    return jsonOk({
      success: true,
      data: {
        skills,
        total,
        totalPages: Math.ceil(total / pageSize),
        pageNum,
        pageSize,
        isFiltered: Boolean(category),
      },
    });
  } catch (error) {
    console.error('Search API error:', error);
    return jsonOk({ success: false, error: errorMessage(error) || 'Internal server error' }, { status: 500 });
  }
}
