import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import {
  isInsidePath,
  resolveExistingInsideWorkspace,
  resolveWorkspaceRoot,
  workspaceErrorResponse,
} from '@/lib/workspace-path-safety';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

async function buildTree(dirPath: string, rootPath: string, depth: number, maxDepth: number, visited?: Set<string>): Promise<TreeNode[]> {
  const seen = visited || new Set<string>();
  const realDir = await fs.realpath(dirPath);
  if (!isInsidePath(rootPath, realDir)) {
    throw new Error('目录路径不合法');
  }
  if (seen.has(realDir)) return [];
  seen.add(realDir);

  const entries = await fs.readdir(realDir, { withFileTypes: true });
  const filtered = entries.filter(e => !e.name.startsWith('.'));

  const dirs: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const entry of filtered) {
    const fullPath = path.join(realDir, entry.name);
    const relativePath = path.relative(rootPath, fullPath);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      const children = depth < maxDepth
        ? await buildTree(fullPath, rootPath, depth + 1, maxDepth, seen)
        : undefined;
      dirs.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        children,
      });
    } else if (entry.isFile()) {
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

    const tree = await buildTree(targetPath, rootPath, 0, maxDepth);
    return NextResponse.json({ tree });
  } catch (error: any) {
    const { message, status } = workspaceErrorResponse(error);
    return NextResponse.json({ error: message, message }, { status });
  }
}
