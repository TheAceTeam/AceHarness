const DEFAULT_TEXT_LIMIT = 4000;
const EVENT_OUTPUT_LIMIT = 12000;
const FLOW_LIMIT = 200;
const ARRAY_LIMIT = 80;
const DEPTH_LIMIT = 5;
const TERMINAL_WORKFLOW_STATUSES = new Set(['completed', 'failed', 'stopped', 'crashed']);

function isTerminalWorkflowStatus(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_WORKFLOW_STATUSES.has(status);
}

export function truncateLiveText(value: unknown, limit = DEFAULT_TEXT_LIMIT): unknown {
  if (typeof value !== 'string') return value;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n[已截断 ${value.length - limit} 字，完整内容请查看实时输出或运行详情]`;
}

function compactJsonValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return truncateLiveText(value);
  if (typeof value !== 'object') return value;
  if (depth >= DEPTH_LIMIT) return '[已省略深层对象]';
  if (Array.isArray(value)) {
    return value.slice(0, ARRAY_LIMIT).map((item) => compactJsonValue(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'stdout' || key === 'stderr' || key === 'output' || key === 'lastOutput' || key === 'fullOutput') {
      result[key] = truncateLiveText(item, 1000);
      continue;
    }
    result[key] = compactJsonValue(item, depth + 1);
  }
  return result;
}

function compactAgent(agent: any) {
  return {
    name: agent?.name,
    team: agent?.team,
    model: agent?.model,
    status: agent?.status,
    currentTask: agent?.currentTask ?? null,
    completedTasks: agent?.completedTasks || 0,
    sessionId: agent?.sessionId || null,
    tokenUsage: agent?.tokenUsage,
    costUsd: agent?.costUsd,
    iterationCount: agent?.iterationCount || 0,
    summary: truncateLiveText(agent?.summary || '', 1200),
    changes: Array.isArray(agent?.changes) ? agent.changes.slice(-20).map((item: any) => compactJsonValue(item)) : [],
  };
}

function compactIssue(issue: any) {
  return {
    ...issue,
    description: truncateLiveText(issue?.description || '', 1200),
    evidence: truncateLiveText(issue?.evidence || '', 1200),
    recommendation: truncateLiveText(issue?.recommendation || '', 1200),
  };
}

function compactTransition(record: any) {
  return {
    ...record,
    reason: truncateLiveText(record?.reason || '', 1600),
    issues: Array.isArray(record?.issues) ? record.issues.slice(0, 20).map(compactIssue) : [],
  };
}

function compactFlowRecord(record: any) {
  return {
    ...record,
    message: truncateLiveText(record?.message || '', 1600),
    question: truncateLiveText(record?.question || '', 1600),
  };
}

function compactHumanQuestion(question: any) {
  if (!question) return null;
  return {
    ...question,
    message: truncateLiveText(question.message || '', 4000),
    supervisorAdvice: truncateLiveText(question.supervisorAdvice || '', 4000),
    answer: question.status === 'unanswered' ? undefined : truncateLiveText(question.answer || '', 4000),
    result: question.result ? compactJsonValue(question.result) : question.result,
  };
}

function compactSubworkflowRun(ref: any) {
  if (!ref) return null;
  return {
    parentStepId: ref.parentStepId,
    parentStepName: ref.parentStepName,
    parentStateName: ref.parentStateName,
    configFile: ref.configFile,
    snapshotFile: ref.snapshotFile,
    runId: ref.runId,
    attempt: ref.attempt,
    status: ref.status,
    startedAt: ref.startedAt,
    endedAt: ref.endedAt,
    summary: truncateLiveText(ref.summary || '', 1600),
    verdict: ref.verdict,
    error: truncateLiveText(ref.error || '', 1200),
    eventCount: typeof ref.eventCount === 'number' ? ref.eventCount : undefined,
  };
}

function compactSubworkflowAuditEvent(event: any) {
  if (!event) return null;
  return {
    id: event.id,
    timestamp: event.timestamp,
    action: event.action,
    actorId: event.actorId,
    actorName: event.actorName,
    childRunId: event.childRunId,
    childConfigFile: event.childConfigFile,
    stateName: event.stateName,
    stepName: event.stepName,
    details: event.details ? compactJsonValue(event.details) : undefined,
  };
}

function compactStepLog(log: any) {
  if (!log) return null;
  return {
    id: log.id,
    stepName: log.stepName,
    agent: log.agent,
    status: log.status,
    superseded: log.superseded === true || undefined,
    supersededAt: log.supersededAt,
    supersededByStep: log.supersededByStep,
    output: truncateLiveText(log.output || '', 4000),
    outputRef: log.outputRef,
    outputBytes: log.outputBytes,
    error: truncateLiveText(log.error || '', 2000),
    costUsd: log.costUsd,
    durationMs: log.durationMs,
    timestamp: log.timestamp,
    tokenUsage: log.tokenUsage,
    sessionId: log.sessionId || null,
    engineName: log.engineName,
    stepType: log.stepType,
    childRunId: log.childRunId,
    childConfigFile: log.childConfigFile,
    childStatus: log.childStatus,
    childSummary: truncateLiveText(log.childSummary || '', 1600),
    childVerdict: log.childVerdict,
    gitStepDiffId: log.gitStepDiffId,
    gitBeforeSnapshotId: log.gitBeforeSnapshotId,
    gitAfterSnapshotId: log.gitAfterSnapshotId,
  };
}

function compactSubworkflowSummary(summary: any) {
  if (!summary) return null;
  return {
    total: summary.total || 0,
    active: summary.active || 0,
    failed: summary.failed || 0,
    waitingHuman: summary.waitingHuman || 0,
    detached: summary.detached || 0,
    completed: summary.completed || 0,
    stopped: summary.stopped || 0,
    superseded: summary.superseded || 0,
    abandoned: summary.abandoned || 0,
    latest: compactSubworkflowRun(summary.latest),
  };
}

function compactSpecCodingSummary(specCoding: any, source: 'run') {
  if (!specCoding) return null;
  const phases = Array.isArray(specCoding.phases) ? specCoding.phases : [];
  const tasks = Array.isArray(specCoding.tasks) ? specCoding.tasks : [];
  const assignments = Array.isArray(specCoding.assignments) ? specCoding.assignments : [];
  const checkpoints = Array.isArray(specCoding.checkpoints) ? specCoding.checkpoints : [];
  const revisions = Array.isArray(specCoding.revisions) ? specCoding.revisions : [];
  return {
    specCodingSummary: {
      id: specCoding.id,
      version: specCoding.version,
      status: specCoding.status,
      source,
      summary: truncateLiveText(specCoding.summary || '', 2000),
      phaseCount: phases.length,
      taskCount: tasks.length,
      assignmentCount: assignments.length,
      checkpointCount: checkpoints.length,
      revisionCount: revisions.length,
      progress: specCoding.progress ? compactJsonValue(specCoding.progress) : specCoding.progress,
      latestRevision: revisions.length ? compactJsonValue(revisions.at(-1)) : null,
    },
    runSpecCodingSummary: {
      id: specCoding.id,
      version: specCoding.version,
      status: specCoding.status,
      source,
      summary: truncateLiveText(specCoding.summary || '', 2000),
      phaseCount: phases.length,
      taskCount: tasks.length,
      assignmentCount: assignments.length,
      checkpointCount: checkpoints.length,
      revisionCount: revisions.length,
      progress: specCoding.progress ? compactJsonValue(specCoding.progress) : specCoding.progress,
      latestRevision: revisions.length ? compactJsonValue(revisions.at(-1)) : null,
    },
    runSpecCodingDetails: {
      phases: phases.map((phase: any) => compactJsonValue(phase)),
      tasks: tasks.map((task: any) => compactJsonValue(task)),
      assignments: assignments.map((assignment: any) => compactJsonValue(assignment)),
      checkpoints: checkpoints.map((checkpoint: any) => compactJsonValue(checkpoint)),
      revisions: revisions.slice(-20).map((revision: any) => compactJsonValue(revision)),
    },
  };
}

export function compactWorkflowStatusForLive(status: any, configFile?: string | null) {
  if (!status) return { status: 'idle' };
  const terminalStatus = isTerminalWorkflowStatus(status.status);
  const specPayload = compactSpecCodingSummary(status.runSpecCoding, 'run') || {};
  return {
    status: status.status || '',
    statusReason: truncateLiveText(status.statusReason || null, 2000),
    runId: status.runId || null,
    currentConfigFile: status.currentConfigFile || configFile || null,
    workflowFrontendSessionId: status.workflowFrontendSessionId || null,
    currentState: status.currentState || null,
    currentPhase: status.currentPhase || status.currentState || null,
    currentStep: terminalStatus ? null : (status.currentStep || null),
    activeSteps: terminalStatus ? [] : (Array.isArray(status.activeSteps) ? status.activeSteps : []),
    activeConcurrencyGroups: terminalStatus ? [] : (Array.isArray(status.activeConcurrencyGroups) ? status.activeConcurrencyGroups : []),
    completedSteps: Array.isArray(status.completedSteps) ? status.completedSteps : [],
    failedSteps: Array.isArray(status.failedSteps) ? status.failedSteps : [],
    stepLogs: Array.isArray(status.stepLogs) ? status.stepLogs.slice(-80).map(compactStepLog) : [],
    agents: Array.isArray(status.agents) ? status.agents.map(compactAgent) : [],
    iterationStates: status.iterationStates || {},
    stateHistory: Array.isArray(status.stateHistory) ? status.stateHistory.slice(-80).map(compactTransition) : [],
    issueTracker: Array.isArray(status.issueTracker) ? status.issueTracker.map(compactIssue) : [],
    transitionCount: typeof status.transitionCount === 'number' ? status.transitionCount : 0,
    childRunIds: Array.isArray(status.childRunIds) ? status.childRunIds : [],
    subworkflowRuns: Array.isArray(status.subworkflowRuns) ? status.subworkflowRuns.map(compactSubworkflowRun) : [],
    subworkflowSummary: compactSubworkflowSummary(status.subworkflowSummary),
    activeSubworkflowRunId: status.activeSubworkflowRunId || null,
    subworkflowAuditEvents: Array.isArray(status.subworkflowAuditEvents)
      ? status.subworkflowAuditEvents.slice(0, 50).map(compactSubworkflowAuditEvent)
      : [],
    workflowSnapshotRoot: status.workflowSnapshotRoot || null,
    workflowSnapshotManifestHash: status.workflowSnapshotManifestHash || null,
    startTime: status.startTime || null,
    endTime: status.endTime || null,
    accumulatedWaitMs: typeof status.accumulatedWaitMs === 'number' ? status.accumulatedWaitMs : 0,
    waitStartedAt: status.waitStartedAt || null,
    taskInput: status.taskInput ? compactJsonValue(status.taskInput) : undefined,
    workingDirectory: status.workingDirectory || null,
    workspaceGit: status.workspaceGit ? compactJsonValue(status.workspaceGit) : undefined,
    supervisorAgent: status.supervisorAgent || null,
    supervisorSessionId: status.supervisorSessionId || null,
    supervisorFlow: Array.isArray(status.supervisorFlow) ? status.supervisorFlow.slice(-FLOW_LIMIT).map(compactFlowRecord) : [],
    agentFlow: Array.isArray(status.agentFlow) ? status.agentFlow.slice(-FLOW_LIMIT).map(compactFlowRecord) : [],
    pendingLiveFeedback: Array.isArray(status.pendingLiveFeedback)
      ? status.pendingLiveFeedback.map((item: any) => ({
          ...item,
          message: truncateLiveText(item?.message || '', 2000),
        }))
      : [],
    latestSupervisorReview: status.latestSupervisorReview ? compactJsonValue(status.latestSupervisorReview) : null,
    humanQuestions: Array.isArray(status.humanQuestions) ? status.humanQuestions.slice(-20).map(compactHumanQuestion) : undefined,
    pendingHumanQuestionId: status.pendingHumanQuestionId || null,
    pendingHumanQuestion: compactHumanQuestion(status.pendingHumanQuestion),
    specRevisionVote: status.specRevisionVote ? compactJsonValue(status.specRevisionVote) : null,
    specRevisionVoteHistory: Array.isArray(status.specRevisionVoteHistory)
      ? status.specRevisionVoteHistory.slice(-20).map((item: any) => compactJsonValue(item))
      : [],
    persistMode: status.persistMode || null,
    deltaSpecMerged: Boolean(status.deltaSpecMerged),
    deltaMergeState: status.deltaMergeState ? compactJsonValue(status.deltaMergeState) : null,
    ...specPayload,
  };
}

export function compactWorkflowStatusDeltaForLive(status: any, configFile?: string | null) {
  if (!status) return { status: 'idle' };
  const terminalStatus = isTerminalWorkflowStatus(status.status);
  return {
    status: status.status || '',
    statusReason: truncateLiveText(status.statusReason || null, 1000),
    runId: status.runId || null,
    currentConfigFile: status.currentConfigFile || configFile || null,
    workflowFrontendSessionId: status.workflowFrontendSessionId || null,
    currentState: status.currentState || null,
    currentPhase: status.currentPhase || status.currentState || null,
    currentStep: terminalStatus ? null : (status.currentStep || null),
    activeSteps: terminalStatus ? [] : (Array.isArray(status.activeSteps) ? status.activeSteps : []),
    activeConcurrencyGroups: terminalStatus ? [] : (Array.isArray(status.activeConcurrencyGroups) ? status.activeConcurrencyGroups : []),
    completedStepCount: Array.isArray(status.completedSteps) ? status.completedSteps.length : 0,
    failedStepCount: Array.isArray(status.failedSteps) ? status.failedSteps.length : 0,
    transitionCount: typeof status.transitionCount === 'number' ? status.transitionCount : 0,
    childRunIds: Array.isArray(status.childRunIds) ? status.childRunIds : [],
    subworkflowRuns: Array.isArray(status.subworkflowRuns) ? status.subworkflowRuns.map(compactSubworkflowRun) : [],
    subworkflowSummary: compactSubworkflowSummary(status.subworkflowSummary),
    activeSubworkflowRunId: status.activeSubworkflowRunId || null,
    subworkflowAuditEvents: Array.isArray(status.subworkflowAuditEvents)
      ? status.subworkflowAuditEvents.slice(0, 50).map(compactSubworkflowAuditEvent)
      : [],
    workflowSnapshotRoot: status.workflowSnapshotRoot || null,
    workflowSnapshotManifestHash: status.workflowSnapshotManifestHash || null,
    pendingHumanQuestionId: status.pendingHumanQuestionId || null,
    pendingHumanQuestion: compactHumanQuestion(status.pendingHumanQuestion),
    startTime: status.startTime || null,
    endTime: status.endTime || null,
    accumulatedWaitMs: typeof status.accumulatedWaitMs === 'number' ? status.accumulatedWaitMs : 0,
    waitStartedAt: status.waitStartedAt || null,
    taskInput: status.taskInput ? compactJsonValue(status.taskInput) : undefined,
  };
}

export function compactWorkflowEventPayloadForLive(payload: any) {
  if (!payload || typeof payload !== 'object') return payload;
  const compact = compactJsonValue(payload) as Record<string, unknown>;
  if (typeof payload.output === 'string') {
    compact.output = truncateLiveText(payload.output, EVENT_OUTPUT_LIMIT);
    compact.outputTruncated = payload.output.length > EVENT_OUTPUT_LIMIT;
  }
  if (typeof payload.fullOutput === 'string') {
    compact.fullOutput = truncateLiveText(payload.fullOutput, EVENT_OUTPUT_LIMIT);
    compact.fullOutputTruncated = payload.fullOutput.length > EVENT_OUTPUT_LIMIT;
  }
  if (Array.isArray(payload.agents)) {
    compact.agents = payload.agents.map(compactAgent);
  }
  return compact;
}
