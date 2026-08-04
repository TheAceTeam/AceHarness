import { requireAuth } from '@/lib/auth/middleware';
import { listConfigsWithMeta } from '@/lib/config/metadata';
import { loadUsers } from '@/lib/core/user-store';
import {
  getCreatedAtTime,
  listIndexedConfigSummaries,
  paginate,
  readPositiveInt,
  type ConfigSortDirection,
  type ConfigSortKey,
} from '@/lib/config/config-summary-index';
import { ensureRuntimeConfigsSeeded, getRuntimeConfigsDirPath } from '@/lib/run/runtime-configs';
import { errorMessage, jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;

    const { searchParams } = new URL(request.url);
    const page = readPositiveInt(searchParams.get('page'), 1);
    const pageSize = Math.min(readPositiveInt(searchParams.get('pageSize'), 20), 100);
    const sortKey: ConfigSortKey = searchParams.get('sortKey') === 'name' ? 'name' : 'createdAt';
    const sortDirection: ConfigSortDirection = searchParams.get('sortDirection') === 'asc' ? 'asc' : 'desc';
    const mode = searchParams.get('mode') || 'all';
    const keyword = (searchParams.get('keyword') || searchParams.get('search') || '').trim().toLowerCase();

    await ensureRuntimeConfigsSeeded();
    const configsDir = await getRuntimeConfigsDirPath();
    const metaMap = await listConfigsWithMeta('workflow');
    const usersById = new Map((await loadUsers().catch(() => [])).map((user) => [user.id, user]));
    const indexed = await listIndexedConfigSummaries({ configsDir, metaMap, auth, usersById });
    const direction = sortDirection === 'asc' ? 1 : -1;

    let filteredConfigs = indexed.configs;
    if (mode === 'lightweight' || mode === 'state-machine') {
      filteredConfigs = filteredConfigs.filter((item) => item.kind === mode);
    }
    if (keyword) {
      filteredConfigs = filteredConfigs.filter((item) => {
        const haystack = `${item.name} ${item.filename} ${item.description || ''}`.toLowerCase();
        return haystack.includes(keyword);
      });
    }
    filteredConfigs = [...filteredConfigs].sort((a, b) => {
      if (sortKey === 'createdAt') {
        const diff = getCreatedAtTime(a.createdAt) - getCreatedAtTime(b.createdAt);
        if (diff !== 0) return diff * direction;
        return a.name.localeCompare(b.name, 'zh-CN') * direction;
      }
      const nameDiff = a.name.localeCompare(b.name, 'zh-CN');
      if (nameDiff !== 0) return nameDiff * direction;
      return a.filename.localeCompare(b.filename, 'zh-CN') * direction;
    });

    const paged = paginate(filteredConfigs, page, pageSize);
    return jsonOk({
      files: paged.items.map((item) => item.filename),
      configs: paged.items,
      pagination: {
        total: paged.total,
        totalPages: paged.totalPages,
        page: paged.page,
        pageSize: paged.pageSize,
        unfilteredTotal: indexed.configs.length,
      },
      filters: { keyword, mode, sortKey, sortDirection },
      index: { persisted: true, path: indexed.indexPath },
    });
  } catch (error: any) {
    return jsonError('获取配置列表失败', 500, errorMessage(error));
  }
}
