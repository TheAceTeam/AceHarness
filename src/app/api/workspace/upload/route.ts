import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import {
  WORKSPACE_UPLOAD_FILE_COUNT_LIMIT,
  WORKSPACE_UPLOAD_FILE_SIZE_LIMIT,
  WORKSPACE_UPLOAD_TOTAL_SIZE_LIMIT,
  WorkspacePathError,
  assertSafeRelativePath,
  getConflictSafePath,
  isInsidePath,
  resolveWorkspaceRoot,
  workspaceErrorResponse,
} from '@/lib/workspace-path-safety';

function parseRelativePaths(value: FormDataEntryValue | null, fileCount: number): string[] {
  if (typeof value !== 'string' || !value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== fileCount || parsed.some((item) => typeof item !== 'string')) {
      throw new WorkspacePathError('relativePaths 格式不合法');
    }
    return parsed;
  } catch (error) {
    if (error instanceof WorkspacePathError) throw error;
    throw new WorkspacePathError('relativePaths 不是有效 JSON');
  }
}

async function ensureUploadParent(root: string, fullPath: string): Promise<void> {
  const parent = path.dirname(fullPath);
  if (!isInsidePath(root, parent)) throw new WorkspacePathError('路径不合法', 403);

  await fs.mkdir(parent, { recursive: true });
  const realParent = await fs.realpath(parent);
  if (!isInsidePath(root, realParent)) throw new WorkspacePathError('路径不合法', 403);
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return NextResponse.json({ error: '请求必须是 multipart/form-data' }, { status: 400 });
    }

    const formData = await request.formData();
    const workspace = formData.get('workspace');
    const targetPathValue = formData.get('targetPath');
    const conflictValue = formData.get('conflict');
    const files = formData.getAll('files').filter((item): item is File => item instanceof File);

    if (typeof workspace !== 'string' || !workspace) {
      return NextResponse.json({ error: '缺少 workspace 参数' }, { status: 400 });
    }

    if (files.length === 0) {
      return NextResponse.json({ error: '缺少上传文件' }, { status: 400 });
    }

    if (files.length > WORKSPACE_UPLOAD_FILE_COUNT_LIMIT) {
      return NextResponse.json({ error: `上传文件数量超过 ${WORKSPACE_UPLOAD_FILE_COUNT_LIMIT} 个限制` }, { status: 413 });
    }

    const conflict = typeof conflictValue === 'string' ? conflictValue : 'rename';
    if (conflict !== 'rename' && conflict !== 'error') {
      return NextResponse.json({ error: 'conflict 参数不合法' }, { status: 400 });
    }

    const root = await resolveWorkspaceRoot(workspace);
    const targetPath = typeof targetPathValue === 'string' ? targetPathValue : '';
    const safeTargetPath = assertSafeRelativePath(targetPath, '目标目录');
    const targetDir = path.resolve(root, safeTargetPath);
    if (!isInsidePath(root, targetDir)) throw new WorkspacePathError('路径不合法', 403);

    await fs.mkdir(targetDir, { recursive: true });
    const realTargetDir = await fs.realpath(targetDir);
    if (!isInsidePath(root, realTargetDir)) throw new WorkspacePathError('路径不合法', 403);

    const relativePaths = parseRelativePaths(formData.get('relativePaths'), files.length);
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > WORKSPACE_UPLOAD_TOTAL_SIZE_LIMIT) {
      return NextResponse.json({ error: '上传总大小超过 200MB 限制' }, { status: 413 });
    }

    const saved: Array<{ name: string; path: string; size: number }> = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (file.size > WORKSPACE_UPLOAD_FILE_SIZE_LIMIT) {
        throw new WorkspacePathError(`文件 ${file.name} 超过 50MB 限制`, 413);
      }

      const originalRelativePath = relativePaths[index] || file.name;
      const safeFilePath = assertSafeRelativePath(originalRelativePath, '文件路径');
      if (!safeFilePath) throw new WorkspacePathError('文件路径不合法', 403);

      let finalPath = path.resolve(realTargetDir, safeFilePath);
      if (!isInsidePath(root, finalPath)) throw new WorkspacePathError('路径不合法', 403);

      await ensureUploadParent(root, finalPath);
      if (conflict === 'error') {
        try {
          await fs.lstat(finalPath);
          throw new WorkspacePathError(`文件已存在: ${originalRelativePath}`, 409);
        } catch (error: any) {
          if (error?.code !== 'ENOENT') throw error;
        }
      } else {
        finalPath = await getConflictSafePath(finalPath);
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(finalPath, buffer, { flag: 'wx' });
      saved.push({
        name: path.basename(finalPath),
        path: path.relative(root, finalPath),
        size: file.size,
      });
    }

    return NextResponse.json({ success: true, count: saved.length, files: saved });
  } catch (error: any) {
    const { message, status } = workspaceErrorResponse(error);
    return NextResponse.json({ error: message, message }, { status });
  }
}
