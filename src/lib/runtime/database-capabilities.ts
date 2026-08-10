import { randomBytes, randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import type { CapabilitySkillsConfig } from '@/lib/core/schemas';

export const RAG_CAPABILITY_SKILL = 'aceharness-rag';
export const SQLITE_CAPABILITY_SKILL = 'aceharness-sqlite';

export interface RuntimeRagGrant {
  enabled: boolean;
  knowledgeBases: string[];
  topK: number;
  allowAgentQuery: boolean;
}

export interface RuntimeSqliteDatabaseGrant {
  name: string;
  absolutePath: string;
  relativePath: string;
  allowCreate: boolean;
  allowDelete: boolean;
  readOnly: boolean;
}

export interface RuntimeSqliteGrant {
  enabled: boolean;
  databases: RuntimeSqliteDatabaseGrant[];
}

export interface RuntimeDatabaseGrant {
  token: string;
  createdAt: string;
  runId?: string;
  chatSessionId?: string;
  workflowConfigFile?: string;
  workspaceRoot: string;
  enabledSkills: string[];
  rag?: RuntimeRagGrant;
  sqlite?: RuntimeSqliteGrant;
}

export interface CreateRuntimeDatabaseGrantInput {
  capabilitySkills?: CapabilitySkillsConfig;
  skills?: string[];
  agentRagKnowledgeBases?: string[];
  workspaceRoot?: string;
  runId?: string;
  chatSessionId?: string;
  workflowConfigFile?: string;
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function isEnabled(value: unknown): boolean {
  return Boolean((value as { enabled?: boolean } | undefined)?.enabled);
}

export function expandCapabilitySkillNames(skills: string[] | undefined, capabilitySkills?: CapabilitySkillsConfig): string[] {
  const names = uniqueStrings(skills || []);
  if (isEnabled(capabilitySkills?.rag)) names.push(RAG_CAPABILITY_SKILL);
  if (isEnabled(capabilitySkills?.sqlite)) names.push(SQLITE_CAPABILITY_SKILL);
  return uniqueStrings(names);
}

export function expandDatabaseCapabilitySkillNames(input: {
  skills?: string[];
  capabilitySkills?: CapabilitySkillsConfig;
  agentRagKnowledgeBases?: string[];
}): string[] {
  const names = expandCapabilitySkillNames(input.skills, input.capabilitySkills);
  if (uniqueStrings(input.agentRagKnowledgeBases || []).length > 0) names.push(RAG_CAPABILITY_SKILL);
  return uniqueStrings(names);
}

function normalizeRelativeDbPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function resolveWorkspaceSqliteDatabase(input: {
  workspaceRoot: string;
  name: string;
  relativePath: string;
  allowCreate?: boolean;
  allowDelete?: boolean;
  readOnly?: boolean;
}): RuntimeSqliteDatabaseGrant {
  const relativePath = normalizeRelativeDbPath(input.relativePath);
  if (!relativePath || path.isAbsolute(input.relativePath) || relativePath.includes('\0')) {
    throw new Error('SQLITE_PATH_ESCAPE');
  }
  const ext = path.extname(relativePath).toLowerCase();
  if (!['.sqlite', '.sqlite3', '.db'].includes(ext)) {
    throw new Error('SQLITE_INVALID_EXTENSION');
  }
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const absolutePath = path.resolve(workspaceRoot, relativePath);
  const relative = path.relative(workspaceRoot, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('SQLITE_PATH_ESCAPE');
  }
  return {
    name: input.name,
    absolutePath,
    relativePath,
    allowCreate: input.allowCreate !== false,
    allowDelete: input.allowDelete === true,
    readOnly: input.readOnly === true,
  };
}

function grantPath(token: string): string {
  return getWorkspaceDataFile('runtime-grants', `${token}.json`);
}

export async function createRuntimeDatabaseGrant(input: CreateRuntimeDatabaseGrantInput): Promise<RuntimeDatabaseGrant | null> {
  const capabilitySkills = input.capabilitySkills;
  const agentRagKnowledgeBases = uniqueStrings(input.agentRagKnowledgeBases || []);
  const ragEnabled = isEnabled(capabilitySkills?.rag) || agentRagKnowledgeBases.length > 0;
  const sqliteEnabled = isEnabled(capabilitySkills?.sqlite);
  const enabledSkills = expandCapabilitySkillNames(input.skills, capabilitySkills);
  if (!ragEnabled && !sqliteEnabled && !enabledSkills.includes(RAG_CAPABILITY_SKILL) && !enabledSkills.includes(SQLITE_CAPABILITY_SKILL)) {
    return null;
  }

  const token = `rdg_${randomBytes(24).toString('base64url')}`;
  const workspaceRoot = path.resolve(input.workspaceRoot || process.cwd());
  const grant: RuntimeDatabaseGrant = {
    token,
    createdAt: new Date().toISOString(),
    runId: input.runId,
    chatSessionId: input.chatSessionId,
    workflowConfigFile: input.workflowConfigFile,
    workspaceRoot,
    enabledSkills,
  };

  if (ragEnabled) {
    const knowledgeBases = uniqueStrings([
      ...(capabilitySkills?.rag?.knowledgeBases?.length ? capabilitySkills.rag.knowledgeBases : []),
      ...agentRagKnowledgeBases,
    ]);
    grant.rag = {
      enabled: true,
      knowledgeBases: knowledgeBases.length ? knowledgeBases : ['default'],
      topK: Math.max(1, Math.min(Number(capabilitySkills?.rag?.topK || 8), 50)),
      allowAgentQuery: capabilitySkills?.rag?.allowAgentQuery !== false,
    };
  }

  if (sqliteEnabled) {
    const configured = capabilitySkills?.sqlite?.databases || [];
    const databases = configured.map((db) => resolveWorkspaceSqliteDatabase({
      workspaceRoot,
      name: db.name,
      relativePath: db.path,
      allowCreate: db.allowCreate,
      allowDelete: db.allowDelete,
      readOnly: db.readOnly,
    }));
    grant.sqlite = {
      enabled: true,
      databases,
    };
  }

  const file = grantPath(token);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(grant, null, 2), 'utf-8');
  return grant;
}

export async function readRuntimeDatabaseGrant(token: string): Promise<RuntimeDatabaseGrant | null> {
  const normalized = String(token || '').trim();
  if (!/^rdg_[A-Za-z0-9_-]{20,}$/.test(normalized)) return null;
  const file = grantPath(normalized);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8')) as RuntimeDatabaseGrant;
    return parsed?.token === normalized ? parsed : null;
  } catch {
    return null;
  }
}

export function getRuntimeTokenFromRequest(request: Request): string {
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  return (bearer || request.headers.get('x-aceharness-runtime-token') || '').trim();
}

export async function requireRuntimeDatabaseGrant(request: Request): Promise<{ grant: RuntimeDatabaseGrant } | { error: string; status: number }> {
  const token = getRuntimeTokenFromRequest(request);
  if (!token) return { error: 'RUNTIME_TOKEN_MISSING', status: 401 };
  const grant = await readRuntimeDatabaseGrant(token);
  if (!grant) return { error: 'RUNTIME_TOKEN_INVALID', status: 403 };
  return { grant };
}

export function buildRuntimeDatabaseEnv(grant: RuntimeDatabaseGrant | null | undefined, runtimeUrl?: string): Record<string, string> {
  if (!grant) return {};
  return {
    aceharness_runtime_url: runtimeUrl || resolveRuntimeUrl(),
    aceharness_runtime_token: grant.token,
    aceharness_run_id: grant.runId || '',
    aceharness_chat_session_id: grant.chatSessionId || '',
    aceharness_workspace_root: grant.workspaceRoot,
  };
}

export async function writeRuntimeDatabaseEnvFile(grant: RuntimeDatabaseGrant | null | undefined, runtimeUrl?: string): Promise<void> {
  if (!grant) return;
  const env = buildRuntimeDatabaseEnv(grant, runtimeUrl);
  const file = path.join(grant.workspaceRoot, '.agents', 'runtime-database-env.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(env, null, 2), 'utf-8');
}

export function resolveRuntimeUrl(): string {
  const explicit = process.env.ACEHARNESS_RUNTIME_URL
    || process.env.ACE_INTERNAL_BASE_URL
    || process.env.ACE_PUBLIC_ORIGIN
    || process.env.NEXT_PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_ACE_ORIGIN
    || process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (explicit?.trim()) return explicit.trim().replace(/\/+$/, '');
  const host = process.env.ACE_HOST || process.env.HOST || '127.0.0.1';
  const port = process.env.ACE_PORT || process.env.PORT || '3001';
  return `http://${host}:${port}`;
}

export function buildDatabaseCapabilityPrompt(grant: RuntimeDatabaseGrant | null | undefined, skillsDir: string): string {
  if (!grant || (!grant.rag?.enabled && !grant.sqlite?.enabled)) return '';
  const lines: string[] = [
    '# ACEHarness 数据库能力',
    '',
    '当前运行启用了受控数据库能力。需要使用时，先阅读对应 Skill 的 SKILL.md，然后通过 Skill 内置 Python 脚本调用 ACEHarness runtime API；不要直接读写 LanceDB、SQLite 文件或 ACEHarness 内部数据库。',
    '',
  ];
  if (grant.rag?.enabled) {
    lines.push(
      '## aceharness-rag',
      '',
      `Skill 文件：\`${path.join(skillsDir, RAG_CAPABILITY_SKILL, 'SKILL.md')}\``,
      `默认 topK：${grant.rag.topK}`,
      '可查询知识库：',
      ...grant.rag.knowledgeBases.map((id) => `- ${id}`),
      '',
      '示例：',
      `\`python "${path.join(skillsDir, RAG_CAPABILITY_SKILL, 'scripts', 'rag_search.py')}" --kb ${grant.rag.knowledgeBases[0] || 'default'} --query "查询内容" --top-k ${grant.rag.topK}\``,
      '',
    );
  }
  if (grant.sqlite?.enabled) {
    lines.push(
      '## aceharness-sqlite',
      '',
      `Skill 文件：\`${path.join(skillsDir, SQLITE_CAPABILITY_SKILL, 'SKILL.md')}\``,
      '数据库根目录：当前 workspace',
      '可用数据库：',
      ...(grant.sqlite.databases.length
        ? grant.sqlite.databases.map((db) => `- ${db.name} -> ${db.relativePath} (allowCreate=${db.allowCreate}, allowDelete=${db.allowDelete}, readOnly=${db.readOnly})`)
        : ['- 当前未配置 SQLite 数据库。']),
      '',
      '示例：',
      `\`python "${path.join(skillsDir, SQLITE_CAPABILITY_SKILL, 'scripts', 'sqlite_list.py')}"\``,
      '',
      '限制：只能访问上面列出的逻辑数据库；不要使用 ATTACH/DETACH/load_extension/VACUUM INTO；写操作必须优先使用参数绑定。',
      '',
    );
  }
  lines.push(`runtime 调用追踪 ID：${grant.runId || grant.chatSessionId || randomUUID()}`);
  return `${lines.join('\n')}\n\n`;
}
