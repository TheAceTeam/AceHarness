const DEFAULT_TEXT_LIMIT = 4000;
const EVENT_OUTPUT_LIMIT = 12000;
const FLOW_LIMIT = 200;
const ARRAY_LIMIT = 80;
const DEPTH_LIMIT = 5;

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
  const specPayload = compactSpecCodingSummary(status.runSpecCoding, 'run') || {};
  return {
    status: status.status || '',
    statusReason: truncateLiveText(status.statusReason || null, 2000),
    runId: status.runId || null,
    currentConfigFile: status.currentConfigFile || configFile || null,
    workflowFrontendSessionId: status.workflowFrontendSessionId || null,
    currentState: status.currentState || null,
    currentPhase: status.currentPhase || status.currentState || null,
    currentStep: status.currentStep || null,
    activeSteps: Array.isArray(status.activeSteps) ? status.activeSteps : [],
    activeConcurrencyGroups: Array.isArray(status.activeConcurrencyGroups) ? status.activeConcurrencyGroups : [],
    completedSteps: Array.isArray(status.completedSteps) ? status.completedSteps : [],
    failedSteps: Array.isArray(status.failedSteps) ? status.failedSteps : [],
    agents: Array.isArray(status.agents) ? status.agents.map(compactAgent) : [],
    iterationStates: status.iterationStates || {},
    stateHistory: Array.isArray(status.stateHistory) ? status.stateHistory.map(compactTransition) : [],
    issueTracker: Array.isArray(status.issueTracker) ? status.issueTracker.map(compactIssue) : [],
    transitionCount: typeof status.transitionCount === 'number' ? status.transitionCount : 0,
    startTime: status.startTime || null,
    endTime: status.endTime || null,
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
  return {
    status: status.status || '',
    statusReason: truncateLiveText(status.statusReason || null, 1000),
    runId: status.runId || null,
    currentConfigFile: status.currentConfigFile || configFile || null,
    workflowFrontendSessionId: status.workflowFrontendSessionId || null,
    currentState: status.currentState || null,
    currentPhase: status.currentPhase || status.currentState || null,
    currentStep: status.currentStep || null,
    activeSteps: Array.isArray(status.activeSteps) ? status.activeSteps : [],
    activeConcurrencyGroups: Array.isArray(status.activeConcurrencyGroups) ? status.activeConcurrencyGroups : [],
    completedStepCount: Array.isArray(status.completedSteps) ? status.completedSteps.length : 0,
    failedStepCount: Array.isArray(status.failedSteps) ? status.failedSteps.length : 0,
    transitionCount: typeof status.transitionCount === 'number' ? status.transitionCount : 0,
    pendingHumanQuestionId: status.pendingHumanQuestionId || null,
    pendingHumanQuestion: compactHumanQuestion(status.pendingHumanQuestion),
    startTime: status.startTime || null,
    endTime: status.endTime || null,
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
