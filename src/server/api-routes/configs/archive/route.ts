import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import unzipper from 'unzipper';
import { ZipFile } from 'yazl';
import { parse, stringify } from 'yaml';
import { requireAuth } from '@/lib/auth/middleware';
import { canAccessConfigMeta, getConfigMeta, setConfigMeta } from '@/lib/config/metadata';
import { formatValidationIssuesForResponse, validateWorkflowDraft } from '@/lib/core/creator-validation';
import { getRuntimeAgentsDirPath, getRuntimeConfigsDirPath, unmarkConfigDeleted } from '@/lib/run/runtime-configs';
import { getRuntimeSkillsDirPath } from '@/lib/run/runtime-skills';
import {
  cloneCreationSessionForWorkflow,
  loadLatestCreationSessionByFilename,
  saveCreationSession,
} from '@/lib/spec/coding-store';
import {
  listSubworkflowReferences,
  normalizeWorkflowConfigRef,
  readWorkflowConfigForDependency,
  resolveWorkflowConfigDependencyGraph,
} from '@/lib/workflow/subworkflow-config';
import { jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

type AuthUser = {
  id: string;
  role: 'admin' | 'user';
};

type WorkflowImportCandidate = {
  filename: string;
  normalizedConfig: any;
  audit: WorkflowImportAudit;
};

type ExportDependencyMode = 'selected' | 'direct' | 'full';

type SpecCodingImportCandidate = {
  filename: string;
  session: any;
};

type RemovedReference = {
  filename: string;
  name: string;
  path: string;
};

type PathReminder = {
  filename: string;
  location: string;
  value: string;
};

type WorkflowImportAudit = {
  pathReminders: PathReminder[];
  removedSkills: RemovedReference[];
  removedAgentDefinitions: RemovedReference[];
  removedAgentOverrides: RemovedReference[];
  unsupportedAgentRefs: RemovedReference[];
};

const RESERVED_CONFIG_DIRS = new Set(['agents', 'models', 'notebook', 'settings']);
const COMMON_ABSOLUTE_PATH_PATTERN = /(?:[A-Za-z]:\\[^\s`'"，。；;,)\]\}]+|\/(?:Users|home|root|mnt|var|tmp|opt|workspace|repo|repos|data)\/[^\s`'"，。；;,)\]\}]+)/g;

function isYamlFilename(filename: string): boolean {
  return /\.ya?ml$/i.test(filename);
}

function isIgnoredArchiveMetadataPath(input: string): boolean {
  const segments = String(input || '').replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.some((segment) => (
    segment === '__MACOSX'
    || segment === '.DS_Store'
    || segment.startsWith('._')
  ));
}

function normalizeArchiveWorkflowPath(input: unknown): string {
  const normalized = String(input || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .join('/');

  const segments = normalized.split('/');
  if (
    !normalized
    || !isYamlFilename(normalized)
    || normalized.includes('\0')
    || segments.some((segment) => segment === '.' || segment === '..')
    || RESERVED_CONFIG_DIRS.has(segments[0])
  ) {
    throw Object.assign(new Error('无效 workflow YAML 路径'), { status: 400 });
  }

  return normalized;
}

function resolveInside(baseDir: string, relativePath: string): string {
  const root = path.resolve(baseDir);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw Object.assign(new Error('无效 workflow YAML 路径'), { status: 400 });
  }
  return target;
}

async function canEditWorkflow(filename: string, user: AuthUser): Promise<boolean> {
  if (user.role === 'admin') return true;
  const meta = await getConfigMeta(filename, 'workflow');
  if (!meta) return true;
  return !meta.createdBy || meta.createdBy === user.id;
}

async function assertExportableWorkflow(filename: string, user: AuthUser): Promise<string> {
  const meta = await getConfigMeta(filename, 'workflow');
  if (!canAccessConfigMeta(meta, user.id, user.role)) {
    throw Object.assign(new Error(`无权限导出工作流: ${filename}`), { status: 403 });
  }

  const configsDir = await getRuntimeConfigsDirPath();
  const filePath = resolveInside(configsDir, filename);
  const content = await fs.readFile(filePath, 'utf-8').catch((error: any) => {
    if (error?.code === 'ENOENT') {
      throw Object.assign(new Error(`找不到工作流: ${filename}`), { status: 404 });
    }
    throw error;
  });
  let parsed: any;
  try {
    parsed = parse(content);
  } catch (error: any) {
    throw Object.assign(new Error(`工作流 YAML 解析失败: ${filename}`), { status: 400, cause: error });
  }
  const validation = validateWorkflowDraft(parsed, {
    mode: 'portable',
    materializeIds: true,
    workflowKey: filename,
  });
  if (!validation.ok) {
    throw Object.assign(new Error(`工作流配置无效: ${filename}`), {
      status: 400,
      details: formatValidationIssuesForResponse(validation),
    });
  }
  return filePath;
}

async function zipWorkflowFiles(files: Array<{ filename: string; filePath: string }>, manifest?: any): Promise<Buffer> {
  const zipfile = new ZipFile();
  for (const file of files) {
    zipfile.addFile(file.filePath, file.filename);
    const session = await loadLatestCreationSessionByFilename(file.filename).catch(() => null);
    if (session?.specCoding) {
      zipfile.addBuffer(Buffer.from(stringify(session)), `spec-coding/${file.filename}`);
    }
  }
  if (manifest) {
    zipfile.addBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), 'workflow-dependencies.json');
  }

  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    zipfile.outputStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    zipfile.outputStream.on('end', resolve);
    zipfile.outputStream.on('error', reject);
  });
  zipfile.end();
  await done;
  return Buffer.concat(chunks);
}

async function readArchiveCandidatesFromZip(
  file: File,
  availableAgents: Set<string>,
  availableSkills: Set<string>
): Promise<{
  workflows: WorkflowImportCandidate[];
  specSessions: SpecCodingImportCandidate[];
}> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const directory = await (unzipper as any).Open.buffer(buffer);
  const seen = new Set<string>();
  const candidates: WorkflowImportCandidate[] = [];
  const specSessions: SpecCodingImportCandidate[] = [];

  for (const entry of directory.files || []) {
    if (entry.type !== 'File') continue;
    const rawPath = String(entry.path || '');
    if (isIgnoredArchiveMetadataPath(rawPath)) continue;
    if (!isYamlFilename(rawPath)) continue;
    const normalizedRawPath = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalizedRawPath.startsWith('spec-coding/')) {
      const workflowPath = normalizeArchiveWorkflowPath(normalizedRawPath.slice('spec-coding/'.length));
      const content = (await entry.buffer()).toString('utf-8');
      let parsed: any;
      try {
        parsed = parse(content);
      } catch (error: any) {
        throw Object.assign(new Error(`SpecCoding YAML 解析失败: ${workflowPath}`), { status: 400, cause: error });
      }
      specSessions.push({ filename: workflowPath, session: parsed });
      continue;
    }

    const filename = normalizeArchiveWorkflowPath(rawPath);
    if (seen.has(filename)) {
      throw Object.assign(new Error(`ZIP 中存在重复的 workflow YAML: ${filename}`), { status: 400 });
    }
    seen.add(filename);

    const content = (await entry.buffer()).toString('utf-8');
    candidates.push(parseWorkflowImportCandidate(filename, content, availableAgents, availableSkills));
  }

  return { workflows: candidates, specSessions };
}

function parseWorkflowImportCandidate(
  filename: string,
  content: string,
  availableAgents: Set<string>,
  availableSkills: Set<string>,
): WorkflowImportCandidate {
  let parsed: any;
  try {
    parsed = parse(content);
  } catch (error: any) {
    throw Object.assign(new Error(`工作流 YAML 解析失败: ${filename}`), { status: 400, cause: error });
  }
  const validation = validateWorkflowDraft(parsed, {
    mode: 'portable',
    materializeIds: true,
    workflowKey: filename,
  });
  if (!validation.ok || !validation.normalized) {
    throw Object.assign(new Error(`工作流校验失败: ${filename}`), {
      status: 400,
      details: formatValidationIssuesForResponse(validation),
    });
  }
  const audit = auditAndSanitizeImportedWorkflow(filename, validation.normalized, availableAgents, availableSkills);
  return { filename, normalizedConfig: validation.normalized, audit };
}

async function readImportCandidates(
  file: File,
  availableAgents: Set<string>,
  availableSkills: Set<string>,
): Promise<{ workflows: WorkflowImportCandidate[]; specSessions: SpecCodingImportCandidate[] }> {
  const filename = String(file.name || '').trim();
  if (/\.zip$/i.test(filename)) {
    return readArchiveCandidatesFromZip(file, availableAgents, availableSkills);
  }
  if (isYamlFilename(filename)) {
    const normalizedFilename = normalizeArchiveWorkflowPath(filename);
    const content = await file.text();
    return {
      workflows: [parseWorkflowImportCandidate(normalizedFilename, content, availableAgents, availableSkills)],
      specSessions: [],
    };
  }
  throw Object.assign(new Error('请上传 .zip、.yaml 或 .yml 文件'), { status: 400 });
}

async function collectExportWorkflowFiles(
  selectedFiles: string[],
  user: AuthUser,
  dependencyMode: ExportDependencyMode,
): Promise<Array<{ filename: string; filePath: string }>> {
  const result = new Map<string, { filename: string; filePath: string }>();
  async function addFile(filename: string) {
    const normalized = normalizeArchiveWorkflowPath(filename);
    if (result.has(normalized)) return;
    const filePath = await assertExportableWorkflow(normalized, user);
    result.set(normalized, { filename: normalized, filePath });
  }

  for (const filename of selectedFiles) {
    await addFile(filename);
    if (dependencyMode === 'selected') continue;
    if (dependencyMode === 'full') {
      const graph = await resolveWorkflowConfigDependencyGraph(filename);
      for (const dep of graph.configs) {
        await addFile(dep.file);
      }
      continue;
    }
    const loaded = await readWorkflowConfigForDependency(filename);
    for (const ref of listSubworkflowReferences(loaded.config)) {
      await addFile(ref.configFile);
    }
  }

  return Array.from(result.values());
}

async function buildExportDependencyManifest(files: Array<{ filename: string }>, dependencyMode: ExportDependencyMode) {
  return {
    version: 1,
    dependencyMode,
    exportedAt: new Date().toISOString(),
    workflows: files.map((file) => file.filename),
  };
}

function emptyImportAudit(): WorkflowImportAudit {
  return {
    pathReminders: [],
    removedSkills: [],
    removedAgentDefinitions: [],
    removedAgentOverrides: [],
    unsupportedAgentRefs: [],
  };
}

async function listRuntimeAgentNames(): Promise<Set<string>> {
  const agentsDir = await getRuntimeAgentsDirPath();
  const files = await fs.readdir(agentsDir).catch(() => []);
  return new Set(
    files
      .filter((file) => /\.ya?ml$/i.test(file))
      .map((file) => file.replace(/\.(yaml|yml)$/i, ''))
      .filter(Boolean)
  );
}

async function listRuntimeSkillNames(): Promise<Set<string>> {
  const skillsDir = await getRuntimeSkillsDirPath();
  const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => []);
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
    if (existsSync(skillFile)) names.push(entry.name);
  }
  return new Set(names);
}

function sanitizeSkillList(
  value: unknown,
  availableSkills: Set<string>,
  filename: string,
  location: string,
  audit: WorkflowImportAudit
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const name = typeof item === 'string' ? item.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (!availableSkills.has(name)) {
      audit.removedSkills.push({ filename, name, path: location });
      continue;
    }
    result.push(name);
  }
  return result;
}

function scanPathReminders(filename: string, location: string, text: unknown, audit: WorkflowImportAudit) {
  if (typeof text !== 'string' || !text.trim()) return;
  const matches = text.match(COMMON_ABSOLUTE_PATH_PATTERN) || [];
  const seen = new Set(audit.pathReminders.map((item) => `${item.location}:${item.value}`));
  for (const raw of matches) {
    const value = raw.trim();
    if (!value || existsSync(value) || seen.has(`${location}:${value}`)) continue;
    audit.pathReminders.push({ filename, location, value });
    seen.add(`${location}:${value}`);
  }
}

function looksLikeMachinePath(value: string) {
  return /^[A-Za-z]:\\/.test(value) || /^\/(?:Users|home|root|mnt|var|tmp|opt|workspace|repo|repos|data)\//.test(value);
}

function getWorkflowNodes(config: any): any[] {
  return Array.isArray(config?.workflow?.states) ? config.workflow.states : [];
}

function getWorkflowNodePath(config: any, nodeIndex: number) {
  return `workflow.states.${nodeIndex}`;
}

function auditAndSanitizeImportedWorkflow(
  filename: string,
  config: any,
  availableAgents: Set<string>,
  availableSkills: Set<string>
): WorkflowImportAudit {
  const audit = emptyImportAudit();

  if (config?.context) {
    const nextSkills = sanitizeSkillList(config.context.skills, availableSkills, filename, 'context.skills', audit);
    if (nextSkills) config.context.skills = nextSkills;
    scanPathReminders(filename, 'context.requirements', config.context.requirements, audit);
    if (
      typeof config.context.projectRoot === 'string'
      && looksLikeMachinePath(config.context.projectRoot.trim())
      && !existsSync(config.context.projectRoot.trim())
    ) {
      audit.pathReminders.push({ filename, location: 'context.projectRoot', value: config.context.projectRoot.trim() });
    }
  }

  if (Array.isArray(config?.roles)) {
    const keptRoles: any[] = [];
    config.roles.forEach((role: any, index: number) => {
      const name = typeof role?.name === 'string' ? role.name.trim() : '';
      if (!name || !availableAgents.has(name)) {
        if (name) audit.removedAgentDefinitions.push({ filename, name, path: `roles.${index}` });
        return;
      }
      const nextSkills = sanitizeSkillList(role.skills, availableSkills, filename, `roles.${index}.skills`, audit);
      if (nextSkills) role.skills = nextSkills;
      keptRoles.push(role);
    });
    config.roles = keptRoles;
  }

  const overrides = config?.context?.executionPolicy?.agentOverrides;
  if (overrides && typeof overrides === 'object') {
    for (const name of Object.keys(overrides)) {
      if (!availableAgents.has(name)) {
        delete overrides[name];
        audit.removedAgentOverrides.push({ filename, name, path: `context.executionPolicy.agentOverrides.${name}` });
      }
    }
  }

  const supervisorAgent = typeof config?.workflow?.supervisor?.agent === 'string'
    ? config.workflow.supervisor.agent.trim()
    : '';
  if (supervisorAgent && !availableAgents.has(supervisorAgent)) {
    audit.unsupportedAgentRefs.push({ filename, name: supervisorAgent, path: 'workflow.supervisor.agent' });
  }

  const nodes = getWorkflowNodes(config);
  nodes.forEach((node, nodeIndex) => {
    const nodePath = getWorkflowNodePath(config, nodeIndex);
    if (typeof node?.agent === 'string' && node.agent.trim() && !availableAgents.has(node.agent.trim())) {
      audit.unsupportedAgentRefs.push({ filename, name: node.agent.trim(), path: `${nodePath}.agent` });
    }
    (node?.steps || []).forEach((step: any, stepIndex: number) => {
      const stepPath = `${nodePath}.steps.${stepIndex}`;
      if (typeof step?.agent === 'string' && step.agent.trim() && !availableAgents.has(step.agent.trim())) {
        audit.unsupportedAgentRefs.push({ filename, name: step.agent.trim(), path: `${stepPath}.agent` });
      }
      const nextSkills = sanitizeSkillList(step?.skills, availableSkills, filename, `${stepPath}.skills`, audit);
      if (nextSkills) step.skills = nextSkills;
      scanPathReminders(filename, `${stepPath}.task`, step?.task, audit);
    });
  });

  return audit;
}

function mergeImportAudits(audits: WorkflowImportAudit[]): WorkflowImportAudit {
  return audits.reduce((acc, audit) => ({
    pathReminders: [...acc.pathReminders, ...audit.pathReminders],
    removedSkills: [...acc.removedSkills, ...audit.removedSkills],
    removedAgentDefinitions: [...acc.removedAgentDefinitions, ...audit.removedAgentDefinitions],
    removedAgentOverrides: [...acc.removedAgentOverrides, ...audit.removedAgentOverrides],
    unsupportedAgentRefs: [...acc.unsupportedAgentRefs, ...audit.unsupportedAgentRefs],
  }), emptyImportAudit());
}

function validateImportedWorkflowDependencyClosure(candidates: WorkflowImportCandidate[]): void {
  const byFile = new Map(candidates.map((candidate) => [normalizeWorkflowConfigRef(candidate.filename), candidate]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const missing: string[] = [];

  function visit(file: string, stack: string[]) {
    const normalized = normalizeWorkflowConfigRef(file);
    if (stack.includes(normalized)) {
      throw Object.assign(new Error(`导入候选存在子工作流循环: ${[...stack, normalized].join(' -> ')}`), { status: 400 });
    }
    if (visited.has(normalized)) return;
    if (visiting.has(normalized)) {
      throw Object.assign(new Error(`导入候选存在子工作流循环: ${[...stack, normalized].join(' -> ')}`), { status: 400 });
    }
    const candidate = byFile.get(normalized);
    if (!candidate) {
      missing.push(normalized);
      return;
    }
    visiting.add(normalized);
    for (const ref of listSubworkflowReferences(candidate.normalizedConfig)) {
      visit(ref.configFile, [...stack, normalized]);
    }
    visiting.delete(normalized);
    visited.add(normalized);
  }

  for (const candidate of candidates) {
    visit(candidate.filename, []);
  }
  if (missing.length > 0) {
    const uniqueMissing = Array.from(new Set(missing)).sort();
    throw Object.assign(new Error(`导入 ZIP 缺少子工作流依赖: ${uniqueMissing.join(', ')}`), {
      status: 400,
      details: uniqueMissing.map((file) => ({ path: ['workflow', 'subworkflow'], message: `缺少子工作流依赖: ${file}`, severity: 'error' })),
    });
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;

    const body = await readJsonBody<Record<string, any>>(request, {});
    const requested: unknown[] = Array.isArray(body?.workflows)
      ? body.workflows
      : Array.isArray(body?.files)
        ? body.files
        : [];
    const workflowFiles: string[] = requested.map((item) => normalizeArchiveWorkflowPath(item));

    if (workflowFiles.length === 0) {
      return jsonError('请选择要导出的工作流', 400);
    }

    const dependencyMode: ExportDependencyMode = body?.dependencyMode === 'full'
      ? 'full'
      : body?.dependencyMode === 'direct'
        ? 'direct'
        : 'selected';
    const uniqueWorkflowFiles = Array.from(new Set(workflowFiles));
    const files = await collectExportWorkflowFiles(uniqueWorkflowFiles, auth as AuthUser, dependencyMode);
    const manifest = dependencyMode === 'selected'
      ? undefined
      : await buildExportDependencyManifest(files, dependencyMode);

    const zipBuffer = await zipWorkflowFiles(files, manifest);
    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="workflows-export.zip"',
      },
    });
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    return jsonOk(
      {
        error: status === 500 ? '导出失败' : error.message,
        message: error.message,
        details: error.details,
      },
      { status }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return jsonError('请上传工作流 ZIP 或 YAML 文件', 400);
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return jsonError('未找到上传文件', 400);
    }
    if (!/\.(?:zip|ya?ml)$/i.test(file.name || '')) {
      return jsonError('请上传 .zip、.yaml 或 .yml 文件', 400);
    }

    const configsDir = await getRuntimeConfigsDirPath();
    const [availableAgents, availableSkills] = await Promise.all([
      listRuntimeAgentNames(),
      listRuntimeSkillNames(),
    ]);
    const { workflows: candidates, specSessions } = await readImportCandidates(file, availableAgents, availableSkills);
    if (candidates.length === 0) {
      return jsonError('导入文件中未找到 workflow YAML', 400);
    }
    validateImportedWorkflowDependencyClosure(candidates);

    for (const candidate of candidates) {
      const existingMeta = await getConfigMeta(candidate.filename, 'workflow');
      if (existingMeta && !(await canEditWorkflow(candidate.filename, auth as AuthUser))) {
        return jsonError(`无权限覆盖工作流: ${candidate.filename}`, 403);
      }
    }

    const now = Date.now();
    const imported: string[] = [];
    const specSessionByFilename = new Map(specSessions.map((item) => [item.filename, item.session]));
    for (const candidate of candidates) {
      const filePath = resolveInside(configsDir, candidate.filename);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, stringify(candidate.normalizedConfig), 'utf-8');
      await unmarkConfigDeleted(configsDir, candidate.filename);

      const existingMeta = await getConfigMeta(candidate.filename, 'workflow');
      if (!existingMeta) {
        await setConfigMeta(candidate.filename, {
          createdBy: (auth as AuthUser).id,
          visibility: 'private',
          sharedWithUserIds: [],
          createdAt: now,
        }, 'workflow');
      }
      const archivedSession = specSessionByFilename.get(candidate.filename);
      if (archivedSession?.specCoding) {
        const restoredSession = cloneCreationSessionForWorkflow(archivedSession, {
          filename: candidate.filename,
          workflowName: candidate.normalizedConfig?.workflow?.name || archivedSession.workflowName,
          createdBy: (auth as AuthUser).id,
          config: candidate.normalizedConfig,
        });
        await saveCreationSession(restoredSession);
      }
      imported.push(candidate.filename);
    }

    return jsonOk({
      success: true,
      imported,
      audit: mergeImportAudits(candidates.map((candidate) => candidate.audit)),
      message: `导入了 ${imported.length} 个工作流`,
    });
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    return jsonOk(
      {
        error: status === 500 ? '导入失败' : error.message,
        message: error.message,
        details: error.details,
      },
      { status }
    );
  }
}
