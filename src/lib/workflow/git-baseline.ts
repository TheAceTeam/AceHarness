import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, relative, resolve } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  WorkflowGitSnapshot,
  WorkflowGitSnapshotKind,
  WorkflowGitState,
  WorkflowGitStepDiff,
} from '@/lib/run/state-persistence';

const execFileAsync = promisify(execFile);

const GIT_MAX_BUFFER = 64 * 1024 * 1024;

function toPortablePath(input: string): string {
  return input.replace(/\\/g, '/');
}

function isNotGitRepositoryError(error: any): boolean {
  const text = `${error?.message || ''}\n${error?.stderr || ''}`;
  return text.includes('not a git repository') || text.includes('不是一个 git 仓库');
}

function safeRefSegment(value: string): string {
  return (value || 'snapshot')
    .replace(/\\/g, '/')
    .replace(/[^A-Za-z0-9._/-]+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^\.+/, '')
    .replace(/[/.]+$/, '')
    .slice(0, 160) || 'snapshot';
}

function safeMessageLine(value: string | undefined): string {
  return String(value || '').replace(/\r?\n/g, ' ').trim();
}

async function runGit(cwd: string, args: string[], env?: Record<string, string | undefined>): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: true,
  });
  return stdout.trim();
}

async function gitSucceeds(cwd: string, args: string[]): Promise<boolean> {
  try {
    await runGit(cwd, args);
    return true;
  } catch {
    return false;
  }
}

async function resolveRepoRoot(workspacePath: string): Promise<string | null> {
  try {
    return resolve(await runGit(workspacePath, ['rev-parse', '--show-toplevel']));
  } catch (error) {
    if (isNotGitRepositoryError(error)) return null;
    throw error;
  }
}

async function ensureRepository(workspacePath: string): Promise<{
  repoRoot: string;
  wasGitRepository: boolean;
  initializedRepository: boolean;
}> {
  const existingRoot = await resolveRepoRoot(workspacePath);
  if (existingRoot) {
    return { repoRoot: existingRoot, wasGitRepository: true, initializedRepository: false };
  }

  await runGit(workspacePath, ['init']);
  const repoRoot = await resolveRepoRoot(workspacePath);
  if (!repoRoot) {
    throw new Error('git init 后仍无法解析仓库根目录');
  }
  return { repoRoot, wasGitRepository: false, initializedRepository: true };
}

async function writeSnapshotCommit(input: {
  repoRoot: string;
  workspacePath: string;
  ref: string;
  message: string;
}): Promise<{ commit: string; shortCommit: string; tree: string }> {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'aceharness-git-index-'));
  const indexFile = join(tmpRoot, 'index');
  const env = { GIT_INDEX_FILE: indexFile };

  try {
    const hasHead = await gitSucceeds(input.repoRoot, ['rev-parse', '--verify', 'HEAD']);
    if (hasHead) {
      await runGit(input.repoRoot, ['read-tree', 'HEAD'], env);
    } else {
      await runGit(input.repoRoot, ['read-tree', '--empty'], env);
    }

    const repoPortable = toPortablePath(input.repoRoot).replace(/\/$/, '');
    const workspacePortable = toPortablePath(resolve(input.workspacePath));
    const workspaceRelative = workspacePortable === repoPortable || workspacePortable.startsWith(`${repoPortable}/`)
      ? toPortablePath(relative(input.repoRoot, input.workspacePath))
      : '';
    const pathspec = workspaceRelative && workspaceRelative !== '.' ? workspaceRelative : '.';
    await runGit(input.repoRoot, ['add', '-A', '--', pathspec], env);

    const tree = await runGit(input.repoRoot, ['write-tree'], env);
    const parentArgs = hasHead ? ['-p', 'HEAD'] : [];
    const commit = await runGit(input.repoRoot, ['commit-tree', tree, ...parentArgs, '-m', input.message], {
      ...env,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'CSIHarness',
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'aceharness@example.invalid',
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'CSIHarness',
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'aceharness@example.invalid',
    });
    await runGit(input.repoRoot, ['update-ref', input.ref, commit]);
    const shortCommit = await runGit(input.repoRoot, ['rev-parse', '--short', commit]).catch(() => commit.slice(0, 12));
    return { commit, shortCommit, tree };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function createEmptyGitState(input: {
  runId: string;
  workspacePath: string;
  repoRoot: string;
  wasGitRepository: boolean;
  initializedRepository: boolean;
}): WorkflowGitState {
  return {
    enabled: true,
    runId: input.runId,
    workspacePath: input.workspacePath,
    repoRoot: input.repoRoot,
    wasGitRepository: input.wasGitRepository,
    initializedRepository: input.initializedRepository,
    snapshots: [],
    stepDiffs: [],
    updatedAt: new Date().toISOString(),
  };
}

export async function ensureWorkflowGitState(input: {
  workspacePath: string;
  runId: string;
  existing?: WorkflowGitState;
}): Promise<WorkflowGitState> {
  const workspacePath = resolve(input.workspacePath);
  const repoInfo = await ensureRepository(workspacePath);
  let state: WorkflowGitState = input.existing && input.existing.enabled
    ? {
        ...input.existing,
        runId: input.runId,
        workspacePath,
        repoRoot: repoInfo.repoRoot,
        wasGitRepository: input.existing.wasGitRepository ?? repoInfo.wasGitRepository,
        initializedRepository: input.existing.initializedRepository || repoInfo.initializedRepository,
        snapshots: input.existing.snapshots || [],
        stepDiffs: input.existing.stepDiffs || [],
        updatedAt: new Date().toISOString(),
      }
    : createEmptyGitState({
        runId: input.runId,
        workspacePath,
        repoRoot: repoInfo.repoRoot,
        wasGitRepository: repoInfo.wasGitRepository,
        initializedRepository: repoInfo.initializedRepository,
      });

  if (!state.baselineSnapshotId) {
    const baseline = await recordWorkflowGitSnapshot({
      state,
      kind: 'run-baseline',
      label: '工作流启动基线',
    });
    state = baseline.state;
  }

  return { ...state, updatedAt: new Date().toISOString() };
}

export async function recordWorkflowGitSnapshot(input: {
  state: WorkflowGitState;
  kind: WorkflowGitSnapshotKind;
  label: string;
  stepName?: string;
  phaseName?: string;
  stateName?: string;
  agent?: string;
  allowReuse?: boolean;
}): Promise<{ state: WorkflowGitState; snapshot: WorkflowGitSnapshot }> {
  const now = new Date().toISOString();
  const nextIndex = (input.state.snapshots || []).length + 1;
  const ref = `refs/aceharness/runs/${safeRefSegment(input.state.runId)}/snapshots/${String(nextIndex).padStart(4, '0')}-${safeRefSegment(input.kind)}-${safeRefSegment(input.stepName || input.label)}`;
  const messageParts = [
    `CSIHarness ${input.kind}`,
    `run: ${input.state.runId}`,
    input.stepName ? `step: ${safeMessageLine(input.stepName)}` : '',
    input.phaseName ? `phase: ${safeMessageLine(input.phaseName)}` : '',
    input.stateName ? `state: ${safeMessageLine(input.stateName)}` : '',
    input.agent ? `agent: ${safeMessageLine(input.agent)}` : '',
    safeMessageLine(input.label),
  ].filter(Boolean);

  const written = await writeSnapshotCommit({
    repoRoot: input.state.repoRoot,
    workspacePath: input.state.workspacePath,
    ref,
    message: messageParts.join('\n'),
  });

  const previous = input.state.lastSnapshotId
    ? input.state.snapshots.find((item) => item.id === input.state.lastSnapshotId)
    : input.state.snapshots[input.state.snapshots.length - 1];
  if (input.allowReuse !== false && previous?.tree && previous.tree === written.tree) {
    await runGit(input.state.repoRoot, ['update-ref', '-d', ref]).catch(() => {});
    const reused: WorkflowGitSnapshot = {
      ...previous,
      kind: input.kind,
      label: input.label,
      stepName: input.stepName ?? previous.stepName,
      phaseName: input.phaseName ?? previous.phaseName,
      stateName: input.stateName ?? previous.stateName,
      agent: input.agent ?? previous.agent,
      createdAt: now,
      reusedFromId: previous.id,
    };
    return {
      state: {
        ...input.state,
        updatedAt: now,
      },
      snapshot: reused,
    };
  }

  const snapshot: WorkflowGitSnapshot = {
    id: `git-snap-${nextIndex}-${Date.now()}`,
    ref,
    commit: written.commit,
    shortCommit: written.shortCommit,
    tree: written.tree,
    kind: input.kind,
    label: input.label,
    stepName: input.stepName,
    phaseName: input.phaseName,
    stateName: input.stateName,
    agent: input.agent,
    createdAt: now,
  };

  const state: WorkflowGitState = {
    ...input.state,
    baselineSnapshotId: input.kind === 'run-baseline' ? snapshot.id : input.state.baselineSnapshotId,
    baselineRef: input.kind === 'run-baseline' ? snapshot.ref : input.state.baselineRef,
    baselineCommit: input.kind === 'run-baseline' ? snapshot.commit : input.state.baselineCommit,
    snapshots: [...(input.state.snapshots || []), snapshot],
    lastSnapshotId: snapshot.id,
    lastSnapshotTree: snapshot.tree,
    lastSnapshotCommit: snapshot.commit,
    updatedAt: now,
  };

  return { state, snapshot };
}

export function upsertWorkflowGitStepDiff(
  state: WorkflowGitState,
  diff: WorkflowGitStepDiff,
): WorkflowGitState {
  const existingIndex = (state.stepDiffs || []).findIndex((item) => item.id === diff.id);
  const stepDiffs = [...(state.stepDiffs || [])];
  if (existingIndex >= 0) {
    stepDiffs[existingIndex] = { ...stepDiffs[existingIndex], ...diff };
  } else {
    stepDiffs.push(diff);
  }
  return {
    ...state,
    stepDiffs,
    updatedAt: new Date().toISOString(),
  };
}
