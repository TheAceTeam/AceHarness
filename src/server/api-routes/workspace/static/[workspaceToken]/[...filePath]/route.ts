import fs from 'fs/promises';
import path from 'path';
import {
  WorkspacePathError,
  resolveExistingInsideWorkspace,
  resolveWorkspaceRoot,
} from '@/lib/core/workspace-path-safety';
import { workspaceRouteError } from '@/server/api-route-runtime/workspace-route';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
};

function decodeWorkspaceToken(token: string): string {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    if (!decoded.trim()) throw new Error('empty token');
    return decoded;
  } catch {
    throw new WorkspacePathError('workspace token 不合法');
  }
}

function encodeStaticPath(pathname: string): string {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function rewriteRootAbsoluteUrl(value: string, workspaceToken: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return value;
  if (trimmed.startsWith('/api/workspace/static/')) return value;
  if (trimmed === '/') return value;

  const hashIndex = trimmed.indexOf('#');
  const beforeHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const hash = hashIndex >= 0 ? trimmed.slice(hashIndex) : '';
  const queryIndex = beforeHash.indexOf('?');
  const pathname = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const search = queryIndex >= 0 ? beforeHash.slice(queryIndex) : '';
  const encodedPath = encodeStaticPath(pathname);
  if (!encodedPath) return value;
  return `/api/workspace/static/${encodeURIComponent(workspaceToken)}/${encodedPath}${search}${hash}`;
}

function rewriteHtml(content: string, workspaceToken: string): string {
  return content
    .replace(
      /\b(src|href|poster|action)=("|')([^"']+)\2/gi,
      (match, attr: string, quote: string, value: string) => {
        const rewritten = rewriteRootAbsoluteUrl(value, workspaceToken);
        return `${attr}=${quote}${rewritten}${quote}`;
      },
    )
    .replace(
      /\bsrcset=("|')([^"']+)\1/gi,
      (match, quote: string, value: string) => {
        const rewritten = value
          .split(',')
          .map((entry) => {
            const parts = entry.trim().split(/\s+/);
            if (!parts[0]) return entry;
            return [rewriteRootAbsoluteUrl(parts[0], workspaceToken), ...parts.slice(1)].join(' ');
          })
          .join(', ');
        return `srcset=${quote}${rewritten}${quote}`;
      },
    )
    .replace(
      /url\((\s*)(["']?)(\/(?!\/)[^)"']+)\2(\s*)\)/gi,
      (match, leading: string, quote: string, value: string, trailing: string) =>
        `url(${leading}${quote}${rewriteRootAbsoluteUrl(value, workspaceToken)}${quote}${trailing})`,
    );
}

function rewriteCss(content: string, workspaceToken: string): string {
  return content.replace(
    /url\((\s*)(["']?)(\/(?!\/)[^)"']+)\2(\s*)\)/gi,
    (match, leading: string, quote: string, value: string, trailing: string) =>
      `url(${leading}${quote}${rewriteRootAbsoluteUrl(value, workspaceToken)}${quote}${trailing})`,
  );
}

function securityHeaders(contentType: string): HeadersInit {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': [
      "default-src 'self' data: blob:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:",
      "style-src 'self' 'unsafe-inline' data:",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "media-src 'self' data: blob:",
      "connect-src 'none'",
      "frame-ancestors 'self'",
    ].join('; '),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: { workspaceToken: string; filePath?: string[] } | Promise<{ workspaceToken: string; filePath?: string[] }> },
) {
  try {
    const { workspaceToken, filePath = [] } = await params;
    const workspace = decodeWorkspaceToken(workspaceToken);
    const requestedPath = filePath.join('/');
    if (!requestedPath) throw new WorkspacePathError('缺少文件路径');

    const resolvedWorkspace = await resolveWorkspaceRoot(workspace);
    let realPath = await resolveExistingInsideWorkspace(resolvedWorkspace, requestedPath);
    let stat = await fs.stat(realPath);
    if (stat.isDirectory()) {
      realPath = await resolveExistingInsideWorkspace(resolvedWorkspace, path.join(requestedPath, 'index.html'));
      stat = await fs.stat(realPath);
    }
    if (!stat.isFile()) throw new WorkspacePathError('不是文件');

    const ext = path.extname(realPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    if (ext === '.html' || ext === '.htm') {
      const source = await fs.readFile(realPath, 'utf8');
      const content = rewriteHtml(source, workspaceToken);
      return new Response(content, { headers: securityHeaders(contentType) });
    }
    if (ext === '.css') {
      const source = await fs.readFile(realPath, 'utf8');
      const content = rewriteCss(source, workspaceToken);
      return new Response(content, { headers: securityHeaders(contentType) });
    }

    const buffer = await fs.readFile(realPath);
    return new Response(buffer, {
      headers: {
        ...securityHeaders(contentType),
        'Content-Length': String(buffer.length),
      },
    });
  } catch (error) {
    return workspaceRouteError(error);
  }
}
