import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { workflowRegistry } from '@/lib/workflow-registry';
import { loadRunState } from '@/lib/run-state-persistence';
import { loadLatestCreationSessionByFilename } from '@/lib/spec-coding-store';
import {
  findRelevantWorkflowExperiences,
  listWorkflowExperiences,
  loadWorkflowFinalReview,
} from '@/lib/workflow-experience-store';
import { getRuntimeWorkflowConfigPath } from '@/lib/runtime-configs';
import type { SpecCodingDocument } from '@/lib/schemas';
import {
  listMemoryEntries,
  type MemoryEntry,
} from '@/lib/workflow-memory-store';

type WorkflowStructureMapping = {
  mode: 'phase-based' | 'state-machine' | 'unknown';
  yamlSourceOfTruth: string[];
  derivedIntoSpecCoding: string[];
  runtimeSpecCodingSourceOfTruth: string[];
  counts: {
    yamlPhases: number;
    yamlStates: number;
    yamlSteps: number;
    yamlCheckpoints: number;
    specCodingPhases: number;
    specCodingTasks: number;
    specCodingAssignments: number;
    specCodingCheckpoints: number;
  };
};

async function buildWorkflowStructureMapping(configFile: string, specCoding: SpecCodingDocument): Promise<WorkflowStructureMapping | null> {
  try {
    const configPath = await getRuntimeWorkflowConfigPath(configFile);
    const raw = await readFile(configPath, 'utf-8');
    const config = parse(raw) as any;
    const workflow = config?.workflow || {};
    const phases = Array.isArray(workflow.phases) ? workflow.phases : [];
    const states = Array.isArray(workflow.states) ? workflow.states : [];
    const yamlSteps = (phases.length > 0 ? phases : states)
      .reduce((sum: number, item: any) => sum + (Array.isArray(item?.steps) ? item.steps.length : 0), 0);
    const yamlCheckpoints = phases.reduce((sum: number, phase: any) => sum + (phase?.checkpoint ? 1 : 0), 0);

    return {
      mode: workflow.mode === 'state-machine'
        ? 'state-machine'
        : phases.length > 0
          ? 'phase-based'
          : 'unknown',
      yamlSourceOfTruth: [
        'workflow.name / workflow.description',
        phases.length > 0 ? 'workflow.phases[].name / steps[] / checkpoint' : '',
        states.length > 0 ? 'workflow.states[].name / description / steps[] / transitions[]' : '',
        'roles[]',
        'context.projectRoot / workspaceMode / requirements',
        'workflow.supervisor',
      ].filter(Boolean),
      derivedIntoSpecCoding: [
        'specCoding.workflowName <- workflow.name',
        'specCoding.summary <- workflow.description / requirements',
        phases.length > 0
          ? 'specCoding.phases <- workflow.phases[].name + steps[].task'
          : 'specCoding.phases <- workflow.states[].name + description / steps[].task',
        'specCoding.assignments <- steps[].agent 聚合',
        'specCoding.checkpoints <- workflow.phases[].checkpoint',
      ],
      runtimeSpecCodingSourceOfTruth: [
        'specCoding.progress',
        'specCoding.tasks <- artifacts.tasks 的结构化状态投影',
        'specCoding.revisions',
        'run snapshot status',
        'Supervisor 非状态修订摘要',
      ],
      counts: {
        yamlPhases: phases.length,
        yamlStates: states.length,
        yamlSteps,
        yamlCheckpoints,
        specCodingPhases: specCoding.phases.length,
        specCodingTasks: specCoding.tasks.length,
        specCodingAssignments: specCoding.assignments.length,
        specCodingCheckpoints: specCoding.checkpoints.length,
      },
    };
  } catch {
    return null;
  }
}

async function loadWorkflowRuntimeMeta(configFile: string): Promise<{
  workflowName?: string;
  projectRoot?: string;
  requirements?: string;
}> {
  try {
    const configPath = await getRuntimeWorkflowConfigPath(configFile);
    const raw = await readFile(configPath, 'utf-8');
    const config = parse(raw) as any;
    return {
      workflowName: typeof config?.workflow?.name === 'string' ? config.workflow.name : undefined,
      projectRoot: typeof config?.context?.projectRoot === 'string' ? config.context.projectRoot : undefined,
      requirements: typeof config?.context?.requirements === 'string' ? config.context.requirements : undefined,
    };
  } catch {
    return {};
  }
}

function compactMemory(entries: MemoryEntry[]) {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    content: entry.content,
    source: entry.source,
    createdAt: entry.createdAt,
    tags: entry.tags || [],
  }));
}

function buildSpecCodingPayload(specCoding: SpecCodingDocument, source: 'run' | 'creation') {
  return {
    specCodingSummary: {
      id: specCoding.id,
      version: specCoding.version,
      status: specCoding.status,
      source,
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

async function withCreationSession(status: any, requestedConfigFile?: string | null) {
  const configFile = requestedConfigFile || status?.currentConfigFile;
  if (!configFile) return status;

  const creationSession = await loadLatestCreationSessionByFilename(configFile);
  if (!creationSession) return status;

  const finalReview = status?.runId ? await loadWorkflowFinalReview(status.runId).catch(() => null) : null;
  const runtimeMeta = await loadWorkflowRuntimeMeta(configFile);
  const historicalExperiences = configFile
    ? await listWorkflowExperiences({ configFile, limit: 5 }).catch(() => [])
    : [];
  const recalledExperiences = await findRelevantWorkflowExperiences({
    configFile,
    workflowName: runtimeMeta.workflowName,
    requirements: runtimeMeta.requirements,
    projectRoot: status?.workingDirectory || runtimeMeta.projectRoot,
    excludeRunId: status?.runId || undefined,
    limit: 5,
  }).catch(() => []);
  const runSpecCoding = status?.runSpecCoding || null;
  const displaySpecCoding = runSpecCoding || creationSession.specCoding;
  const specCodingPayload = displaySpecCoding
    ? buildSpecCodingPayload(displaySpecCoding, runSpecCoding ? 'run' : 'creation')
    : {};
  const sourceOfTruth = displaySpecCoding
    ? await buildWorkflowStructureMapping(configFile, displaySpecCoding)
    : null;
  const supervisorName = status?.supervisorAgent || finalReview?.supervisorAgent || 'default-supervisor';
  const workflowMemories = await listMemoryEntries({
    scope: 'workflow',
    key: configFile,
    limit: 4,
  }).catch(() => []);
  const projectMemories = await listMemoryEntries({
    scope: 'project',
    key: status?.workingDirectory || runtimeMeta.projectRoot || configFile,
    limit: 4,
  }).catch(() => []);
  const roleMemories = await listMemoryEntries({
    scope: 'role',
    key: supervisorName,
    limit: 4,
  }).catch(() => []);
  const chatMemories = status?.supervisorSessionId
    ? await listMemoryEntries({
        scope: 'chat',
        key: `${supervisorName}:${status.supervisorSessionId}`,
        limit: 4,
      }).catch(() => [])
    : [];

  return {
    ...status,
    creationSession: {
      id: creationSession.id,
      workflowName: creationSession.workflowName,
      filename: creationSession.filename,
      status: creationSession.status,
      updatedAt: creationSession.updatedAt,
    },
    ...specCodingPayload,
    sourceOfTruth,
    finalReview,
    qualityChecks: status?.qualityChecks || [],
    memoryLayers: {
      schema: {
        scopes: ['role', 'project', 'workflow', 'chat'],
        rules: [
          'role: Agent 长期记忆，可跨 run 复用',
          'project: 当前工程共享经验，不跨项目扩散',
          'workflow: 当前配置/运行相关设计与复盘',
          'chat: 单次会话补充记忆，只在本会话复用',
        ],
      },
      runtime: {
        specCodingSummary: runSpecCoding
          ? {
              id: runSpecCoding.id,
              version: runSpecCoding.version,
              summary: runSpecCoding.summary,
              progressSummary: runSpecCoding.progress?.summary,
            }
          : null,
        qualityChecks: status?.qualityChecks || [],
      },
      review: finalReview
        ? {
            summary: finalReview.summary,
            nextFocus: finalReview.nextFocus,
            experience: finalReview.experience,
            generatedAt: finalReview.generatedAt,
          }
        : null,
      history: historicalExperiences
        .filter((item) => item.runId !== status?.runId)
        .map((item) => ({
          runId: item.runId,
          status: item.status,
          summary: item.summary,
          nextFocus: item.nextFocus,
          experience: item.experience,
          generatedAt: item.generatedAt,
        })),
      role: {
        agent: supervisorName,
        memories: compactMemory(roleMemories),
      },
      project: {
        key: status?.workingDirectory || runtimeMeta.projectRoot || configFile,
        memories: compactMemory(projectMemories),
      },
      workflow: {
        key: configFile,
        memories: compactMemory(workflowMemories),
      },
      chat: {
        sessionId: status?.supervisorSessionId || null,
        memories: compactMemory(chatMemories),
      },
      recalledExperiences: recalledExperiences.map((item) => ({
        runId: item.runId,
        status: item.status,
        summary: item.summary,
        nextFocus: item.nextFocus,
        experience: item.experience,
        generatedAt: item.generatedAt,
      })),
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const configFile = request.nextUrl.searchParams.get('configFile');
    const requestedRunId = request.nextUrl.searchParams.get('runId');

    if (configFile) {
      const runningManager = workflowRegistry.getRunningManager(configFile);
      const runningStatus = runningManager?.getStatus?.();
      if (runningStatus && (!requestedRunId || runningStatus.runId === requestedRunId)) {
        return NextResponse.json(await withCreationSession(runningStatus, configFile));
      }

      if (requestedRunId) {
        const runState = await loadRunState(requestedRunId);
        if (runState && runState.configFile === configFile) {
          const pendingHumanQuestion = runState.pendingHumanQuestionId
            ? runState.humanQuestions?.find((question) => question.id === runState.pendingHumanQuestionId && question.status === 'unanswered') || null
            : runState.pendingCheckpoint?.humanQuestion || null;
          const restoredStatus = {
            ...runState,
            runId: runState.runId,
            currentConfigFile: runState.configFile,
            currentPhase: runState.currentPhase || runState.currentState || null,
            logs: [],
            iterationStates: runState.iterationStates || {},
            agents: runState.agents || [],
            stepLogs: runState.stepLogs || [],
            completedSteps: runState.completedSteps || [],
            failedSteps: runState.failedSteps || [],
            workingDirectory: runState.workingDirectory || null,
            pendingHumanQuestion,
          };
          return NextResponse.json(await withCreationSession(restoredStatus, configFile));
        }
      }

      const manager = await workflowRegistry.getManager(configFile);
      return NextResponse.json(await withCreationSession(manager.getStatus(), configFile));
    }

    // No configFile — return first running manager's status, or first idle
    const running = workflowRegistry.getRunningManagers();
    if (running.length > 0) {
      return NextResponse.json(await withCreationSession(running[0].manager.getStatus()));
    }

    const all = workflowRegistry.getAllManagers();
    if (all.length > 0) {
      return NextResponse.json(await withCreationSession(all[all.length - 1].manager.getStatus()));
    }

    return NextResponse.json({ status: 'idle' });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取状态失败', message: error.message },
      { status: 500 }
    );
  }
}
