import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import {
  isInsidePath,
  resolveExistingInsideWorkspace,
  resolveWorkspaceRoot,
  workspaceErrorResponse,
} from '@/lib/core/workspace-path-safety';

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
  if (process.platform !== 'win32') return [];

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

const MAX_ENTRIES = 3000; // Hard cap on total nodes to prevent OOM/hang

interface BuildContext {
  seen: Set<string>;
  count: number;
  truncated: boolean;
}

async function buildTree(dirPath: string, rootPath: string, depth: number, maxDepth: number, ctx?: BuildContext): Promise<TreeNode[]> {
  const context = ctx || { seen: new Set<string>(), count: 0, truncated: false };
  if (context.count >= MAX_ENTRIES) {
    context.truncated = true;
    return [];
  }

  const realDir = await fs.realpath(dirPath);
  if (!isInsidePath(rootPath, realDir)) {
    throw new Error('目录路径不合法');
  }
  if (context.seen.has(realDir)) return [];
  context.seen.add(realDir);

  const entries = await fs.readdir(realDir, { withFileTypes: true });
  const filtered = entries.filter(e => !e.name.startsWith('.') && !SKIP_DIRS.has(e.name));

  const dirs: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const entry of filtered) {
    if (context.count >= MAX_ENTRIES) {
      context.truncated = true;
      break;
    }

    const fullPath = path.join(realDir, entry.name);
    const relativePath = toPortablePath(path.relative(rootPath, fullPath));

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      context.count++;
      let children: TreeNode[] | undefined;
      if (depth < maxDepth) {
        try {
          children = await buildTree(fullPath, rootPath, depth + 1, maxDepth, context);
        } catch (error: any) {
          if (!['EPERM', 'EACCES', 'ENOENT'].includes(error?.code)) {
            throw error;
          }
          children = [];
        }
      }
      dirs.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        children,
      });
    } else if (entry.isFile()) {
      context.count++;
      files.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
      });
    }
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  return [...dirs, ...files];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspacePath = searchParams.get('path');

    if (!workspacePath) {
      return NextResponse.json({ error: '缺少 path 参数' }, { status: 400 });
    }

    const maxDepth = Math.min(parseInt(searchParams.get('depth') || '2', 10), 10);
    const subPath = searchParams.get('sub') || '';

    const rootPath = await resolveWorkspaceRoot(workspacePath);
    const targetPath = subPath ? await resolveExistingInsideWorkspace(rootPath, subPath) : rootPath;
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: '路径不是目录' }, { status: 400 });
    }

    const context: BuildContext = { seen: new Set(), count: 0, truncated: false };
    const tree = await buildTree(targetPath, rootPath, 0, maxDepth, context);
    return NextResponse.json({
      tree,
      workspaceRoot: toPortablePath(rootPath),
      targetPath: toPortablePath(targetPath),
      availableRoots: await getAvailableDriveRoots(),
      truncated: context.truncated,
      totalEntries: context.count,
    });
  } catch (error: any) {
    const { message, status } = workspaceErrorResponse(error);
    return NextResponse.json({ error: message, message }, { status });
  }
}
