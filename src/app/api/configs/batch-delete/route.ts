import { NextRequest, NextResponse } from 'next/server';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { requireAuth } from '@/lib/auth/middleware';
import { getConfigMeta, deleteConfigMeta } from '@/lib/config/metadata';
import { getRuntimeConfigsDirPath, getRuntimeWorkflowConfigPath, markConfigDeleted } from '@/lib/run/runtime-configs';
import { deleteRunsByConfig } from '@/lib/run/store';
import { workflowRegistry } from '@/lib/workflow/registry';

async function stopRunningWorkflow(filename: string): Promise<void> {
  const manager = workflowRegistry.getRunningManager(filename);
  if (!manager) return;
  await manager.stop();
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { filenames } = await request.json();
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return NextResponse.json({ error: '请提供要删除的文件列表' }, { status: 400 });
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
        if (meta?.visibility === 'private' && meta.createdBy !== auth.id && auth.role !== 'admin') {
          errors.push(`${filename}: 无权限`);
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

    return NextResponse.json({
      success: true,
      deletedCount,
      deletedRunsCount,
      deletedRunIds,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    return NextResponse.json({ error: '批量删除失败', message: error.message }, { status: 500 });
  }
}
