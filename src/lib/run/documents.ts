import { existsSync } from 'node:fs';
import { readFile, rename, unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { parse } from 'yaml';
import {
  getRunDocumentRoot,
  isRegularDocumentFile,
  isSafeDocumentDestination,
  isSafeDocumentRename,
  isSafeRunDocumentId,
  listRunDocumentsRecursively,
  normalizeDocumentRelativePath,
  resolveDocumentPath,
  resolveRunDocumentRoots,
  type RunDocumentRoot,
  type RunDocumentSource,
} from '@/lib/run/document-roots';
import { loadRunState, type PersistedRunState } from '@/lib/run/state-persistence';
import { resolveWorkflowConfigPath } from '@/lib/workflow/config-path';
import { canAccessRunState } from '@/lib/workflow/run-access';

export type { RunDocumentSource } from '@/lib/run/document-roots';

const TIMESTAMP_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/;

export type RunDocumentFile = {
  filename: string;
  relativePath: string;
  documentKey: string;
  documentSource: RunDocumentSource;
  documentSourceLabel: string;
  documentDirectory: string;
  stepName: string;
  baseName: string;
  logicalName: string;
  iteration: number | null;
  agent: string;
  phaseName: string;
  role: string;
  documentKind: 'conclusion' | 'detail';
  groupKey: string;
  groupLabel: string;
  detailCount?: number;
  size: number;
  modifiedTime: string;
  sourceRunId: string;
  sourceConfigFile?: string;
  sourceLabel?: string;
  parentRunId?: string | null;
  rootRunId?: string | null;
};

export type RunDocumentReference = {
  source: RunDocumentSource;
  sourceRunId?: string;
  file: string;
};

export type RunDocumentChildRef = {
  runId: string;
  configFile?: string;
  status?: string;
};

export type ListRunDocumentsOptions = {
  includeChildren?: boolean;
  scope?: 'root' | 'children' | 'child';
  childRunId?: string;
  source?: RunDocumentSource;
  groupKey?: string;
  documentKind?: 'conclusion' | 'detail';
  summaryOnly?: boolean;
  sortDirection?: 'asc' | 'desc';
  auth?: { id: string; role: 'admin' | 'user' };
};

export type RunDocumentList = {
  files: RunDocumentFile[];
  documentRoots: Partial<Record<RunDocumentSource, string>>;
  documentDirectory: string | null;
  childRuns: RunDocumentChildRef[];
  state: PersistedRunState;
};

export class RunDocumentOperationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'RunDocumentOperationError';
  }
}

export function readPositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readOffsetLimit(searchParams: URLSearchParams, fallbackLimit = 100) {
  const pageSize = Math.min(readPositiveInt(searchParams.get('limit') || searchParams.get('pageSize'), fallbackLimit), 500);
  const page = readPositiveInt(searchParams.get('page'), 1);
  const rawOffset = Number.parseInt(searchParams.get('offset') || '', 10);
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : (page - 1) * pageSize;
  return { offset, limit: pageSize, page: Math.floor(offset / pageSize) + 1, pageSize };
}

export function paginateDocuments<T>(items: T[], offset: number, limit: number) {
  const safeLimit = Math.max(1, limit);
  const safeOffset = Math.max(0, offset);
  const pageItems = items.slice(safeOffset, safeOffset + safeLimit);
  const totalPages = Math.max(1, Math.ceil(items.length / safeLimit));
  const page = Math.floor(safeOffset / safeLimit) + 1;
  return {
    items: pageItems,
    pagination: {
      total: items.length,
      totalPages,
      page: Math.min(page, totalPages),
      pageSize: safeLimit,
      offset: safeOffset,
      limit: safeLimit,
      nextOffset: safeOffset + pageItems.length < items.length ? safeOffset + pageItems.length : null,
    },
  };
}

export async function listRunDocuments(
  runId: string,
  options: ListRunDocumentsOptions = {},
): Promise<RunDocumentList | null> {
  const rootDocuments = await listSingleRunDocuments(runId);
  if (!rootDocuments) return null;

  const descendants = await listDescendantRuns(rootDocuments.state, options.auth);
  let files: RunDocumentFile[] = [];
  const scope = options.scope || (options.includeChildren ? 'children' : 'root');

  if (scope === 'root') {
    files = rootDocuments.files;
  } else if (scope === 'child') {
    const childRunId = String(options.childRunId || '').trim();
    const child = descendants.documents.get(childRunId);
    if (child) files = child.files;
  } else {
    files = [
      ...rootDocuments.files,
      ...Array.from(descendants.documents.values()).flatMap((child) => child.files),
    ];
  }

  files = filterAndSortDocuments(files, options);
  if (options.summaryOnly) files = summarizeDocumentGroups(files);

  return {
    files,
    documentRoots: documentRootsPayload(rootDocuments.roots),
    documentDirectory: rootDocuments.roots[0]?.path || null,
    childRuns: descendants.refs,
    state: rootDocuments.state,
  };
}

export async function readRunDocumentContent(
  rootRunId: string,
  reference: RunDocumentReference,
): Promise<{ file: string; source: RunDocumentSource; sourceRunId: string; content: string } | null> {
  const resolved = await resolveRunDocumentReference({ rootRunId, ...reference });
  if (!resolved || !(await isRegularDocumentFile(resolved.root.path, resolved.path))) return null;

  try {
    const content = await readFile(resolved.path, 'utf-8');
    return {
      file: resolved.relativePath,
      source: resolved.root.source,
      sourceRunId: resolved.runId,
      content,
    };
  } catch {
    return null;
  }
}

export async function renameRunDocument(
  rootRunId: string,
  input: RunDocumentReference & { newName: string },
): Promise<{ newFilename: string; source: RunDocumentSource; sourceRunId: string } | null> {
  const resolved = await resolveRunDocumentReference({ rootRunId, ...input });
  if (!resolved || resolved.runId !== rootRunId || !(await isRegularDocumentFile(resolved.root.path, resolved.path))) {
    return null;
  }
  if (!isSafeDocumentRename(input.newName)) {
    throw new RunDocumentOperationError('缺少或非法的重命名参数', 400);
  }

  const oldExtension = extname(resolved.relativePath);
  const requestedName = input.newName.trim();
  const requestedExtension = extname(requestedName);
  if (requestedExtension && requestedExtension.toLowerCase() !== oldExtension.toLowerCase()) {
    throw new RunDocumentOperationError('重命名不能改变文档扩展名', 400);
  }

  const finalBaseName = requestedExtension ? requestedName : `${requestedName}${oldExtension}`;
  const parentSegments = resolved.relativePath.split('/').slice(0, -1);
  const finalRelativePath = normalizeDocumentRelativePath([...parentSegments, finalBaseName].join('/'));
  if (!finalRelativePath) throw new RunDocumentOperationError('非法的新文件名', 400);

  const nextPath = resolveDocumentPath(resolved.root.path, finalRelativePath);
  if (!nextPath || !(await isSafeDocumentDestination(resolved.root.path, nextPath))) {
    throw new RunDocumentOperationError('非法的新文件名', 400);
  }
  if (nextPath !== resolved.path && existsSync(nextPath)) {
    throw new RunDocumentOperationError('目标文件已存在', 409);
  }
  if (nextPath !== resolved.path) await rename(resolved.path, nextPath);

  return {
    newFilename: finalRelativePath,
    source: resolved.root.source,
    sourceRunId: resolved.runId,
  };
}

export async function deleteRunDocuments(
  rootRunId: string,
  references: RunDocumentReference[],
): Promise<string[] | null> {
  if (!isSafeRunDocumentId(rootRunId)) return null;
  const rootState = await loadRunState(rootRunId, { hydrateLargeOutputs: false });
  if (!rootState) return null;

  const deleted: string[] = [];
  for (const reference of references) {
    const resolved = await resolveRunDocumentReference({ rootRunId, ...reference });
    if (!resolved || resolved.runId !== rootRunId || !(await isRegularDocumentFile(resolved.root.path, resolved.path))) continue;
    await unlink(resolved.path);
    deleted.push(createDocumentKey(resolved.runId, resolved.root.source, resolved.relativePath));
  }
  return deleted;
}

async function listSingleRunDocuments(runId: string): Promise<{
  files: RunDocumentFile[];
  roots: RunDocumentRoot[];
  state: PersistedRunState;
} | null> {
  if (!isSafeRunDocumentId(runId)) return null;
  const state = await loadRunState(runId, { hydrateLargeOutputs: false });
  if (!state) return null;

  const roots = resolveRunDocumentRoots(runId, state);
  const stepMap = await buildStepMap(state);
  const sourceLabel = getSourceRunLabel(state);
  const files: RunDocumentFile[] = [];

  for (const root of roots) {
    const entries = await listRunDocumentsRecursively(root.path);
    for (const entry of entries) {
      files.push(buildDocumentFile({
        runId,
        state,
        root,
        relativePath: entry.relativePath,
        size: entry.size,
        modifiedTime: entry.modifiedTime,
        sourceLabel,
        stepMap,
      }));
    }
  }

  return { files: withDetailCounts(files), roots, state };
}

async function listDescendantRuns(
  rootState: PersistedRunState,
  auth?: ListRunDocumentsOptions['auth'],
): Promise<{
  refs: RunDocumentChildRef[];
  documents: Map<string, { files: RunDocumentFile[]; roots: RunDocumentRoot[]; state: PersistedRunState }>;
}> {
  const refs: RunDocumentChildRef[] = [];
  const documents = new Map<string, { files: RunDocumentFile[]; roots: RunDocumentRoot[]; state: PersistedRunState }>();
  const seen = new Set<string>([rootState.runId]);
  const queue = getChildRunRefs(rootState).map((ref) => ({ ref, parentRunId: rootState.runId }));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || !isSafeRunDocumentId(current.ref.runId) || seen.has(current.ref.runId)) continue;
    seen.add(current.ref.runId);

    const child = await listSingleRunDocuments(current.ref.runId).catch(() => null);
    if (!child) continue;
    if (auth && !canAccessRunState(auth, child.state)) continue;

    refs.push({
      runId: child.state.runId,
      configFile: child.state.configFile || current.ref.configFile,
      status: child.state.status || current.ref.status,
    });
    documents.set(child.state.runId, child);
    for (const nested of getChildRunRefs(child.state)) {
      queue.push({ ref: nested, parentRunId: child.state.runId });
    }
  }

  return { refs, documents };
}

async function resolveRunDocumentReference(input: {
  rootRunId: string;
  sourceRunId?: string | null;
  source: unknown;
  file: unknown;
}): Promise<{
  runId: string;
  state: PersistedRunState;
  root: RunDocumentRoot;
  relativePath: string;
  path: string;
} | null> {
  if (!isSafeRunDocumentId(input.rootRunId)) return null;
  const runId = typeof input.sourceRunId === 'string' && input.sourceRunId.trim()
    ? input.sourceRunId.trim()
    : input.rootRunId;
  const source = normalizeRunDocumentSource(input.source);
  const relativePath = normalizeDocumentRelativePath(input.file);
  if (!isSafeRunDocumentId(runId) || !source || !relativePath || !(await isDescendantRun(input.rootRunId, runId))) return null;

  const state = await loadRunState(runId, { hydrateLargeOutputs: false });
  if (!state) return null;
  const root = getRunDocumentRoot(runId, state, source);
  if (!root) return null;
  const path = resolveDocumentPath(root.path, relativePath);
  return path ? { runId, state, root, relativePath, path } : null;
}

async function isDescendantRun(rootRunId: string, requestedRunId: string): Promise<boolean> {
  if (!isSafeRunDocumentId(rootRunId) || !isSafeRunDocumentId(requestedRunId)) return false;
  if (rootRunId === requestedRunId) return true;

  const rootState = await loadRunState(rootRunId, { hydrateLargeOutputs: false });
  if (!rootState) return false;
  const seen = new Set<string>([rootRunId]);
  const queue = getChildRunRefs(rootState);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || !isSafeRunDocumentId(current.runId) || seen.has(current.runId)) continue;
    if (current.runId === requestedRunId) return true;
    seen.add(current.runId);
    const state = await loadRunState(current.runId, { hydrateLargeOutputs: false }).catch(() => null);
    if (state) queue.push(...getChildRunRefs(state));
  }
  return false;
}

function buildDocumentFile(input: {
  runId: string;
  state: PersistedRunState;
  root: RunDocumentRoot;
  relativePath: string;
  size: number;
  modifiedTime: string;
  sourceLabel: string;
  stepMap: Record<string, StepMetadata>;
}): RunDocumentFile {
  const baseName = getBaseName(input.relativePath).replace(/\.(md|mdx|txt)$/i, '');
  const documentKind = TIMESTAMP_PREFIX_RE.test(baseName) ? 'detail' : 'conclusion';
  const logicalName = documentKind === 'detail' ? baseName.replace(TIMESTAMP_PREFIX_RE, '') : baseName;
  const iteration = readDocumentIteration(baseName);
  const metadata = resolveStepMetadata(logicalName, input.stepMap) || {
    canonicalStepName: logicalName,
    agent: '',
    phaseName: '',
    role: '',
  };
  const groupKey = JSON.stringify([
    input.runId,
    input.root.source,
    metadata.phaseName || '',
    metadata.canonicalStepName || logicalName,
  ]);

  return {
    filename: input.relativePath,
    relativePath: input.relativePath,
    documentKey: createDocumentKey(input.runId, input.root.source, input.relativePath),
    documentSource: input.root.source,
    documentSourceLabel: input.root.label,
    documentDirectory: input.root.path,
    stepName: metadata.canonicalStepName || logicalName,
    baseName,
    logicalName,
    iteration,
    agent: metadata.agent,
    phaseName: metadata.phaseName,
    role: metadata.role,
    documentKind,
    groupKey,
    groupLabel: metadata.canonicalStepName || logicalName,
    size: input.size,
    modifiedTime: input.modifiedTime,
    sourceRunId: input.runId,
    sourceConfigFile: input.state.configFile,
    sourceLabel: input.sourceLabel,
    parentRunId: input.state.parentRunId || null,
    rootRunId: input.state.rootRunId || input.state.runId || null,
  };
}

function filterAndSortDocuments(files: RunDocumentFile[], options: ListRunDocumentsOptions): RunDocumentFile[] {
  const direction = options.sortDirection === 'desc' ? -1 : 1;
  return files
    .filter((file) => !options.source || file.documentSource === options.source)
    .filter((file) => !options.groupKey || file.groupKey === options.groupKey)
    .filter((file) => !options.documentKind || file.documentKind === options.documentKind)
    .sort((left, right) => {
      const timeDifference = new Date(left.modifiedTime).getTime() - new Date(right.modifiedTime).getTime();
      if (timeDifference !== 0) return timeDifference * direction;
      return left.relativePath.localeCompare(right.relativePath, 'zh-CN') * direction;
    });
}

function summarizeDocumentGroups(files: RunDocumentFile[]): RunDocumentFile[] {
  const groups = new Map<string, RunDocumentFile[]>();
  for (const file of files) {
    const group = groups.get(file.groupKey) || [];
    group.push(file);
    groups.set(file.groupKey, group);
  }
  return Array.from(groups.values()).flatMap((group) => {
    const conclusion = group.find((file) => file.documentKind === 'conclusion');
    const details = group.filter((file) => file.documentKind === 'detail');
    // Detail files can be internal runtime artifacts. A work summary must only
    // expose a real step conclusion, never promote an orphan detail as one.
    return conclusion ? [{ ...conclusion, detailCount: details.length }] : [];
  });
}

function withDetailCounts(files: RunDocumentFile[]): RunDocumentFile[] {
  const detailCounts = new Map<string, number>();
  for (const file of files) {
    if (file.documentKind === 'detail') {
      detailCounts.set(file.groupKey, (detailCounts.get(file.groupKey) || 0) + 1);
    }
  }
  return files.map((file) => ({ ...file, detailCount: detailCounts.get(file.groupKey) || 0 }));
}

function documentRootsPayload(roots: RunDocumentRoot[]): Partial<Record<RunDocumentSource, string>> {
  return Object.fromEntries(roots.map((root) => [root.source, root.path])) as Partial<Record<RunDocumentSource, string>>;
}

function getChildRunRefs(state: PersistedRunState): RunDocumentChildRef[] {
  const refs = new Map<string, RunDocumentChildRef>();
  for (const runId of Array.isArray(state.childRunIds) ? state.childRunIds : []) {
    if (isSafeRunDocumentId(runId)) refs.set(runId, { runId });
  }
  for (const child of Array.isArray(state.subworkflowRuns) ? state.subworkflowRuns : []) {
    const runId = typeof child?.runId === 'string' ? child.runId.trim() : '';
    if (!isSafeRunDocumentId(runId)) continue;
    refs.set(runId, {
      runId,
      configFile: child.configFile,
      status: child.status,
    });
  }
  return Array.from(refs.values());
}

function getSourceRunLabel(state: PersistedRunState): string {
  return state.parentRunId
    ? `${state.parentStateName || '子工作流'} / ${state.parentStepName || state.configFile}`
    : '父工作流';
}

function createDocumentKey(runId: string, source: RunDocumentSource, relativePath: string): string {
  return JSON.stringify([runId, source, relativePath]);
}

function getBaseName(relativePath: string): string {
  const segments = relativePath.split('/');
  return segments[segments.length - 1] || relativePath;
}

function readDocumentIteration(baseName: string): number | null {
  const match = baseName.match(/(?:-迭代|-v)(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 1;
}

function normalizeRunDocumentSource(value: unknown): RunDocumentSource | null {
  return isRunDocumentSource(value) ? value : null;
}

function isRunDocumentSource(value: unknown): value is RunDocumentSource {
  return value === 'tasklist' || value === 'runtime-output';
}

type StepMetadata = {
  canonicalStepName: string;
  agent: string;
  phaseName: string;
  role: string;
};

async function buildStepMap(state: PersistedRunState): Promise<Record<string, StepMetadata>> {
  const stepMap: Record<string, StepMetadata> = {};
  try {
    const configPath = await resolveWorkflowConfigPath(state.configFile);
    if (!configPath) return stepMap;
    const config = parse(await readFile(configPath, 'utf-8')) as any;
    for (const stateItem of Array.isArray(config?.workflow?.states) ? config.workflow.states : []) {
      for (const step of Array.isArray(stateItem?.steps) ? stateItem.steps : []) {
        const metadata: StepMetadata = {
          canonicalStepName: step.name || '',
          agent: step.agent || '',
          phaseName: stateItem.name || '',
          role: step.role || '',
        };
        if (!metadata.canonicalStepName) continue;
        stepMap[metadata.canonicalStepName] = metadata;
        stepMap[normalizeLookupKey(metadata.canonicalStepName)] = metadata;
        const compositeKey = `${metadata.phaseName}-${metadata.canonicalStepName}`;
        stepMap[compositeKey] = metadata;
        stepMap[normalizeLookupKey(compositeKey)] = metadata;
      }
    }
  } catch {
    // File metadata is optional; path names remain usable when a config is unavailable.
  }
  return stepMap;
}

function resolveStepMetadata(logicalName: string, stepMap: Record<string, StepMetadata>): StepMetadata | null {
  const direct = stepMap[logicalName] || stepMap[normalizeLookupKey(logicalName)];
  if (direct) return direct;
  for (const key of Object.keys(stepMap).sort((left, right) => right.length - left.length)) {
    if (logicalName.endsWith(`-${key}`)) return stepMap[key];
  }
  return null;
}

function normalizeLookupKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
}
