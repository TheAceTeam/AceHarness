import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { parse } from 'yaml';
import { workflowRegistry } from '@/lib/workflow/registry';
import { getWorkspaceRunsDir } from '@/lib/core/app-paths';
import { deleteRun } from '@/lib/run/store';
import { jsonOk } from '@/server/api-route-runtime/request-utils';

const RUNS_DIR = getWorkspaceRunsDir();

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const runId = (await params).id;
    const runDir = resolve(RUNS_DIR, runId);

    // Read state.yaml to get workingDirectory and check if running
    let configFile: string | null = null;
    try {
      const stateFile = resolve(runDir, 'state.yaml');
      if (existsSync(stateFile)) {
        const content = await readFile(stateFile, 'utf-8');
        const state = parse(content);
        configFile = state.configFile || null;
      }
    } catch { /* ignore */ }

    // If workflow is running/preparing, stop it first
    if (configFile) {
      try {
        const manager = await workflowRegistry.getManager(configFile);
        const status = manager.getStatus();
        if (status.runId === runId && (status.status === 'running' || status.status === 'preparing')) {
          await manager.stop();
        }
      } catch { /* ignore */ }
    }

    await deleteRun(runId);

    return jsonOk({
      success: true,
      message: '运行记录已删除',
    });
  } catch (error: any) {
    return jsonOk(
      { error: '删除失败', message: error.message },
      { status: 500 }
    );
  }
}
