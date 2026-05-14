import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import {
  applyConfigNamesToRuns,
  paginateRuns,
  readAccessibleConfigNameMap,
  readAllRunsSummary,
  sortRuns,
  type RunSortKey,
  type SortDirection,
} from '@/lib/run/history';
import { listUsers } from '@/lib/core/user-store';

export const dynamic = 'force-dynamic';

function readPositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readSortKey(value: string | null): RunSortKey {
  return value === 'name' ? 'name' : 'startTime';
}

function readSortDirection(value: string | null): SortDirection {
  return value === 'asc' ? 'asc' : 'desc';
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const page = readPositiveInt(searchParams.get('page'), 1);
    const pageSize = Math.min(readPositiveInt(searchParams.get('pageSize'), 20), 100);
    const sortKey = readSortKey(searchParams.get('sortKey'));
    const sortDirection = readSortDirection(searchParams.get('sortDirection'));
    const ownerId = searchParams.get('ownerId')?.trim() || '';
    const keyword = searchParams.get('keyword')?.trim().toLowerCase() || '';

    const [configNameMap, runsResult, users] = await Promise.all([
      readAccessibleConfigNameMap(auth.id, auth.role),
      readAllRunsSummary(),
      auth.role === 'admin' ? listUsers() : Promise.resolve([]),
    ]);

    let runs = applyConfigNamesToRuns(runsResult.runs, configNameMap, auth.role);

    if (auth.role === 'admin' && ownerId && ownerId !== 'all') {
      runs = runs.filter((run) => run.ownerId === ownerId);
    }

    if (keyword) {
      runs = runs.filter((run) => {
        const name = `${run.configName} ${run.configFile}`.toLowerCase();
        return name.includes(keyword);
      });
    }

    runs = sortRuns(runs, sortKey, sortDirection);
    const paged = paginateRuns(runs, page, pageSize);

    return NextResponse.json({
      runs: paged.items,
      pagination: {
        total: paged.total,
        totalPages: paged.totalPages,
        page: paged.page,
        pageSize: paged.pageSize,
      },
      filters: {
        sortKey,
        sortDirection,
        ownerId: auth.role === 'admin' ? ownerId || 'all' : 'all',
        keyword,
      },
      userOptions: auth.role === 'admin'
        ? users.map((user) => ({ id: user.id, username: user.username }))
        : [],
      isAdmin: auth.role === 'admin',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '运行记录加载失败', message: error?.message || 'unknown error' },
      { status: 500 }
    );
  }
}
