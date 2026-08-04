import { isAbsolute, relative, resolve, sep } from 'path';
import { getWorkspaceRunsDir } from '@/lib/core/app-paths';

const RUNTIME_TASKLIST_DIRECTORY = 'tasklist';

export interface ResolvedLightweightTasklistDirectory {
  tasklistDirectory: typeof RUNTIME_TASKLIST_DIRECTORY;
  workspaceRoot: string;
  resolvedTasklistDirectory: string;
}

function isWithinDirectory(baseDirectory: string, targetPath: string): boolean {
  const relativePath = relative(baseDirectory, targetPath);
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
  );
}

function isSafeRunId(runId: unknown): runId is string {
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

export function resolveLightweightTasklistDirectory(input: {
  runId: string;
  workspaceRoot: string;
}): ResolvedLightweightTasklistDirectory {
  if (!isSafeRunId(input.runId)) {
    throw new Error('Invalid lightweight workflow run identifier');
  }

  const workspaceRoot = resolve(input.workspaceRoot);
  const runsRoot = resolve(getWorkspaceRunsDir());
  const resolvedTasklistDirectory = resolve(runsRoot, input.runId, RUNTIME_TASKLIST_DIRECTORY);
  if (!isWithinDirectory(runsRoot, resolvedTasklistDirectory)) {
    throw new Error('Lightweight tasklist directory escapes the runtime runs root');
  }

  return {
    tasklistDirectory: RUNTIME_TASKLIST_DIRECTORY,
    workspaceRoot,
    resolvedTasklistDirectory,
  };
}
