import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isWindows } from '@/lib/core/runtime-platform';
import {
  isInsidePath,
  resolveExistingInsideWorkspace,
  resolveWorkspaceRoot,
  workspaceErrorResponse,
} from '@/lib/core/workspace-path-safety';
import {
  getRemoteWorkspace,
  isRemoteWorkspace,
  sortRemoteEntries,
  type RemoteEntry,
} from '@/lib/core/remote-workspace';
import {
  getRemoteCredentials,
  remoteCredentialErrorBody,
  requireRemoteWorkspaceAuth,
} from '@/lib/core/remote-credential-vault';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

function toPortablePath(input: string): string {
  return input.replace(/\\/g, '/');
}

async function getAvailableDriveRoots(): Promise<string[]> {
  if (!isWindows()) return [];

  const checks = await Promise.all(
    Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)).map(async (letter) => {
      const drivePath = `${letter}:\\`;
      try {
        const stat = await fs.stat(drivePath);
        return stat.isDirectory() ? `${letter}:/` : null;
      } catch {
        return null;
      }
    }),
  );

  return checks.filter((item): item is string => Boolean(item));
}

// Directories that are typically huge and not useful to browse
const SKIP_DIRS = new Set([
  'node_modules', '__pycache__', '.cache', 'dist', 'build',
  '$Recycle.Bin', 'System Volume Information', 'Recovery',
  'ProgramData', 'Windows', 'MSOCache',
]);

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;

async function listVisibleEntries(dirPath: string, rootPath: string) {
  const realDir = await fs.realpath(dirPath);
  if (!isInsidePath(rootPath, realDir)) {
    throw new Error('目录路径不合法');
  }

  const entries = await fs.readdir(realDir, { withFileTypes: true });
  return entries
    .filter((entry) => !SKIP_DIRS.has(entry.name) && !entry.isSymbolicLink())
    .sort((a, b) => {
      const aDir = a.isDirectory();
      const bDir = b.isDirectory();
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((entry) => ({
      entry,
      fullPath: path.join(realDir, entry.name),
      relativePath: toPortablePath(path.relative(rootPath, path.join(realDir, entry.name))),
    }));
}

async function buildTree(dirPath: string, rootPath: string, depth: number, maxDepth: number, seen = new Set<string>()): Promise<TreeNode[]> {
  const realDir = await fs.realpath(dirPath);
  if (!isInsidePath(rootPath, realDir)) {
    throw new Error('目录路径不合法');
  }
  if (seen.has(realDir)) return [];
  seen.add(realDir);

  const visibleEntries = await listVisibleEntries(realDir, rootPath);
  const nodes: TreeNode[] = [];

  for (const { entry, fullPath, relativePath } of visibleEntries) {
    if (entry.isDirectory()) {
      let children: TreeNode[] | undefined;
      if (depth < maxDepth) {
        try {
          children = await buildTree(fullPath, rootPath, depth + 1, maxDepth, seen);
        } catch (error: any) {
          if (!['EPERM', 'EACCES', 'ENOENT', 'EBADF', 'ENOTDIR'].includes(error?.code)) {
            throw error;
          }
          children = [];
        }
      }
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        children,
      });
    } else if (entry.isFile()) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
      });
    }
  }

  return nodes;
}

async function buildTreePage(dirPath: string, rootPath: string, maxDepth: number, offset: number, limit: number) {
  const visibleEntries = await listVisibleEntries(dirPath, rootPath);
  const pageEntries = visibleEntries.slice(offset, offset + limit);
  const tree: TreeNode[] = [];

  for (const { entry, fullPath, relativePath } of pageEntries) {
    if (entry.isDirectory()) {
      let children: TreeNode[] | undefined;
      if (maxDepth > 0) {
        try {
          children = await buildTree(fullPath, rootPath, 1, maxDepth);
        } catch (error: any) {
          if (!['EPERM', 'EACCES', 'ENOENT', 'EBADF', 'ENOTDIR'].includes(error?.code)) {
            throw error;
          }
          children = [];
        }
      }
      tree.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        children,
      });
    } else if (entry.isFile()) {
      tree.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
      });
    }
  }

  const nextOffset = offset + tree.length;
  return {
    tree,
    totalEntries: visibleEntries.length,
    offset,
    pageSize: limit,
    hasMore: nextOffset < visibleEntries.length,
    nextOffset: nextOffset < visibleEntries.length ? nextOffset : null,
  };
}

function remoteEntryToNode(entry: RemoteEntry): TreeNode {
  return {
    name: entry.name,
    path: entry.path,
    type: entry.type,
  };
}

async function buildRemoteTreePage(workspacePath: string, userId: string, subPath: string, offset: number, limit: number) {
  const credentials = getRemoteCredentials({ userId, workspace: workspacePath });
  const { ref, provider } = getRemoteWorkspace(workspacePath, credentials);
  try {
    const entries = sortRemoteEntries(await provider.list(subPath));
    const pageEntries = entries.slice(offset, offset + limit);
    const nextOffset = offset + pageEntries.length;
    return {
      tree: pageEntries.map(remoteEntryToNode),
      workspaceRoot: ref.displayRoot,
      targetPath: subPath,
      availableRoots: [],
      totalEntries: entries.length,
      offset,
      pageSize: limit,
      hasMore: nextOffset < entries.length,
      nextOffset: nextOffset < entries.length ? nextOffset : null,
      truncated: nextOffset < entries.length,
    };
  } finally {
    await provider.close?.();
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspacePath = searchParams.get('path');

    if (!workspacePath) {
      return NextResponse.json({ error: '缺少 path 参数' }, { status: 400 });
    }

    const maxDepth = Math.min(Math.max(parseInt(searchParams.get('depth') || '0', 10), 0), 10);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);
    const requestedLimit = parseInt(searchParams.get('limit') || searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10);
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE);
    const subPath = searchParams.get('sub') || '';

    if (isRemoteWorkspace(workspacePath)) {
      const auth = await requireRemoteWorkspaceAuth(request);
      if (auth instanceof NextResponse) return auth;
      const page = await buildRemoteTreePage(workspacePath, auth.id, subPath, offset, limit);
      return NextResponse.json(page);
    }

    const rootPath = await resolveWorkspaceRoot(workspacePath);
    const targetPath = subPath ? await resolveExistingInsideWorkspace(rootPath, subPath) : rootPath;
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: '路径不是目录' }, { status: 400 });
    }

    const page = await buildTreePage(targetPath, rootPath, maxDepth, offset, limit);
    return NextResponse.json({
      ...page,
      workspaceRoot: toPortablePath(rootPath),
      targetPath: toPortablePath(targetPath),
      availableRoots: await getAvailableDriveRoots(),
      truncated: page.hasMore,
    });
  } catch (error: any) {
    if (error?.status === 428 && workspaceErrorResponse(error).message.includes('凭据')) {
      const workspacePath = new URL(request.url).searchParams.get('path') || '';
      return NextResponse.json(remoteCredentialErrorBody(workspacePath), { status: 428 });
    }
    const { message, status } = workspaceErrorResponse(error);
    return NextResponse.json({ error: message, message }, { status });
  }
}
