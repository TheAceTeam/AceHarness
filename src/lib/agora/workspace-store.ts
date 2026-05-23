import { cp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { ensureDirectoryLinkSync } from '@/lib/core/directory-links';
import { getRuntimeSkillsDirPath } from '@/lib/run/runtime-skills';

const execFileAsync = promisify(execFile);
const inflightWorkspaceInitializations = new Map<string, Promise<{ workspacePath: string; created: boolean; sourceWorkspace?: string }>>();

function sanitizeSegment(input: string, fallback = 'agora') {
  const normalized = String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
}

function getAgoraWorkspacesDir() {
  return getWorkspaceDataFile('agora-workspaces');
}

async function runGit(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

async function isGitWorkspace(dir: string) {
  if (!existsSync(path.join(dir, '.git'))) return false;
  return runGit(dir, ['rev-parse', '--is-inside-work-tree'])
    .then((value) => value.trim() === 'true')
    .catch(() => false);
}

function isGitConfigLockError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /could not lock config file/i.test(message);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGitWorkspace(dir: string, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isGitWorkspace(dir)) return true;
    await delay(50);
  }
  return isGitWorkspace(dir);
}

async function ensureGitRepositoryReady(dir: string) {
  if (await isGitWorkspace(dir)) return;
  try {
    await runGit(dir, ['init']);
  } catch (error) {
    if (!isGitConfigLockError(error)) throw error;
    const ready = await waitForGitWorkspace(dir);
    if (!ready) throw error;
  }
}

async function ensureGitBaseline(dir: string) {
  await ensureGitRepositoryReady(dir);
  await runGit(dir, ['config', 'user.name', 'ACEHarness Agora']).catch(() => {});
  await runGit(dir, ['config', 'user.email', 'agora@aceharness.local']).catch(() => {});
  const head = await runGit(dir, ['rev-parse', '--verify', 'HEAD']).catch(() => '');
  if (!head) {
    await runGit(dir, ['add', '-A']).catch(() => {});
    const status = await runGit(dir, ['status', '--porcelain']).catch(() => '');
    if (status.trim()) {
      await runGit(dir, ['commit', '-m', 'Initial agora workspace baseline']).catch(() => {});
    } else {
      await writeFile(path.join(dir, '.ace-agora-baseline'), 'baseline\n', 'utf-8');
      await runGit(dir, ['add', '.ace-agora-baseline']).catch(() => {});
      await runGit(dir, ['commit', '-m', 'Initial agora workspace baseline']).catch(() => {});
    }
  }
}

async function ensureWorkspaceGitIgnore(dir: string) {
  const gitignorePath = path.join(dir, '.gitignore');
  const line = '/skills';
  let content = '';
  try {
    content = await readFile(gitignorePath, 'utf-8');
  } catch {
    // Missing .gitignore is fine; create one below.
  }
  const lines = content.split(/\r?\n/).map((item) => item.trim());
  if (lines.includes(line)) return;
  const next = `${content.replace(/\s*$/, '')}${content.trim() ? '\n' : ''}${line}\n`;
  await writeFile(gitignorePath, next, 'utf-8');
}

async function ensureWorkspaceSkillsLink(dir: string) {
  const skillsDir = await getRuntimeSkillsDirPath();
  const skillsLink = path.join(dir, 'skills');
  if (!existsSync(skillsDir)) return;
  try {
    const linkResult = ensureDirectoryLinkSync(skillsDir, skillsLink);
    if (linkResult !== 'skipped' || existsSync(skillsLink)) return;
  } catch {
    // Fall through to copy fallback.
  }
  if (!existsSync(skillsLink)) {
    await cp(skillsDir, skillsLink, { recursive: true, force: true }).catch(() => {});
  }
}

export async function ensureAgoraWorkspace(input: {
  sessionId: string;
  sourceWorkspace?: string;
  title?: string;
}): Promise<{ workspacePath: string; created: boolean; sourceWorkspace?: string }> {
  const sessionId = sanitizeSegment(input.sessionId, `session-${Date.now().toString(36)}`);
  const existingInitialization = inflightWorkspaceInitializations.get(sessionId);
  if (existingInitialization) return existingInitialization;

  const initialization = (async () => {
    const workspaceRoot = getAgoraWorkspacesDir();
    const dir = path.join(workspaceRoot, sessionId);
    if (existsSync(dir)) {
      await ensureWorkspaceGitIgnore(dir).catch(() => {});
      await ensureGitBaseline(dir);
      await ensureWorkspaceSkillsLink(dir).catch(() => {});
      return { workspacePath: dir, created: false, sourceWorkspace: input.sourceWorkspace };
    }

    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(dir, { recursive: true });

    await writeFile(
      path.join(dir, 'README.md'),
      [
        `# ${input.title?.trim() || '新议题'}`,
        '',
        '这是议场的临时工作区。议场嘉宾会在这里协作，变更 tab 会展示相对初始基线的文件变化。',
        '',
      ].join('\n'),
      'utf-8',
    ).catch(() => {});
    await ensureWorkspaceGitIgnore(dir).catch(() => {});
    await ensureGitBaseline(dir);
    await ensureWorkspaceSkillsLink(dir).catch(() => {});
    return { workspacePath: dir, created: true, sourceWorkspace: input.sourceWorkspace };
  })().finally(() => {
    if (inflightWorkspaceInitializations.get(sessionId) === initialization) {
      inflightWorkspaceInitializations.delete(sessionId);
    }
  });

  inflightWorkspaceInitializations.set(sessionId, initialization);
  return initialization;
}

export async function removeAgoraWorkspace(sessionId: string): Promise<void> {
  const dir = path.join(getAgoraWorkspacesDir(), sanitizeSegment(sessionId));
  await rm(dir, { recursive: true, force: true });
}
