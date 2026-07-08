const contentKeys = {
  workspaceFile: (workspacePath: string, filePath: string) =>
    ['content', 'workspace', workspacePath, filePath] as const,
  runDocument: (runId: string, filename: string, sourceRunId?: string) =>
    ['content', 'runDocument', runId, filename, sourceRunId ?? null] as const,
};

export const queryKeys = {
  auth: {
    currentUser: () => ['auth', 'currentUser'] as const,
  },
  profile: () => ['auth', 'currentUser'] as const,
  configs: (params: Record<string, unknown>) => ['configs', params] as const,
  configOptions: (params: Record<string, unknown>) => ['configs', 'options', params] as const,
  config: (filename: string) => ['config', filename] as const,
  workflowStatusCompact: (configFile: string, runId?: string) =>
    ['workflow', 'status', configFile, runId ?? null, 'compact'] as const,
  workflowChildStatusCompact: (parentConfigFile: string, parentRunId: string, childConfigFile: string, childRunId: string) =>
    ['workflow', 'childStatus', parentConfigFile, parentRunId || null, childConfigFile, childRunId, 'compact'] as const,
  workflowEvents: (configFile: string, runId: string, params: Record<string, unknown>) =>
    ['workflow', 'events', configFile, runId, params] as const,
  workflowStateHistory: (configFile: string, runId: string, params: Record<string, unknown>) =>
    ['workflow', 'stateHistory', configFile, runId, params] as const,
  workflowStepLogs: (configFile: string, runId: string, params: Record<string, unknown>) =>
    ['workflow', 'stepLogs', configFile, runId, params] as const,
  workflowHumanQuestions: (params: Record<string, unknown>) =>
    ['workflow', 'humanQuestions', params] as const,
  runHistory: (params: Record<string, unknown>) => ['runs', 'history', params] as const,
  runDetail: (runId: string) => ['runs', runId, 'detail'] as const,
  workflowRunDocuments: (runId: string, params: Record<string, unknown>) =>
    ['workflow', 'runDocuments', runId, params] as const,
  documents: (runId: string, params: Record<string, unknown>) =>
    ['runs', runId, 'documents', params] as const,
  documentGroupDetails: (runId: string, groupKey: string, params: Record<string, unknown>) =>
    ['runs', runId, 'documents', 'groups', groupKey, params] as const,
  documentLatestDetail: (runId: string, params: Record<string, unknown>) =>
    ['runs', runId, 'documents', 'latestDetail', params] as const,
  content: contentKeys,
  documentContent: contentKeys.runDocument,
  workspace: {
    tree: (workspacePath: string, params: Record<string, unknown>) =>
      ['workspace', 'tree', workspacePath, params] as const,
    subtree: (workspacePath: string, subPath: string, params: Record<string, unknown>) =>
      ['workspace', 'subtree', workspacePath, subPath, params] as const,
    file: contentKeys.workspaceFile,
    fileBlob: (workspacePath: string, filePath: string) =>
      ['workspace', 'fileBlob', workspacePath, filePath] as const,
    workflowGitDiff: (runId: string, params: Record<string, unknown>) =>
      ['workspace', 'workflowGitDiff', runId, params] as const,
    workflowGitDiffFile: (runId: string, filePath: string, params: Record<string, unknown>) =>
      ['workspace', 'workflowGitDiff', runId, 'file', filePath, params] as const,
    gitBrowserSummary: (workspacePath: string, params: Record<string, unknown>) =>
      ['workspace', 'gitBrowser', workspacePath, 'summary', params] as const,
    gitBrowserCommitDetail: (workspacePath: string, commit: string) =>
      ['workspace', 'gitBrowser', workspacePath, 'commit', commit] as const,
    gitBrowserCommitFile: (workspacePath: string, commit: string, filePath: string) =>
      ['workspace', 'gitBrowser', workspacePath, 'commit', commit, 'file', filePath] as const,
    gitBrowserScopeFile: (workspacePath: string, scope: string, filePath: string) =>
      ['workspace', 'gitBrowser', workspacePath, 'scope', scope, 'file', filePath] as const,
  },
  notebook: {
    tree: (params: Record<string, unknown>) =>
      ['notebook', 'tree', params] as const,
    subtree: (subPath: string, params: Record<string, unknown>) =>
      ['notebook', 'subtree', subPath, params] as const,
    file: (filePath: string, params: Record<string, unknown>) =>
      ['notebook', 'file', filePath, params] as const,
    fileBlob: (filePath: string, params: Record<string, unknown>) =>
      ['notebook', 'fileBlob', filePath, params] as const,
    snapshots: (filePath: string, params: Record<string, unknown>) =>
      ['notebook', 'snapshots', filePath, params] as const,
    snapshotDetail: (filePath: string, snapshotId: string, params: Record<string, unknown>) =>
      ['notebook', 'snapshots', filePath, snapshotId, params] as const,
  },
  schedules: () => ['schedules'] as const,
  users: () => ['users'] as const,
  agents: () => ['agents'] as const,
  agentMemory: (name: string, maxChars: number) => ['agents', name, 'memory', maxChars] as const,
  models: () => ['models'] as const,
  engines: () => ['engines'] as const,
  engineAvailability: () => ['engines', 'availability'] as const,
  skills: () => ['skills'] as const,
  marketplace: {
    categories: () => ['marketplace', 'categories'] as const,
    search: (params: Record<string, unknown>) => ['marketplace', 'search', params] as const,
  },
  rag: {
    knowledgeBases: () => ['rag', 'knowledgeBases'] as const,
    detail: (knowledgeBaseId: string, params: Record<string, unknown>) =>
      ['rag', 'detail', knowledgeBaseId, params] as const,
    search: (params: Record<string, unknown>) => ['rag', 'search', params] as const,
  },
};
