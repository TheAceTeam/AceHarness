import { existsSync } from 'node:fs';
import { readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { getWorkspaceRunsDir } from '@/lib/core/app-paths';
import { loadRunState } from '@/lib/run/state-persistence';
import { canAccessRunState } from '@/lib/workflow/run-access';
import { resolveWorkflowConfigPath } from '@/lib/workflow/config-path';

const TIMESTAMP_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/;

export type RunDocumentFile = {
  filename: string;
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

export type RunDocumentChildRef = {
  runId: string;
  configFile?: string;
  status?: string;
};

export type ListRunDocumentsOptions = {
  includeChildren?: boolean;
  scope?: 'root' | 'children' | 'child';
  childRunId?: string;
  groupKey?: string;
  documentKind?: 'conclusion' | 'detail';
  summaryOnly?: boolean;
  sortDirection?: 'asc' | 'desc';
  auth?: { id: string; role: 'admin' | 'user' };
};

export type RunDocumentList = {
  files: RunDocumentFile[];
  aceDir: string | null;
  documentDirectory: string | null;
  childRuns: RunDocumentChildRef[];
  state: any;
};

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

export async function listRunDocuments(runId: string, options: ListRunDocumentsOptions = {}): Promise<RunDocumentList | null> {
  const rootDocs = await listSingleRunDocuments(runId, '父工作流');
  if (!rootDocs) return null;

  const childRuns = getChildRunRefs(rootDocs.state);
  let files: RunDocumentFile[] = [];
  const scope = options.scope || (options.includeChildren ? 'children' : 'root');

  if (scope === 'root') {
    files.push(...rootDocs.files);
  } else if (scope === 'child') {
    const childRunId = options.childRunId;
    if (childRunId && childRuns.some((child) => child.runId === childRunId)) {
      const childDocs = await listAuthorizedChildDocuments(childRunId, options.auth, rootDocs.state, childRuns);
      if (childDocs) files.push(...childDocs.files);
    }
  } else {
    files.push(...rootDocs.files);
    for (const child of childRuns) {
      const childDocs = await listAuthorizedChildDocuments(child.runId, options.auth, rootDocs.state, childRuns);
      if (childDocs) files.push(...childDocs.files);
    }
  }

  files = filterAndSortDocuments(files, options);
  if (options.summaryOnly) {
    files = summarizeDocumentGroups(files);
  }

  return {
    files,
    aceDir: rootDocs.aceDir,
    documentDirectory: rootDocs.documentDirectory,
    childRuns,
    state: rootDocs.state,
  };
}

export async function readRunDocumentContent(runId: string, filename: string): Promise<{ file: string; sourceRunId: string; content: string } | null> {
  const dirs = await resolveOutputDirs(runId);
  if (!dirs) return null;
  const safe = filename.replace(/\.\./g, '');
  for (const dir of [dirs.runsDir, dirs.aceDir].filter((value): value is string => Boolean(value))) {
    if (!existsSync(dir)) continue;
    const fullPath = resolve(dir, safe);
    if (!isPathInside(dir, fullPath)) continue;
    try {
      const content = await readFile(fullPath, 'utf-8');
      return { file: filename, sourceRunId: runId, content };
    } catch {
      // Try the next output directory.
    }
  }
  return null;
}

export async function renameRunDocument(runId: string, file: string, newName: string): Promise<string | null> {
  const dirs = await resolveOutputDirs(runId);
  if (!dirs) return null;
  const ext = file.match(/\.(md|txt)$/)?.[0] || '.md';
  const finalName = newName.endsWith(ext) ? newName : newName + ext;
  let renamed = false;
  for (const dir of [dirs.runsDir, dirs.aceDir].filter((value): value is string => Boolean(value))) {
    const oldPath = safePath(dir, file);
    const newPath = safePath(dir, finalName);
    if (oldPath && newPath && existsSync(oldPath)) {
      await rename(oldPath, newPath).catch(() => {});
      renamed = true;
    }
  }
  return renamed ? finalName : null;
}

export async function deleteRunDocuments(runId: string, files: string[]): Promise<string[] | null> {
  const dirs = await resolveOutputDirs(runId);
  if (!dirs) return null;
  const deleted: string[] = [];
  for (const file of files) {
    let found = false;
    for (const dir of [dirs.runsDir, dirs.aceDir].filter((value): value is string => Boolean(value))) {
      const fullPath = safePath(dir, file);
      if (fullPath && existsSync(fullPath)) {
        await unlink(fullPath).catch(() => {});
        found = true;
      }
    }
    if (found) deleted.push(file);
  }
  return deleted;
}

async function listAuthorizedChildDocuments(
  childRunId: string,
  auth: ListRunDocumentsOptions['auth'],
  rootState: any,
  childRuns: RunDocumentChildRef[],
): Promise<RunDocumentList | null> {
  const childState = await loadRunState(childRunId, { hydrateLargeOutputs: false }).catch(() => null);
  if (!childState) return null;
  if (auth && !canAccessRunState(auth, childState)) return null;
  const ref = childRuns.find((item) => item.runId === childRunId);
  const sourceLabel = ref?.configFile || childState.configFile || childRunId;
  return listSingleRunDocuments(childRunId, sourceLabel, {
    parentRunId: childState.parentRunId || rootState.runId,
    rootRunId: childState.rootRunId || rootState.runId,
  });
}

async function listSingleRunDocuments(
  runId: string,
  sourceLabel: string,
  source?: { parentRunId?: string | null; rootRunId?: string | null },
): Promise<RunDocumentList | null> {
  const dirs = await resolveOutputDirs(runId);
  if (!dirs) return null;
  const { state, aceDir, runsDir } = dirs;
  const aceDirExists = Boolean(aceDir && existsSync(aceDir));
  const runsDirExists = existsSync(runsDir);
  const documentDirectory = runsDirExists ? runsDir : (aceDirExists ? aceDir : null);

  if (!aceDirExists && !runsDirExists) {
    return { files: [], aceDir, documentDirectory, childRuns: getChildRunRefs(state), state };
  }

  const allEntries = await collectOutputEntries([runsDir, aceDir].filter((value): value is string => Boolean(value)));
  const stepMap = await buildStepMap(state);
  const files: RunDocumentFile[] = [];

  for (const { entry, dir } of allEntries) {
    if (!entry.endsWith('.md') && !entry.endsWith('.txt')) continue;
    const fullPath = resolve(dir, entry);
    const fileStat = await stat(fullPath);
    files.push(buildDocumentFile({
      entry,
      fileStat,
      runId,
      state,
      stepMap,
      sourceLabel,
      parentRunId: source?.parentRunId ?? state.parentRunId ?? null,
      rootRunId: source?.rootRunId ?? state.rootRunId ?? state.runId ?? null,
    }));
  }

  files.sort((a, b) => new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime());
  return { files: withDetailCounts(files), aceDir, documentDirectory, childRuns: getChildRunRefs(state), state };
}

function buildDocumentFile(input: {
  entry: string;
  fileStat: { size: number; mtime: Date };
  runId: string;
  state: any;
  stepMap: Record<string, { canonicalStepName: string; agent: string; phaseName: string; role: string }>;
  sourceLabel: string;
  parentRunId: string | null;
  rootRunId: string | null;
}): RunDocumentFile {
  const { entry, fileStat, runId, state, stepMap, sourceLabel, parentRunId, rootRunId } = input;
  const iterRegex = /^(.+)-迭代(\d+)\.md$/;
  const versionRegex = /^(.+)-v(\d+)\.md$/;
  const baseName = entry.replace(/\.(md|txt)$/, '');
  const documentKind = TIMESTAMP_PREFIX_RE.test(baseName) ? 'detail' : 'conclusion';
  const logicalName = documentKind === 'detail' ? baseName.replace(TIMESTAMP_PREFIX_RE, '') : baseName;
  let iteration: number | null = 1;
  let stepName = baseName;
  const iterMatch = entry.match(iterRegex);
  const verMatch = entry.match(versionRegex);
  if (iterMatch) {
    stepName = iterMatch[1];
    iteration = Number.parseInt(iterMatch[2], 10);
  } else if (verMatch) {
    stepName = verMatch[1];
    iteration = Number.parseInt(verMatch[2], 10);
  }

  const resolved = resolveStepMetadata(logicalName, stepMap);
  const info = resolved || { resolvedStepName: stepName, agent: '', phaseName: '', role: '' };
  const groupKey = info.phaseName
    ? `${runId}::${info.phaseName}::${info.resolvedStepName}`
    : `${runId}::${logicalName}`;

  return {
    filename: entry,
    stepName,
    baseName,
    logicalName,
    iteration,
    agent: info.agent,
    phaseName: info.phaseName,
    role: info.role,
    documentKind,
    groupKey,
    groupLabel: info.resolvedStepName || logicalName,
    size: fileStat.size,
    modifiedTime: fileStat.mtime.toISOString(),
    sourceRunId: runId,
    sourceConfigFile: state.configFile,
    sourceLabel,
    parentRunId,
    rootRunId,
  };
}

function filterAndSortDocuments(files: RunDocumentFile[], options: ListRunDocumentsOptions): RunDocumentFile[] {
  const direction = options.sortDirection === 'desc' ? -1 : 1;
  return files
    .filter((file) => !options.groupKey || file.groupKey === options.groupKey)
    .filter((file) => !options.documentKind || file.documentKind === options.documentKind)
    .sort((a, b) => {
      const diff = new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime();
      if (diff !== 0) return diff * direction;
      return a.filename.localeCompare(b.filename, 'zh-CN') * direction;
    });
}

function summarizeDocumentGroups(files: RunDocumentFile[]): RunDocumentFile[] {
  const groups = new Map<string, RunDocumentFile[]>();
  for (const file of files) {
    const list = groups.get(file.groupKey) || [];
    list.push(file);
    groups.set(file.groupKey, list);
  }
  return Array.from(groups.values()).map((groupFiles) => {
    const conclusion = groupFiles.find((file) => file.documentKind === 'conclusion');
    const details = groupFiles.filter((file) => file.documentKind === 'detail');
    const fallback = details.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))[0] || groupFiles[0];
    return { ...(conclusion || fallback), detailCount: details.length };
  });
}

function withDetailCounts(files: RunDocumentFile[]): RunDocumentFile[] {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    if (file.documentKind === 'detail') counts.set(file.groupKey, (counts.get(file.groupKey) || 0) + 1);
  });
  return files.map((file) => ({ ...file, detailCount: counts.get(file.groupKey) || 0 }));
}

async function resolveOutputDirs(runId: string) {
  const state = await loadRunState(runId, { hydrateLargeOutputs: false });
  if (!state) return null;
  let projectRoot = '';
  try {
    const configPath = await resolveWorkflowConfigPath(state.configFile);
    if (configPath) {
      const config = parse(await readFile(configPath, 'utf-8'));
      projectRoot = config?.context?.projectRoot || '';
    }
  } catch {
    // Legacy .ace-outputs path is optional.
  }
  const aceDir = projectRoot ? resolve(process.cwd(), projectRoot, '.ace-outputs', runId) : null;
  const runsDir = resolve(getWorkspaceRunsDir(), runId, 'outputs');
  return { state, projectRoot, aceDir, runsDir };
}

async function collectOutputEntries(dirs: string[]) {
  const seenFiles = new Set<string>();
  const allEntries: { entry: string; dir: string }[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (!seenFiles.has(entry)) {
          seenFiles.add(entry);
          allEntries.push({ entry, dir });
        }
      }
    } catch {
      // Ignore output directories deleted while scanning.
    }
  }
  return allEntries;
}

function getChildRunRefs(state: any): RunDocumentChildRef[] {
  const byId = new Map<string, RunDocumentChildRef>();
  for (const runId of Array.isArray(state?.childRunIds) ? state.childRunIds : []) {
    if (typeof runId === 'string' && runId.trim()) byId.set(runId, { runId });
  }
  for (const ref of Array.isArray(state?.subworkflowRuns) ? state.subworkflowRuns : []) {
    const runId = String(ref?.runId || '').trim();
    if (!runId) continue;
    byId.set(runId, {
      runId,
      configFile: ref?.configFile,
      status: ref?.status,
    });
  }
  return Array.from(byId.values());
}

function normalizeLookupKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
}

function resolveStepMetadata(
  logicalName: string,
  stepMap: Record<string, { canonicalStepName: string; agent: string; phaseName: string; role: string }>,
): { resolvedStepName: string; agent: string; phaseName: string; role: string } | null {
  const direct = stepMap[logicalName] || stepMap[normalizeLookupKey(logicalName)];
  if (direct) return { resolvedStepName: direct.canonicalStepName, agent: direct.agent, phaseName: direct.phaseName, role: direct.role };
  const keys = Object.keys(stepMap).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (logicalName.endsWith(`-${key}`)) {
      const matched = stepMap[key];
      return { resolvedStepName: matched.canonicalStepName, agent: matched.agent, phaseName: matched.phaseName, role: matched.role };
    }
  }
  return null;
}

async function buildStepMap(state: any) {
  const stepMap: Record<string, { canonicalStepName: string; agent: string; phaseName: string; role: string }> = {};
  try {
    const configPath = await resolveWorkflowConfigPath(state.configFile);
    if (!configPath) return stepMap;
    const config = parse(await readFile(configPath, 'utf-8'));
    for (const phase of config?.workflow?.phases || []) {
      for (const step of phase.steps || []) addStepMapEntry(stepMap, phase.name, step);
    }
    for (const stateItem of config?.workflow?.states || []) {
      for (const step of stateItem.steps || []) {
        addStepMapEntry(stepMap, stateItem.name, step);
        const compositeKey = `${stateItem.name}-${step.name}`;
        stepMap[compositeKey] = stepMap[step.name];
        stepMap[normalizeLookupKey(compositeKey)] = stepMap[step.name];
      }
    }
  } catch {
    // Metadata fallback is filename based.
  }
  return stepMap;
}

function addStepMapEntry(
  stepMap: Record<string, { canonicalStepName: string; agent: string; phaseName: string; role: string }>,
  phaseName: string,
  step: any,
) {
  const info = { canonicalStepName: step.name, agent: step.agent || '', phaseName, role: step.role || 'defender' };
  stepMap[step.name] = info;
  stepMap[normalizeLookupKey(step.name)] = info;
}

function safePath(dir: string, file: string): string | null {
  const full = resolve(dir, file.replace(/\.\./g, ''));
  return isPathInside(dir, full) ? full : null;
}

function isPathInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}
