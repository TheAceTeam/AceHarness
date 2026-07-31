import { isAbsolute, relative, resolve, sep } from 'path';
import { findActiveRuns } from '@/lib/run/state-persistence';
import { normalizeLightweightTasklistDirectory } from '@/lib/workflow/lightweight';

export interface ResolvedLightweightTasklistDirectory {
  tasklistDirectory: string;
  workspaceRoot: string;
  resolvedTasklistDirectory: string;
}

const globalForLightweightTasklistDirectories = globalThis as typeof globalThis & {
  __activeLightweightTasklistDirectories?: Map<string, string>;
};
const activeLightweightTasklistDirectories = globalForLightweightTasklistDirectories
  .__activeLightweightTasklistDirectories ??= new Map<string, string>();

export class LightweightTasklistDirectoryConflictError extends Error {
  constructor(readonly conflictingRunId: string) {
    super(`Lightweight tasklist directory is already in use by run ${conflictingRunId}`);
    this.name = 'LightweightTasklistDirectoryConflictError';
  }
}

function isWithinDirectory(baseDirectory: string, targetPath: string): boolean {
  const relativePath = relative(baseDirectory, targetPath);
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
  );
}

export function resolveLightweightTasklistDirectory(input: {
  workspaceRoot: string;
  tasklistDirectory: unknown;
}): ResolvedLightweightTasklistDirectory {
  const workspaceRoot = resolve(input.workspaceRoot);
  const tasklistDirectory = normalizeLightweightTasklistDirectory(input.tasklistDirectory);
  const resolvedTasklistDirectory = resolve(workspaceRoot, tasklistDirectory);
  if (!isWithinDirectory(workspaceRoot, resolvedTasklistDirectory)) {
    throw new Error('workflow.lightweight.tasklistDirectory escapes the effective workspace');
  }

  return {
    tasklistDirectory,
    workspaceRoot,
    resolvedTasklistDirectory,
  };
}

export function getLightweightTasklistDirectoryKey(directory: string): string {
  const resolvedDirectory = resolve(directory);
  return process.platform === 'win32' ? resolvedDirectory.toLocaleLowerCase() : resolvedDirectory;
}

export async function reserveLightweightTasklistDirectory(input: {
  runId: string;
  resolvedTasklistDirectory: string;
}): Promise<void> {
  const key = getLightweightTasklistDirectoryKey(input.resolvedTasklistDirectory);
  const inMemoryRunId = activeLightweightTasklistDirectories.get(key);
  if (inMemoryRunId && inMemoryRunId !== input.runId) {
    throw new LightweightTasklistDirectoryConflictError(inMemoryRunId);
  }

  const activeRuns = await findActiveRuns();
  const persistedConflict = activeRuns.find((runState) => (
    runState.runId !== input.runId
    && runState.lightweight?.profile === 'lightweight'
    && getLightweightTasklistDirectoryKey(runState.lightweight.resolvedTasklistDirectory) === key
  ));
  if (persistedConflict) {
    throw new LightweightTasklistDirectoryConflictError(persistedConflict.runId);
  }

  const concurrentRunId = activeLightweightTasklistDirectories.get(key);
  if (concurrentRunId && concurrentRunId !== input.runId) {
    throw new LightweightTasklistDirectoryConflictError(concurrentRunId);
  }

  activeLightweightTasklistDirectories.set(key, input.runId);
}

export function releaseLightweightTasklistDirectory(input: {
  runId: string;
  resolvedTasklistDirectory: string;
}): void {
  const key = getLightweightTasklistDirectoryKey(input.resolvedTasklistDirectory);
  if (activeLightweightTasklistDirectories.get(key) === input.runId) {
    activeLightweightTasklistDirectories.delete(key);
  }
}
