import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import path from 'path';
import { parse } from 'yaml';
import { getInstallConfigsDir, getWorkspaceRunsDir } from '@/lib/core/app-paths';
import { stateMachineWorkflowSchema } from '@/lib/core/schemas';
import {
  ensureRuntimeConfigsSeeded,
  getRuntimeConfigsDirPath,
} from '@/lib/run/runtime-configs';

export const DEFAULT_SUBWORKFLOW_MAX_DEPTH = 3;
export const SYSTEM_SUBWORKFLOW_MAX_DEPTH = 8;
export const DEFAULT_SUBWORKFLOW_MAX_DEPENDENCY_GRAPH_SIZE = 32;
export const DEFAULT_SUBWORKFLOW_MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

const WINDOWS_DRIVE_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;

export interface WorkflowConfigDependency {
  file: string;
  canonicalFile: string;
  snapshot: string;
  sha256: string;
  workflowName: string;
  mode: string;
  referencedBy: string[];
}

export interface WorkflowConfigDependencyGraph {
  root: string;
  createdAt: string;
  manifestHash: string;
  configs: WorkflowConfigDependency[];
}

interface WorkflowConfigDependencyGraphWithContent extends WorkflowConfigDependencyGraph {
  configs: Array<WorkflowConfigDependency & { content: string }>;
}

export interface SubworkflowReference {
  configFile: string;
  stateName?: string;
  stepName?: string;
  stepIndex?: number;
}

export interface WorkflowDependencyValidationIssue {
  path: Array<string | number>;
  message: string;
  severity: 'error' | 'warning';
}

export function isSubworkflowStep(step: any): boolean {
  return step?.type === 'subworkflow';
}

export function getSubworkflowConfigFile(step: any): string {
  if (!isSubworkflowStep(step)) return '';
  return String(step?.workflow || step?.subworkflow?.configFile || '').trim();
}

export function normalizeWorkflowConfigRef(input: string): string {
  const raw = String(input || '').trim().replace(/\\/g, '/');
  if (!raw) throw new Error('子工作流配置不能为空');
  if (raw.startsWith('/') || raw.startsWith('//') || WINDOWS_DRIVE_ABSOLUTE_PATH.test(raw)) {
    throw new Error(`子工作流配置必须使用相对路径: ${input}`);
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..' || normalized.includes('/../')) {
    throw new Error(`子工作流配置不能越过 workflow 配置目录: ${input}`);
  }
  if (!/\.(ya?ml)$/i.test(normalized)) {
    throw new Error(`子工作流配置必须是 YAML 文件: ${input}`);
  }
  return normalized;
}

function canonicalWorkflowConfigRef(input: string): string {
  return normalizeWorkflowConfigRef(input).toLowerCase();
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function computeManifestHash(input: Omit<WorkflowConfigDependencyGraph, 'manifestHash'>): string {
  return sha256(JSON.stringify({
    root: input.root,
    createdAt: input.createdAt,
    configs: input.configs,
  }));
}

function safeSnapshotName(configFile: string): string {
  return normalizeWorkflowConfigRef(configFile).replace(/[\\/]+/g, '__');
}

function isWithinDir(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(baseDir), path.resolve(targetPath));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function readWorkflowConfigFile(configFile: string): Promise<{ file: string; content: string; config: any }> {
  await ensureRuntimeConfigsSeeded();
  const safeRef = normalizeWorkflowConfigRef(configFile);
  const runtimeDir = await getRuntimeConfigsDirPath();
  const runtimePath = path.resolve(runtimeDir, safeRef);
  if (!isWithinDir(runtimeDir, runtimePath)) {
    throw new Error(`子工作流配置路径非法: ${configFile}`);
  }
  if (existsSync(runtimePath)) {
    const content = await readFile(runtimePath, 'utf-8');
    return { file: safeRef, content, config: parse(content) };
  }

  const bundledDir = getInstallConfigsDir();
  const bundledPath = path.resolve(bundledDir, safeRef);
  if (!isWithinDir(bundledDir, bundledPath)) {
    throw new Error(`内置子工作流配置路径非法: ${configFile}`);
  }
  if (existsSync(bundledPath)) {
    const content = await readFile(bundledPath, 'utf-8');
    return { file: safeRef, content, config: parse(content) };
  }

  throw new Error(`找不到子工作流配置: ${configFile}`);
}

export async function readWorkflowConfigForDependency(configFile: string): Promise<{ file: string; content: string; config: any }> {
  return readWorkflowConfigFile(configFile);
}

export function listSubworkflowReferences(config: any): SubworkflowReference[] {
  const workflow = config?.workflow;
  if (!workflow || workflow.mode !== 'state-machine') return [];
  const result: SubworkflowReference[] = [];
  for (const state of Array.isArray(workflow.states) ? workflow.states : []) {
    const steps = Array.isArray(state?.steps) ? state.steps : [];
    steps.forEach((step: any, stepIndex: number) => {
      const configFile = getSubworkflowConfigFile(step);
      if (!configFile) return;
      result.push({
        configFile: normalizeWorkflowConfigRef(configFile),
        stateName: typeof state?.name === 'string' ? state.name : undefined,
        stepName: typeof step?.name === 'string' ? step.name : undefined,
        stepIndex,
      });
    });
  }
  return result;
}

async function resolveWorkflowConfigDependencyGraphWithContent(
  rootConfigFile: string,
  options: { maxDepth?: number; maxGraphSize?: number; maxSnapshotBytes?: number } = {},
): Promise<WorkflowConfigDependencyGraphWithContent> {
  const root = normalizeWorkflowConfigRef(rootConfigFile);
  const maxDepth = Math.min(
    Math.max(1, options.maxDepth || DEFAULT_SUBWORKFLOW_MAX_DEPTH),
    SYSTEM_SUBWORKFLOW_MAX_DEPTH,
  );
  const createdAt = new Date().toISOString();
  const maxGraphSize = Math.max(1, options.maxGraphSize || DEFAULT_SUBWORKFLOW_MAX_DEPENDENCY_GRAPH_SIZE);
  const maxSnapshotBytes = Math.max(1, options.maxSnapshotBytes || DEFAULT_SUBWORKFLOW_MAX_SNAPSHOT_BYTES);
  let totalSnapshotBytes = 0;
  const byFile = new Map<string, WorkflowConfigDependency & { content: string }>();
  const canonicalByFile = new Map<string, string>();
  const visiting = new Set<string>();

  async function visit(configFile: string, stack: string[], referencedBy?: string) {
    const file = normalizeWorkflowConfigRef(configFile);
    const canonicalFile = canonicalWorkflowConfigRef(file);
    if (stack.includes(file)) {
      throw new Error(`检测到子工作流循环: ${[...stack, file].join(' -> ')}`);
    }
    if (stack.length >= maxDepth) {
      throw new Error(`子工作流嵌套超过最大深度 ${maxDepth}: ${[...stack, file].join(' -> ')}`);
    }
    const existing = byFile.get(file);
    if (existing) {
      if (referencedBy && !existing.referencedBy.includes(referencedBy)) existing.referencedBy.push(referencedBy);
      return;
    }
    if (visiting.has(file)) {
      throw new Error(`检测到子工作流循环: ${[...stack, file].join(' -> ')}`);
    }
    const existingCanonical = canonicalByFile.get(canonicalFile);
    if (existingCanonical && existingCanonical !== file) {
      throw new Error(`检测到重复 canonical 子工作流路径: ${existingCanonical} 与 ${file}`);
    }
    canonicalByFile.set(canonicalFile, file);

    visiting.add(file);
    const loaded = await readWorkflowConfigFile(file);
    totalSnapshotBytes += Buffer.byteLength(loaded.content, 'utf-8');
    if (byFile.size + 1 > maxGraphSize) {
      throw new Error(`子工作流依赖图超过最大配置数量 ${maxGraphSize}`);
    }
    if (totalSnapshotBytes > maxSnapshotBytes) {
      throw new Error(`子工作流快照总大小超过上限 ${maxSnapshotBytes} bytes`);
    }
    const parsedConfig = stateMachineWorkflowSchema.safeParse(loaded.config);
    if (!parsedConfig.success) {
      const detail = parsedConfig.error.issues
        .map((issue) => `${issue.path.join('.') || 'workflow'}: ${issue.message}`)
        .join('; ');
      throw new Error(`子工作流配置不是有效的状态机配置: ${file}${detail ? ` (${detail})` : ''}`);
    }
    const mode = String(parsedConfig.data.workflow.mode);
    const refs = listSubworkflowReferences(loaded.config);
    if (mode !== 'state-machine') {
      throw new Error(`子工作流必须是状态机模式: ${file}`);
    }

    const entry: WorkflowConfigDependency & { content: string } = {
      file,
      canonicalFile,
      snapshot: `configs/${safeSnapshotName(file)}`,
      sha256: sha256(loaded.content),
      workflowName: String(loaded.config?.workflow?.name || file),
      mode,
      referencedBy: referencedBy ? [referencedBy] : [],
      content: loaded.content,
    };
    byFile.set(file, entry);

    for (const ref of refs) {
      await visit(ref.configFile, [...stack, file], file);
    }
    visiting.delete(file);
  }

  await visit(root, []);

  const configs = Array.from(byFile.values()).map((entry) => ({
    ...entry,
    referencedBy: [...entry.referencedBy].sort(),
  }));
  const manifestConfigs = configs.map(({ content: _content, ...entry }) => entry);
  const manifestHash = computeManifestHash({ root, createdAt, configs: manifestConfigs });
  return {
    root,
    createdAt,
    manifestHash,
    configs,
  };
}

export async function resolveWorkflowConfigDependencyGraph(
  rootConfigFile: string,
  options: { maxDepth?: number; maxGraphSize?: number; maxSnapshotBytes?: number } = {},
): Promise<WorkflowConfigDependencyGraph> {
  const graph = await resolveWorkflowConfigDependencyGraphWithContent(rootConfigFile, options);
  return {
    ...graph,
    configs: graph.configs.map(({ content: _content, ...entry }) => entry),
  };
}

export async function createWorkflowConfigSnapshot(input: {
  rootConfigFile: string;
  runId: string;
  maxDepth?: number;
  maxGraphSize?: number;
  maxSnapshotBytes?: number;
}): Promise<WorkflowConfigDependencyGraph> {
  const graph = await resolveWorkflowConfigDependencyGraphWithContent(input.rootConfigFile, {
    maxDepth: input.maxDepth,
    maxGraphSize: input.maxGraphSize,
    maxSnapshotBytes: input.maxSnapshotBytes,
  });
  const runConfigsDir = path.resolve(getWorkspaceRunsDir(), input.runId, 'configs');
  const tmpConfigsDir = path.resolve(getWorkspaceRunsDir(), input.runId, `configs.tmp-${process.pid}-${Date.now()}`);
  await rm(tmpConfigsDir, { recursive: true, force: true }).catch(() => {});
  await mkdir(tmpConfigsDir, { recursive: true });

  try {
    for (const config of graph.configs) {
      const target = path.resolve(tmpConfigsDir, config.snapshot.replace(/^configs[\\/]/, ''));
      if (!isWithinDir(tmpConfigsDir, target)) {
        throw new Error(`配置快照路径非法: ${config.snapshot}`);
      }
      await writeFile(target, config.content, 'utf-8');
    }

    const manifest: WorkflowConfigDependencyGraph = {
      ...graph,
      configs: graph.configs.map(({ content: _content, ...entry }) => entry),
    };

    await writeFile(
      path.resolve(tmpConfigsDir, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf-8',
    );
    await rm(runConfigsDir, { recursive: true, force: true }).catch(() => {});
    await rename(tmpConfigsDir, runConfigsDir);
    return manifest;
  } catch (error) {
    await rm(tmpConfigsDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function readWorkflowConfigSnapshot(input: {
  rootRunId: string;
  configFile: string;
}): Promise<{ content: string; snapshotFile: string; manifest: WorkflowConfigDependencyGraph }> {
  const configFile = normalizeWorkflowConfigRef(input.configFile);
  const manifestPath = path.resolve(getWorkspaceRunsDir(), input.rootRunId, 'configs', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as WorkflowConfigDependencyGraph;
  const expectedManifestHash = computeManifestHash({
    root: manifest.root,
    createdAt: manifest.createdAt,
    configs: manifest.configs,
  });
  if (manifest.manifestHash !== expectedManifestHash) {
    throw new Error('配置快照 manifest 校验失败，请重新启动工作流或恢复 run snapshot');
  }
  const entry = manifest.configs.find((item) => item.file === configFile);
  if (!entry) {
    throw new Error(`配置快照中找不到子工作流: ${configFile}`);
  }
  const target = path.resolve(getWorkspaceRunsDir(), input.rootRunId, entry.snapshot);
  const snapshotRoot = path.resolve(getWorkspaceRunsDir(), input.rootRunId, 'configs');
  if (!isWithinDir(snapshotRoot, target)) {
    throw new Error(`配置快照路径非法: ${entry.snapshot}`);
  }
  const content = await readFile(target, 'utf-8');
  if (sha256(content) !== entry.sha256) {
    throw new Error(`配置快照校验失败: ${configFile}`);
  }
  return { content, snapshotFile: entry.snapshot, manifest };
}

export async function assertSubworkflowDependenciesForConfig(
  config: any,
  options: { maxDepth?: number; maxGraphSize?: number; maxSnapshotBytes?: number } = {},
): Promise<void> {
  const refs = listSubworkflowReferences(config);
  if (config?.workflow?.profile === 'lightweight' && refs.length > 0) {
    throw new Error('轻量工作流不能包含子工作流步骤');
  }
  if (refs.length === 0) return;
  const maxDepth = Math.min(
    Math.max(1, options.maxDepth || DEFAULT_SUBWORKFLOW_MAX_DEPTH),
    SYSTEM_SUBWORKFLOW_MAX_DEPTH,
  );
  for (const ref of refs) {
    await resolveWorkflowConfigDependencyGraph(ref.configFile, {
      maxDepth,
      maxGraphSize: options.maxGraphSize,
      maxSnapshotBytes: options.maxSnapshotBytes,
    });
  }
}

export async function validateSubworkflowDependenciesForConfig(
  config: any,
  options: { maxDepth?: number; maxGraphSize?: number; maxSnapshotBytes?: number } = {},
): Promise<WorkflowDependencyValidationIssue[]> {
  try {
    await assertSubworkflowDependenciesForConfig(config, options);
    return [];
  } catch (error) {
    return [{
      path: ['workflow', 'states'],
      message: error instanceof Error ? error.message : String(error),
      severity: 'error',
    }];
  }
}
