import { NextRequest, NextResponse } from 'next/server';
import { adaptMatrixSkills } from '@/lib/marketplace-adapter';
import { MarketplaceClient } from '@/lib/marketplace-client';
import { validateSearchRequest } from '@/lib/marketplace-validators';
import { DEFAULT_PAGE_SIZE } from '@/constants/marketplace';
import { MarketplaceSkill } from '@/types/marketplace';

interface CachedData {
  skills: MarketplaceSkill[];
  total: number;
  timestamp: number;
}

let skillsCache: CachedData | null = null;
const CACHE_TTL = 5 * 60 * 1000;

async function getAllSkills(): Promise<CachedData> {
  const now = Date.now();
  
  if (skillsCache && (now - skillsCache.timestamp) < CACHE_TTL) {
    return skillsCache;
  }

  const client = new MarketplaceClient();
  
  const firstPageResponse = await client.searchSkills({
    pageNum: 1,
    pageSize: 1,
  });
  
  const totalCount = firstPageResponse.data.count;
  
  const fullResponse = await client.searchSkills({
    pageNum: 1,
    pageSize: totalCount,
  });
  
  const skills = adaptMatrixSkills(fullResponse.data.list);
  
  skillsCache = {
    skills,
    total: totalCount,
    timestamp: now,
  };
  
  return skillsCache;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!validateSearchRequest(body)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid request parameters',
      }, { status: 400 });
    }

    const { keyword, category, pageNum = 1, pageSize = DEFAULT_PAGE_SIZE } = body;

    const cachedData = await getAllSkills();
    let skills = cachedData.skills;

    if (keyword) {
      const lowerKeyword = keyword.toLowerCase();
      skills = skills.filter(skill => 
        skill.name.toLowerCase().includes(lowerKeyword) ||
        skill.enName?.toLowerCase().includes(lowerKeyword) ||
        skill.description.toLowerCase().includes(lowerKeyword) ||
        skill.tags.some(tag => tag.toLowerCase().includes(lowerKeyword))
      );
    }

    if (category) {
      skills = skills.filter(skill => skill.categoryIds?.includes(category));
    }

    const totalFiltered = skills.length;
    const startIndex = (pageNum - 1) * pageSize;
    const paginatedSkills = skills.slice(startIndex, startIndex + pageSize);

    return NextResponse.json({
      success: true,
      data: {
        skills: paginatedSkills,
        total: totalFiltered,
        pageNum,
        pageSize,
        isFiltered: !!category,
        sourceTotal: cachedData.total,
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