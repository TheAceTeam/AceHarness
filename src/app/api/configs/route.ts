import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile, stat } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import { requireAuth } from '@/lib/auth-middleware';
import { listConfigsWithMeta } from '@/lib/config-metadata';
import { ensureRuntimeConfigsSeeded, getRuntimeConfigsDirPath } from '@/lib/runtime-configs';

export const dynamic = 'force-dynamic';

type ConfigSortKey = 'name' | 'createdAt';
type SortDirection = 'asc' | 'desc';

function readPositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readSortKey(value: string | null): ConfigSortKey {
  return value === 'name' ? 'name' : 'createdAt';
}

function readSortDirection(value: string | null): SortDirection {
  return value === 'asc' ? 'asc' : 'desc';
}

function getCreatedAtTime(value?: number | string): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const safePageSize = Math.max(1, pageSize);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * safePageSize;
  return {
    items: items.slice(start, start + safePageSize),
    total,
    totalPages,
    page: safePage,
    pageSize: safePageSize,
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const page = readPositiveInt(searchParams.get('page'), 1);
    const pageSize = Math.min(readPositiveInt(searchParams.get('pageSize'), 20), 100);
    const sortKey = readSortKey(searchParams.get('sortKey'));
    const sortDirection = readSortDirection(searchParams.get('sortDirection'));
    const mode = searchParams.get('mode') || 'all';
    const keyword = (searchParams.get('keyword') || searchParams.get('search') || '').trim().toLowerCase();

    await ensureRuntimeConfigsSeeded();
    const configsDir = await getRuntimeConfigsDirPath();
    const entries = await readdir(configsDir, { withFileTypes: true });
    const metaMap = await listConfigsWithMeta('workflow');

    // Filter only workflow YAML files (not directories, not settings)
    const yamlFiles: string[] = [];

    // Collect files from both root and subdirectories
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
        const meta = metaMap[entry.name];
        if (meta?.visibility === 'private' && meta.createdBy && meta.createdBy !== auth.id && auth.role !== 'admin') {
          continue;
        }
        yamlFiles.push(entry.name);
      } else if (entry.isDirectory() && entry.name !== 'agents') {
        // Recursively scan subdirectories (except 'agents')
        try {
          const subEntries = await readdir(resolve(configsDir, entry.name), { withFileTypes: true });
          for (const subEntry of subEntries) {
            if (subEntry.isFile() && (subEntry.name.endsWith('.yaml') || subEntry.name.endsWith('.yml'))) {
              const relPath = `${entry.name}/${subEntry.name}`;
              const meta = metaMap[relPath];
              if (meta?.visibility === 'private' && meta.createdBy && meta.createdBy !== auth.id && auth.role !== 'admin') {
                continue;
              }
              yamlFiles.push(relPath);
            }
          }
        } catch { /* subdirectory may not exist */ }
      }
    }

    // Count agents from configs/agents/ directory
    let agentCount = 0;
    try {
      const agentsDir = resolve(configsDir, 'agents');
      const agentFiles = await readdir(agentsDir);
      agentCount = agentFiles.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).length;
    } catch { /* agents dir may not exist */ }

    const configs = [];
    for (const file of yamlFiles) {
      try {
        const filePath = resolve(configsDir, file);
        const content = await readFile(filePath, 'utf-8');
        const config = parse(content);

        const hasWorkflowRoot = Boolean(config?.workflow && typeof config.workflow === 'object');
        const hasPhaseWorkflow = Array.isArray(config?.workflow?.phases);
        const hasStateWorkflow = Array.isArray(config?.workflow?.states);
        if (!hasWorkflowRoot || (!hasPhaseWorkflow && !hasStateWorkflow)) {
          continue;
        }

        // 检测工作流模式
        const mode = config?.workflow?.mode || 'phase-based';

        // 根据模式计算统计信息
        let phaseCount = 0;
        let stepCount = 0;

        if (mode === 'state-machine') {
          // 状态机模式
          phaseCount = config?.workflow?.states?.length || 0;
          stepCount = config?.workflow?.states?.reduce(
            (sum: number, s: any) => sum + (s.steps?.length || 0), 0
          ) || 0;
        } else {
          // 阶段模式
          phaseCount = config?.workflow?.phases?.length || 0;
          stepCount = config?.workflow?.phases?.reduce(
            (sum: number, p: any) => sum + (p.steps?.length || 0), 0
          ) || 0;
        }

        configs.push({
          filename: file,
          name: config?.workflow?.name || file,
          description: config?.workflow?.description || '',
          mode,
          phaseCount,
          stepCount,
          agentCount,
          createdAt: metaMap[file]?.createdAt || (await stat(filePath)).birthtimeMs,
        });
      } catch {
        // skip malformed or non-workflow yaml files
      }
    }

    const unfilteredTotal = configs.length;
    let filteredConfigs = configs;

    if (mode === 'phase-based' || mode === 'state-machine') {
      filteredConfigs = filteredConfigs.filter((item) => item.mode === mode);
    }

    if (keyword) {
      filteredConfigs = filteredConfigs.filter((item) => {
        const haystack = `${item.name} ${item.filename} ${item.description || ''}`.toLowerCase();
        return haystack.includes(keyword);
      });
    }

    const direction = sortDirection === 'asc' ? 1 : -1;
    filteredConfigs = [...filteredConfigs].sort((a, b) => {
      if (sortKey === 'createdAt') {
        const diff = getCreatedAtTime(a.createdAt) - getCreatedAtTime(b.createdAt);
        if (diff !== 0) return diff * direction;
        return a.name.localeCompare(b.name, 'zh-CN');
      }
      const nameDiff = a.name.localeCompare(b.name, 'zh-CN');
      if (nameDiff !== 0) return nameDiff * direction;
      return a.filename.localeCompare(b.filename, 'zh-CN') * direction;
    });

    const paged = paginate(filteredConfigs, page, pageSize);

    return NextResponse.json({
      files: paged.items.map((item) => item.filename),
      configs: paged.items,
      pagination: {
        total: paged.total,
        totalPages: paged.totalPages,
        page: paged.page,
        pageSize: paged.pageSize,
        unfilteredTotal,
      },
      filters: {
        keyword,
        mode,
        sortKey,
        sortDirection,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取配置列表失败', message: error.message },
      { status: 500 }
    );
  }
}
