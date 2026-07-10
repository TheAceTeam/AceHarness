import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './query-keys';
import { workspaceApi, type GitBrowserScope, type NotebookScope, type NotebookSnapshotSource, type WorkspaceTreeOptions } from '@/lib/core/api';

export type WorkspaceTreeQueryParams = WorkspaceTreeOptions & {
  workspacePath?: string;
};

export type NotebookTreeQueryParams = {
  depth?: number;
  scope?: NotebookScope;
  shareToken?: string;
};

export type NotebookFileQueryParams = {
  scope?: NotebookScope;
  shareToken?: string;
};

type QueryEnableOptions = {
  enabled?: boolean;
  refetchInterval?: number | false;
};

export type WorkflowGitDiffQueryParams = {
  stepDiffId?: string;
  range?: 'step' | 'baseline';
};

export type GitBrowserSummaryQueryParams = {
  commitOffset?: number;
  commitLimit?: number;
};

function workspaceTreeParams(options: WorkspaceTreeOptions = {}) {
  return {
    depth: options.depth ?? 0,
    offset: options.offset ?? 0,
    limit: options.limit ?? null,
    sort: options.sort || 'name',
  };
}

function notebookParams(params: NotebookTreeQueryParams | NotebookFileQueryParams = {}) {
  return {
    depth: 'depth' in params ? params.depth ?? 2 : undefined,
    scope: params.scope || 'personal',
    shareToken: params.shareToken || '',
  };
}

function workflowGitDiffParams(params: WorkflowGitDiffQueryParams = {}) {
  return {
    stepDiffId: params.stepDiffId || '',
    range: params.range || 'step',
  };
}

function gitBrowserSummaryParams(params: GitBrowserSummaryQueryParams = {}) {
  return {
    commitOffset: params.commitOffset ?? 0,
    commitLimit: params.commitLimit ?? 40,
  };
}

function parentPath(filePath: string) {
  const normalized = String(filePath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

export function useWorkspaceTreeQuery(workspacePath: string, options: WorkspaceTreeOptions = {}, queryOptions: QueryEnableOptions = {}) {
  const params = workspaceTreeParams(options);
  return useQuery({
    queryKey: queryKeys.workspace.tree(workspacePath, params),
    queryFn: () => workspaceApi.getTree(workspacePath, options),
    enabled: queryOptions.enabled ?? Boolean(workspacePath),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useWorkspaceSubTreeQuery(workspacePath: string, subPath: string, options: WorkspaceTreeOptions = {}, queryOptions: QueryEnableOptions = {}) {
  const params = workspaceTreeParams(options);
  return useQuery({
    queryKey: queryKeys.workspace.subtree(workspacePath, subPath, params),
    queryFn: () => workspaceApi.getSubTree(workspacePath, subPath, options),
    enabled: queryOptions.enabled ?? Boolean(workspacePath && subPath),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useWorkspaceFileQuery(workspacePath: string, filePath: string, queryOptions: QueryEnableOptions = {}) {
  return useQuery({
    queryKey: queryKeys.workspace.file(workspacePath, filePath),
    queryFn: () => workspaceApi.getFile(workspacePath, filePath),
    enabled: queryOptions.enabled ?? Boolean(workspacePath && filePath),
    staleTime: 30_000,
  });
}

export function useWorkspaceFileBlobQuery(workspacePath: string, filePath: string, queryOptions: QueryEnableOptions = {}) {
  return useQuery({
    queryKey: queryKeys.workspace.fileBlob(workspacePath, filePath),
    queryFn: () => workspaceApi.getFileBlob(workspacePath, filePath),
    enabled: queryOptions.enabled ?? Boolean(workspacePath && filePath),
    staleTime: 30_000,
  });
}

export function useWorkflowGitDiffQuery(runId: string, params: WorkflowGitDiffQueryParams = {}, queryOptions: QueryEnableOptions = {}) {
  const keyParams = workflowGitDiffParams(params);
  return useQuery({
    queryKey: queryKeys.workspace.workflowGitDiff(runId, keyParams),
    queryFn: () => workspaceApi.getWorkflowGitDiff(runId, keyParams),
    enabled: queryOptions.enabled ?? Boolean(runId),
    placeholderData: (previous) => previous,
    refetchInterval: queryOptions.refetchInterval,
    staleTime: 5_000,
  });
}

export function useWorkflowGitDiffFileQuery(runId: string, filePath: string, params: WorkflowGitDiffQueryParams = {}, queryOptions: QueryEnableOptions = {}) {
  const keyParams = workflowGitDiffParams(params);
  return useQuery({
    queryKey: queryKeys.workspace.workflowGitDiffFile(runId, filePath, keyParams),
    queryFn: () => workspaceApi.getWorkflowGitDiffFile(runId, filePath, keyParams),
    enabled: queryOptions.enabled ?? Boolean(runId && filePath),
    placeholderData: (previous) => previous,
    refetchInterval: queryOptions.refetchInterval,
    staleTime: 5_000,
  });
}

export function useGitBrowserSummaryQuery(workspacePath: string, params: GitBrowserSummaryQueryParams = {}, queryOptions: QueryEnableOptions = {}) {
  const keyParams = gitBrowserSummaryParams(params);
  return useQuery({
    queryKey: queryKeys.workspace.gitBrowserSummary(workspacePath, keyParams),
    queryFn: () => workspaceApi.getGitBrowserSummary(workspacePath, keyParams),
    enabled: queryOptions.enabled ?? Boolean(workspacePath),
    placeholderData: (previous) => previous,
    refetchInterval: queryOptions.refetchInterval,
    staleTime: 5_000,
  });
}

export function useGitBrowserCommitDetailQuery(workspacePath: string, commit: string, queryOptions: QueryEnableOptions = {}) {
  return useQuery({
    queryKey: queryKeys.workspace.gitBrowserCommitDetail(workspacePath, commit),
    queryFn: () => workspaceApi.getGitBrowserCommitDetail(workspacePath, commit),
    enabled: queryOptions.enabled ?? Boolean(workspacePath && commit),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useGitBrowserCommitFileQuery(workspacePath: string, commit: string, filePath: string, queryOptions: QueryEnableOptions = {}) {
  return useQuery({
    queryKey: queryKeys.workspace.gitBrowserCommitFile(workspacePath, commit, filePath),
    queryFn: () => workspaceApi.getGitBrowserCommitFileDetail(workspacePath, commit, filePath),
    enabled: queryOptions.enabled ?? Boolean(workspacePath && commit && filePath),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useGitBrowserScopeFileQuery(workspacePath: string, scope: GitBrowserScope, filePath: string, queryOptions: QueryEnableOptions = {}) {
  return useQuery({
    queryKey: queryKeys.workspace.gitBrowserScopeFile(workspacePath, scope, filePath),
    queryFn: () => workspaceApi.getGitBrowserScopeFileDetail(workspacePath, scope, filePath),
    enabled: queryOptions.enabled ?? Boolean(workspacePath && scope && filePath),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useGitBrowserSummaryPageMutation(workspacePath: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: GitBrowserSummaryQueryParams) => workspaceApi.getGitBrowserSummary(workspacePath, gitBrowserSummaryParams(params)),
    onSuccess: (result, params) => {
      queryClient.setQueryData(queryKeys.workspace.gitBrowserSummary(workspacePath, gitBrowserSummaryParams(params)), result);
    },
  });
}

export function useNotebookTreeQuery(params: NotebookTreeQueryParams = {}, queryOptions: QueryEnableOptions = {}) {
  const keyParams = notebookParams(params);
  const depth = params.depth ?? 2;
  return useQuery({
    queryKey: queryKeys.notebook.tree(keyParams),
    queryFn: () => workspaceApi.getNotebookTree(depth, params),
    enabled: queryOptions.enabled ?? true,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useNotebookSubTreeQuery(subPath: string, params: NotebookTreeQueryParams = {}, queryOptions: QueryEnableOptions = {}) {
  const keyParams = notebookParams(params);
  const depth = params.depth ?? 2;
  return useQuery({
    queryKey: queryKeys.notebook.subtree(subPath, keyParams),
    queryFn: () => workspaceApi.getNotebookSubTree(subPath, depth, params),
    enabled: queryOptions.enabled ?? Boolean(subPath),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useNotebookFileQuery(filePath: string, params: NotebookFileQueryParams = {}, queryOptions: QueryEnableOptions = {}) {
  const keyParams = notebookParams(params);
  return useQuery({
    queryKey: queryKeys.notebook.file(filePath, keyParams),
    queryFn: () => workspaceApi.getNotebookFile(filePath, params),
    enabled: queryOptions.enabled ?? Boolean(filePath),
    staleTime: 30_000,
  });
}

export function useNotebookFileBlobQuery(filePath: string, params: NotebookFileQueryParams = {}, queryOptions: QueryEnableOptions = {}) {
  const keyParams = notebookParams(params);
  return useQuery({
    queryKey: queryKeys.notebook.fileBlob(filePath, keyParams),
    queryFn: () => workspaceApi.getNotebookFileBlob(filePath, params),
    enabled: queryOptions.enabled ?? Boolean(filePath),
    staleTime: 30_000,
  });
}

export function useNotebookSnapshotsQuery(filePath: string, params: NotebookFileQueryParams = {}, queryOptions: QueryEnableOptions = {}) {
  const keyParams = notebookParams(params);
  return useQuery({
    queryKey: queryKeys.notebook.snapshots(filePath, keyParams),
    queryFn: () => workspaceApi.listNotebookSnapshots(filePath, params),
    enabled: queryOptions.enabled ?? Boolean(filePath),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useNotebookSnapshotDetailQuery(
  filePath: string,
  snapshotId: string,
  params: NotebookFileQueryParams = {},
  queryOptions: QueryEnableOptions = {},
) {
  const keyParams = notebookParams(params);
  return useQuery({
    queryKey: queryKeys.notebook.snapshotDetail(filePath, snapshotId, keyParams),
    queryFn: () => workspaceApi.getNotebookSnapshotDetail(filePath, snapshotId, params),
    enabled: queryOptions.enabled ?? Boolean(filePath && snapshotId),
    staleTime: 60_000,
  });
}

export function useSaveWorkspaceFileMutation(workspacePath: string, filePath: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => workspaceApi.saveFile(workspacePath, filePath, content),
    onSuccess: async (_result, content) => {
      queryClient.setQueryData(queryKeys.workspace.file(workspacePath, filePath), {
        content,
        path: filePath,
        size: content.length,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspace', 'tree', workspacePath] }),
        queryClient.invalidateQueries({ queryKey: ['workspace', 'subtree', workspacePath, parentPath(filePath)] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspace.fileBlob(workspacePath, filePath) }),
        queryClient.invalidateQueries({ queryKey: ['workspace', 'gitBrowser', workspacePath] }),
      ]);
    },
  });
}

export function useSaveNotebookFileMutation(filePath: string, params: NotebookFileQueryParams = {}) {
  const queryClient = useQueryClient();
  const keyParams = notebookParams(params);
  return useMutation({
    mutationFn: (content: string) => workspaceApi.saveNotebookFile(filePath, content, params),
    onSuccess: async (_result, content) => {
      queryClient.setQueryData(queryKeys.notebook.file(filePath, keyParams), {
        content,
        path: filePath,
        size: content.length,
        readOnly: false,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notebook', 'tree'] }),
        queryClient.invalidateQueries({ queryKey: ['notebook', 'subtree', parentPath(filePath)] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notebook.fileBlob(filePath, keyParams) }),
      ]);
    },
  });
}

export function useCreateNotebookSnapshotMutation(filePath: string, params: NotebookFileQueryParams = {}) {
  const queryClient = useQueryClient();
  const keyParams = notebookParams(params);
  return useMutation({
    mutationFn: (source: NotebookSnapshotSource) => workspaceApi.createNotebookSnapshot(filePath, {
      ...params,
      source,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notebook.snapshots(filePath, keyParams) });
    },
  });
}

export function useRestoreNotebookSnapshotMutation(filePath: string, params: NotebookFileQueryParams = {}) {
  const queryClient = useQueryClient();
  const keyParams = notebookParams(params);
  return useMutation({
    mutationFn: (snapshotId: string) => workspaceApi.restoreNotebookSnapshot(filePath, snapshotId, params),
    onSuccess: async (_result, snapshotId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.notebook.file(filePath, keyParams) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notebook.fileBlob(filePath, keyParams) }),
        queryClient.invalidateQueries({ queryKey: ['notebook', 'tree'] }),
        queryClient.invalidateQueries({ queryKey: ['notebook', 'subtree', parentPath(filePath)] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notebook.snapshots(filePath, keyParams) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notebook.snapshotDetail(filePath, snapshotId, keyParams) }),
      ]);
    },
  });
}
