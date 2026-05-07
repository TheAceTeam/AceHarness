import { NextRequest, NextResponse } from 'next/server';
import { loadRunState } from '@/lib/run-state-persistence';
import { readdir, stat, readFile, rename, unlink } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { parse } from 'yaml';
import { getWorkspaceRunsDir } from '@/lib/app-paths';
import { resolveWorkflowConfigPath } from '@/lib/workflow-config-path';

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

function safePath(dir: string, file: string): string | null {
  const safe = file.replace(/\.\./g, '');
  const full = resolve(dir, safe);
  return full.startsWith(dir) ? full : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const runId = (await params).id;
  const filePath = request.nextUrl.searchParams.get('file');

  try {
    const dirs = await resolveOutputDirs(runId);
    if (!dirs) return NextResponse.json({ error: '未找到运行记录或未配置项目根目录' }, { status: 404 });
    const { state, aceDir, runsDir } = dirs;

    const aceDirExists = Boolean(aceDir && existsSync(aceDir));
    const runsDirExists = existsSync(runsDir);

    const documentDirectory = runsDirExists ? runsDir : (aceDirExists ? aceDir : null);

    if (!aceDirExists && !runsDirExists) {
      return NextResponse.json({ error: '文档目录不存在', files: [], documentDirectory }, { status: 200 });
    }

    // If requesting a specific file's content — check runsDir first, then aceDir
    if (filePath) {
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

    // List all documents from both directories, runsDir takes priority for dedup
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

    // Build step→phase/agent lookup from config (once, outside loop)
    const stepMap: Record<string, { agent: string; phaseName: string; role: string }> = {};
    try {
      const configPath = await resolveWorkflowConfigPath(state.configFile);
      if (configPath) {
        const configContent = await readFile(configPath, 'utf-8');
        const config = parse(configContent);
        if (config?.workflow?.phases) {
          for (const phase of config.workflow.phases) {
            for (const step of phase.steps || []) {
              const safeStep = step.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
              const info = { agent: step.agent || '', phaseName: phase.name, role: step.role || 'defender' };
              stepMap[step.name] = info;
              stepMap[safeStep] = info;
            }
          }
        }
        // State machine mode: states instead of phases
        if (config?.workflow?.states) {
          for (const state of config.workflow.states) {
            for (const step of state.steps || []) {
              const safeStep = step.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
              const info = { agent: step.agent || '', phaseName: state.name, role: step.role || 'defender' };
              stepMap[step.name] = info;
              stepMap[safeStep] = info;
              // Also map "stateName-stepName" format used in output filenames
              const compositeKey = `${state.name}-${step.name}`;
              const safeComposite = compositeKey.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
              stepMap[compositeKey] = info;
              stepMap[safeComposite] = info;
            }
          }
        }
      }
    } catch { /* ignore */ }

    const files = [];
    for (const { entry, dir } of allEntries) {
      if (!entry.endsWith('.md') && !entry.endsWith('.txt')) continue;
      const fullPath = resolve(dir, entry);
      const fileStat = await stat(fullPath);

      let baseName = entry.replace(/\.(md|txt)$/, '');
      let iteration: number | null = null;
      let stepName = baseName;

      // Parse iteration from filename
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

      const info = stepMap[stepName] || { agent: '', phaseName: '', role: '' };

      files.push({
        filename: entry,
        stepName,
        baseName,
        iteration,
        agent: info.agent,
        phaseName: info.phaseName,
        role: info.role,
        size: fileStat.size,
        modifiedTime: fileStat.mtime.toISOString(),
      });
    }

    // Sort: by modifiedTime
    files.sort((a, b) => new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime());

    return NextResponse.json({ files, aceDir, documentDirectory });
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
