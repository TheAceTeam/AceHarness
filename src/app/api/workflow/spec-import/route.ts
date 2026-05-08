import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { requireAuth } from '@/lib/auth-middleware';
import { getRuntimeWorkflowConfigPath } from '@/lib/runtime-configs';
import { loadRunState, saveRunState } from '@/lib/run-state-persistence';
import { workflowRegistry, isStateMachineManagerLike } from '@/lib/workflow-registry';
import { compileStepTaskBindings } from '@/lib/spec-task-binding';
import { getSpecRootDir, readDeltaSpec, writeDeltaSpec } from '@/lib/spec-persistence';
import { importWorkspaceArtifactsIntoRunSpecCoding } from '@/lib/runtime-spec-import';
import type { SpecCodingDocument } from '@/lib/schemas';

type SpecImportRequest = {
  action?: 'import-delta';
  runId?: string;
  configFile?: string;
  summary?: string;
};

async function loadWorkflowConfig(configFile: string): Promise<any> {
  const configPath = await getRuntimeWorkflowConfigPath(configFile);
  const raw = await readFile(configPath, 'utf-8');
  return parse(raw);
}

function buildSpecCodingPayload(specCoding: SpecCodingDocument) {
  return {
    specCodingSummary: {
      id: specCoding.id,
      version: specCoding.version,
      status: specCoding.status,
      source: 'run' as const,
      summary: specCoding.summary,
      phaseCount: specCoding.phases.length,
      taskCount: specCoding.tasks.length,
      assignmentCount: specCoding.assignments.length,
      checkpointCount: specCoding.checkpoints.length,
      revisionCount: specCoding.revisions.length,
      progress: specCoding.progress,
      latestRevision: specCoding.revisions.at(-1) || null,
    },
    specCodingDetails: {
      phases: specCoding.phases,
      tasks: specCoding.tasks,
      assignments: specCoding.assignments,
      checkpoints: specCoding.checkpoints,
      revisions: specCoding.revisions,
      artifacts: specCoding.artifacts,
    },
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await request.json()) as SpecImportRequest;
    if ((body.action || 'import-delta') !== 'import-delta') {
      return NextResponse.json({ error: '不支持的 spec import action' }, { status: 400 });
    }
    if (!body.runId) {
      return NextResponse.json({ error: '缺少 runId 参数' }, { status: 400 });
    }

    const activeManager = await workflowRegistry.getManagerByRunId(body.runId).catch(() => null);
    if (activeManager && isStateMachineManagerLike(activeManager)) {
      const imported = await (activeManager as any).importWorkspaceDeltaSpecRevision?.({
        summary: body.summary,
        createdBy: auth.id,
      });
      if (imported) {
        const status = activeManager.getStatus();
        return NextResponse.json({
          success: true,
          source: 'manager',
          bindingValidation: status.bindingValidation,
          deltaMergeState: status.deltaMergeState,
          deltaSpecMerged: status.deltaSpecMerged,
          ...buildSpecCodingPayload(imported),
        });
      }
    }

    const runState = await loadRunState(body.runId);
    if (!runState) {
      return NextResponse.json({ error: '运行状态不存在' }, { status: 404 });
    }
    if (body.configFile && runState.configFile !== body.configFile) {
      return NextResponse.json({ error: 'runId 与 configFile 不匹配' }, { status: 400 });
    }
    if (runState.persistMode !== 'repository' || runState.runSpecCoding?.persistMode !== 'repository') {
      return NextResponse.json({ error: '当前 run 不是持久化 Spec 模式' }, { status: 400 });
    }
    if (!runState.runSpecCoding) {
      return NextResponse.json({ error: '当前 run 没有运行态 SpecCoding 快照' }, { status: 400 });
    }

    const config = await loadWorkflowConfig(runState.configFile);
    const workflowName = runState.workflowName || config?.workflow?.name;
    const workingDirectory = runState.workingDirectory || config?.context?.projectRoot;
    if (!workflowName || !workingDirectory) {
      return NextResponse.json({ error: '缺少 workflowName 或 workingDirectory，无法定位 delta spec' }, { status: 400 });
    }

    const specRootDir = runState.specRootDir || getSpecRootDir(workingDirectory, runState.runSpecCoding.specRoot || config?.specCoding?.specRoot);
    const deltaSpec = await readDeltaSpec(specRootDir, workflowName, body.runId);
    if (!deltaSpec) {
      return NextResponse.json({ error: 'Delta spec 不存在，无法导入 workspace 修改' }, { status: 404 });
    }

    const nextSpecCoding = importWorkspaceArtifactsIntoRunSpecCoding({
      current: runState.runSpecCoding,
      artifacts: deltaSpec.artifacts,
      summary: body.summary || '用户从 workspace delta spec 导入修订',
      createdBy: auth.id,
    });

    const bindingCompilation = compileStepTaskBindings(config, nextSpecCoding);
    if (!bindingCompilation.validation.ok) {
      return NextResponse.json(
        {
          error: '导入后的 Spec task 与 workflow step 绑定不一致',
          bindingValidation: bindingCompilation.validation,
        },
        { status: 409 }
      );
    }

    runState.runSpecCoding = nextSpecCoding;
    runState.stepTaskBindingsSnapshot = bindingCompilation.validation.bindings as any;
    runState.bindingValidation = bindingCompilation.validation as any;
    runState.deltaSpecMerged = false;
    runState.deltaMergeState = {
      ...(runState.deltaMergeState || {}),
      status: 'available',
      requestedAt: runState.deltaMergeState?.requestedAt || new Date().toISOString(),
      error: undefined,
    };
    await saveRunState(runState);
    await writeDeltaSpec(specRootDir, workflowName, body.runId, nextSpecCoding);

    return NextResponse.json({
      success: true,
      source: 'run-state',
      bindingValidation: runState.bindingValidation,
      deltaMergeState: runState.deltaMergeState,
      deltaSpecMerged: runState.deltaSpecMerged,
      ...buildSpecCodingPayload(nextSpecCoding),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: '导入 workspace delta spec 失败',
        message: error.message || String(error),
        bindingValidation: error.bindingValidation,
      },
      { status: error.bindingValidation ? 409 : 500 }
    );
  }
}
