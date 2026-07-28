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

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
type GitBrowserScope = 'unstaged' | 'staged' | 'untracked';

type GitSummaryFile = {
  path: string;
  repoPath: string;
  previousPath?: string;
  previousRepoPath?: string;
  status: GitFileStatus;
  additions: number;
  deletions: number;
};

type GitCommitSummary = {
  hash: string;
  shortHash: string;
  message: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  additions: number;
  deletions: number;
  fileCount: number;
};

type GitCommitListResult = {
  commits: GitCommitSummary[];
  hasMore: boolean;
};

function toPortablePath(input: string): string {
  return input.replace(/\\/g, '/');
}

async function runGit(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 24 * 1024 * 1024,
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

function getScopePathArgs(workspaceRelative: string): string[] {
  return workspaceRelative ? ['--', workspaceRelative] : [];
}

function normalizeNameStatusPathText(raw: string) {
  return toPortablePath(raw.replace(/^"+|"+$/g, ''));
}

function parseNameStatusLine(line: string) {
  const parts = line.split('\t');
  const code = parts[0] || '';
  if (code === '??') {
    return { status: 'untracked' as GitFileStatus, repoPath: normalizeNameStatusPathText(parts[1] || '') };
  }
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

async function getDiffNumstat(repoRoot: string, args: string[]) {
  const out = await runGit(repoRoot, args).catch(() => '');
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

async function listScopeFiles(workspaceRoot: string, scope: GitBrowserScope): Promise<GitSummaryFile[]> {
  const context = await getRepoContext(workspaceRoot);
  const scopePathArgs = getScopePathArgs(context.workspaceRelative);
  const nameStatusArgs = scope === 'unstaged'
    ? ['diff', '--name-status', '-M', ...scopePathArgs]
    : scope === 'staged'
      ? ['diff', '--cached', '--name-status', '-M', ...scopePathArgs]
      : ['ls-files', '--others', '--exclude-standard', ...scopePathArgs];
  const numstatArgs = scope === 'unstaged'
    ? ['diff', '--numstat', '-M', ...scopePathArgs]
    : scope === 'staged'
      ? ['diff', '--cached', '--numstat', '-M', ...scopePathArgs]
      : [];

  const raw = await runGit(context.repoRoot, nameStatusArgs).catch(() => '');
  const numstat = scope === 'untracked' ? new Map<string, { additions: number; deletions: number }>() : await getDiffNumstat(context.repoRoot, numstatArgs);
  const files: GitSummaryFile[] = [];

  for (const line of raw.split('\n').filter(Boolean)) {
    if (scope === 'untracked') {
      const repoPath = normalizeNameStatusPathText(line);
      const absolute = path.resolve(context.repoRoot, repoPath);
      try {
        await resolveExistingInsideWorkspace(workspaceRoot, absolute);
      } catch {
        continue;
      }
      let additions = 0;
      try {
        const fileText = await fs.readFile(absolute, 'utf-8');
        additions = countContentLines(fileText);
      } catch {
        additions = 0;
      }
      files.push({
        path: toWorkspaceDisplayPath(workspaceRoot, context.repoRoot, repoPath),
        repoPath,
        status: 'untracked',
        additions,
        deletions: 0,
      });
      continue;
    }

    const parsed = parseNameStatusLine(line);
    const currentAbsPath = path.resolve(context.repoRoot, parsed.repoPath);
    if (parsed.status !== 'deleted') {
      try {
        await resolveExistingInsideWorkspace(workspaceRoot, currentAbsPath);
      } catch {
        continue;
      }
    } else {
      const workspacePrefix = toPortablePath(workspaceRoot).replace(/\/$/, '') + '/';
      const deletedPortable = toPortablePath(currentAbsPath);
      if (deletedPortable !== toPortablePath(workspaceRoot) && !deletedPortable.startsWith(workspacePrefix)) {
        continue;
      }
    }

    const previousRepoPath = parsed.previousRepoPath;
    const previousPath = previousRepoPath
      ? toWorkspaceDisplayPath(workspaceRoot, context.repoRoot, previousRepoPath)
      : undefined;
    const stats = numstat.get(parsed.repoPath) || { additions: 0, deletions: 0 };

    files.push({
      path: toWorkspaceDisplayPath(workspaceRoot, context.repoRoot, parsed.repoPath),
      repoPath: parsed.repoPath,
      previousPath,
      previousRepoPath,
      status: parsed.status,
      additions: stats.additions,
      deletions: stats.deletions,
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

async function listCommits(workspaceRoot: string, offset = 0, limit = 40): Promise<GitCommitListResult> {
  const context = await getRepoContext(workspaceRoot);
  const scopePathArgs = getScopePathArgs(context.workspaceRelative);
  const logArgs = [
    'log',
    `--skip=${Math.max(0, offset)}`,
    `--max-count=${Math.max(1, limit + 1)}`,
    '--date=iso-strict',
    '--pretty=format:%H%x09%h%x09%s%x09%an%x09%ae%x09%aI',
    '--shortstat',
    ...scopePathArgs,
  ];
  const raw = await runGit(context.repoRoot, logArgs).catch(() => '');
  const commits: GitCommitSummary[] = [];
  const lines = raw.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 6) continue;
    const [hash, shortHash, message, authorName, authorEmail, authoredAt] = parts;
    let additions = 0;
    let deletions = 0;
    let fileCount = 0;
    const nextLine = lines[index + 1] || '';
    const fileMatch = nextLine.match(/(\d+)\s+files?\s+changed/);
    const insertMatch = nextLine.match(/(\d+)\s+insertions?\(\+\)/);
    const deleteMatch = nextLine.match(/(\d+)\s+deletions?\(-\)/);
    if (fileMatch || insertMatch || deleteMatch) {
      fileCount = Number(fileMatch?.[1] || 0);
      additions = Number(insertMatch?.[1] || 0);
      deletions = Number(deleteMatch?.[1] || 0);
      index += 1;
    }
    commits.push({
      hash,
      shortHash,
      message,
      authorName,
      authorEmail,
      authoredAt,
      additions,
      deletions,
      fileCount,
    });
  }

  const hasMore = commits.length > limit;
  return {
    commits: hasMore ? commits.slice(0, limit) : commits,
    hasMore,
  };
}

async function listCommitFiles(workspaceRoot: string, commit: string): Promise<GitSummaryFile[]> {
  const context = await getRepoContext(workspaceRoot);
  const scopePathArgs = getScopePathArgs(context.workspaceRelative);
  const nameStatusRaw = await runGit(
    context.repoRoot,
    ['show', '--format=', '--name-status', '--find-renames', commit, ...scopePathArgs],
  ).catch(() => '');
  const numstat = await getDiffNumstat(
    context.repoRoot,
    ['show', '--format=', '--numstat', '--find-renames', commit, ...scopePathArgs],
  );

  const files: GitSummaryFile[] = [];
  for (const line of nameStatusRaw.split('\n').filter(Boolean)) {
    const parsed = parseNameStatusLine(line);
    if (!parsed.repoPath) continue;
    const currentAbsPath = path.resolve(context.repoRoot, parsed.repoPath);
    const previousRepoPath = parsed.previousRepoPath;
    const previousPath = previousRepoPath
      ? toWorkspaceDisplayPath(workspaceRoot, context.repoRoot, previousRepoPath)
      : undefined;

    if (parsed.status !== 'deleted') {
      const workspacePrefix = toPortablePath(workspaceRoot).replace(/\/$/, '') + '/';
      const currentPortable = toPortablePath(currentAbsPath);
      if (currentPortable !== toPortablePath(workspaceRoot) && !currentPortable.startsWith(workspacePrefix)) {
        if (!previousRepoPath) continue;
      }
    }

    const stats = numstat.get(parsed.repoPath) || (previousRepoPath ? numstat.get(previousRepoPath) : undefined) || { additions: 0, deletions: 0 };

    files.push({
      path: toWorkspaceDisplayPath(workspaceRoot, context.repoRoot, parsed.repoPath),
      repoPath: parsed.repoPath,
      previousPath,
      previousRepoPath,
      status: parsed.status,
      additions: stats.additions,
      deletions: stats.deletions,
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

async function getCommitSummary(workspaceRoot: string, commit: string): Promise<GitCommitSummary | null> {
  const raw = await runGit(
    workspaceRoot,
    ['show', '-s', '--date=iso-strict', '--format=%H%n%h%n%s%n%an%n%ae%n%aI', commit],
  ).catch(() => '');
  if (!raw) return null;
  const [hash = '', shortHash = '', message = '', authorName = '', authorEmail = '', authoredAt = ''] = raw.split('\n');
  const files = await listCommitFiles(workspaceRoot, commit);
  return {
    hash,
    shortHash,
    message,
    authorName,
    authorEmail,
    authoredAt,
    additions: files.reduce((sum, item) => sum + item.additions, 0),
    deletions: files.reduce((sum, item) => sum + item.deletions, 0),
    fileCount: files.length,
  };
}

async function readGitBlob(repoRoot: string, spec: string) {
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

async function buildScopeFileDetail(workspaceRoot: string, scope: GitBrowserScope, filePath: string) {
  const context = await getRepoContext(workspaceRoot);
  const files = await listScopeFiles(workspaceRoot, scope);
  const target = files.find((item) => item.path === filePath);
  if (!target) {
    return workspaceRouteJsonError('未找到对应文件', 404);
  }

  let originalContent = '';
  let currentContent = '';
  let originalTooLarge = false;
  let currentTooLarge = false;
  let originalSize = 0;
  let currentSize = 0;

  if (scope === 'unstaged') {
    const original = await readGitBlob(context.repoRoot, `:${target.previousRepoPath || target.repoPath}`);
    originalContent = original.content;
    originalTooLarge = original.tooLarge;
    originalSize = original.size;

    if (target.status !== 'deleted') {
      const current = await safeReadText(path.resolve(context.repoRoot, target.repoPath)).catch(() => ({ tooLarge: false, content: '', size: 0 }));
      currentContent = current.content;
      currentTooLarge = current.tooLarge;
      currentSize = current.size;
    }
  } else if (scope === 'staged') {
    if (target.status !== 'added') {
      const original = await readGitBlob(context.repoRoot, `HEAD:${target.previousRepoPath || target.repoPath}`);
      originalContent = original.content;
      originalTooLarge = original.tooLarge;
      originalSize = original.size;
    }
    if (target.status !== 'deleted') {
      const current = await readGitBlob(context.repoRoot, `:${target.repoPath}`);
      currentContent = current.content;
      currentTooLarge = current.tooLarge;
      currentSize = current.size;
    }
  } else {
    const current = await safeReadText(path.resolve(context.repoRoot, target.repoPath)).catch(() => ({ tooLarge: false, content: '', size: 0 }));
    currentContent = current.content;
    currentTooLarge = current.tooLarge;
    currentSize = current.size;
  }

  const patchTargets = target.status === 'renamed' && target.previousRepoPath
    ? [target.previousRepoPath, target.repoPath]
    : [target.repoPath];
  const scopedPatch = scope === 'untracked'
    ? ''
    : await runGit(
      context.repoRoot,
      [
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--unified=3',
        ...(scope === 'staged' ? ['--cached'] : []),
        '--',
        ...patchTargets,
      ],
    ).catch(() => '');

  return jsonOk({
    available: true,
    workspaceRoot: toPortablePath(workspaceRoot),
    repoRoot: context.repoRoot,
    branch: context.branch,
    scope,
    file: {
      ...target,
      patch: scopedPatch,
      originalContent,
      currentContent,
      originalTooLarge,
      currentTooLarge,
      originalSize,
      currentSize,
      baseLabel: scope === 'unstaged' ? 'Index' : scope === 'staged' ? 'HEAD' : 'Empty',
      targetLabel: scope === 'unstaged' ? 'Working tree' : scope === 'staged' ? 'Index' : 'Working tree',
    },
  });
}

async function buildCommitDetail(workspaceRoot: string, commit: string) {
  const context = await getRepoContext(workspaceRoot);
  const summary = await getCommitSummary(workspaceRoot, commit);
  if (!summary) {
    return workspaceRouteJsonError('未找到对应提交', 404);
  }
  const files = await listCommitFiles(workspaceRoot, commit);
  const patch = await runGit(
    context.repoRoot,
    ['show', '--no-color', '--no-ext-diff', '--format=medium', '--unified=3', commit, ...getScopePathArgs(context.workspaceRelative)],
  ).catch(() => '');
  return jsonOk({
    available: true,
    workspaceRoot: toPortablePath(workspaceRoot),
    repoRoot: context.repoRoot,
    branch: context.branch,
    commit: summary,
    patch,
    files,
  });
}

async function buildCommitFileDetail(workspaceRoot: string, commit: string, filePath: string) {
  const context = await getRepoContext(workspaceRoot);
  const summary = await getCommitSummary(workspaceRoot, commit);
  if (!summary) {
    return workspaceRouteJsonError('未找到对应提交', 404);
  }

  const files = await listCommitFiles(workspaceRoot, commit);
  const target = files.find((item) => item.path === filePath);
  if (!target) {
    return workspaceRouteJsonError('未找到对应提交文件', 404);
  }

  let originalContent = '';
  let currentContent = '';
  let originalTooLarge = false;
  let currentTooLarge = false;
  let originalSize = 0;
  let currentSize = 0;

  if (target.status !== 'added') {
    const original = await readGitBlob(context.repoRoot, `${commit}^:${target.previousRepoPath || target.repoPath}`);
    originalContent = original.content;
    originalTooLarge = original.tooLarge;
    originalSize = original.size;
  }
  if (target.status !== 'deleted') {
    const current = await readGitBlob(context.repoRoot, `${commit}:${target.repoPath}`);
    currentContent = current.content;
    currentTooLarge = current.tooLarge;
    currentSize = current.size;
  }

  const patchTargets = target.status === 'renamed' && target.previousRepoPath
    ? [target.previousRepoPath, target.repoPath]
    : [target.repoPath];
  const patch = await runGit(
    context.repoRoot,
    ['show', '--no-color', '--no-ext-diff', '--format=', '--unified=3', commit, '--', ...patchTargets],
  ).catch(() => '');

  return jsonOk({
    available: true,
    workspaceRoot: toPortablePath(workspaceRoot),
    repoRoot: context.repoRoot,
    branch: context.branch,
    commit: summary,
    file: {
      ...target,
      patch,
      originalContent,
      currentContent,
      originalTooLarge,
      currentTooLarge,
      originalSize,
      currentSize,
      baseLabel: `${summary.shortHash}^`,
      targetLabel: summary.shortHash,
    },
  });
}

async function buildSummary(workspaceRoot: string, commitOffset = 0, commitLimit = 40) {
  const context = await getRepoContext(workspaceRoot);
  const [unstaged, staged, untracked, commitList] = await Promise.all([
    listScopeFiles(workspaceRoot, 'unstaged'),
    listScopeFiles(workspaceRoot, 'staged'),
    listScopeFiles(workspaceRoot, 'untracked'),
    listCommits(workspaceRoot, commitOffset, commitLimit),
  ]);

  return {
    available: true,
    workspaceRoot: toPortablePath(workspaceRoot),
    repoRoot: context.repoRoot,
    branch: context.branch,
    head: context.head,
    workingTree: {
      unstaged,
      staged,
      untracked,
    },
    commits: commitList.commits,
    commitOffset,
    commitLimit,
    hasMoreCommits: commitList.hasMore,
  };
}

async function buildSummaryOrUnavailable(workspaceRoot: string, commitOffset = 0, commitLimit = 40) {
  try {
    return await buildSummary(workspaceRoot, commitOffset, commitLimit);
  } catch (error: any) {
    const message = String(error?.message || '');
    if (message.includes('not a git repository') || message.includes('不是一个 git 仓库')) {
      return {
        available: false,
        workspaceRoot: toPortablePath(workspaceRoot),
        workingTree: {
          unstaged: [],
          staged: [],
          untracked: [],
        },
        commits: [],
        commitOffset,
        commitLimit,
        hasMoreCommits: false,
        reason: '当前工作区不在 Git 仓库中',
      };
    }
    throw error;
  }
}

function createGitBrowserSummaryStream(
  request: Request,
  workspaceRoot: string,
  commitOffset = 0,
  commitLimit = 40,
) {
  const encoder = new TextEncoder();
  let closed = false;
  let lastSignature = '';
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const sendSummary = async (reason: string, force = false) => {
        if (closed) return;
        try {
          const summary = await buildSummaryOrUnavailable(workspaceRoot, commitOffset, commitLimit);
          const signature = JSON.stringify(summary);
          if (!force && signature === lastSignature) return;
          lastSignature = signature;
          send({ type: 'summary', reason, data: summary });
        } catch (error: any) {
          send({ type: 'error', reason, error: error?.message || '获取 Git 浏览数据失败' });
        }
      };

      request.signal.addEventListener('abort', () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {}
      });

      send({ type: 'connected', data: { workspaceRoot: toPortablePath(workspaceRoot), commitOffset, commitLimit } });
      void sendSummary('initial', true);
      timer = setInterval(() => {
        void sendSummary('change-check');
      }, 3000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get('workspace');
    const scope = searchParams.get('scope') as GitBrowserScope | null;
    const commit = searchParams.get('commit');
    const file = searchParams.get('file');
    const commitOffset = Number(searchParams.get('commitOffset') || 0);
    const commitLimit = Number(searchParams.get('commitLimit') || 40);
    const live = searchParams.get('live') === '1';

    if (!workspace) {
      return workspaceRouteJsonError('缺少 workspace 参数', 400);
    }

    const workspaceRoot = await resolveWorkspaceRoot(workspace);

    try {
      if (live && !commit && !scope && !file) {
        return createGitBrowserSummaryStream(request, workspaceRoot, commitOffset, commitLimit);
      }
      if (commit && file) {
        return await buildCommitFileDetail(workspaceRoot, commit, file);
      }
      if (commit) {
        return await buildCommitDetail(workspaceRoot, commit);
      }
      if (scope && file) {
        return await buildScopeFileDetail(workspaceRoot, scope, file);
      }
      if (scope) {
        const context = await getRepoContext(workspaceRoot);
        const files = await listScopeFiles(workspaceRoot, scope);
        return jsonOk({
          available: true,
          workspaceRoot: toPortablePath(workspaceRoot),
          repoRoot: context.repoRoot,
          branch: context.branch,
          scope,
          files,
        });
      }
      return jsonOk(await buildSummaryOrUnavailable(workspaceRoot, commitOffset, commitLimit));
    } catch (error: any) {
      const message = String(error?.message || '');
      if (message.includes('not a git repository') || message.includes('不是一个 git 仓库')) {
        return jsonOk({
          available: false,
          workspaceRoot: toPortablePath(workspaceRoot),
          workingTree: {
            unstaged: [],
            staged: [],
            untracked: [],
          },
          commits: [],
          reason: '当前工作区不在 Git 仓库中',
        });
      }
      throw error;
    }
  } catch (error) {
    return workspaceRouteError(error);
  }
}
