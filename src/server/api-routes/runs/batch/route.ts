import { deleteRun } from '@/lib/run/store';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { workflowRegistry } from '@/lib/workflow/registry';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

const RUNS_DIR = resolve(process.cwd(), 'runs');

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const { action, runIds } = body;

    if (action !== 'delete') {
      return jsonOk(
        { error: '不支持的操作' },
        { status: 400 }
      );
    }

    if (!Array.isArray(runIds) || runIds.length === 0) {
      return jsonOk(
        { error: '缺少运行记录ID列表' },
        { status: 400 }
      );
    }

    let deletedCount = 0;
    const errors: string[] = [];

    for (const runId of runIds) {
      try {
        try {
          const stateFile = resolve(RUNS_DIR, runId, 'state.yaml');
          if (existsSync(stateFile)) {
            const content = await readFile(stateFile, 'utf-8');
            const state = parse(content);
            if (state.configFile) {
              try {
                const manager = await workflowRegistry.getManager(state.configFile);
                const status = manager.getStatus();
                if (status.runId === runId && (status.status === 'running' || status.status === 'preparing')) {
                  await manager.stop();
                }
              } catch { /* ignore */ }
            }
          }
        } catch { /* ignore */ }
        await deleteRun(runId);
        deletedCount++;
      } catch (error: any) {
        errors.push(`${runId}: ${error.message}`);
      }
    }

    return jsonOk({
      success: true,
      message: `已删除 ${deletedCount} 条运行记录${errors.length > 0 ? `，${errors.length} 条失败` : ''}`,
      deletedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    return jsonOk(
      { error: '批量删除失败', message: error.message },
      { status: 500 }
    );
  }
}
