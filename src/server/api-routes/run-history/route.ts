import { requireAuth } from '@/lib/auth/middleware';
import {
  applyConfigNamesToRuns,
  buildTokenRankingsForRuns,
  attachRunHistoryTree,
  type HistoryView,
  paginateRuns,
  readAccessibleConfigNameMap,
  readAllRunsSummary,
  sortRuns,
  sortTokenRankings,
  type RunSortKey,
  type SortDirection,
  type TokenRankingDimension,
  type TokenRankingSortKey,
} from '@/lib/run/history';
import { listUsers } from '@/lib/core/user-store';
import { jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

function readPositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readView(value: string | null): HistoryView {
  return value === 'token-ranking' ? 'token-ranking' : 'runs';
}

function readRunSortKey(value: string | null): RunSortKey {
  if (value === 'name' || value === 'totalTokens' || value === 'cost') return value;
  return 'startTime';
}

function readTokenRankingSortKey(value: string | null): TokenRankingSortKey {
  if (value === 'name' || value === 'runs' || value === 'cost') return value;
  return 'totalTokens';
}

function readSortDirection(value: string | null): SortDirection {
  return value === 'asc' ? 'asc' : 'desc';
}

function readTokenRankingDimension(value: string | null): TokenRankingDimension {
  return value === 'user' ? 'user' : 'workflow';
}

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = requestUrl(request);
    const page = readPositiveInt(searchParams.get('page'), 1);
    const pageSize = Math.min(readPositiveInt(searchParams.get('pageSize'), 20), 100);
    const view = readView(searchParams.get('view'));
    const sortDirection = readSortDirection(searchParams.get('sortDirection'));
    const ownerId = searchParams.get('ownerId')?.trim() || '';
    const keyword = searchParams.get('keyword')?.trim().toLowerCase() || '';
    const dimension = readTokenRankingDimension(searchParams.get('dimension'));

    const [configNameMap, runsResult, users] = await Promise.all([
      readAccessibleConfigNameMap(auth.id, auth.role),
      readAllRunsSummary(),
      auth.role === 'admin' ? listUsers() : Promise.resolve([]),
    ]);

    let runs = applyConfigNamesToRuns(runsResult.runs, configNameMap, auth.role);
    if (auth.role !== 'admin') {
      runs = runs.filter((run) => !run.ownerId || run.ownerId === auth.id);
    }

    if (auth.role === 'admin' && ownerId && ownerId !== 'all') {
      runs = runs.filter((run) => run.ownerId === ownerId);
    }

    if (keyword) {
      runs = runs.filter((run) => {
        const name = `${run.configName} ${run.configFile}`.toLowerCase();
        return name.includes(keyword);
      });
    }

    if (view === 'token-ranking') {
      const sortKey = readTokenRankingSortKey(searchParams.get('sortKey'));
      const rankings = buildTokenRankingsForRuns(runs);
      const selectedRankings = dimension === 'user'
        ? rankings.tokenRankingByUser
        : rankings.tokenRankingByWorkflow;
      const paged = paginateRuns(sortTokenRankings(selectedRankings, sortKey, sortDirection), page, pageSize);

      return jsonOk({
        view,
        rankings: paged.items,
        pagination: {
          total: paged.total,
          totalPages: paged.totalPages,
          page: paged.page,
          pageSize: paged.pageSize,
        },
        filters: {
          view,
          dimension,
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
    }

    const sortKey = readRunSortKey(searchParams.get('sortKey'));
    const tree = searchParams.get('tree') === '1';
    runs = sortRuns(runs, sortKey, sortDirection);
    const responseRuns = tree ? attachRunHistoryTree(runs) : runs;
    const paged = paginateRuns(responseRuns, page, pageSize);

    return jsonOk({
      view,
      runs: paged.items,
      tree,
      pagination: {
        total: paged.total,
        totalPages: paged.totalPages,
        page: paged.page,
        pageSize: paged.pageSize,
      },
      filters: {
        view,
        dimension,
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
    return jsonOk(
      { error: '运行记录加载失败', message: error?.message || 'unknown error' },
      { status: 500 }
    );
  }
}
