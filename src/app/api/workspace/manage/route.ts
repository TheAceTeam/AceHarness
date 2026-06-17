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
} from '@/lib/core/workspace-path-safety';
import { getRemoteWorkspace, isRemoteWorkspace } from '@/lib/core/remote-workspace';
import { getRemoteCredentials, remoteCredentialErrorBody, requireRemoteWorkspaceAuth } from '@/lib/core/remote-credential-vault';

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

function ensureValidRelocation(srcFull: string, destFull: string, options?: { disallowSameParent?: boolean }): void {
  const srcNormalized = path.resolve(srcFull);
  const destNormalized = path.resolve(destFull);
  const srcParent = path.dirname(srcNormalized);

  if (srcNormalized === destNormalized) {
    throw new WorkspacePathError('源路径与目标路径相同', 400);
  }
  if (destNormalized.startsWith(`${srcNormalized}${path.sep}`)) {
    throw new WorkspacePathError('不能移动或重命名到自身子目录中', 400);
  }
  if (options?.disallowSameParent && srcParent === path.dirname(destNormalized)) {
    throw new WorkspacePathError('目标路径与当前目录相同', 400);
  }
}

export async function POST(request: NextRequest) {
  let workspaceForError = '';
  try {
    const body = await request.json();
    const { workspace, action, ...params } = body;
    workspaceForError = typeof workspace === 'string' ? workspace : '';

    if (!workspace || !action) {
      return NextResponse.json({ error: '缺少 workspace 或 action 参数' }, { status: 400 });
    }

    if (isRemoteWorkspace(workspace)) {
      const auth = await requireRemoteWorkspaceAuth(request);
      if (auth instanceof NextResponse) return auth;
      const credentials = getRemoteCredentials({ userId: auth.id, workspace });
      const { provider } = getRemoteWorkspace(workspace, credentials);
      switch (action) {
        case 'create-file':
          await provider.writeFile(params.path, params.content || '');
          return NextResponse.json({ success: true });
        case 'create-folder':
          await provider.mkdir(params.path);
          return NextResponse.json({ success: true });
        case 'rename':
          await provider.rename(params.oldPath, params.newPath);
          return NextResponse.json({ success: true });
        case 'delete':
          if (!params.path) return NextResponse.json({ error: '不能删除 workspace 根目录' }, { status: 400 });
          await provider.delete(params.path);
          return NextResponse.json({ success: true });
        case 'copy':
          await provider.copy(params.srcPath, params.destPath);
          return NextResponse.json({ success: true });
        case 'move':
          await provider.rename(params.srcPath, params.destPath);
          return NextResponse.json({ success: true });
        default:
          return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
      }
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
        ensureValidRelocation(oldFull, newFull);
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
        ensureValidRelocation(srcFull, destFull, { disallowSameParent: true });
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
    if (error?.status === 428) {
      return NextResponse.json(remoteCredentialErrorBody(workspaceForError), { status: 428 });
    }
    const { message, status } = workspaceErrorResponse(error);
    return NextResponse.json({ error: message, message }, { status });
  }
}
