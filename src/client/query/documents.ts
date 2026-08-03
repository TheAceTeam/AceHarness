import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { runsApi, type RunDocumentReference, type RunDocumentSource } from '@/lib/core/api';
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
  source?: RunDocumentSource;
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
  reference: RunDocumentReference | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.documentContent(runId || '', reference),
    queryFn: () => runsApi.getDocumentContent(runId || '', reference!),
    enabled: Boolean(runId && reference?.file && reference.source),
    staleTime: 60_000,
  });
}

export function useRenameDocumentMutation(runId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RunDocumentReference & { newName: string }) => runsApi.renameDocument(runId || '', input),
    onMutate: async ({ source, sourceRunId, file, newName }) => {
      if (!runId) return { snapshot: [] };
      await queryClient.cancelQueries({ queryKey: ['runs', runId, 'documents'] });
      const snapshot = getDocumentMetadataSnapshot(runId);
      const reference = { source, sourceRunId, file };
      const oldContent = queryClient.getQueryData(queryKeys.documentContent(runId, reference));
      const newFile = optimisticRenameDocumentMetadata(runId, reference, newName);
      const renamedReference = { ...reference, file: newFile };
      if (oldContent) {
        queryClient.setQueryData(queryKeys.documentContent(runId, renamedReference), {
          ...(oldContent as Record<string, unknown>),
          file: newFile,
        });
        queryClient.removeQueries({ queryKey: queryKeys.documentContent(runId, reference), exact: true });
      }
      return { snapshot, oldContent, reference, renamedReference };
    },
    onError: (_error, _variables, context) => {
      if (!runId || !context?.snapshot) return;
      restoreDocumentMetadataSnapshot(runId, context.snapshot);
      if (context.oldContent && context.reference && context.renamedReference) {
        queryClient.setQueryData(queryKeys.documentContent(runId, context.reference), context.oldContent);
        queryClient.removeQueries({ queryKey: queryKeys.documentContent(runId, context.renamedReference), exact: true });
      }
    },
    onSuccess: () => {
      if (runId) void queryClient.invalidateQueries({ queryKey: ['runs', runId, 'documents'] });
    },
  });
}

export function useDeleteDocumentsMutation(runId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: RunDocumentReference[]) => runsApi.deleteDocuments(runId || '', files),
    onMutate: async (files) => {
      if (!runId) return { snapshot: [] };
      await queryClient.cancelQueries({ queryKey: ['runs', runId, 'documents'] });
      const snapshot = getDocumentMetadataSnapshot(runId);
      optimisticDeleteDocumentMetadata(runId, files);
      files.forEach((reference) => {
        queryClient.removeQueries({ queryKey: queryKeys.documentContent(runId, reference), exact: true });
      });
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      if (runId && context?.snapshot) restoreDocumentMetadataSnapshot(runId, context.snapshot);
    },
    onSuccess: (_data, files) => {
      if (!runId) return;
      void queryClient.invalidateQueries({ queryKey: ['runs', runId, 'documents'] });
      files.forEach((reference) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.documentContent(runId, reference), exact: true });
      });
    },
  });
}
