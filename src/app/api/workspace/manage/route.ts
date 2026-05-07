import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import {
  WorkspacePathError,
  assertSafeRelativePath,
  isInsidePath,
  resolveCreatableInsideWorkspace,
  resolveExistingInsideWorkspace,
  resolveWorkspaceRoot,
  workspaceErrorResponse,
} from '@/lib/workspace-path-safety';

async function ensureDestinationAvailable(fullPath: string): Promise<void> {
  try {
    await fs.lstat(fullPath);
    throw new WorkspacePathError('目标路径已存在', 409);
  } catch (error: any) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
}

async function createParentDirectories(root: string, relPath: string): Promise<string> {
  const safeRelPath = assertSafeRelativePath(relPath);
  if (!safeRelPath) throw new WorkspacePathError('路径不合法', 403);

  const fullPath = path.resolve(root, safeRelPath);
  if (!isInsidePath(root, fullPath)) throw new WorkspacePathError('路径不合法', 403);

  const relativeParent = path.relative(root, path.dirname(fullPath));
  const parentPath = path.resolve(root, relativeParent);
  if (!isInsidePath(root, parentPath)) throw new WorkspacePathError('路径不合法', 403);

  await fs.mkdir(parentPath, { recursive: true });
  const realParent = await fs.realpath(parentPath);
  if (!isInsidePath(root, realParent)) throw new WorkspacePathError('路径不合法', 403);

  return fullPath;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workspace, action, ...params } = body;

    if (!workspace || !action) {
      return NextResponse.json({ error: '缺少 workspace 或 action 参数' }, { status: 400 });
    }

    const resolvedWorkspace = await resolveWorkspaceRoot(workspace);

    switch (action) {
      case 'create-file': {
        const fullPath = await createParentDirectories(resolvedWorkspace, params.path);
        await ensureDestinationAvailable(fullPath);
        await fs.writeFile(fullPath, params.content || '', 'utf-8');
        return NextResponse.json({ success: true });
      }

      case 'create-folder': {
        const fullPath = await createParentDirectories(resolvedWorkspace, params.path);
        await ensureDestinationAvailable(fullPath);
        await fs.mkdir(fullPath);
        return NextResponse.json({ success: true });
      }

      case 'rename': {
        const oldFull = await resolveExistingInsideWorkspace(resolvedWorkspace, params.oldPath);
        const { fullPath: newFull } = await resolveCreatableInsideWorkspace(resolvedWorkspace, params.newPath);
        await ensureDestinationAvailable(newFull);
        await fs.rename(oldFull, newFull);
        return NextResponse.json({ success: true });
      }

      case 'delete': {
        const fullPath = await resolveExistingInsideWorkspace(resolvedWorkspace, params.path);
        if (fullPath === resolvedWorkspace) {
          return NextResponse.json({ error: '不能删除 workspace 根目录' }, { status: 400 });
        }
        await fs.rm(fullPath, { recursive: true, force: false });
        return NextResponse.json({ success: true });
      }

      case 'copy': {
        const srcFull = await resolveExistingInsideWorkspace(resolvedWorkspace, params.srcPath);
        const destFull = await createParentDirectories(resolvedWorkspace, params.destPath);
        await ensureDestinationAvailable(destFull);
        await fs.cp(srcFull, destFull, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
        return NextResponse.json({ success: true });
      }

      case 'move': {
        const srcFull = await resolveExistingInsideWorkspace(resolvedWorkspace, params.srcPath);
        const destFull = await createParentDirectories(resolvedWorkspace, params.destPath);
        await ensureDestinationAvailable(destFull);
        try {
          await fs.rename(srcFull, destFull);
        } catch {
          await fs.cp(srcFull, destFull, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
          await fs.rm(srcFull, { recursive: true, force: false });
        }
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    const { message, status } = workspaceErrorResponse(error);
    return NextResponse.json({ error: message, message }, { status });
  }
}
