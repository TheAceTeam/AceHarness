import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { requireAuth } from '@/lib/auth/middleware';
import { getConfigMeta, setConfigMeta } from '@/lib/config/metadata';
import { ensureRuntimeConfigsSeeded, getRuntimeConfigsDirPath } from '@/lib/run/runtime-configs';

function normalizeConfigFilename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error('无效文件名');
  }
  return normalized;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { newFilename, workflowName } = await request.json();
    if (!newFilename || !/^[a-zA-Z0-9_-]+\.yaml$/.test(newFilename)) {
      return NextResponse.json({ error: '无效的文件名' }, { status: 400 });
    }

    const filename = (await params).filename;
    const sourceMeta = await getConfigMeta(filename, 'workflow');
    if (sourceMeta?.visibility === 'private' && sourceMeta.createdBy && sourceMeta.createdBy !== auth.id && auth.role !== 'admin') {
      return NextResponse.json({ error: '无权限访问该工作流' }, { status: 403 });
    }

    await ensureRuntimeConfigsSeeded();
    const configsDir = await getRuntimeConfigsDirPath();
    const sourcePath = resolve(configsDir, normalizeConfigFilename(filename));
    const destPath = resolve(configsDir, newFilename);

    if (existsSync(destPath)) {
      return NextResponse.json({ error: '目标文件已存在' }, { status: 409 });
    }

    const content = await readFile(sourcePath, 'utf-8');
    const config = parse(content);
    config.workflow.name = workflowName || (config.workflow.name + ' (副本)');
    await writeFile(destPath, stringify(config), 'utf-8');
    await setConfigMeta(newFilename, {
      createdBy: auth.id,
      visibility: 'private',
      createdAt: Date.now(),
    }, 'workflow');

    return NextResponse.json({ success: true, filename: newFilename });
  } catch (error: any) {
    return NextResponse.json(
      { error: '复制配置失败', message: error.message },
      { status: 500 }
    );
  }
}
