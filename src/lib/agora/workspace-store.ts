import { cp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getWorkspaceDataFile, SHARED_AGENT_CONFIG_DIR } from '@/lib/core/app-paths';
import { ensureDirectoryLinkSync, isLinkedDirectoryTarget } from '@/lib/core/directory-links';
import { getRuntimeSkillsDirPath, syncInstalledSkillsToRuntime } from '@/lib/run/runtime-skills';

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

export function getDefaultAgoraWorkspacePath(sessionId: string): string {
  return path.join(getAgoraWorkspacesDir(), sanitizeSegment(sessionId));
}

export function isDefaultAgoraWorkspacePathForSession(sessionId: string, workspacePath?: string | null): boolean {
  const normalizedWorkspacePath = String(workspacePath || '').trim();
  if (!normalizedWorkspacePath) return false;
  return path.resolve(normalizedWorkspacePath) === path.resolve(getDefaultAgoraWorkspacePath(sessionId));
}

const BASELINE_COMMIT_MESSAGE = 'Initial agora workspace baseline';

/**
 * 基线提交是 ACEHarness 自己的记账行为，必须跳过用户的 commit hook：
 * 用户配了全局 core.hooksPath（如 commitlint）时，这条非 conventional 的消息会被拒绝，
 * 失败又被调用处吞掉，最终表现为工作区没有基线、变更视图为空。
 */
const BASELINE_COMMIT_ARGS = ['commit', '--no-verify', '-m', BASELINE_COMMIT_MESSAGE];

async function runGit(cwd: string, args: string[], env?: Record<string, string | undefined>) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: env ? ({ ...process.env, ...env } as NodeJS.ProcessEnv) : undefined,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

/**
 * 基线提交的身份只通过环境变量传给单次 git 调用，绝不写入仓库的 .git/config，
 * 否则会覆盖（或遮蔽）用户自己的 user.name / user.email，污染其后续手工提交的署名。
 */
function baselineCommitEnv(): Record<string, string | undefined> {
  return {
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'ACEHarness Agora',
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'agora@aceharness.local',
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'ACEHarness Agora',
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'agora@aceharness.local',
  };
}

async function isGitWorkspace(dir: string) {
  if (!existsSync(path.join(dir, '.git'))) return false;
  return runGit(dir, ['rev-parse', '--is-inside-work-tree'])
    .then((value) => value.trim() === 'true')
    .catch(() => false);
}

/** 解析 dir 所属仓库的根目录；dir 是某个仓库的子目录时同样能识别出来。 */
async function resolveEnclosingRepoRoot(dir: string): Promise<string | null> {
  try {
    const top = await runGit(dir, ['rev-parse', '--show-toplevel']);
    return top ? path.resolve(top) : null;
  } catch {
    return null;
  }
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

/**
 * 建立变更视图所需的 git 基线。
 *
 * managed=true 表示这是 ACEHarness 在自己的数据目录下创建的工作区，内容完全由我们掌控，
 * 可以放心 `git add -A` 建基线；managed=false 表示目录由用户指定，必须保守处理：
 * 已在任意 git 仓库内就完全不碰，非仓库也只提交基线标记文件，绝不把用户既有内容纳入提交。
 */
async function ensureGitBaseline(dir: string, options: { managed: boolean }) {
  if (!options.managed && (await resolveEnclosingRepoRoot(dir))) {
    // 用户自己的仓库（或其子目录）：已有 git 历史可作基线，无需也不应改动任何东西。
    return;
  }

  await ensureGitRepositoryReady(dir);

  const head = await runGit(dir, ['rev-parse', '--verify', 'HEAD']).catch(() => '');
  if (head) return;

  const env = baselineCommitEnv();
  if (options.managed) {
    await runGit(dir, ['add', '-A']).catch(() => {});
    const status = await runGit(dir, ['status', '--porcelain']).catch(() => '');
    if (status.trim()) {
      await runGit(dir, BASELINE_COMMIT_ARGS, env).catch(() => {});
      return;
    }
  }

  await writeFile(path.join(dir, '.ace-agora-baseline'), 'baseline\n', 'utf-8');
  await runGit(dir, ['add', '--', '.ace-agora-baseline']).catch(() => {});
  await runGit(dir, BASELINE_COMMIT_ARGS, env).catch(() => {});
}

function toPosixPath(input: string): string {
  return input.replace(/\\/g, '/');
}

/**
 * 让 skills 软链和 .agents 配置目录不出现在 git status 里。
 *
 * 自建工作区写 .gitignore（它本身就是基线的一部分）；用户目录改写 .git/info/exclude，
 * 避免修改用户受版本控制的 .gitignore 而在其工作区制造一处凭空的未提交改动。
 */
async function ensureWorkspaceIgnoreRules(dir: string, options: { managed: boolean }) {
  const entries = ['skills', SHARED_AGENT_CONFIG_DIR];
  if (options.managed) {
    await appendMissingLines(path.join(dir, '.gitignore'), entries.map((entry) => `/${entry}`));
    return;
  }

  const gitDir = await runGit(dir, ['rev-parse', '--absolute-git-dir']).catch(() => '');
  if (!gitDir) return;

  // exclude 里的 `/xxx` 锚定到仓库根，工作区是子目录时要带上相对前缀。
  // 用 git 自己的 --show-prefix 而不是 path.relative：macOS 上 /var 与 /private/var
  // 这类软链会让手工算出来的相对路径完全失真。
  const showPrefix = await runGit(dir, ['rev-parse', '--show-prefix']).catch(() => '');
  const prefix = `/${toPosixPath(showPrefix).replace(/^\/+/, '')}`;
  await mkdir(path.join(gitDir, 'info'), { recursive: true }).catch(() => {});
  await appendMissingLines(path.join(gitDir, 'info', 'exclude'), entries.map((entry) => `${prefix}${entry}`));
}

/**
 * 自建工作区要先写 .gitignore，好让它成为基线提交的一部分；
 * 用户目录则必须等仓库归属确定之后，才能往 .git/info/exclude 写规则。
 */
async function prepareWorkspaceGitState(dir: string, options: { managed: boolean }) {
  if (options.managed) await ensureWorkspaceIgnoreRules(dir, options).catch(() => {});
  await ensureGitBaseline(dir, options);
  if (!options.managed) await ensureWorkspaceIgnoreRules(dir, options).catch(() => {});
}

async function appendMissingLines(filePath: string, wanted: string[]) {
  let content = '';
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    // Missing file is fine; create one below.
  }
  const lines = content.split(/\r?\n/).map((item) => item.trim());
  const missing = wanted.filter((line) => !lines.includes(line));
  if (!missing.length) return;
  const next = `${content.replace(/\s*$/, '')}${content.trim() ? '\n' : ''}${missing.join('\n')}\n`;
  await writeFile(filePath, next, 'utf-8');
}

async function ensureWorkspaceSkillsLink(dir: string) {
  const skillsDir = await getRuntimeSkillsDirPath();
  const skillsLink = path.join(dir, 'skills');
  if (!existsSync(skillsDir)) return;
  try {
    const linkResult = ensureDirectoryLinkSync(skillsDir, skillsLink);
    if (linkResult !== 'skipped' || existsSync(skillsLink)) return;
  } catch (error) {
    console.warn('[Agora] Failed to link workspace skills:', error);
  }
}

function enabledNamesFromInput(input: string[] | Record<string, boolean> | undefined): string[] {
  if (Array.isArray(input)) {
    return Array.from(new Set(input.map((item) => String(item || '').trim()).filter(Boolean))).sort();
  }
  if (!input || typeof input !== 'object') return [];
  return Object.entries(input)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([name]) => name.trim())
    .filter(Boolean)
    .sort();
}

function isSafeRuntimeEntryName(name: string) {
  return Boolean(name) && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..';
}

function hasSkillManifest(dir: string) {
  return existsSync(path.join(dir, 'SKILL.md'));
}

async function ensureWorkspaceSkillEntry(source: string, target: string) {
  if (!existsSync(source) || !hasSkillManifest(source)) return false;

  if (existsSync(target)) {
    if (isLinkedDirectoryTarget(target, source) || hasSkillManifest(target)) return true;
    await rm(target, { recursive: true, force: true });
  }

  try {
    ensureDirectoryLinkSync(source, target);
  } catch (error) {
    console.warn(`[Agora] Failed to link workspace skill ${path.basename(source)}; copying instead:`, error);
  }

  if (hasSkillManifest(target)) return true;

  await rm(target, { recursive: true, force: true }).catch(() => {});
  await cp(source, target, { recursive: true, force: false });
  return hasSkillManifest(target);
}

async function ensureWorkspaceAgentConfig(
  dir: string,
  input: {
    skills?: string[] | Record<string, boolean>;
    mcpServers?: string[] | Record<string, boolean>;
  },
) {
  const enabledSkills = enabledNamesFromInput(input.skills);
  const enabledMcpServers = enabledNamesFromInput(input.mcpServers);
  const configDir = path.join(dir, SHARED_AGENT_CONFIG_DIR);
  await mkdir(configDir, { recursive: true });
  await writeFile(
    path.join(configDir, 'runtime.json'),
    JSON.stringify({
      kind: 'agora-runtime',
      skills: enabledSkills,
      mcpServers: enabledMcpServers,
      updatedAt: new Date().toISOString(),
    }, null, 2),
    'utf-8',
  );

  if (!enabledSkills.length) return;
  await syncInstalledSkillsToRuntime(enabledSkills).catch((error) => {
    console.warn('[Agora] Failed to sync enabled skills into runtime:', error);
  });
  const skillsDir = await getRuntimeSkillsDirPath();
  if (!existsSync(skillsDir)) return;
  const workspaceSkillsDir = path.join(configDir, 'skills');
  await mkdir(workspaceSkillsDir, { recursive: true });
  for (const skillName of enabledSkills) {
    if (!isSafeRuntimeEntryName(skillName)) continue;
    const source = path.join(skillsDir, skillName);
    const target = path.resolve(workspaceSkillsDir, skillName);
    const resolvedSkillsDir = path.resolve(workspaceSkillsDir);
    if (!target.startsWith(`${resolvedSkillsDir}${path.sep}`)) continue;
    try {
      await ensureWorkspaceSkillEntry(source, target);
    } catch (error) {
      console.warn(`[Agora] Failed to prepare workspace skill ${skillName}:`, error);
    }
  }
}

export async function ensureAgoraWorkspace(input: {
  sessionId: string;
  sourceWorkspace?: string;
  targetWorkspace?: string;
  title?: string;
  skills?: string[] | Record<string, boolean>;
  mcpServers?: string[] | Record<string, boolean>;
  purpose?: 'agora' | 'chat';
}): Promise<{ workspacePath: string; created: boolean; sourceWorkspace?: string }> {
  const sessionId = sanitizeSegment(input.sessionId, `session-${Date.now().toString(36)}`);
  const targetWorkspace = String(input.targetWorkspace || '').trim();
  const initializationKey = targetWorkspace ? `target:${path.resolve(targetWorkspace)}` : `session:${sessionId}`;
  const existingInitialization = inflightWorkspaceInitializations.get(initializationKey);
  if (existingInitialization) return existingInitialization;

  const initialization = (async () => {
    const workspaceRoot = getAgoraWorkspacesDir();
    const dir = targetWorkspace ? path.resolve(targetWorkspace) : path.join(workspaceRoot, sessionId);
    // 只有 ACEHarness 自己数据目录下的工作区才由我们完全掌控；用户指定的路径一律保守处理。
    const managed = !targetWorkspace;
    if (existsSync(dir)) {
      await prepareWorkspaceGitState(dir, { managed });
      await ensureWorkspaceSkillsLink(dir).catch(() => {});
      await ensureWorkspaceAgentConfig(dir, input).catch(() => {});
      return { workspacePath: dir, created: false, sourceWorkspace: input.sourceWorkspace };
    }

    if (!targetWorkspace) {
      await mkdir(workspaceRoot, { recursive: true });
    }
    await mkdir(dir, { recursive: true });

    const purpose = input.purpose === 'chat' ? 'chat' : 'agora';
    await writeFile(
      path.join(dir, 'README.md'),
      [
        `# ${input.title?.trim() || (purpose === 'chat' ? '新对话工作区' : '新议题')}`,
        '',
        purpose === 'chat'
          ? '这是对话会话的工作区。对话引擎会以这里作为默认上下文目录，变更视图会展示相对初始基线的文件变化。'
          : '这是议场的临时工作区。议场嘉宾会在这里协作，变更 tab 会展示相对初始基线的文件变化。',
        '',
      ].join('\n'),
      'utf-8',
    ).catch(() => {});
    await ensureWorkspaceAgentConfig(dir, input).catch(() => {});
    await prepareWorkspaceGitState(dir, { managed });
    await ensureWorkspaceSkillsLink(dir).catch(() => {});
    return { workspacePath: dir, created: true, sourceWorkspace: input.sourceWorkspace };
  })().finally(() => {
    if (inflightWorkspaceInitializations.get(initializationKey) === initialization) {
      inflightWorkspaceInitializations.delete(initializationKey);
    }
  });

  inflightWorkspaceInitializations.set(initializationKey, initialization);
  return initialization;
}

export async function removeAgoraWorkspace(sessionId: string, workspacePath?: string): Promise<void> {
  if (workspacePath && !isDefaultAgoraWorkspacePathForSession(sessionId, workspacePath)) {
    throw new Error('只能删除系统默认创建的议场工作目录');
  }
  const dir = getDefaultAgoraWorkspacePath(sessionId);
  await rm(dir, { recursive: true, force: true });
}
