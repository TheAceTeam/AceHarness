import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import {
  WORKSPACE_RELATIVE_PATH_LENGTH_LIMIT,
  WorkspacePathError,
  assertSafeRelativePath,
} from '@/lib/core/workspace-path-safety';

export type RemoteWorkspaceKind = 'sftp' | 'webdav' | 'smb';

export interface RemoteWorkspaceRef {
  kind: RemoteWorkspaceKind;
  href: string;
  rootPath: string;
  displayRoot: string;
  url: URL;
}

export interface RemoteCredentials {
  username?: string;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
  domain?: string;
}

export interface RemoteEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedTime?: number;
}

export interface RemoteStat {
  type: 'file' | 'directory';
  size: number;
  modifiedTime?: number;
}

export interface RemoteWorkspaceProvider {
  list(dirPath: string): Promise<RemoteEntry[]>;
  stat(relPath: string): Promise<RemoteStat>;
  readFile(relPath: string): Promise<Buffer>;
  writeFile(relPath: string, data: Buffer | string): Promise<void>;
  mkdir(relPath: string): Promise<void>;
  delete(relPath: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  copy(srcPath: string, destPath: string): Promise<void>;
  close?(): Promise<void> | void;
}

const REMOTE_PROTOCOLS = new Set(['sftp:', 'ssh:', 'webdav:', 'webdavs:', 'http:', 'https:', 'smb:']);

export function isRemoteWorkspace(workspace: string | null | undefined): boolean {
  if (!workspace || typeof workspace !== 'string') return false;
  try {
    const url = new URL(workspace);
    return REMOTE_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

export function normalizeRemoteWorkspaceUrl(workspace: string): string {
  const url = new URL(workspace);
  url.password = '';
  const paramsToStrip = ['password', 'passphrase', 'privateKey', 'privateKeyPath', 'keyPath'];
  for (const key of paramsToStrip) url.searchParams.delete(key);
  return url.toString();
}

function normalizeRemotePath(input: string): string {
  return (input || '').replace(/\\/g, '/').replace(/\/+/g, '/');
}

function trimRemoteDir(input: string): string {
  const normalized = normalizeRemotePath(input).replace(/\/+$/g, '');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function joinRemotePath(...parts: string[]): string {
  const joined = normalizeRemotePath(parts.filter(Boolean).join('/'));
  const normalized = joined.replace(/\/+$/g, '');
  return normalized.startsWith('/') ? normalized || '/' : `/${normalized}`;
}

function dirnameRemote(input: string): string {
  const normalized = trimRemoteDir(input);
  if (normalized === '/') return '/';
  const idx = normalized.lastIndexOf('/');
  return idx <= 0 ? '/' : normalized.slice(0, idx);
}

function basenameRemote(input: string): string {
  const normalized = normalizeRemotePath(input).replace(/\/+$/g, '');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function relativeRemotePath(rootPath: string, absolutePath: string): string {
  const root = trimRemoteDir(rootPath);
  const target = trimRemoteDir(absolutePath);
  if (target === root) return '';
  if (!target.startsWith(`${root}/`)) {
    throw new WorkspacePathError('路径不合法', 403);
  }
  return target.slice(root.length + 1);
}

function assertSafeRemoteRelativePath(relPath: string, label = '路径'): string {
  if (typeof relPath !== 'string') throw new WorkspacePathError(`${label}不合法`);
  if (relPath.length > WORKSPACE_RELATIVE_PATH_LENGTH_LIMIT) throw new WorkspacePathError(`${label}过长`);
  if (/[\u0000-\u001f\u007f]/.test(relPath)) throw new WorkspacePathError(`${label}包含非法字符`);
  const normalized = normalizeRemotePath(relPath.trim()).replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized) || normalized.startsWith('//')) {
    throw new WorkspacePathError(`${label}不能是绝对路径`);
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '..' || part === '.')) throw new WorkspacePathError(`${label}不能包含 . 或 ..`);
  return parts.join('/');
}

function parseRemoteWorkspace(workspace: string): RemoteWorkspaceRef {
  let url: URL;
  try {
    url = new URL(workspace);
  } catch {
    throw new WorkspacePathError('远程 workspace URL 不合法');
  }

  if (url.protocol === 'sftp:' || url.protocol === 'ssh:') {
    const rootPath = trimRemoteDir(decodeURIComponent(url.pathname || '/'));
    const displayRoot = normalizeRemoteWorkspaceUrl(url.toString());
    return { kind: 'sftp', href: displayRoot, rootPath, displayRoot, url };
  }

  if (url.protocol === 'webdav:' || url.protocol === 'webdavs:' || url.protocol === 'http:' || url.protocol === 'https:') {
    const rootPath = trimRemoteDir(decodeURIComponent(url.pathname || '/'));
    const displayRoot = normalizeRemoteWorkspaceUrl(url.toString());
    return { kind: 'webdav', href: displayRoot, rootPath, displayRoot, url };
  }

  if (url.protocol === 'smb:') {
    const parts = decodeURIComponent(url.pathname || '').split('/').filter(Boolean);
    if (parts.length === 0) throw new WorkspacePathError('SMB workspace 缺少 share 名称');
    const share = parts[0];
    const rootPath = trimRemoteDir(parts.slice(1).join('/') || '/');
    const displayRoot = normalizeRemoteWorkspaceUrl(url.toString());
    return { kind: 'smb', href: displayRoot, rootPath, displayRoot, url: new URL(url.toString().replace(/^smb:\/\//, 'smb://')) };
  }

  throw new WorkspacePathError('不支持的远程 workspace 协议');
}

function remoteAbsolutePath(ref: RemoteWorkspaceRef, relPath: string): string {
  const safeRelPath = assertSafeRemoteRelativePath(relPath);
  return safeRelPath ? joinRemotePath(ref.rootPath, safeRelPath) : ref.rootPath;
}

function parentPathsFor(relPath: string): string[] {
  const safe = assertSafeRemoteRelativePath(relPath);
  if (!safe) return [];
  const parts = safe.split('/').filter(Boolean);
  const parents: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    parents.push(parts.slice(0, i).join('/'));
  }
  return parents;
}

async function readPrivateKey(credentials?: RemoteCredentials): Promise<string | undefined> {
  if (credentials?.privateKey) return credentials.privateKey;
  const privateKeyPath = credentials?.privateKeyPath;
  if (!privateKeyPath) return undefined;
  return fs.readFile(privateKeyPath, 'utf8');
}

async function withSftpClient<T>(ref: RemoteWorkspaceRef, credentials: RemoteCredentials, fn: (client: any) => Promise<T>): Promise<T> {
  const SftpClient = (await import('ssh2-sftp-client')).default || (await import('ssh2-sftp-client'));
  const client = new SftpClient();
  const url = ref.url;
  const privateKey = await readPrivateKey(credentials);
  try {
    await client.connect({
      host: url.hostname,
      port: url.port ? Number(url.port) : 22,
      username: credentials.username || decodeURIComponent(url.username || ''),
      password: credentials.password,
      privateKey,
      passphrase: credentials.passphrase,
      readyTimeout: Number(url.searchParams.get('timeoutMs') || 20000),
    });
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function ensureSftpParents(ref: RemoteWorkspaceRef, client: any, relPath: string): Promise<void> {
  for (const parent of parentPathsFor(relPath)) {
    await client.mkdir(remoteAbsolutePath(ref, parent), true).catch(() => undefined);
  }
}

function createSftpProvider(ref: RemoteWorkspaceRef, credentials: RemoteCredentials): RemoteWorkspaceProvider {
  return {
    async list(dirPath) {
      return withSftpClient(ref, credentials, async (client) => {
        const absolute = remoteAbsolutePath(ref, dirPath);
        const entries = await client.list(absolute);
        return entries
          .filter((entry: any) => entry?.name && entry.name !== '.' && entry.name !== '..' && entry.type !== 'l')
          .map((entry: any): RemoteEntry => ({
            name: entry.name,
            path: relativeRemotePath(ref.rootPath, joinRemotePath(absolute, entry.name)),
            type: entry.type === 'd' ? 'directory' : 'file',
            size: Number(entry.size || 0),
            modifiedTime: Number(entry.modifyTime || 0) || undefined,
          }));
      });
    },
    async stat(relPath) {
      return withSftpClient(ref, credentials, async (client) => {
        const absolute = remoteAbsolutePath(ref, relPath);
        const exists = await client.exists(absolute);
        if (!exists) throw new WorkspacePathError('路径不存在', 404);
        const stat = await client.stat(absolute);
        return {
          type: exists === 'd' ? 'directory' : 'file',
          size: Number(stat.size || 0),
          modifiedTime: stat.modifyTime ? Number(stat.modifyTime) : undefined,
        };
      });
    },
    async readFile(relPath) {
      return withSftpClient(ref, credentials, async (client) => Buffer.from(await client.get(remoteAbsolutePath(ref, relPath))));
    },
    async writeFile(relPath, data) {
      return withSftpClient(ref, credentials, async (client) => {
        await ensureSftpParents(ref, client, relPath);
        await client.put(Buffer.isBuffer(data) ? data : Buffer.from(data), remoteAbsolutePath(ref, relPath));
      });
    },
    async mkdir(relPath) {
      return withSftpClient(ref, credentials, async (client) => {
        await client.mkdir(remoteAbsolutePath(ref, relPath), true);
      });
    },
    async delete(relPath) {
      return withSftpClient(ref, credentials, async (client) => {
        const absolute = remoteAbsolutePath(ref, relPath);
        const exists = await client.exists(absolute);
        if (!exists) throw new WorkspacePathError('路径不存在', 404);
        if (exists === 'd') await client.rmdir(absolute, true);
        else await client.delete(absolute);
      });
    },
    async rename(oldPath, newPath) {
      return withSftpClient(ref, credentials, async (client) => {
        await ensureSftpParents(ref, client, newPath);
        await client.rename(remoteAbsolutePath(ref, oldPath), remoteAbsolutePath(ref, newPath));
      });
    },
    async copy(srcPath, destPath) {
      const buffer = await this.readFile(srcPath);
      await this.writeFile(destPath, buffer);
    },
  };
}

function webdavBaseUrl(url: URL): string {
  const protocol = url.protocol === 'webdavs:' ? 'https:' : url.protocol === 'webdav:' ? 'http:' : url.protocol;
  return `${protocol}//${url.host}`;
}

function webdavAuth(ref: RemoteWorkspaceRef, credentials: RemoteCredentials) {
  return {
    username: credentials.username || (ref.url.username ? decodeURIComponent(ref.url.username) : undefined),
    password: credentials.password,
  };
}

function createWebdavProvider(ref: RemoteWorkspaceRef, credentials: RemoteCredentials): RemoteWorkspaceProvider {
  return {
    async list(dirPath) {
      const { createClient } = await import('webdav');
      const client = createClient(webdavBaseUrl(ref.url), webdavAuth(ref, credentials));
      const absolute = remoteAbsolutePath(ref, dirPath);
      const result = await client.getDirectoryContents(absolute) as any[];
      return result
        .filter((entry) => entry?.basename && entry.basename !== '.' && entry.basename !== '..')
        .map((entry): RemoteEntry => ({
          name: entry.basename,
          path: relativeRemotePath(ref.rootPath, entry.filename || joinRemotePath(absolute, entry.basename)),
          type: entry.type === 'directory' ? 'directory' : 'file',
          size: Number(entry.size || 0),
          modifiedTime: entry.lastmod ? new Date(entry.lastmod).getTime() : undefined,
        }));
    },
    async stat(relPath) {
      const { createClient } = await import('webdav');
      const client = createClient(webdavBaseUrl(ref.url), webdavAuth(ref, credentials));
      const stat = await client.stat(remoteAbsolutePath(ref, relPath)) as any;
      return {
        type: stat.type === 'directory' ? 'directory' : 'file',
        size: Number(stat.size || 0),
        modifiedTime: stat.lastmod ? new Date(stat.lastmod).getTime() : undefined,
      };
    },
    async readFile(relPath) {
      const { createClient } = await import('webdav');
      const client = createClient(webdavBaseUrl(ref.url), webdavAuth(ref, credentials));
      const data = await client.getFileContents(remoteAbsolutePath(ref, relPath), { format: 'binary' }) as Buffer | ArrayBuffer;
      return Buffer.isBuffer(data) ? data : Buffer.from(data);
    },
    async writeFile(relPath, data) {
      const { createClient } = await import('webdav');
      const client = createClient(webdavBaseUrl(ref.url), webdavAuth(ref, credentials));
      for (const parent of parentPathsFor(relPath)) {
        await client.createDirectory(remoteAbsolutePath(ref, parent), { recursive: true }).catch(() => undefined);
      }
      await client.putFileContents(remoteAbsolutePath(ref, relPath), data, { overwrite: true });
    },
    async mkdir(relPath) {
      const { createClient } = await import('webdav');
      const client = createClient(webdavBaseUrl(ref.url), webdavAuth(ref, credentials));
      await client.createDirectory(remoteAbsolutePath(ref, relPath), { recursive: true });
    },
    async delete(relPath) {
      const { createClient } = await import('webdav');
      const client = createClient(webdavBaseUrl(ref.url), webdavAuth(ref, credentials));
      await client.deleteFile(remoteAbsolutePath(ref, relPath));
    },
    async rename(oldPath, newPath) {
      const { createClient } = await import('webdav');
      const client = createClient(webdavBaseUrl(ref.url), webdavAuth(ref, credentials));
      await client.moveFile(remoteAbsolutePath(ref, oldPath), remoteAbsolutePath(ref, newPath), { overwrite: false });
    },
    async copy(srcPath, destPath) {
      const { createClient } = await import('webdav');
      const client = createClient(webdavBaseUrl(ref.url), webdavAuth(ref, credentials));
      await client.copyFile(remoteAbsolutePath(ref, srcPath), remoteAbsolutePath(ref, destPath), { overwrite: false });
    },
  };
}

function smbInfo(ref: RemoteWorkspaceRef, credentials: RemoteCredentials) {
  const parts = decodeURIComponent(ref.url.pathname || '').split('/').filter(Boolean);
  const shareName = parts[0];
  const domain = ref.url.searchParams.get('domain') || '';
  return {
    share: `\\\\${ref.url.hostname}\\${shareName}`,
    port: ref.url.port ? Number(ref.url.port) : undefined,
    username: credentials.username || (ref.url.username ? decodeURIComponent(ref.url.username) : 'guest'),
    password: credentials.password || '',
    domain: credentials.domain || domain,
  };
}

function smbPath(ref: RemoteWorkspaceRef, relPath: string): string {
  return remoteAbsolutePath(ref, relPath).replace(/^\/+/, '').replace(/\//g, '\\');
}

async function withSmbClient<T>(ref: RemoteWorkspaceRef, credentials: RemoteCredentials, fn: (client: any) => Promise<T>): Promise<T> {
  const SMB2 = (await import('@marsaud/smb2')).default;
  const client = new SMB2(smbInfo(ref, credentials));
  try {
    return await fn(client);
  } finally {
    client.disconnect?.();
  }
}

async function deleteSmbRecursive(client: any, targetPath: string): Promise<void> {
  const stat = await client.stat(targetPath);
  if (!stat.isDirectory()) {
    await client.unlink(targetPath);
    return;
  }
  const entries = await client.readdir(targetPath, { stats: true });
  for (const entry of entries) {
    await deleteSmbRecursive(client, targetPath ? `${targetPath}\\${entry.name}` : entry.name);
  }
  await client.rmdir(targetPath);
}

function createSmbProvider(ref: RemoteWorkspaceRef, credentials: RemoteCredentials): RemoteWorkspaceProvider {
  return {
    async list(dirPath) {
      return withSmbClient(ref, credentials, async (client) => {
        const base = smbPath(ref, dirPath);
        const entries = await client.readdir(base, { stats: true });
        return entries.map((entry: any): RemoteEntry => {
          const rel = relativeRemotePath(ref.rootPath, joinRemotePath(remoteAbsolutePath(ref, dirPath), entry.name));
          return {
            name: entry.name,
            path: rel,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: Number(entry.size || 0),
            modifiedTime: entry.mtime ? new Date(entry.mtime).getTime() : undefined,
          };
        });
      });
    },
    async stat(relPath) {
      return withSmbClient(ref, credentials, async (client) => {
        const stat = await client.stat(smbPath(ref, relPath));
        return {
          type: stat.isDirectory() ? 'directory' : 'file',
          size: Number(stat.size || 0),
          modifiedTime: stat.mtime ? new Date(stat.mtime).getTime() : undefined,
        };
      });
    },
    async readFile(relPath) {
      return withSmbClient(ref, credentials, async (client) => Buffer.from(await client.readFile(smbPath(ref, relPath), { encoding: null })));
    },
    async writeFile(relPath, data) {
      return withSmbClient(ref, credentials, async (client) => {
        for (const parent of parentPathsFor(relPath)) {
          await client.mkdir(smbPath(ref, parent)).catch(() => undefined);
        }
        await client.writeFile(smbPath(ref, relPath), Buffer.isBuffer(data) ? data : Buffer.from(data));
      });
    },
    async mkdir(relPath) {
      return withSmbClient(ref, credentials, async (client) => {
        for (const parent of [...parentPathsFor(relPath), relPath]) {
          if (parent) await client.mkdir(smbPath(ref, parent)).catch(() => undefined);
        }
      });
    },
    async delete(relPath) {
      return withSmbClient(ref, credentials, async (client) => deleteSmbRecursive(client, smbPath(ref, relPath)));
    },
    async rename(oldPath, newPath) {
      return withSmbClient(ref, credentials, async (client) => {
        for (const parent of parentPathsFor(newPath)) {
          await client.mkdir(smbPath(ref, parent)).catch(() => undefined);
        }
        await client.rename(smbPath(ref, oldPath), smbPath(ref, newPath), { replace: false });
      });
    },
    async copy(srcPath, destPath) {
      const buffer = await this.readFile(srcPath);
      await this.writeFile(destPath, buffer);
    },
  };
}

export function getRemoteWorkspace(workspace: string, credentials: RemoteCredentials): { ref: RemoteWorkspaceRef; provider: RemoteWorkspaceProvider } {
  const ref = parseRemoteWorkspace(workspace);
  const provider = ref.kind === 'sftp'
    ? createSftpProvider(ref, credentials)
    : ref.kind === 'webdav'
      ? createWebdavProvider(ref, credentials)
      : createSmbProvider(ref, credentials);
  return { ref, provider };
}

export function sortRemoteEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function remoteEntryName(relPath: string): string {
  return basenameRemote(relPath) || 'workspace';
}

export async function remoteReadableToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export { assertSafeRemoteRelativePath, remoteAbsolutePath, relativeRemotePath, dirnameRemote };
