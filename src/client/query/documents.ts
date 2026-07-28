import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { runsApi } from '@/lib/core/api';
import { queryKeys } from './query-keys';
import {
  getDocumentMetadataSnapshot,
  optimisticDeleteDocumentMetadata,
  optimisticRenameDocumentMetadata,
  restoreDocumentMetadataSnapshot,
} from '@/client/db/collections';

export type RunDocumentsParams = {
  includeChildren?: boolean;
  scope?: 'root' | 'children' | 'child';
  childRunId?: string;
  groupKey?: string;
  documentKind?: 'conclusion' | 'detail';
  summaryOnly?: boolean;
  page?: number;
  pageSize?: number;
  offset?: number;
  limit?: number;
  sortDirection?: 'asc' | 'desc';
};

export function useRunDocumentsQuery(runId: string | null | undefined, params: RunDocumentsParams) {
  return useQuery({
    queryKey: queryKeys.documents(runId || '', params),
    queryFn: () => runsApi.listDocuments(runId || '', params),
    enabled: Boolean(runId),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useDocumentContentQuery(
  runId: string | null | undefined,
  filename: string | null | undefined,
  sourceRunId?: string,
) {
  return useQuery({
    queryKey: queryKeys.documentContent(runId || '', filename || '', sourceRunId),
    queryFn: () => runsApi.getDocumentContent(runId || '', filename || '', { sourceRunId }),
    enabled: Boolean(runId && filename),
    staleTime: 60_000,
  });
}

export function useRenameDocumentMutation(runId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, newName }: { file: string; newName: string }) => runsApi.renameDocument(runId || '', file, newName),
    onMutate: async ({ file, newName }) => {
      if (!runId) return { snapshot: [] };
      await queryClient.cancelQueries({ queryKey: ['runs', runId, 'documents'] });
      const snapshot = getDocumentMetadataSnapshot(runId);
      const oldContent = queryClient.getQueryData(queryKeys.documentContent(runId, file));
      optimisticRenameDocumentMetadata(runId, file, newName);
      if (oldContent) {
        queryClient.setQueryData(queryKeys.documentContent(runId, newName), oldContent);
        queryClient.removeQueries({ queryKey: queryKeys.documentContent(runId, file), exact: true });
      }
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      if (runId && context?.snapshot) restoreDocumentMetadataSnapshot(runId, context.snapshot);
    },
    onSuccess: () => {
      if (runId) void queryClient.invalidateQueries({ queryKey: ['runs', runId, 'documents'] });
    },
  });
}

export function useDeleteDocumentsMutation(runId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: string[]) => runsApi.deleteDocuments(runId || '', files),
    onMutate: async (files) => {
      if (!runId) return { snapshot: [] };
      await queryClient.cancelQueries({ queryKey: ['runs', runId, 'documents'] });
      const snapshot = getDocumentMetadataSnapshot(runId);
      optimisticDeleteDocumentMetadata(runId, files);
      files.forEach((filename) => {
        queryClient.removeQueries({ queryKey: queryKeys.documentContent(runId, filename), exact: true });
      });
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      if (runId && context?.snapshot) restoreDocumentMetadataSnapshot(runId, context.snapshot);
    },
    onSuccess: (_data, files) => {
      if (!runId) return;
      void queryClient.invalidateQueries({ queryKey: ['runs', runId, 'documents'] });
      files.forEach((filename) => {
        void queryClient.invalidateQueries({ queryKey: ['runs', runId, 'documents', 'content', filename] });
      });
    },
  });
}
