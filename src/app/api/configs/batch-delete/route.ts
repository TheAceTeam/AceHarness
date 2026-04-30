import { NextRequest, NextResponse } from 'next/server';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { requireAuth } from '@/lib/auth-middleware';
import { getConfigMeta, deleteConfigMeta } from '@/lib/config-metadata';
import { getRuntimeConfigsDirPath, getRuntimeWorkflowConfigPath, markConfigDeleted } from '@/lib/runtime-configs';

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

        const filepath = await getRuntimeWorkflowConfigPath(filename);
        if (existsSync(filepath)) {
          await unlink(filepath);
        }
        await markConfigDeleted(configsDir, filename);
        await deleteConfigMeta(filename, 'workflow');
        deletedCount++;
      } catch (err: any) {
        errors.push(`${filename}: ${err.message}`);
      }
    }

    return NextResponse.json({ success: true, deletedCount, errors: errors.length > 0 ? errors : undefined });
  } catch (error: any) {
    return NextResponse.json({ error: '批量删除失败', message: error.message }, { status: 500 });
  }
}
