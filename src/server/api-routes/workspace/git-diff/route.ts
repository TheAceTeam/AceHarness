import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  WORKSPACE_TEXT_FILE_SIZE_LIMIT,
  resolveExistingInsideWorkspace,
  resolveWorkspaceRoot,
} from '@/lib/core/workspace-path-safety';
import { jsonOk, workspaceRouteError, workspaceRouteJsonError } from '@/server/api-route-runtime/workspace-route';

const execFileAsync = promisify(execFile);

type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';

type GitSummaryFile = {
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

async function runGit(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

async function getRepoContext(workspaceRoot: string) {
  const repoRoot = toPortablePath(await runGit(workspaceRoot, ['rev-parse', '--show-toplevel']));
  const branch = await runGit(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'HEAD');
  const headRaw = await runGit(workspaceRoot, ['log', '-1', '--format=%H%n%h%n%s%n%an%n%ae%n%aI']).catch(() => '');
  const [hash = '', shortHash = '', message = '', authorName = '', authorEmail = '', authoredAt = ''] = headRaw.split('\n');
  const workspaceRelative = toPortablePath(path.relative(repoRoot, workspaceRoot));
  return {
    repoRoot,
    branch,
    head: hash ? { hash, shortHash, message, authorName, authorEmail, authoredAt } : null,
    workspaceRelative: workspaceRelative && workspaceRelative !== '.' ? workspaceRelative : '',
  };
}

function inferStatus(code: string, rest: string): { status: GitFileStatus; pathText: string; previousPathText?: string } {
  if (code === '??') return { status: 'untracked', pathText: rest };
  if (code.includes('R') || code.includes('C')) {
    const [previousPathText, pathText] = rest.split(' -> ');
    return { status: 'renamed', pathText: pathText || rest, previousPathText };
  }
  if (code.includes('D')) return { status: 'deleted', pathText: rest };
  if (code.includes('A')) return { status: 'added', pathText: rest };
  return { status: 'modified', pathText: rest };
}

function countContentLines(content: string) {
  if (!content) return 0;
  return content.replace(/\r\n/g, '\n').split('\n').length;
}

async function safeReadText(filePath: string) {
  const stat = await fs.stat(filePath);
  if (stat.size > WORKSPACE_TEXT_FILE_SIZE_LIMIT) {
    return { tooLarge: true, content: '', size: stat.size };
  }
  const content = await fs.readFile(filePath, 'utf-8');
  return { tooLarge: false, content, size: stat.size };
}

async function getNumstat(workspaceRoot: string, repoPath: string) {
  const out = await runGit(workspaceRoot, ['diff', '--numstat', 'HEAD', '--', repoPath]).catch(() => '');
  const row = out.split('\n').find(Boolean);
  if (!row) return { additions: 0, deletions: 0 };
  const [additionsText = '0', deletionsText = '0'] = row.split('\t');
  const additions = additionsText === '-' ? 0 : Number(additionsText) || 0;
  const deletions = deletionsText === '-' ? 0 : Number(deletionsText) || 0;
  return { additions, deletions };
}

async function listChangedFiles(workspaceRoot: string, repoRoot: string): Promise<GitSummaryFile[]> {
  const statusOutput = await runGit(workspaceRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  const files: GitSummaryFile[] = [];

  for (const line of statusOutput.split('\n').filter(Boolean)) {
    const code = line.slice(0, 2);
    if (code === '!!') continue;
    const rest = line.slice(3);
    const parsed = inferStatus(code, rest);
    const currentRepoPath = toPortablePath(parsed.pathText);
    const currentAbsPath = path.resolve(repoRoot, currentRepoPath);

    if (parsed.status !== 'deleted') {
      try {
        await resolveExistingInsideWorkspace(workspaceRoot, currentAbsPath);
      } catch {
        continue;
      }
    } else {
      const deletedAbsPath = path.resolve(repoRoot, currentRepoPath);
      if (!toPortablePath(deletedAbsPath).startsWith(toPortablePath(workspaceRoot).replace(/\/$/, '') + '/')
        && toPortablePath(deletedAbsPath) !== toPortablePath(workspaceRoot)) {
        continue;
      }
    }

    let additions = 0;
    let deletions = 0;
    if (parsed.status === 'untracked') {
      try {
        const fileText = await fs.readFile(currentAbsPath, 'utf-8');
        additions = countContentLines(fileText);
      } catch {
        additions = 0;
      }
    } else {
      const stats = await getNumstat(workspaceRoot, currentRepoPath);
      additions = stats.additions;
      deletions = stats.deletions;
    }

    const workspacePath = toPortablePath(path.relative(workspaceRoot, currentAbsPath));
    const previousRepoPath = parsed.previousPathText ? toPortablePath(parsed.previousPathText) : undefined;
    const previousAbsPath = previousRepoPath ? path.resolve(repoRoot, previousRepoPath) : undefined;
    const previousPath = previousAbsPath ? toPortablePath(path.relative(workspaceRoot, previousAbsPath)) : undefined;

    files.push({
      path: workspacePath,
      repoPath: currentRepoPath,
      previousPath,
      previousRepoPath,
      status: parsed.status,
      additions,
      deletions,
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

async function buildSummary(workspaceRoot: string) {
  const context = await getRepoContext(workspaceRoot);
  const files = await listChangedFiles(workspaceRoot, context.repoRoot);
  return {
    available: true,
    workspaceRoot: toPortablePath(workspaceRoot),
    repoRoot: context.repoRoot,
    branch: context.branch,
    head: context.head,
    clean: files.length === 0,
    files,
    totals: {
      files: files.length,
      additions: files.reduce((sum, item) => sum + item.additions, 0),
      deletions: files.reduce((sum, item) => sum + item.deletions, 0),
    },
  };
}

async function buildFileDetail(workspaceRoot: string, filePath: string) {
  const context = await getRepoContext(workspaceRoot);
  const files = await listChangedFiles(workspaceRoot, context.repoRoot);
  const target = files.find((item) => item.path === filePath);
  if (!target) {
    return workspaceRouteJsonError('未找到对应的变更文件', 404);
  }

  const currentAbsPath = path.resolve(workspaceRoot, target.path);
  let currentContent = '';
  let currentTooLarge = false;
  let currentSize = 0;

  if (target.status !== 'deleted') {
    const currentRead = await safeReadText(currentAbsPath).catch(() => ({ tooLarge: false, content: '', size: 0 }));
    currentContent = currentRead.content;
    currentTooLarge = currentRead.tooLarge;
    currentSize = currentRead.size;
  }

  const headPath = target.previousRepoPath || target.repoPath;
  let originalContent = '';
  let originalTooLarge = false;
  let originalSize = 0;

  if (target.status !== 'untracked') {
    try {
      originalContent = await runGit(context.repoRoot, ['show', `HEAD:${headPath}`]);
      originalSize = Buffer.byteLength(originalContent, 'utf-8');
      if (originalSize > WORKSPACE_TEXT_FILE_SIZE_LIMIT) {
        originalContent = '';
        originalTooLarge = true;
      }
    } catch {
      originalContent = '';
    }
  }

  const patchTargets = target.status === 'renamed' && target.previousRepoPath
    ? [target.previousRepoPath, target.repoPath]
    : [target.repoPath];
  const patch = target.status === 'untracked'
    ? ''
    : await runGit(context.repoRoot, ['diff', '--no-color', '--no-ext-diff', '--unified=3', 'HEAD', '--', ...patchTargets]).catch(() => '');

  return jsonOk({
    available: true,
    workspaceRoot: toPortablePath(workspaceRoot),
    repoRoot: context.repoRoot,
    branch: context.branch,
    file: {
      ...target,
      patch,
      originalContent,
      currentContent,
      originalTooLarge,
      currentTooLarge,
      originalSize,
      currentSize,
    },
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get('workspace');
    const file = searchParams.get('file');

    if (!workspace) {
      return workspaceRouteJsonError('缺少 workspace 参数', 400);
    }

    const workspaceRoot = await resolveWorkspaceRoot(workspace);

    try {
      if (file) {
        return await buildFileDetail(workspaceRoot, file);
      }
      return jsonOk(await buildSummary(workspaceRoot));
    } catch (error: any) {
      const message = String(error?.message || '');
      if (message.includes('not a git repository') || message.includes('不是一个 git 仓库')) {
        return jsonOk({
          available: false,
          workspaceRoot: toPortablePath(workspaceRoot),
          clean: true,
          files: [],
          totals: { files: 0, additions: 0, deletions: 0 },
          reason: '当前工作区不在 Git 仓库中',
        });
      }
      throw error;
    }
  } catch (error: any) {
    return workspaceRouteError(error);
  }
}

