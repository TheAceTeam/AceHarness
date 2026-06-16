'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { workspaceApi, type TreeNode, type WorkspaceTreeResponse } from '@/lib/core/api';
import DirectoryTreePicker from '@/components/common/DirectoryTreePicker';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface WorkspaceDirectoryPickerProps {
  workspaceRoot?: string;
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
  className?: string;
  autoSelectRootWhenEmpty?: boolean;
}

function normalizeSlashes(input: string): string {
  return (input || '').replace(/\\/g, '/');
}

function isWindowsAbsolutePath(input: string): boolean {
  return /^[a-zA-Z]:([/\\]|$)/.test(input);
}

function isPosixAbsolutePath(input: string): boolean {
  return input.startsWith('/');
}

function normalizeRoot(root: string): string {
  const normalized = normalizeSlashes((root || '').trim());
  if (!normalized) return '';
  if (isRemoteWorkspaceUrl(normalized)) {
    return normalized.replace(/\/+$/, '');
  }
  if (isWindowsAbsolutePath(normalized)) {
    const drive = normalized.slice(0, 2).toUpperCase();
    const rest = normalized.slice(2).replace(/\/+$/, '');
    return rest ? `${drive}${rest}` : `${drive}/`;
  }
  if (normalized === '/') return '/';
  return normalized.replace(/\/+$/, '');
}

function isAbsolutePath(input: string): boolean {
  const normalized = normalizeSlashes((input || '').trim());
  return isRemoteWorkspaceUrl(normalized) || isWindowsAbsolutePath(normalized) || isPosixAbsolutePath(normalized);
}

function getDefaultRoot(root: string, value: string): string {
  const normalizedRoot = normalizeRoot(root);
  if (normalizedRoot) return normalizedRoot;
  const normalizedValue = normalizeRoot(value);
  if (isAbsolutePath(normalizedValue)) return normalizedValue;
  return '/';
}

function getParentAbsolutePath(input: string): string {
  const normalized = normalizeRoot(input);
  if (isRemoteWorkspaceUrl(normalized)) {
    const url = new URL(normalized);
    const currentPath = url.pathname.replace(/\/+$/, '');
    if (!currentPath || currentPath === '/') return normalized;
    const idx = currentPath.lastIndexOf('/');
    url.pathname = idx <= 0 ? '/' : currentPath.slice(0, idx);
    return url.toString().replace(/\/+$/, '');
  }
  if (isWindowsAbsolutePath(normalized)) {
    if (/^[A-Z]:\/$/i.test(normalized)) return normalized;
    const withoutTrailing = normalized.replace(/\/+$/, '');
    const idx = withoutTrailing.lastIndexOf('/');
    if (idx <= 2) return `${withoutTrailing.slice(0, 2)}/`;
    return withoutTrailing.slice(0, idx);
  }
  if (normalized === '/') return '/';
  const idx = normalized.lastIndexOf('/');
  return idx <= 0 ? '/' : normalized.slice(0, idx);
}

function isFilesystemRoot(input: string): boolean {
  const normalized = normalizeRoot(input);
  if (!normalized) return false;
  if (isRemoteWorkspaceUrl(normalized)) return true;
  if (normalized === '/') return true;
  return /^[A-Z]:\/$/i.test(normalized);
}

function toAbsolute(root: string, relative: string): string {
  const normalizedRoot = normalizeRoot(root);
  const normalizedRelative = normalizeSlashes(relative || '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalizedRelative) return normalizedRoot;
  if (isAbsolutePath(normalizedRelative)) {
    return normalizeRoot(normalizedRelative);
  }
  if (normalizedRoot === '/') return `/${normalizedRelative}`;
  return `${normalizedRoot}/${normalizedRelative}`;
}

function toRelative(root: string, absolute: string): string {
  const normalizedRoot = normalizeRoot(root);
  const normalizedAbsolute = normalizeRoot(absolute || '');
  if (!normalizedAbsolute || normalizedAbsolute === normalizedRoot) return '';

  if (isRemoteWorkspaceUrl(normalizedRoot)) {
    return '';
  }

  if (isWindowsAbsolutePath(normalizedRoot)) {
    const rootLower = normalizedRoot.toLowerCase();
    const absoluteLower = normalizedAbsolute.toLowerCase();
    if (absoluteLower.startsWith(`${rootLower}/`)) {
      return normalizedAbsolute.slice(normalizedRoot.length + 1);
    }
    return '';
  }

  if (normalizedRoot === '/') return normalizedAbsolute.replace(/^\/+/, '');
  if (normalizedAbsolute.startsWith(`${normalizedRoot}/`)) return normalizedAbsolute.slice(normalizedRoot.length + 1);
  return '';
}

function getPathSegments(pathValue: string): string[] {
  return normalizeSlashes(pathValue).split('/').filter(Boolean);
}

function isRemoteWorkspaceUrl(input: string): boolean {
  try {
    const protocol = new URL(input).protocol;
    return ['sftp:', 'ssh:', 'webdav:', 'webdavs:', 'http:', 'https:', 'smb:'].includes(protocol);
  } catch {
    return false;
  }
}

function isRemoteCredentialRequired(error: unknown): error is Error & { code: string; workspace?: string } {
  return error instanceof Error && (error as Error & { code?: string }).code === 'REMOTE_CREDENTIAL_REQUIRED';
}

function joinRelativePath(parentPath: string, childName: string): string {
  const parent = normalizeSlashes(parentPath || '').replace(/^\/+|\/+$/g, '');
  const child = normalizeSlashes(childName || '').replace(/^\/+|\/+$/g, '');
  return parent ? `${parent}/${child}` : child;
}

function deriveRootFromValue(defaultRoot: string, value: string): string {
  const normalizedValue = normalizeRoot(value || '');
  if (!normalizedValue) return defaultRoot;
  if (isRemoteWorkspaceUrl(normalizedValue)) return normalizedValue;
  if (isWindowsAbsolutePath(normalizedValue)) {
    if (isFilesystemRoot(defaultRoot) && normalizedValue !== defaultRoot) {
      return normalizedValue;
    }
    const relativeToDefault = toRelative(defaultRoot, normalizedValue);
    return relativeToDefault || normalizedValue === defaultRoot ? defaultRoot : normalizedValue;
  }
  if (isPosixAbsolutePath(normalizedValue)) {
    if (isFilesystemRoot(defaultRoot) && normalizedValue !== defaultRoot) {
      return normalizedValue;
    }
    const relativeToDefault = toRelative(defaultRoot, normalizedValue);
    return relativeToDefault || normalizedValue === defaultRoot ? defaultRoot : '/';
  }
  return defaultRoot;
}

export default function WorkspaceDirectoryPicker({
  workspaceRoot = '',
  value,
  onChange,
  disabled = false,
  className,
  autoSelectRootWhenEmpty = false,
}: WorkspaceDirectoryPickerProps) {
  const defaultRoot = useMemo(() => getDefaultRoot(workspaceRoot, value), [value, workspaceRoot]);
  const [currentRoot, setCurrentRoot] = useState(() => deriveRootFromValue(defaultRoot, value));
  const [quickAccessRoots, setQuickAccessRoots] = useState<string[]>([]);
  const [credentialWorkspace, setCredentialWorkspace] = useState<string | null>(null);
  const [credentialRetry, setCredentialRetry] = useState<(() => Promise<void>) | null>(null);
  const [credentialForm, setCredentialForm] = useState({
    username: '',
    password: '',
    privateKey: '',
    privateKeyPath: '',
    passphrase: '',
    domain: '',
  });
  const [credentialSaving, setCredentialSaving] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const currentRootRef = useRef(currentRoot);

  useEffect(() => {
    const nextRoot = deriveRootFromValue(defaultRoot, value);
    currentRootRef.current = nextRoot;
    setCurrentRoot(nextRoot);
  }, [defaultRoot, value]);

  const relativeValue = useMemo(() => {
    if (!value) return '';
    const normalizedValue = normalizeRoot(value);
    const derived = toRelative(currentRoot, normalizedValue);
    if (derived) return derived;
    if (normalizedValue === currentRoot) return '';
    return isAbsolutePath(normalizedValue) ? '' : normalizedValue;
  }, [currentRoot, value]);

  const updateRootFromResponse = useCallback((result: WorkspaceTreeResponse) => {
    if (Array.isArray(result.availableRoots)) {
      setQuickAccessRoots(result.availableRoots.map(normalizeRoot).filter(Boolean));
    }
    if (!result.workspaceRoot) return;
    const normalized = normalizeRoot(result.workspaceRoot);
    if (!normalized) return;
    if (autoSelectRootWhenEmpty && !value) {
      onChange(normalized);
    }
    if (normalized !== currentRootRef.current) {
      currentRootRef.current = normalized;
      setCurrentRoot(normalized);
    }
  }, [autoSelectRootWhenEmpty, onChange, value]);

  const loadRoot = useCallback(async (): Promise<TreeNode[]> => {
    try {
      const result = await workspaceApi.getTree(currentRootRef.current, { depth: 0 });
      updateRootFromResponse(result);
      return result.tree || [];
    } catch (error) {
      if (isRemoteCredentialRequired(error)) {
        const workspace = error.workspace || currentRootRef.current;
        setCredentialWorkspace(workspace);
        setCredentialRetry(() => async () => {
          const result = await workspaceApi.getTree(currentRootRef.current, { depth: 0 });
          updateRootFromResponse(result);
        });
      }
      throw error;
    }
  }, [updateRootFromResponse]);

  const loadChildren = useCallback(async (path: string): Promise<TreeNode[]> => {
    try {
      const result = await workspaceApi.getSubTree(currentRootRef.current, path, { depth: 0 });
      updateRootFromResponse(result);
      return result.tree || [];
    } catch (error) {
      if (isRemoteCredentialRequired(error)) {
        const workspace = error.workspace || currentRootRef.current;
        setCredentialWorkspace(workspace);
        setCredentialRetry(() => async () => {
          const result = await workspaceApi.getSubTree(currentRootRef.current, path, { depth: 0 });
          updateRootFromResponse(result);
        });
      }
      throw error;
    }
  }, [updateRootFromResponse]);

  const resolveInputPath = useCallback((input: string) => {
    const normalizedInput = normalizeRoot(input);
    if (!normalizedInput) {
      return { root: currentRootRef.current, path: '' };
    }

    if (isAbsolutePath(normalizedInput)) {
      if (isRemoteWorkspaceUrl(normalizedInput)) {
        currentRootRef.current = normalizedInput;
        setCurrentRoot(normalizedInput);
        return { root: normalizedInput, path: '' };
      }
      if (isWindowsAbsolutePath(normalizedInput)) {
        currentRootRef.current = normalizedInput;
        setCurrentRoot(normalizedInput);
        return { root: normalizedInput, path: '' };
      }
      currentRootRef.current = '/';
      setCurrentRoot('/');
      return { root: '/', path: toRelative('/', normalizedInput) };
    }

    return { root: currentRootRef.current, path: normalizeSlashes(normalizedInput).replace(/^\/+|\/+$/g, '') };
  }, []);

  const navigateUp = useCallback((currentPath: string) => {
    if (currentPath) {
      const parts = getPathSegments(currentPath);
      if (parts.length > 1) return { root: currentRootRef.current, path: parts.slice(0, -1).join('/') };
      if (parts.length === 1) return { root: currentRootRef.current, path: '' };
    }

    const parentRoot = getParentAbsolutePath(currentRootRef.current);
    if (parentRoot === currentRootRef.current) {
      return { root: currentRootRef.current, path: '' };
    }
    const previousName = getPathSegments(currentRootRef.current).slice(-1)[0] || '';
    currentRootRef.current = parentRoot;
    setCurrentRoot(parentRoot);
    return { root: parentRoot, path: previousName };
  }, []);

  const navigateHome = useCallback(() => {
    currentRootRef.current = defaultRoot;
    setCurrentRoot(defaultRoot);
    return { root: defaultRoot, path: toRelative(defaultRoot, value || defaultRoot) };
  }, [defaultRoot, value]);

  const createFolder = useCallback(async (parentPath: string, folderName: string) => {
    const nextPath = joinRelativePath(parentPath, folderName);
    try {
      await workspaceApi.manage(currentRootRef.current, 'create-folder', { path: nextPath });
    } catch (error) {
      if (isRemoteCredentialRequired(error)) {
        const workspace = error.workspace || currentRootRef.current;
        setCredentialWorkspace(workspace);
        setCredentialRetry(() => async () => {
          await workspaceApi.manage(currentRootRef.current, 'create-folder', { path: nextPath });
        });
      }
      throw error;
    }
    return { root: currentRootRef.current, path: nextPath };
  }, []);

  const submitCredentials = useCallback(async () => {
    if (!credentialWorkspace) return;
    setCredentialSaving(true);
    setCredentialError(null);
    try {
      await workspaceApi.setRemoteCredentials(credentialWorkspace, {
        username: credentialForm.username || undefined,
        password: credentialForm.password || undefined,
        privateKey: credentialForm.privateKey || undefined,
        privateKeyPath: credentialForm.privateKeyPath || undefined,
        passphrase: credentialForm.passphrase || undefined,
        domain: credentialForm.domain || undefined,
      });
      const retry = credentialRetry;
      setCredentialWorkspace(null);
      setCredentialRetry(null);
      setCredentialForm({ username: '', password: '', privateKey: '', privateKeyPath: '', passphrase: '', domain: '' });
      await retry?.();
    } catch (error) {
      setCredentialError(error instanceof Error ? error.message : '连接凭据保存失败');
    } finally {
      setCredentialSaving(false);
    }
  }, [credentialForm, credentialRetry, credentialWorkspace]);

  const handleChange = useCallback((relativePath: string) => {
    onChange(toAbsolute(currentRootRef.current, relativePath));
  }, [onChange]);

  return (
    <>
    <DirectoryTreePicker
      value={relativeValue}
      onChange={handleChange}
      loadRoot={loadRoot}
      loadChildren={loadChildren}
      rootLabel={currentRoot}
      quickAccessRoots={quickAccessRoots}
      disabled={disabled}
      className={className}
      onResolvePath={resolveInputPath}
      onNavigateUp={navigateUp}
      onNavigateHome={navigateHome}
      onCreateFolder={createFolder}
    />
    <Dialog open={Boolean(credentialWorkspace)} onOpenChange={(open) => {
      if (credentialSaving) return;
      if (!open) {
        setCredentialWorkspace(null);
        setCredentialRetry(null);
        setCredentialError(null);
      }
    }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>远程 workspace 连接凭据</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="break-all rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {credentialWorkspace}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input value={credentialForm.username} onChange={(event) => setCredentialForm((prev) => ({ ...prev, username: event.target.value }))} placeholder="用户名" />
            <Input value={credentialForm.password} onChange={(event) => setCredentialForm((prev) => ({ ...prev, password: event.target.value }))} placeholder="密码 / token" type="password" />
            <Input value={credentialForm.domain} onChange={(event) => setCredentialForm((prev) => ({ ...prev, domain: event.target.value }))} placeholder="SMB domain，可选" />
            <Input value={credentialForm.passphrase} onChange={(event) => setCredentialForm((prev) => ({ ...prev, passphrase: event.target.value }))} placeholder="私钥 passphrase，可选" type="password" />
          </div>
          <Input value={credentialForm.privateKeyPath} onChange={(event) => setCredentialForm((prev) => ({ ...prev, privateKeyPath: event.target.value }))} placeholder="服务器本机可读取的私钥路径，可选" />
          <textarea
            value={credentialForm.privateKey}
            onChange={(event) => setCredentialForm((prev) => ({ ...prev, privateKey: event.target.value }))}
            placeholder="私钥内容，可选"
            className="min-h-[120px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          {credentialError ? <div className="text-sm text-destructive">{credentialError}</div> : null}
          <div className="text-xs text-muted-foreground">凭据只保存在服务端内存中，并按当前登录用户隔离；服务重启或过期后需要重新输入。</div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={credentialSaving} onClick={() => setCredentialWorkspace(null)}>取消</Button>
          <Button type="button" disabled={credentialSaving} onClick={() => { void submitCredentials(); }}>
            {credentialSaving ? '连接中...' : '保存并重试'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
