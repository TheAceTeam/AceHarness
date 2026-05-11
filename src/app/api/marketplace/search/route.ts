import { NextRequest, NextResponse } from 'next/server';
import { adaptMatrixSkills } from '@/lib/marketplace-adapter';
import { MarketplaceClient } from '@/lib/marketplace-client';
import { validateSearchRequest } from '@/lib/marketplace-validators';
import { DEFAULT_PAGE_SIZE } from '@/constants/marketplace';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!validateSearchRequest(body)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid request parameters',
      }, { status: 400 });
    }

    const {
      keyword,
      category,
      pageNum = 1,
      pageSize = DEFAULT_PAGE_SIZE,
    } = body;

    const client = new MarketplaceClient();
    const response = await client.searchSkills({
      pageNum,
      pageSize,
      keyword: keyword || '',
      categoryId: category || undefined,
      statusList: ['2', '3'],
    } as any);
    const paginatedSkills = adaptMatrixSkills(response.data.list || []);
    const totalFiltered = Number(response.data.count || 0);

    return NextResponse.json({
      success: true,
      data: {
        skills: paginatedSkills,
        total: totalFiltered,
        pageNum,
        pageSize,
        isFiltered: !!category,
      },
    });
  } catch (error: any) {
    console.error('Search API error:', error);

    return NextResponse.json({
      success: false,
      error: error.message || 'Internal server error',
    }, { status: 500 });
  }
}
