import { createHash, randomUUID } from 'crypto';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { parse, stringify } from 'yaml';
import { getInstallWorkflowTemplatesDir, getWorkspaceWorkflowTemplatesDir } from '@/lib/core/app-paths';
import { validateWorkflowDraft } from '@/lib/core/creator-validation';
import {
  workflowTemplateManifestSchema,
  workflowTemplateIdentitySchema,
  type WorkflowTemplateDetail,
  type WorkflowTemplateLocalMeta,
  type WorkflowTemplateManifest,
  type WorkflowTemplateSource,
  type WorkflowTemplateSummary,
  type WorkflowTemplateVisibility,
} from '@/lib/workflow-template/types';

export interface WorkflowTemplateAccessContext {
  userId: string;
  role: 'admin' | 'user';
}

export interface WorkflowTemplateProvider {
  source: WorkflowTemplateSource;
  writable: boolean;
  getRoot: () => string;
}

interface LoadedTemplatePackage {
  source: WorkflowTemplateSource;
  manifest: WorkflowTemplateManifest;
  workflow: Record<string, unknown>;
  digest: string;
  localMeta?: WorkflowTemplateLocalMeta;
}

export interface WorkflowTemplateRegistryResult {
  templates: WorkflowTemplateSummary[];
  issues: Array<{ path: string; message: string }>;
}

export class WorkflowTemplateError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = 'WORKFLOW_TEMPLATE_ERROR',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'WorkflowTemplateError';
  }
}

const LOCAL_METADATA_FILENAME = '.metadata.json';
const WORKFLOW_TEMPLATE_PROVIDERS: Record<WorkflowTemplateSource, WorkflowTemplateProvider> = {
  builtin: {
    source: 'builtin',
    writable: false,
    getRoot: getInstallWorkflowTemplatesDir,
  },
  local: {
    source: 'local',
    writable: true,
    getRoot: getWorkspaceWorkflowTemplatesDir,
  },
};

export function listWorkflowTemplateProviders(): WorkflowTemplateProvider[] {
  return Object.values(WORKFLOW_TEMPLATE_PROVIDERS);
}

function getWorkflowTemplateProvider(source: WorkflowTemplateSource): WorkflowTemplateProvider {
  return WORKFLOW_TEMPLATE_PROVIDERS[source];
}

function packageKey(id: string, version: string): string {
  return `${id}@${version}`;
}

function uniqueSorted(values: unknown[]): string[] {
  return Array.from(new Set(
    values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function getWorkflowNodes(workflow: Record<string, any>): Array<Record<string, any>> {
  const workflowConfig = workflow.workflow || {};
  return Array.isArray(workflowConfig.states) ? workflowConfig.states : [];
}

function countPreCommands(workflow: Record<string, any>): number {
  return getWorkflowNodes(workflow).reduce((total, node) => (
    total + (Array.isArray(node.steps)
      ? node.steps.reduce((sum: number, step: any) => sum + (Array.isArray(step?.preCommands) ? step.preCommands.length : 0), 0)
      : 0)
  ), 0);
}

function summarizePackage(pkg: LoadedTemplatePackage, versions: string[]): WorkflowTemplateSummary {
  const workflowConfig = pkg.workflow.workflow as Record<string, any> | undefined;
  const nodes = getWorkflowNodes(pkg.workflow);
  const sourceVisibility: WorkflowTemplateVisibility | 'builtin' = pkg.source === 'builtin'
    ? 'builtin'
    : (pkg.localMeta?.visibility || 'private');
  return {
    source: pkg.source,
    id: pkg.manifest.metadata.id,
    version: pkg.manifest.metadata.version,
    name: pkg.manifest.metadata.name,
    description: pkg.manifest.metadata.description,
    category: pkg.manifest.metadata.category,
    tags: pkg.manifest.metadata.tags,
    featured: pkg.manifest.metadata.featured,
    mode: pkg.manifest.spec.mode,
    digest: pkg.digest,
    versions,
    visibility: sourceVisibility,
    editable: pkg.source === 'local',
    createdAt: pkg.localMeta?.createdAt,
    ownerId: pkg.localMeta?.createdBy,
    stateCount: Array.isArray(workflowConfig?.states) ? workflowConfig.states.length : 0,
    stepCount: nodes.reduce((total, node) => total + (Array.isArray(node.steps) ? node.steps.length : 0), 0),
    parameterCount: pkg.manifest.spec.parameters.length,
    preCommandCount: countPreCommands(pkg.workflow),
    dependencies: pkg.manifest.spec.dependencies,
  };
}

function semverParts(version: string): [number, number, number, string] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/.exec(version);
  if (!match) return [0, 0, 0, version];
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] || ''];
}

export function compareTemplateVersions(left: string, right: string): number {
  const a = semverParts(left);
  const b = semverParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return Number(a[index]) - Number(b[index]);
  }
  if (a[3] === b[3]) return 0;
  if (!a[3]) return 1;
  if (!b[3]) return -1;
  return String(a[3]).localeCompare(String(b[3]));
}

async function readLocalMetadata(root: string): Promise<Record<string, WorkflowTemplateLocalMeta>> {
  try {
    const raw = JSON.parse(await readFile(join(root, LOCAL_METADATA_FILENAME), 'utf8')) as Record<string, unknown>;
    const normalized: Record<string, WorkflowTemplateLocalMeta> = {};
    for (const [key, value] of Object.entries(raw || {})) {
      const candidate = value as Partial<WorkflowTemplateLocalMeta> | undefined;
      if (!candidate || typeof candidate.createdBy !== 'string' || typeof candidate.createdAt !== 'number') continue;
      if (candidate.visibility !== 'private' && candidate.visibility !== 'public') continue;
      normalized[key] = candidate as WorkflowTemplateLocalMeta;
    }
    return normalized;
  } catch {
    return {};
  }
}

async function writeLocalMetadata(root: string, metadata: Record<string, WorkflowTemplateLocalMeta>): Promise<void> {
  await mkdir(root, { recursive: true });
  const destination = join(root, LOCAL_METADATA_FILENAME);
  const temporary = join(root, `.metadata-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(metadata, null, 2), 'utf8');
  await rename(temporary, destination);
}

function digestPackage(manifestRaw: string, workflowRaw: string): string {
  return createHash('sha256').update(manifestRaw).update('\0').update(workflowRaw).digest('hex');
}

function canAccessLocalTemplate(meta: WorkflowTemplateLocalMeta | undefined, accessContext: WorkflowTemplateAccessContext): boolean {
  if (accessContext.role === 'admin') return true;
  if (!meta) return false;
  return meta.visibility === 'public' || meta.createdBy === accessContext.userId;
}

async function readPackage(
  root: string,
  source: WorkflowTemplateSource,
  idDirectory: string,
  versionDirectory: string,
  localMetadata: Record<string, WorkflowTemplateLocalMeta>,
): Promise<LoadedTemplatePackage> {
  const packageDirectory = join(root, idDirectory, versionDirectory);
  const manifestPath = join(packageDirectory, 'manifest.yaml');
  const workflowPath = join(packageDirectory, 'workflow.yaml');
  const [manifestRaw, workflowRaw] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(workflowPath, 'utf8'),
  ]);
  const manifestResult = workflowTemplateManifestSchema.safeParse(parse(manifestRaw));
  if (!manifestResult.success) {
    throw new Error(manifestResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }
  if (manifestResult.data.metadata.id !== idDirectory || manifestResult.data.metadata.version !== versionDirectory) {
    throw new Error('manifest metadata.id/version 与目录名不一致');
  }
  const workflow = parse(workflowRaw);
  const workflowValidation = validateWorkflowDraft(workflow, { mode: 'portable' });
  if (!workflowValidation.ok || !workflowValidation.normalized) {
    throw new Error(workflowValidation.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }
  if (workflowValidation.normalized.workflow?.mode !== manifestResult.data.spec.mode) {
    throw new Error(`manifest 模式 ${manifestResult.data.spec.mode} 与 workflow.yaml 模式不一致`);
  }
  return {
    source,
    manifest: manifestResult.data,
    workflow: workflowValidation.normalized,
    digest: digestPackage(manifestRaw, workflowRaw),
    localMeta: source === 'local' ? localMetadata[packageKey(idDirectory, versionDirectory)] : undefined,
  };
}

async function scanProvider(source: WorkflowTemplateSource): Promise<{
  packages: LoadedTemplatePackage[];
  issues: Array<{ path: string; message: string }>;
}> {
  const root = getWorkflowTemplateProvider(source).getRoot();
  const packages: LoadedTemplatePackage[] = [];
  const issues: Array<{ path: string; message: string }> = [];
  const localMetadata = source === 'local' ? await readLocalMetadata(root) : {};
  let idEntries;
  try {
    idEntries = await readdir(root, { withFileTypes: true });
  } catch {
    return { packages, issues };
  }

  for (const idEntry of idEntries) {
    if (!idEntry.isDirectory() || idEntry.isSymbolicLink()) continue;
    let versionEntries;
    try {
      versionEntries = await readdir(join(root, idEntry.name), { withFileTypes: true });
    } catch (error) {
      issues.push({ path: `${source}/${idEntry.name}`, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    for (const versionEntry of versionEntries) {
      if (!versionEntry.isDirectory() || versionEntry.isSymbolicLink()) continue;
      try {
        packages.push(await readPackage(root, source, idEntry.name, versionEntry.name, localMetadata));
      } catch (error) {
        issues.push({
          path: `${source}/${idEntry.name}/${versionEntry.name}`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { packages, issues };
}

export async function listWorkflowTemplates(accessContext: WorkflowTemplateAccessContext): Promise<WorkflowTemplateRegistryResult> {
  const [builtin, local] = await Promise.all([scanProvider('builtin'), scanProvider('local')]);
  const accessible = [...builtin.packages, ...local.packages].filter((pkg) => (
    pkg.source === 'builtin' || canAccessLocalTemplate(pkg.localMeta, accessContext)
  ));
  const groups = new Map<string, LoadedTemplatePackage[]>();
  for (const pkg of accessible) {
    const key = `${pkg.source}:${pkg.manifest.metadata.id}`;
    groups.set(key, [...(groups.get(key) || []), pkg]);
  }
  const templates = Array.from(groups.values()).map((items) => {
    const sorted = items.sort((left, right) => compareTemplateVersions(right.manifest.metadata.version, left.manifest.metadata.version));
    const versions = sorted.map((item) => item.manifest.metadata.version);
    const summary = summarizePackage(sorted[0], versions);
    summary.editable = sorted[0].source === 'local'
      && (accessContext.role === 'admin' || sorted[0].localMeta?.createdBy === accessContext.userId);
    return summary;
  }).sort((left, right) => {
    if (left.featured !== right.featured) return left.featured ? -1 : 1;
    return left.name.localeCompare(right.name, 'zh-CN');
  });
  return { templates, issues: [...builtin.issues, ...local.issues] };
}

export async function getWorkflowTemplate(
  identity: { source: WorkflowTemplateSource; id: string; version: string },
  accessContext: WorkflowTemplateAccessContext,
): Promise<WorkflowTemplateDetail> {
  const identityResult = workflowTemplateIdentitySchema.safeParse(identity);
  if (!identityResult.success) {
    throw new WorkflowTemplateError('模板标识无效', 400, 'WORKFLOW_TEMPLATE_IDENTITY_INVALID', identityResult.error.issues);
  }
  const safeIdentity = identityResult.data;
  const root = getWorkflowTemplateProvider(safeIdentity.source).getRoot();
  const metadata = safeIdentity.source === 'local' ? await readLocalMetadata(root) : {};
  let pkg: LoadedTemplatePackage;
  try {
    pkg = await readPackage(root, safeIdentity.source, safeIdentity.id, safeIdentity.version, metadata);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
      throw new WorkflowTemplateError('模板不存在', 404, 'WORKFLOW_TEMPLATE_NOT_FOUND');
    }
    throw new WorkflowTemplateError('模板包无效', 422, 'WORKFLOW_TEMPLATE_INVALID', error instanceof Error ? error.message : String(error));
  }
  if (pkg.source === 'local' && !canAccessLocalTemplate(pkg.localMeta, accessContext)) {
    throw new WorkflowTemplateError('无权限访问该模板', 403, 'WORKFLOW_TEMPLATE_FORBIDDEN');
  }
  const provider = await scanProvider(safeIdentity.source);
  const versions = provider.packages
    .filter((item) => item.manifest.metadata.id === safeIdentity.id)
    .filter((item) => item.source === 'builtin' || canAccessLocalTemplate(item.localMeta, accessContext))
    .map((item) => item.manifest.metadata.version)
    .sort((left, right) => compareTemplateVersions(right, left));
  const summary = summarizePackage(pkg, versions);
  summary.editable = pkg.source === 'local'
    && (accessContext.role === 'admin' || pkg.localMeta?.createdBy === accessContext.userId);
  return { ...summary, manifest: pkg.manifest, workflow: pkg.workflow };
}

export async function writeLocalWorkflowTemplatePackage(input: {
  manifest: WorkflowTemplateManifest;
  workflow: Record<string, unknown>;
  createdBy: string;
  visibility: WorkflowTemplateVisibility;
}): Promise<WorkflowTemplateDetail> {
  const provider = getWorkflowTemplateProvider('local');
  if (!provider.writable) {
    throw new WorkflowTemplateError('本地模板 Provider 不可写', 500, 'WORKFLOW_TEMPLATE_PROVIDER_READ_ONLY');
  }
  const root = provider.getRoot();
  const { id, version } = input.manifest.metadata;
  const destination = join(root, id, version);
  try {
    await access(destination);
    throw new WorkflowTemplateError('该模板版本已存在，请使用新的版本号', 409, 'WORKFLOW_TEMPLATE_VERSION_EXISTS');
  } catch (error) {
    if (error instanceof WorkflowTemplateError) throw error;
  }

  await mkdir(dirname(destination), { recursive: true });
  const temporary = join(root, `.tmp-${id}-${version}-${randomUUID()}`);
  let packageCommitted = false;
  try {
    await mkdir(temporary, { recursive: false });
    await Promise.all([
      writeFile(join(temporary, 'manifest.yaml'), stringify(input.manifest), 'utf8'),
      writeFile(join(temporary, 'workflow.yaml'), stringify(input.workflow), 'utf8'),
    ]);
    await rename(temporary, destination);
    packageCommitted = true;
    const metadata = await readLocalMetadata(root);
    metadata[packageKey(id, version)] = {
      createdBy: input.createdBy,
      visibility: input.visibility,
      createdAt: Date.now(),
    };
    await writeLocalMetadata(root, metadata);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (packageCommitted) {
      await rm(destination, { recursive: true, force: true });
    }
    if (error instanceof WorkflowTemplateError) throw error;
    throw new WorkflowTemplateError('保存模板包失败', 500, 'WORKFLOW_TEMPLATE_WRITE_FAILED', error instanceof Error ? error.message : String(error));
  }

  return getWorkflowTemplate(
    { source: 'local', id, version },
    { userId: input.createdBy, role: 'user' },
  );
}

export function normalizeTemplateDependencies(input: WorkflowTemplateManifest['spec']['dependencies']) {
  return {
    agents: uniqueSorted(input.agents),
    skills: uniqueSorted(input.skills),
    mcpServers: uniqueSorted(input.mcpServers),
    subworkflows: uniqueSorted(input.subworkflows),
  };
}
