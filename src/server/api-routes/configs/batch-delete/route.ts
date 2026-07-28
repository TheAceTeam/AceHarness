import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { requireAuth } from '@/lib/auth/middleware';
import { getConfigMeta, deleteConfigMeta } from '@/lib/config/metadata';
import { getRuntimeConfigsDirPath, getRuntimeWorkflowConfigPath, markConfigDeleted } from '@/lib/run/runtime-configs';
import { deleteRunsByConfig } from '@/lib/run/store';
import { workflowRegistry } from '@/lib/workflow/registry';
import { findWorkflowReferences } from '@/lib/workflow/references';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

async function stopRunningWorkflow(filename: string): Promise<void> {
  const manager = workflowRegistry.getRunningManager(filename);
  if (!manager) return;
  await manager.stop();
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;

    const { filenames, force } = await readJsonBody<Record<string, any>>(request, {});
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return jsonError('请提供要删除的文件列表', 400);
    }

    const configsDir = await getRuntimeConfigsDirPath();
    const errors: string[] = [];
    let deletedCount = 0;
    let deletedRunsCount = 0;
    const deletedRunIds: string[] = [];

    for (const raw of filenames) {
      const filename = String(raw).replace(/\\/g, '/').replace(/^\/+/, '');
      if (!filename || filename.includes('..')) {
        errors.push(`${raw}: 无效文件名`);
        continue;
      }

      try {
        const meta = await getConfigMeta(filename, 'workflow');
        if (auth.role !== 'admin' && meta?.createdBy && meta.createdBy !== auth.id) {
          errors.push(`${filename}: 无权限`);
          continue;
        }
        const references = await findWorkflowReferences(filename, { id: auth.id, role: auth.role });
        if (!force && references.length > 0) {
          errors.push(`${filename}: 正在被 ${references.length} 个工作流引用，需显式 force 删除`);
          continue;
        }

        await stopRunningWorkflow(filename);
        const filepath = await getRuntimeWorkflowConfigPath(filename);
        if (existsSync(filepath)) {
          await unlink(filepath);
        }
        await markConfigDeleted(configsDir, filename);
        await deleteConfigMeta(filename, 'workflow');
        const runsCleanup = await deleteRunsByConfig(filename);
        deletedRunsCount += runsCleanup.deletedCount;
        deletedRunIds.push(...runsCleanup.runIds);
        deletedCount++;
      } catch (err: any) {
        errors.push(`${filename}: ${err.message}`);
      }
    }

    return jsonOk({
      success: true,
      deletedCount,
      deletedRunsCount,
      deletedRunIds,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    return jsonError('批量删除失败', 500, errorMessage(error));
  }
}
