import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile, stat } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import { requireAuth } from '@/lib/auth-middleware';
import { listConfigsWithMeta } from '@/lib/config-metadata';
import { ensureRuntimeConfigsSeeded, getRuntimeConfigsDirPath } from '@/lib/runtime-configs';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

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
        });
      } catch {
        // skip malformed or non-workflow yaml files
      }
    }

    return NextResponse.json({ files: configs.map((item) => item.filename), configs });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取配置列表失败', message: error.message },
      { status: 500 }
    );
  }
}
