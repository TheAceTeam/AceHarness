import { NextRequest, NextResponse } from 'next/server';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';
import { getWorkspaceRunsDir } from '@/lib/app-paths';
import { getRuntimeWorkflowConfigPath } from '@/lib/runtime-configs';
import { loadRunState, saveRunState, type PersistedRunState } from '@/lib/run-state-persistence';
import {
  applyMergedMasterSpec,
  buildStructuralMergedMasterSpec,
  getSpecRootDir,
  readDeltaSpec,
} from '@/lib/spec-persistence';
import { createEngine } from '@/lib/engines/engine-factory';
import { sha256, buildDeltaDigest, stripCodeFence, createUnifiedDiff } from '@/lib/spec-merge-utils';

export { sha256, buildDeltaDigest, stripCodeFence, createUnifiedDiff } from '@/lib/spec-merge-utils';

const PREVIEW_FILE_NAME = 'merged-spec-preview.md';
const DEFAULT_MERGE_MODEL = 'claude-opus-4-6';

interface WorkflowConfigMeta {
  workflowName?: string;
  projectRoot?: string;
  specRoot?: string;
}

type SpecMergeRequest =
  | { action: 'preview'; runId?: string; configFile?: string }
  | { action: 'apply'; runId?: string; configFile?: string; mergedHash?: string };

function previewFilePath(runId: string): string {
  return resolve(getWorkspaceRunsDir(), runId, PREVIEW_FILE_NAME);
}

async function loadWorkflowConfigMeta(configFile?: string): Promise<WorkflowConfigMeta> {
  if (!configFile) return {};
  try {
    const configPath = await getRuntimeWorkflowConfigPath(configFile);
    const raw = await readFile(configPath, 'utf-8');
    const config = parse(raw) as any;
    return {
      workflowName: typeof config?.workflow?.name === 'string' ? config.workflow.name : undefined,
      projectRoot: typeof config?.context?.projectRoot === 'string' ? config.context.projectRoot : undefined,
      specRoot: typeof config?.specCoding?.specRoot === 'string' ? config.specCoding.specRoot : undefined,
    };
  } catch {
    return {};
  }
}

async function resolveMergeContext(runId: string, configFile?: string) {
  const runState = await loadRunState(runId);
  if (!runState) {
    throw Object.assign(new Error('运行状态不存在'), { statusCode: 404 });
  }
  if (configFile && runState.configFile !== configFile) {
    throw Object.assign(new Error('runId 与 configFile 不匹配'), { statusCode: 400 });
  }
  if (runState.persistMode !== 'repository') {
    throw Object.assign(new Error('当前运行不是 repository 持久化 Spec 模式'), { statusCode: 400 });
  }

  const configMeta = await loadWorkflowConfigMeta(configFile || runState.configFile);
  const workflowName = runState.workflowName || configMeta.workflowName;
  const workingDirectory = runState.workingDirectory || configMeta.projectRoot;
  const specRoot = runState.runSpecCoding?.specRoot || configMeta.specRoot;

  if (!workflowName) {
    throw Object.assign(new Error('缺少 workflowName，无法定位 Delta Spec'), { statusCode: 400 });
  }
  if (!workingDirectory) {
    throw Object.assign(new Error('缺少 workingDirectory，无法定位 Spec 根目录'), { statusCode: 400 });
  }

  const specRootDir = getSpecRootDir(workingDirectory, specRoot);
  return { runState, workflowName, workingDirectory, specRootDir };
}


async function generateAiMergedSpec(input: {
  masterBefore: string;
  requirements: string;
  design: string;
  tasks: string;
  workingDirectory: string;
  runId: string;
  workflowName: string;
}): Promise<{ content: string; summary: string } | null> {
  try {
    const engine = await createEngine();
    if (!engine) return null;

    const prompt = `你是 ACEHarness Spec Coding 的合并助手。请把本次 Delta Spec 合并进 master spec.md。\n\n规则：\n- master spec.md 是基线，必须保留未受影响章节。\n- Delta 的 requirements/design/tasks 是本次变更来源。\n- 只根据给定内容合并，不要臆造未提供事实。\n- 输出必须是完整的合并后 spec.md 正文。\n- 不要输出解释、diff、代码围栏或额外前后缀。\n\n# Master spec.md\n\n${input.masterBefore}\n\n# Delta requirements.md\n\n${input.requirements}\n\n# Delta design.md\n\n${input.design}\n\n# Delta tasks.md\n\n${input.tasks}`;

    const result = await engine.execute({
      agent: 'spec-merge-assistant',
      step: 'merge-delta-spec-to-master',
      prompt,
      systemPrompt: '你负责将 Delta Spec 合并为完整 master spec.md。严格输出合并后的 Markdown 正文，不要包含解释。',
      model: DEFAULT_MERGE_MODEL,
      workingDirectory: input.workingDirectory,
      allowedTools: [],
      timeoutMs: 120_000,
      runId: input.runId,
    });

    if (!result.success || !result.output.trim()) return null;
    return {
      content: stripCodeFence(result.output),
      summary: `AI 已根据 Delta Spec 生成合并候选（engine: ${engine.getName()}）。`,
    };
  } catch (error) {
    console.warn('[spec-merge] AI merge failed, falling back to structural merge:', error);
    return null;
  }
}


async function markMergeFailed(runState: PersistedRunState, message: string): Promise<void> {
  runState.deltaMergeState = {
    ...(runState.deltaMergeState || {}),
    status: 'failed',
    error: message,
  };
  await saveRunState(runState);
}

async function previewMerge(runId: string, configFile?: string) {
  const { runState, workflowName, workingDirectory, specRootDir } = await resolveMergeContext(runId, configFile);
  const now = new Date().toISOString();
  runState.deltaMergeState = {
    ...(runState.deltaMergeState || {}),
    status: 'previewing',
    requestedAt: runState.deltaMergeState?.requestedAt || now,
    error: undefined,
  };
  await saveRunState(runState);

  try {
    const masterPath = resolve(specRootDir, 'spec.md');
    const masterBefore = await readFile(masterPath, 'utf-8').catch(() => '');
    const deltaSpec = await readDeltaSpec(specRootDir, workflowName, runId);
    if (!deltaSpec) {
      throw Object.assign(new Error('Delta Spec 不存在或无法读取'), { statusCode: 404 });
    }

    const requirements = deltaSpec.artifacts.requirements || '';
    const design = deltaSpec.artifacts.design || '';
    const tasks = deltaSpec.artifacts.tasks || '';
    const aiMerge = await generateAiMergedSpec({
      masterBefore,
      requirements,
      design,
      tasks,
      workingDirectory,
      runId,
      workflowName,
    });
    const structural = aiMerge ? null : await buildStructuralMergedMasterSpec(specRootDir, workflowName, runId);
    const mergedContent = aiMerge?.content || structural;
    if (!mergedContent) {
      throw Object.assign(new Error('没有可合并的 Delta Spec 内容'), { statusCode: 400 });
    }

    const deltaDigest = buildDeltaDigest(requirements, design, tasks);
    const previewPath = previewFilePath(runId);
    await mkdir(resolve(getWorkspaceRunsDir(), runId), { recursive: true });
    await writeFile(previewPath, mergedContent, 'utf-8');

    const mergeState = {
      status: 'awaiting-confirmation' as const,
      requestedAt: runState.deltaMergeState?.requestedAt || now,
      previewedAt: new Date().toISOString(),
      baseHash: sha256(masterBefore),
      deltaHash: sha256(deltaDigest),
      mergedHash: sha256(mergedContent),
      diff: createUnifiedDiff(masterBefore, mergedContent),
      aiSummary: aiMerge?.summary || 'AI 合并不可用，已使用结构化合并策略生成候选。',
      previewPath,
      error: undefined,
    };
    runState.deltaMergeState = mergeState;
    runState.deltaSpecMerged = false;
    await saveRunState(runState);

    return { masterBefore, mergedContent, diff: mergeState.diff, aiSummary: mergeState.aiSummary, mergeState };
  } catch (error: any) {
    await markMergeFailed(runState, error.message || String(error));
    throw error;
  }
}

async function applyMerge(runId: string, configFile: string | undefined, mergedHash: string | undefined) {
  if (!mergedHash) {
    throw Object.assign(new Error('缺少 mergedHash'), { statusCode: 400 });
  }

  const { runState, workflowName, specRootDir } = await resolveMergeContext(runId, configFile);
  const mergeState = runState.deltaMergeState;
  if (!mergeState || mergeState.status !== 'awaiting-confirmation') {
    throw Object.assign(new Error('当前没有等待确认的合并预览'), { statusCode: 400 });
  }
  if (mergeState.mergedHash !== mergedHash) {
    throw Object.assign(new Error('合并候选已变化，请重新生成预览'), { statusCode: 409 });
  }
  if (!mergeState.previewPath || !existsSync(mergeState.previewPath)) {
    throw Object.assign(new Error('合并预览文件不存在，请重新生成预览'), { statusCode: 409 });
  }

  const masterBefore = await readFile(resolve(specRootDir, 'spec.md'), 'utf-8').catch(() => '');
  if (mergeState.baseHash && sha256(masterBefore) !== mergeState.baseHash) {
    throw Object.assign(new Error('master spec.md 已被修改，请重新生成预览后再合入'), { statusCode: 409 });
  }

  const mergedContent = await readFile(mergeState.previewPath, 'utf-8');
  if (sha256(mergedContent) !== mergedHash) {
    throw Object.assign(new Error('合并预览内容校验失败，请重新生成预览'), { statusCode: 409 });
  }

  const now = new Date().toISOString();
  runState.deltaMergeState = {
    ...mergeState,
    status: 'applying',
    error: undefined,
  };
  await saveRunState(runState);

  try {
    const revisionSummary = `合入 Delta Spec：${workflowName}-${runId}${mergeState.aiSummary ? `；${mergeState.aiSummary}` : ''}`;
    await applyMergedMasterSpec(specRootDir, mergedContent, revisionSummary, 'workspace-spec-merge');
    runState.deltaMergeState = {
      ...mergeState,
      status: 'merged',
      appliedAt: now,
      appliedBy: 'workspace-spec-merge',
      error: undefined,
    };
    runState.deltaSpecMerged = true;
    await saveRunState(runState);
    return { success: true, mergeState: runState.deltaMergeState };
  } catch (error: any) {
    await markMergeFailed(runState, error.message || String(error));
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SpecMergeRequest;
    if (!body?.action) {
      return NextResponse.json({ error: '缺少 action 参数' }, { status: 400 });
    }
    if (!body.runId) {
      return NextResponse.json({ error: '缺少 runId 参数' }, { status: 400 });
    }

    if (body.action === 'preview') {
      return NextResponse.json(await previewMerge(body.runId, body.configFile));
    }
    if (body.action === 'apply') {
      return NextResponse.json(await applyMerge(body.runId, body.configFile, body.mergedHash));
    }

    return NextResponse.json({ error: '不支持的 action' }, { status: 400 });
  } catch (error: any) {
    const status = typeof error?.statusCode === 'number' ? error.statusCode : 500;
    return NextResponse.json(
      { error: 'Spec 合入操作失败', message: error.message || String(error) },
      { status }
    );
  }
}
