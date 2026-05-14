import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth } from '@/lib/auth/middleware';
import { normalizeNotebookScope, ensureNotebookRoot, safeResolve } from '@/lib/notebook/manager';
import { getNotebookShare } from '@/lib/notebook/share-store';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  modifiedTime?: number;
  children?: TreeNode[];
}

async function buildTree(dirPath: string, rootPath: string, depth: number, maxDepth: number, visited?: Set<string>): Promise<TreeNode[]> {
  const seen = visited || new Set<string>();
  let realDir: string;
  try {
    realDir = await fs.realpath(dirPath);
  } catch {
    return [];
  }
  if (seen.has(realDir)) return [];
  seen.add(realDir);

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const dirs: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath);

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          const children = depth < maxDepth
            ? await buildTree(fullPath, rootPath, depth + 1, maxDepth, seen)
            : undefined;
          dirs.push({
            name: entry.name,
            path: relativePath,
            type: 'directory',
            modifiedTime: stat.mtimeMs,
            children,
          });
        } else if (stat.isFile()) {
          files.push({ name: entry.name, path: relativePath, type: 'file', modifiedTime: stat.mtimeMs });
        }
      } catch {}
    } else if (entry.isFile()) {
      let modifiedTime = 0;
      try {
        const stat = await fs.stat(fullPath);
        modifiedTime = stat.mtimeMs;
      } catch {}
      files.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
        modifiedTime,
      });
    }
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => {
    const timeDiff = (b.modifiedTime || 0) - (a.modifiedTime || 0);
    if (timeDiff !== 0) return timeDiff;
    return a.name.localeCompare(b.name);
  });

  return [...dirs, ...files];
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const scope = normalizeNotebookScope(searchParams.get('scope'));
    const maxDepth = Math.min(parseInt(searchParams.get('depth') || '2', 10), 10);
    const subPath = searchParams.get('sub') || '';
    const shareToken = searchParams.get('shareToken') || '';

    if (scope === 'personal' && !auth.personalDir) {
      return NextResponse.json({ error: '用户未配置个人目录' }, { status: 400 });
    }

    const notebookRoot = await ensureNotebookRoot(scope, auth.personalDir);
    const targetPath = safeResolve(notebookRoot, subPath);

    if (!targetPath) {
      return NextResponse.json({ error: '路径不合法' }, { status: 403 });
    }

    if (scope === 'global' && shareToken) {
      const share = await getNotebookShare(shareToken);
      if (!share || share.scope !== 'global') {
        return NextResponse.json({ error: '分享链接无效' }, { status: 403 });
      }
      const shareDir = path.dirname(share.path || '');
      if (subPath && subPath !== shareDir) {
        return NextResponse.json({ error: '分享链接无权访问该目录' }, { status: 403 });
      }
      const shareName = path.basename(share.path || '');
      return NextResponse.json({
        tree: [{
          name: shareName,
          path: share.path,
          type: 'file',
        }],
        rootPath: notebookRoot,
        scope,
      });
    }

    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: '路径不是目录' }, { status: 400 });
    }

    const tree = await buildTree(targetPath, notebookRoot, 0, maxDepth);
    return NextResponse.json({ tree, rootPath: notebookRoot, scope });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return NextResponse.json({ error: '目录不存在' }, { status: 404 });
    }
    return NextResponse.json({ error: '读取 Notebook 目录失败', message: error.message }, { status: 500 });
  }
}
