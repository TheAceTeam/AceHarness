import { type Dirent } from 'fs';
import { lstat, readdir } from 'fs/promises';
import { isAbsolute, relative, resolve, sep } from 'path';
import { getWorkspaceRunsDir } from '@/lib/core/app-paths';
import type { PersistedRunState } from '@/lib/run/state-persistence';
import { resolveLightweightTasklistDirectory } from '@/lib/workflow/lightweight-runtime';

export type RunDocumentSource = 'tasklist' | 'runtime-output';

export interface RunDocumentRoot {
  source: RunDocumentSource;
  label: string;
  path: string;
}

export interface RunDocumentEntry {
  relativePath: string;
  size: number;
  modifiedTime: string;
}

const DOCUMENT_EXTENSION_RE = /\.(?:md|mdx|txt)$/i;
const WINDOWS_DRIVE_PATH_RE = /^[A-Za-z]:/;

function isWithinDirectory(baseDirectory: string, targetPath: string): boolean {
  const relativePath = relative(baseDirectory, targetPath);
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
  );
}

export function isSafeRunDocumentId(runId: unknown): runId is string {
  return typeof runId === 'string'
    && Boolean(runId.trim())
    && runId === runId.trim()
    && !runId.includes('\0')
    && !runId.includes('/')
    && !runId.includes('\\')
    && !/[<>:"|?*]/.test(runId)
    && runId !== '.'
    && runId !== '..';
}

function toPosixRelativePath(root: string, path: string): string | null {
  const relativePath = relative(root, path);
  if (!relativePath || !isWithinDirectory(root, path)) return null;
  return normalizeDocumentRelativePath(relativePath.split(sep).join('/'));
}

/** Normalizes a client-supplied document path to a strict POSIX relative path. */
export function normalizeDocumentRelativePath(relativePath: unknown): string | null {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')) return null;

  const slashPath = relativePath.replace(/\\/g, '/');
  if (slashPath.startsWith('/') || WINDOWS_DRIVE_PATH_RE.test(slashPath)) return null;

  const segments = slashPath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return segments.join('/');
}

async function isSafeContainedDirectory(root: string, directory: string): Promise<boolean> {
  const resolvedRoot = resolve(root);
  const resolvedDirectory = resolve(directory);
  if (!isWithinDirectory(resolvedRoot, resolvedDirectory)) return false;

  const relativePath = relative(resolvedRoot, resolvedDirectory);
  const normalizedRelativePath = relativePath
    ? normalizeDocumentRelativePath(relativePath.split(sep).join('/'))
    : '';
  if (relativePath && !normalizedRelativePath) return false;
  const segments = normalizedRelativePath ? normalizedRelativePath.split('/') : [];

  try {
    let currentPath = resolvedRoot;
    const rootMetadata = await lstat(currentPath);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) return false;

    for (const segment of segments) {
      currentPath = resolve(currentPath, segment);
      const metadata = await lstat(currentPath);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function isSafeDocumentParentDirectory(root: string, path: string): Promise<boolean> {
  const relativePath = toPosixRelativePath(root, path);
  if (!relativePath) return false;
  const parentSegments = relativePath.split('/').slice(0, -1);
  const parentPath = parentSegments.length > 0
    ? resolve(root, parentSegments.join('/'))
    : resolve(root);
  return isSafeContainedDirectory(root, parentPath);
}

/**
 * Resolves a persisted run's document roots. Tasklist roots are derived from
 * saved run metadata, never from the mutable workflow configuration.
 */
export function resolveRunDocumentRoots(runId: string, state: PersistedRunState): RunDocumentRoot[] {
  if (!isSafeRunDocumentId(runId)) {
    throw new Error('Invalid run identifier');
  }

  const workspaceRunsDirectory = resolve(getWorkspaceRunsDir());
  const runtimeOutputDirectory = resolve(workspaceRunsDirectory, runId, 'outputs');
  if (!isWithinDirectory(workspaceRunsDirectory, runtimeOutputDirectory)) {
    throw new Error('Runtime output directory escapes the runs root');
  }

  const roots: RunDocumentRoot[] = [];
  const lightweight = state.lightweight;
  if (lightweight?.profile === 'lightweight') {
    if (
      typeof lightweight.workspaceRoot !== 'string'
      || typeof lightweight.tasklistDirectory !== 'string'
      || typeof lightweight.resolvedTasklistDirectory !== 'string'
    ) {
      throw new Error('Persisted lightweight tasklist metadata is incomplete');
    }
    const expectedWorkspaceRoot = typeof state.workingDirectory === 'string' && state.workingDirectory.trim()
      ? resolve(state.workingDirectory)
      : resolve(lightweight.workspaceRoot);
    if (resolve(lightweight.workspaceRoot) !== expectedWorkspaceRoot) {
      throw new Error('Persisted lightweight workspace does not match the run working directory');
    }
    const persistedResolvedDirectory = resolve(lightweight.resolvedTasklistDirectory);
    const recalculated = resolveLightweightTasklistDirectory({
      workspaceRoot: expectedWorkspaceRoot,
      tasklistDirectory: lightweight.tasklistDirectory,
    });
    if (persistedResolvedDirectory !== recalculated.resolvedTasklistDirectory) {
      throw new Error('Persisted lightweight tasklist directory is inconsistent');
    }
    roots.push({
      source: 'tasklist',
      label: '任务文档',
      path: recalculated.resolvedTasklistDirectory,
    });
  }

  roots.push({
    source: 'runtime-output',
    label: '运行输出',
    path: runtimeOutputDirectory,
  });
  return roots;
}

export function getRunDocumentRoot(
  runId: string,
  state: PersistedRunState,
  source: RunDocumentSource,
): RunDocumentRoot | null {
  return resolveRunDocumentRoots(runId, state).find((root) => root.source === source) || null;
}

/** Resolves a client-supplied relative document path without permitting escapes. */
export function resolveDocumentPath(root: string, relativePath: unknown): string | null {
  const normalized = normalizeDocumentRelativePath(relativePath);
  if (!normalized || isAbsolute(normalized)) return null;
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, normalized);
  return isWithinDirectory(resolvedRoot, target) && target !== resolvedRoot ? target : null;
}

export function isSafeDocumentRename(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  const normalized = name.trim();
  return Boolean(normalized)
    && !normalized.includes('\0')
    && !normalized.includes('/')
    && !normalized.includes('\\')
    && !/[<>:"|?*]/.test(normalized)
    && normalized !== '.'
    && normalized !== '..';
}

export async function isRegularDocumentFile(root: string, path: string): Promise<boolean> {
  const relativePath = toPosixRelativePath(root, path);
  if (!relativePath || !DOCUMENT_EXTENSION_RE.test(relativePath)) return false;
  if (!(await isSafeDocumentParentDirectory(root, path))) return false;

  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Verifies that a new document location remains in a non-symlinked root branch. */
export async function isSafeDocumentDestination(root: string, path: string): Promise<boolean> {
  const relativePath = toPosixRelativePath(root, path);
  if (!relativePath || !DOCUMENT_EXTENSION_RE.test(relativePath)) return false;
  return isSafeDocumentParentDirectory(root, path);
}

/** Lists supported text documents recursively, excluding symlinks and escaped paths. */
export async function listRunDocumentsRecursively(root: string): Promise<RunDocumentEntry[]> {
  const resolvedRoot = resolve(root);
  const entries: RunDocumentEntry[] = [];

  async function visit(directory: string): Promise<void> {
    if (!(await isSafeContainedDirectory(resolvedRoot, directory))) return;

    let children: Dirent[];
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const child of children) {
      if (child.isSymbolicLink()) continue;
      const fullPath = resolve(directory, child.name);
      if (!isWithinDirectory(resolvedRoot, fullPath)) continue;

      if (child.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!child.isFile() || !DOCUMENT_EXTENSION_RE.test(child.name)) continue;

      try {
        const metadata = await lstat(fullPath);
        if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
        const relativePath = toPosixRelativePath(resolvedRoot, fullPath);
        if (!relativePath) continue;
        entries.push({
          relativePath,
          size: metadata.size,
          modifiedTime: metadata.mtime.toISOString(),
        });
      } catch {
        // Files can disappear during a run; omit only the unstable entry.
      }
    }
  }

  await visit(resolvedRoot);
  return entries;
}
