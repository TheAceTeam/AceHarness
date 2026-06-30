import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { loadRunState, type WorkflowGitSnapshot } from '@/lib/run/state-persistence';
import { requireAuth } from '@/lib/auth/middleware';
import { canAccessRunState } from '@/lib/workflow/run-access';
import {
  WORKSPACE_TEXT_FILE_SIZE_LIMIT,
  workspaceErrorResponse,
} from '@/lib/core/workspace-path-safety';

const execFileAsync = promisify(execFile);

type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

type GitDiffFile = {
  path: string;
  repoPath: string;
  previousPath?: string;
  previousRepoPath?: string;
  status: GitFileStatus;
  additions: number;
  deletions: number;
};

function toPortablePath(input: string): string {
  return input.replace(/\\/g, '/');
}

function normalizeNameStatusPathText(raw: string) {
  return toPortablePath(raw.replace(/^"+|"+$/g, ''));
}

function parseNameStatusLine(line: string) {
  const parts = line.split('\t');
  const code = parts[0] || '';
  if (code.startsWith('R') || code.startsWith('C')) {
    return {
      status: 'renamed' as GitFileStatus,
      previousRepoPath: normalizeNameStatusPathText(parts[1] || ''),
      repoPath: normalizeNameStatusPathText(parts[2] || ''),
    };
  }
  const status = code.includes('D')
    ? 'deleted'
    : code.includes('A')
      ? 'added'
      : 'modified';
  return { status: status as GitFileStatus, repoPath: normalizeNameStatusPathText(parts[1] || '') };
}

async function runGit(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

async function safeGitBlob(repoRoot: string, spec: string) {
  try {
    const content = await runGit(repoRoot, ['show', spec]);
    const size = Buffer.byteLength(content, 'utf-8');
    if (size > WORKSPACE_TEXT_FILE_SIZE_LIMIT) {
      return { tooLarge: true, content: '', size };
    }
    return { tooLarge: false, content, size };
  } catch {
    return { tooLarge: false, content: '', size: 0 };
  }
}

async function getDiffNumstat(repoRoot: string, base: string, target: string) {
  const out = await runGit(repoRoot, ['diff', '--numstat', '-M', base, target]).catch(() => '');
  const stats = new Map<string, { additions: number; deletions: number }>();
  for (const line of out.split('\n').filter(Boolean)) {
    const [additionsText = '0', deletionsText = '0', filePath = ''] = line.split('\t');
    const additions = additionsText === '-' ? 0 : Number(additionsText) || 0;
    const deletions = deletionsText === '-' ? 0 : Number(deletionsText) || 0;
    stats.set(normalizeNameStatusPathText(filePath), { additions, deletions });
  }
  return stats;
}

function toWorkspaceDisplayPath(workspaceRoot: string, repoRoot: string, repoPath: string) {
  const absolute = path.resolve(repoRoot, repoPath);
  return toPortablePath(path.relative(workspaceRoot, absolute));
}

async function listDiffFiles(input: {
  repoRoot: string;
  workspaceRoot: string;
  baseCommit: string;
  targetCommit: string;
}): Promise<GitDiffFile[]> {
  const nameStatusRaw = await runGit(input.repoRoot, ['diff', '--name-status', '-M', input.baseCommit, input.targetCommit]).catch(() => '');
  const numstat = await getDiffNumstat(input.repoRoot, input.baseCommit, input.targetCommit);
  const workspacePrefix = toPortablePath(input.workspaceRoot).replace(/\/$/, '') + '/';
  const files: GitDiffFile[] = [];

  for (const line of nameStatusRaw.split('\n').filter(Boolean)) {
    const parsed = parseNameStatusLine(line);
    if (!parsed.repoPath) continue;
    const currentAbsPath = path.resolve(input.repoRoot, parsed.repoPath);
    const currentPortable = toPortablePath(currentAbsPath);
    const previousRepoPath = parsed.previousRepoPath;
    const previousAbsPath = previousRepoPath ? path.resolve(input.repoRoot, previousRepoPath) : null;
    const previousPortable = previousAbsPath ? toPortablePath(previousAbsPath) : '';

    const touchesWorkspace =
      currentPortable === toPortablePath(input.workspaceRoot)
      || currentPortable.startsWith(workspacePrefix)
      || (previousPortable && (previousPortable === toPortablePath(input.workspaceRoot) || previousPortable.startsWith(workspacePrefix)));
    if (!touchesWorkspace) continue;

    const stats = numstat.get(parsed.repoPath) || (previousRepoPath ? numstat.get(previousRepoPath) : undefined) || { additions: 0, deletions: 0 };
    files.push({
      path: toWorkspaceDisplayPath(input.workspaceRoot, input.repoRoot, parsed.repoPath),
      repoPath: parsed.repoPath,
      previousPath: previousRepoPath ? toWorkspaceDisplayPath(input.workspaceRoot, input.repoRoot, previousRepoPath) : undefined,
      previousRepoPath,
      status: parsed.status,
      additions: stats.additions,
      deletions: stats.deletions,
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function findSnapshot(snapshots: WorkflowGitSnapshot[], idOrRef?: string | null) {
  if (!idOrRef) return null;
  return snapshots.find((snapshot) => snapshot.id === idOrRef || snapshot.ref === idOrRef || snapshot.commit === idOrRef) || null;
}

function snapshotLabel(snapshot: WorkflowGitSnapshot | null, fallback: string) {
  if (!snapshot) return fallback;
  return `${snapshot.shortCommit || snapshot.commit.slice(0, 12)} · ${snapshot.label}`;
}

async function buildFileDetail(input: {
  repoRoot: string;
  workspaceRoot: string;
  base: WorkflowGitSnapshot;
  target: WorkflowGitSnapshot;
  filePath: string;
}) {
  const files = await listDiffFiles({
    repoRoot: input.repoRoot,
    workspaceRoot: input.workspaceRoot,
    baseCommit: input.base.commit,
    targetCommit: input.target.commit,
  });
  const target = files.find((item) => item.path === input.filePath);
  if (!target) {
    return NextResponse.json({ error: '未找到对应步骤变更文件' }, { status: 404 });
  }

  const original = target.status === 'added'
    ? { tooLarge: false, content: '', size: 0 }
    : await safeGitBlob(input.repoRoot, `${input.base.commit}:${target.previousRepoPath || target.repoPath}`);
  const current = target.status === 'deleted'
    ? { tooLarge: false, content: '', size: 0 }
    : await safeGitBlob(input.repoRoot, `${input.target.commit}:${target.repoPath}`);

  const patchTargets = target.status === 'renamed' && target.previousRepoPath
    ? [target.previousRepoPath, target.repoPath]
    : [target.repoPath];
  const patch = await runGit(
    input.repoRoot,
    ['diff', '--no-color', '--no-ext-diff', '--unified=3', input.base.commit, input.target.commit, '--', ...patchTargets],
  ).catch(() => '');

  return NextResponse.json({
    available: true,
    file: {
      ...target,
      patch,
      originalContent: original.content,
      currentContent: current.content,
      originalTooLarge: original.tooLarge,
      currentTooLarge: current.tooLarge,
      originalSize: original.size,
      currentSize: current.size,
      baseLabel: snapshotLabel(input.base, 'Before'),
      targetLabel: snapshotLabel(input.target, 'After'),
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');
    const stepDiffId = searchParams.get('stepDiffId');
    const file = searchParams.get('file');
    const range = searchParams.get('range') || 'step';

    if (!runId) {
      return NextResponse.json({ error: '缺少 runId 参数' }, { status: 400 });
    }

    const runState = await loadRunState(runId);
    if (runState && !canAccessRunState(auth, runState)) {
      return NextResponse.json({ error: '无权访问该工作流 Git 变更' }, { status: 403 });
    }
    const gitState = runState?.workspaceGit;
    if (!runState || !gitState?.enabled) {
      return NextResponse.json({
        available: false,
        reason: gitState?.error || '该运行没有可用的 Git 基线记录',
        snapshots: gitState?.snapshots || [],
        stepDiffs: gitState?.stepDiffs || [],
      });
    }

    const snapshots = gitState.snapshots || [];
    const stepDiffs = gitState.stepDiffs || [];
    const selectedStep = stepDiffId
      ? stepDiffs.find((item) => item.id === stepDiffId || item.stepLogId === stepDiffId)
      : stepDiffs[stepDiffs.length - 1];

    let baseSnapshot: WorkflowGitSnapshot | null = null;
    let targetSnapshot: WorkflowGitSnapshot | null = null;
    if (selectedStep) {
      targetSnapshot = findSnapshot(snapshots, selectedStep.afterSnapshotId) || findSnapshot(snapshots, selectedStep.beforeSnapshotId);
      baseSnapshot = range === 'baseline'
        ? findSnapshot(snapshots, gitState.baselineSnapshotId)
        : findSnapshot(snapshots, selectedStep.beforeSnapshotId);
    }

    const common = {
      available: true,
      workspaceRoot: toPortablePath(gitState.workspacePath),
      repoRoot: toPortablePath(gitState.repoRoot),
      baselineSnapshotId: gitState.baselineSnapshotId,
      snapshots,
      stepDiffs,
      selectedStepDiffId: selectedStep?.id || null,
      range,
    };

    if (!baseSnapshot || !targetSnapshot) {
      return NextResponse.json({
        ...common,
        files: [],
        totals: { files: 0, additions: 0, deletions: 0 },
        patch: '',
        reason: selectedStep ? '该步骤还没有完整的前后快照' : '还没有步骤快照',
      });
    }

    if (file) {
      return buildFileDetail({
        repoRoot: gitState.repoRoot,
        workspaceRoot: gitState.workspacePath,
        base: baseSnapshot,
        target: targetSnapshot,
        filePath: file,
      });
    }

    const files = await listDiffFiles({
      repoRoot: gitState.repoRoot,
      workspaceRoot: gitState.workspacePath,
      baseCommit: baseSnapshot.commit,
      targetCommit: targetSnapshot.commit,
    });
    const patch = await runGit(
      gitState.repoRoot,
      ['diff', '--no-color', '--no-ext-diff', '--unified=3', baseSnapshot.commit, targetSnapshot.commit],
    ).catch(() => '');

    return NextResponse.json({
      ...common,
      baseSnapshot,
      targetSnapshot,
      files,
      totals: {
        files: files.length,
        additions: files.reduce((sum, item) => sum + item.additions, 0),
        deletions: files.reduce((sum, item) => sum + item.deletions, 0),
      },
      patch,
    });
  } catch (error) {
    const { message, status } = workspaceErrorResponse(error);
    return NextResponse.json({ error: message || '获取工作流 Git Diff 失败' }, { status });
  }
}
