import fs from 'fs/promises';
import path from 'path';
import { requireAuth } from '@/lib/auth/middleware';
import { ensureNotebookRoot, normalizeNotebookScope } from '@/lib/notebook/manager';
import { isBuiltinNotebookPath, toBuiltinNotebookAbsolutePath } from '@/lib/notebook/builtin';
import { getNotebookShare } from '@/lib/notebook/share-store';
import { jsonOk, readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';

const MAX_FILE_SIZE = 1024 * 1024;

function isPathSafe(root: string, resolvedPath: string) {
  return resolvedPath.startsWith(root + path.sep) || resolvedPath === root;
}

async function resolveSharePermission(shareToken: string): Promise<'read' | 'write' | null> {
  if (!shareToken) return null;
  const share = await getNotebookShare(shareToken);
  return share?.permission || null;
}

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = requestUrl(request);
    const file = searchParams.get('file');
    const mode = searchParams.get('mode');
    const scope = normalizeNotebookScope(searchParams.get('scope'));
    const shareToken = searchParams.get('shareToken') || '';

    if (scope === 'personal' && !auth.personalDir) {
      return jsonOk({ error: '用户未配置个人目录' }, { status: 400 });
    }

    if (!file) {
      return jsonOk({ error: '缺少 file 参数' }, { status: 400 });
    }

    const notebookRoot = await ensureNotebookRoot(scope, auth.personalDir);
    if (scope === 'global' && shareToken) {
      const share = await getNotebookShare(shareToken);
      if (!share || share.scope !== 'global') {
        return jsonOk({ error: '分享链接无效' }, { status: 403 });
      }
      if (share.path !== file) {
        return jsonOk({ error: '分享链接无权访问该文件' }, { status: 403 });
      }
    }
    const builtin = isBuiltinNotebookPath(file);
    let realPath = '';
    if (builtin) {
      const builtinRoot = toBuiltinNotebookAbsolutePath(scope, '__builtin__');
      realPath = await fs.realpath(toBuiltinNotebookAbsolutePath(scope, file));
      if (!isPathSafe(builtinRoot, realPath)) {
        return jsonOk({ error: '路径不合法' }, { status: 403 });
      }
    } else {
      const fullPath = path.join(notebookRoot, file);
      realPath = await fs.realpath(fullPath);
      if (!isPathSafe(notebookRoot, realPath)) {
        return jsonOk({ error: '路径不合法' }, { status: 403 });
      }
    }

    const stat = await fs.stat(realPath);
    if (!stat.isFile()) {
      return jsonOk({ error: '不是文件' }, { status: 400 });
    }

    if (mode === 'blob') {
      const buffer = await fs.readFile(realPath);
      const ext = path.extname(file).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
      };
      return new Response(buffer, {
        headers: {
          'Content-Type': mimeMap[ext] || 'application/octet-stream',
          'Content-Length': String(stat.size),
        },
      });
    }

    if (stat.size > MAX_FILE_SIZE) {
      return jsonOk({ error: '文件超过 1MB 限制', size: stat.size, path: file }, { status: 413 });
    }

    const content = await fs.readFile(realPath, 'utf-8');
    return jsonOk({ content, size: stat.size, path: file, scope, readOnly: builtin });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return jsonOk({ error: '文件不存在' }, { status: 404 });
    }
    return jsonOk({ error: '读取 Notebook 文件失败', message: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<any>(request, {});
    const { file, content, scope: rawScope, shareToken } = body;
    const scope = normalizeNotebookScope(rawScope);

    if (scope === 'personal' && !auth.personalDir) {
      return jsonOk({ error: '用户未配置个人目录' }, { status: 400 });
    }

    if (!file || content === undefined) {
      return jsonOk({ error: '缺少 file 或 content 参数' }, { status: 400 });
    }

    if (isBuiltinNotebookPath(file)) {
      return jsonOk({ error: '内置文档为只读内容，无法保存' }, { status: 403 });
    }

    if (new TextEncoder().encode(content).length > MAX_FILE_SIZE) {
      return jsonOk({ error: '内容超过 1MB 限制' }, { status: 413 });
    }

    if (scope === 'global' && shareToken) {
      const share = await getNotebookShare(String(shareToken));
      if (!share || share.scope !== 'global') {
        return jsonOk({ error: '分享链接无效' }, { status: 403 });
      }
      if (share.path !== file) {
        return jsonOk({ error: '分享链接无权修改该文件' }, { status: 403 });
      }
      const permission = share.permission;
      if (permission === 'read') {
        return jsonOk({ error: '当前分享链接为只读权限' }, { status: 403 });
      }
    }

    const notebookRoot = await ensureNotebookRoot(scope, auth.personalDir);
    const fullPath = path.join(notebookRoot, file);
    const dir = path.dirname(fullPath);
    const resolvedDir = path.resolve(dir);

    if (!isPathSafe(notebookRoot, resolvedDir)) {
      return jsonOk({ error: '路径不合法' }, { status: 403 });
    }

    await fs.mkdir(dir, { recursive: true });
    const realDir = await fs.realpath(dir);
    if (!isPathSafe(notebookRoot, realDir)) {
      return jsonOk({ error: '路径不合法' }, { status: 403 });
    }

    await fs.writeFile(fullPath, content, 'utf-8');
    return jsonOk({ success: true, scope });
  } catch (error: any) {
    return jsonOk({ error: '保存 Notebook 文件失败', message: error.message }, { status: 500 });
  }
}
