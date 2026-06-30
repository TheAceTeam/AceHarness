import { NextRequest, NextResponse } from 'next/server';
import { loadRunState } from '@/lib/run/state-persistence';
import { readdir, stat, readFile, rename, unlink } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { parse } from 'yaml';
import { getWorkspaceRunsDir } from '@/lib/core/app-paths';
import { resolveWorkflowConfigPath } from '@/lib/workflow/config-path';

const TIMESTAMP_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/;

/** Resolve the .ace-outputs dir and runs/outputs dir for a given runId */
async function resolveOutputDirs(runId: string) {
  const state = await loadRunState(runId);
  if (!state) return null;

  let projectRoot = '';
  try {
    const configPath = await resolveWorkflowConfigPath(state.configFile);
    if (configPath) {
      const config = parse(await readFile(configPath, 'utf-8'));
      projectRoot = config?.context?.projectRoot || '';
    }
  } catch { /* ignore */ }

  const aceDir = projectRoot
    ? resolve(process.cwd(), projectRoot, '.ace-outputs', runId)
    : null;
  const runsDir = resolve(getWorkspaceRunsDir(), runId, 'outputs');
  return { state, projectRoot, aceDir, runsDir };
}

type RunDocumentFile = {
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
  size: number;
  modifiedTime: string;
  sourceRunId: string;
  sourceConfigFile?: string;
  sourceLabel?: string;
  parentRunId?: string | null;
  rootRunId?: string | null;
};

function safePath(dir: string, file: string): string | null {
  const safe = file.replace(/\.\./g, '');
  const full = resolve(dir, safe);
  return full.startsWith(dir) ? full : null;
}

function normalizeLookupKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
}

function resolveStepMetadata(
  logicalName: string,
  stepMap: Record<string, { canonicalStepName: string; agent: string; phaseName: string; role: string }>
): { resolvedStepName: string; agent: string; phaseName: string; role: string } | null {
  const direct = stepMap[logicalName] || stepMap[normalizeLookupKey(logicalName)];
  if (direct) {
    return { resolvedStepName: direct.canonicalStepName, agent: direct.agent, phaseName: direct.phaseName, role: direct.role };
  }

  const keys = Object.keys(stepMap).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (logicalName.endsWith(`-${key}`)) {
      const matched = stepMap[key];
      return {
        resolvedStepName: matched.canonicalStepName,
        agent: matched.agent,
        phaseName: matched.phaseName,
        role: matched.role,
      };
    }
  }

  return null;
}

async function buildStepMap(state: any) {
  const stepMap: Record<string, { canonicalStepName: string; agent: string; phaseName: string; role: string }> = {};
  try {
    const configPath = await resolveWorkflowConfigPath(state.configFile);
    if (configPath) {
      const configContent = await readFile(configPath, 'utf-8');
      const config = parse(configContent);
      if (config?.workflow?.phases) {
        for (const phase of config.workflow.phases) {
          for (const step of phase.steps || []) {
            const safeStep = step.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
            const info = { canonicalStepName: step.name, agent: step.agent || '', phaseName: phase.name, role: step.role || 'defender' };
            stepMap[step.name] = info;
            stepMap[safeStep] = info;
          }
        }
      }
      if (config?.workflow?.states) {
        for (const stateItem of config.workflow.states) {
          for (const step of stateItem.steps || []) {
            const safeStep = step.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
            const info = { canonicalStepName: step.name, agent: step.agent || '', phaseName: stateItem.name, role: step.role || 'defender' };
            stepMap[step.name] = info;
            stepMap[safeStep] = info;
            const compositeKey = `${stateItem.name}-${step.name}`;
            const safeComposite = compositeKey.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
            stepMap[compositeKey] = info;
            stepMap[safeComposite] = info;
          }
        }
      }
    }
  } catch { /* ignore */ }
  return stepMap;
}

async function listRunDocuments(runId: string): Promise<{
  files: RunDocumentFile[];
  aceDir: string | null;
  documentDirectory: string | null;
  state: any;
} | null> {
  const dirs = await resolveOutputDirs(runId);
  if (!dirs) return null;
  const { state, aceDir, runsDir } = dirs;

  const aceDirExists = Boolean(aceDir && existsSync(aceDir));
  const runsDirExists = existsSync(runsDir);
  const documentDirectory = runsDirExists ? runsDir : (aceDirExists ? aceDir : null);

  if (!aceDirExists && !runsDirExists) {
    return { files: [], aceDir, documentDirectory, state };
  }

  const seenFiles = new Set<string>();
  const allEntries: { entry: string; dir: string }[] = [];

  for (const dir of [runsDir, aceDir].filter((value): value is string => Boolean(value))) {
    if (!existsSync(dir)) continue;
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (!seenFiles.has(entry)) {
          seenFiles.add(entry);
          allEntries.push({ entry, dir });
        }
      }
    } catch { /* ignore */ }
  }

  const iterRegex = /^(.+)-迭代(\d+)\.md$/;
  const versionRegex = /^(.+)-v(\d+)\.md$/;
  const stepMap = await buildStepMap(state);
  const files: RunDocumentFile[] = [];
  const sourceLabel = state.parentRunId
    ? `${state.parentStateName || '子工作流'} / ${state.parentStepName || state.configFile}`
    : '父工作流';

  for (const { entry, dir } of allEntries) {
    if (!entry.endsWith('.md') && !entry.endsWith('.txt')) continue;
    const fullPath = resolve(dir, entry);
    const fileStat = await stat(fullPath);

    const baseName = entry.replace(/\.(md|txt)$/, '');
    const documentKind = TIMESTAMP_PREFIX_RE.test(baseName) ? 'detail' : 'conclusion';
    const logicalName = documentKind === 'detail' ? baseName.replace(TIMESTAMP_PREFIX_RE, '') : baseName;
    let iteration: number | null = null;
    let stepName = baseName;

    const iterMatch = entry.match(iterRegex);
    const verMatch = entry.match(versionRegex);
    if (iterMatch) {
      stepName = iterMatch[1];
      iteration = parseInt(iterMatch[2], 10);
    } else if (verMatch) {
      stepName = verMatch[1];
      iteration = parseInt(verMatch[2], 10);
    } else {
      iteration = 1;
    }

    const resolved = resolveStepMetadata(logicalName, stepMap);
    const info = resolved || { resolvedStepName: stepName, agent: '', phaseName: '', role: '' };
    const groupKey = info.phaseName
      ? `${runId}::${info.phaseName}::${info.resolvedStepName}`
      : `${runId}::${logicalName}`;

    files.push({
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
      parentRunId: state.parentRunId || null,
      rootRunId: state.rootRunId || state.runId || null,
    });
  }

  files.sort((a, b) => new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime());
  return { files, aceDir, documentDirectory, state };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const runId = (await params).id;
  const filePath = request.nextUrl.searchParams.get('file');
  const includeChildren = request.nextUrl.searchParams.get('includeChildren') === '1';
  const sourceRunId = request.nextUrl.searchParams.get('sourceRunId') || runId;

  try {
    // If requesting a specific file's content — check runsDir first, then aceDir
    if (filePath) {
      const dirs = await resolveOutputDirs(sourceRunId);
      if (!dirs) return NextResponse.json({ error: '未找到运行记录或未配置项目根目录' }, { status: 404 });
      const { aceDir, runsDir } = dirs;
      const safe = filePath.replace(/\.\./g, '');
      for (const dir of [runsDir, aceDir].filter((value): value is string => Boolean(value))) {
        if (!existsSync(dir)) continue;
        const fullPath = resolve(dir, safe);
        if (!fullPath.startsWith(dir)) continue;
        try {
          const content = await readFile(fullPath, 'utf-8');
          return NextResponse.json({ file: filePath, content });
        } catch { /* try next dir */ }
      }
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    const rootDocs = await listRunDocuments(runId);
    if (!rootDocs) return NextResponse.json({ error: '未找到运行记录或未配置项目根目录' }, { status: 404 });
    let files = [...rootDocs.files];
    const childRuns: Array<{ runId: string; configFile?: string; status?: string }> = [];
    if (includeChildren) {
      const seenRunIds = new Set<string>([runId]);
      const queue = Array.isArray(rootDocs.state?.subworkflowRuns) ? [...rootDocs.state.subworkflowRuns] : [];
      while (queue.length > 0) {
        const child = queue.shift();
        const childRunId = String(child?.runId || '').trim();
        if (!childRunId || seenRunIds.has(childRunId)) continue;
        seenRunIds.add(childRunId);
        const childDocs = await listRunDocuments(childRunId).catch(() => null);
        if (!childDocs) continue;
        files.push(...childDocs.files);
        childRuns.push({ runId: childRunId, configFile: childDocs.state?.configFile || child?.configFile, status: childDocs.state?.status || child?.status });
        if (Array.isArray(childDocs.state?.subworkflowRuns)) {
          queue.push(...childDocs.state.subworkflowRuns);
        }
      }
    }
    files.sort((a, b) => new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime());

    return NextResponse.json({ files, aceDir: rootDocs.aceDir, documentDirectory: rootDocs.documentDirectory, childRuns });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取文档失败', message: error.message },
      { status: 500 }
    );
  }
}

/** Rename a document */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const runId = (await params).id;
  try {
    const { file, newName } = await request.json();
    if (!file || !newName) return NextResponse.json({ error: '缺少参数' }, { status: 400 });

    const dirs = await resolveOutputDirs(runId);
    if (!dirs) return NextResponse.json({ error: '未找到运行记录' }, { status: 404 });

    // Ensure newName has extension
    const ext = file.match(/\.(md|txt)$/)?.[0] || '.md';
    const finalName = newName.endsWith(ext) ? newName : newName + ext;

    // Rename in both directories
    let renamed = false;
    for (const dir of [dirs.runsDir, dirs.aceDir].filter((value): value is string => Boolean(value))) {
      const oldP = safePath(dir, file);
      const newP = safePath(dir, finalName);
      if (oldP && newP && existsSync(oldP)) {
        await rename(oldP, newP).catch(() => {});
        renamed = true;
      }
    }
    if (!renamed) return NextResponse.json({ error: '文件不存在' }, { status: 404 });

    return NextResponse.json({ ok: true, newFilename: finalName });
  } catch (error: any) {
    return NextResponse.json({ error: '重命名失败', message: error.message }, { status: 500 });
  }
}

/** Delete document(s) */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const runId = (await params).id;
  try {
    const { files } = await request.json() as { files: string[] };
    if (!files?.length) return NextResponse.json({ error: '缺少参数' }, { status: 400 });

    const dirs = await resolveOutputDirs(runId);
    if (!dirs) return NextResponse.json({ error: '未找到运行记录' }, { status: 404 });

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

    return NextResponse.json({ ok: true, deleted });
  } catch (error: any) {
    return NextResponse.json({ error: '删除失败', message: error.message }, { status: 500 });
  }
}
