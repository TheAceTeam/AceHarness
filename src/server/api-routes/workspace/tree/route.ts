import fs from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import { isLinux, isMacOS, isWindows } from '@/lib/core/runtime-platform';
import {
  assertSafeRelativePath,
  isInsidePath,
  resolveExistingInsideWorkspace,
  resolveWorkspaceRoot,
} from '@/lib/core/workspace-path-safety';
import {
  getRemoteWorkspace,
  isRemoteWorkspace,
  sortRemoteEntries,
  type RemoteEntry,
} from '@/lib/core/remote-workspace';
import {
  getRemoteCredentials,
  requireRemoteWorkspaceAuth,
} from '@/lib/core/remote-credential-vault';
import { getRuntimeSkillsDirPath } from '@/lib/run/runtime-skills';
import { jsonOk, workspaceRouteError, workspaceRouteJsonError } from '@/server/api-route-runtime/workspace-route';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  modifiedTime?: number;
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

async function directoryExists(input: string): Promise<boolean> {
  try {
    const stat = await fs.stat(input);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function uniquePortableRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const root of roots) {
    const portable = toPortablePath(root).replace(/\/+$/, '') || '/';
    const normalized = /^[A-Za-z]:$/.test(portable) ? `${portable.toUpperCase()}/` : portable;
    const key = isWindows() ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

async function getAvailableQuickAccessRoots(): Promise<string[]> {
  const home = homedir();
  const userRoots = home
    ? [
        home,
        path.join(home, 'Desktop'),
        path.join(home, 'Documents'),
        path.join(home, 'Downloads'),
      ]
    : [];

  const platformRoots = isWindows()
    ? [
        process.env.USERPROFILE || '',
        process.env.SystemDrive ? `${process.env.SystemDrive}\\` : '',
        ...await getAvailableDriveRoots(),
      ]
    : isMacOS()
      ? ['/', '/Applications', '/Volumes']
      : isLinux()
        ? ['/', '/mnt', '/media', '/tmp', '/opt', '/var']
        : ['/'];

  const candidates = uniquePortableRoots([...userRoots, ...platformRoots].filter(Boolean));
  const existing = await Promise.all(
    candidates.map(async (root) => ((await directoryExists(root)) ? root : null)),
  );

  return existing.filter((root): root is string => Boolean(root));
}

// Directories that are typically huge and not useful to browse
const SKIP_DIRS = new Set([
  'node_modules', '__pycache__', '.cache', 'dist', 'build',
  '$Recycle.Bin', 'System Volume Information', 'Recovery',
  'ProgramData', 'Windows', 'MSOCache',
]);

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;

function isAgentsSkillsRelativePath(rootPath: string, lexicalPath: string): boolean {
  const relativePath = toPortablePath(path.relative(rootPath, lexicalPath));
  return relativePath === '.agents/skills' || relativePath.startsWith('.agents/skills/');
}

async function isAllowedAgentsSkillTarget(rootPath: string, lexicalPath: string, realPath: string): Promise<boolean> {
  if (!isAgentsSkillsRelativePath(rootPath, lexicalPath)) return false;
  const runtimeSkillsDir = await getRuntimeSkillsDirPath();
  const realRuntimeSkillsDir = await fs.realpath(runtimeSkillsDir).catch(() => '');
  return Boolean(realRuntimeSkillsDir) && isInsidePath(realRuntimeSkillsDir, realPath);
}

async function assertReadableTreeDirectory(rootPath: string, lexicalDir: string): Promise<string> {
  const realDir = await fs.realpath(lexicalDir);
  if (!isInsidePath(rootPath, realDir) && !(await isAllowedAgentsSkillTarget(rootPath, lexicalDir, realDir))) {
    throw new Error('目录路径不合法');
  }
  return realDir;
}

async function resolveTreeTargetPath(rootPath: string, subPath: string): Promise<string> {
  if (!subPath) return rootPath;
  try {
    return await resolveExistingInsideWorkspace(rootPath, subPath);
  } catch (error: any) {
    if (error?.status !== 403) throw error;
  }

  const lexicalPath = path.resolve(rootPath, assertSafeRelativePath(subPath));
  if (!isInsidePath(rootPath, lexicalPath)) {
    return resolveExistingInsideWorkspace(rootPath, subPath);
  }
  await assertReadableTreeDirectory(rootPath, lexicalPath);
  return lexicalPath;
}

type VisibleEntry = {
  entry: {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  };
  fullPath: string;
  relativePath: string;
  type: 'file' | 'directory';
  modifiedTime?: number;
};

async function resolveEntryType(rootPath: string, fullPath: string, entry: VisibleEntry['entry']): Promise<'file' | 'directory' | null> {
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  if (!entry.isSymbolicLink()) return null;

  const [stat, realPath] = await Promise.all([
    fs.stat(fullPath).catch(() => null),
    fs.realpath(fullPath).catch(() => ''),
  ]);
  if (!stat || !realPath) return null;
  if (!(await isAllowedAgentsSkillTarget(rootPath, fullPath, realPath))) return null;
  if (stat.isDirectory()) return 'directory';
  if (stat.isFile()) return 'file';
  return null;
}

async function listVisibleEntries(dirPath: string, rootPath: string, sortMode: 'name' | 'modified-desc' = 'name'): Promise<VisibleEntry[]> {
  const lexicalDir = path.resolve(dirPath);
  if (!isInsidePath(rootPath, lexicalDir)) {
    throw new Error('目录路径不合法');
  }
  await assertReadableTreeDirectory(rootPath, lexicalDir);

  const entries = await fs.readdir(lexicalDir, { withFileTypes: true });
  const visibleEntries: VisibleEntry[] = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(lexicalDir, entry.name);
    const type = await resolveEntryType(rootPath, fullPath, entry);
    if (!type) continue;
    const stat = await fs.stat(fullPath).catch(() => null);
    visibleEntries.push({
      entry,
      fullPath,
      relativePath: toPortablePath(path.relative(rootPath, fullPath)),
      type,
      modifiedTime: stat?.mtimeMs,
    });
  }

  return visibleEntries
    .sort((a, b) => {
      const aDir = a.type === 'directory';
      const bDir = b.type === 'directory';
      if (aDir !== bDir) return aDir ? -1 : 1;
      if (sortMode === 'modified-desc') {
        const timeDifference = (b.modifiedTime || 0) - (a.modifiedTime || 0);
        if (timeDifference !== 0) return timeDifference;
      }
      return a.entry.name.localeCompare(b.entry.name);
    });
}

async function buildTree(dirPath: string, rootPath: string, depth: number, maxDepth: number, seen = new Set<string>(), sortMode: 'name' | 'modified-desc' = 'name'): Promise<TreeNode[]> {
  const lexicalDir = path.resolve(dirPath);
  const realDir = await assertReadableTreeDirectory(rootPath, lexicalDir);
  if (seen.has(realDir)) return [];
  seen.add(realDir);

  const visibleEntries = await listVisibleEntries(lexicalDir, rootPath, sortMode);
  const nodes: TreeNode[] = [];

  for (const { entry, fullPath, relativePath, type, modifiedTime } of visibleEntries) {
    if (type === 'directory') {
      let children: TreeNode[] | undefined;
      if (depth < maxDepth) {
        try {
          children = await buildTree(fullPath, rootPath, depth + 1, maxDepth, seen, sortMode);
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
        modifiedTime,
        children,
      });
    } else if (type === 'file') {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
        modifiedTime,
      });
    }
  }

  return nodes;
}

async function buildTreePage(dirPath: string, rootPath: string, maxDepth: number, offset: number, limit: number, sortMode: 'name' | 'modified-desc' = 'name') {
  const visibleEntries = await listVisibleEntries(dirPath, rootPath, sortMode);
  const pageEntries = visibleEntries.slice(offset, offset + limit);
  const tree: TreeNode[] = [];

  for (const { entry, fullPath, relativePath, type, modifiedTime } of pageEntries) {
    if (type === 'directory') {
      let children: TreeNode[] | undefined;
      if (maxDepth > 0) {
        try {
          children = await buildTree(fullPath, rootPath, 1, maxDepth, new Set<string>(), sortMode);
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
        modifiedTime,
        children,
      });
    } else if (type === 'file') {
      tree.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
        modifiedTime,
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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspacePath = searchParams.get('path');

    if (!workspacePath) {
      return workspaceRouteJsonError('缺少 path 参数', 400);
    }

    const maxDepth = Math.min(Math.max(parseInt(searchParams.get('depth') || '0', 10), 0), 10);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);
    const requestedLimit = parseInt(searchParams.get('limit') || searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10);
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE);
    const subPath = searchParams.get('sub') || '';
    const sortMode = searchParams.get('sort') === 'modified-desc' ? 'modified-desc' : 'name';

    if (isRemoteWorkspace(workspacePath)) {
      const auth = await requireRemoteWorkspaceAuth(request);
      if (auth instanceof Response) return auth;
      const page = await buildRemoteTreePage(workspacePath, auth.id, subPath, offset, limit);
      return jsonOk(page);
    }

    const rootPath = await resolveWorkspaceRoot(workspacePath);
    const targetPath = await resolveTreeTargetPath(rootPath, subPath);
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      return workspaceRouteJsonError('路径不是目录', 400);
    }

    const page = await buildTreePage(targetPath, rootPath, maxDepth, offset, limit, sortMode);
    return jsonOk({
      ...page,
      workspaceRoot: toPortablePath(rootPath),
      targetPath: toPortablePath(targetPath),
      availableRoots: await getAvailableQuickAccessRoots(),
      truncated: page.hasMore,
    });
  } catch (error: any) {
    const workspacePath = new URL(request.url).searchParams.get('path') || '';
    return workspaceRouteError(error, workspacePath);
  }
}
