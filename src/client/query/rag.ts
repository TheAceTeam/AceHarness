import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { queryKeys } from './query-keys';
import type { RagDatabaseStats, RagDocument, RagImportJob, RagKnowledgeBase, RagTableSchema, RagVectorChunk } from '@/lib/rag/types';
import {
  getRagRowsSnapshot,
  optimisticDeleteRagDocument,
  optimisticDeleteRagKnowledgeBase,
  optimisticDeleteRagRows,
  restoreRagRowsSnapshot,
} from '@/client/db/collections';

export type RagDetail = {
  documents: RagDocument[];
  chunks: RagVectorChunk[];
  importJobs: RagImportJob[];
  stats: RagDatabaseStats | null;
  schema: RagTableSchema | null;
};

export function useRagKnowledgeBasesQuery() {
  return useQuery({
    queryKey: queryKeys.rag.knowledgeBases(),
    queryFn: () => apiRequest<{ knowledgeBases: RagKnowledgeBase[] }>('/api/rag/knowledge-bases'),
    staleTime: 30_000,
  });
}

export function useCreateRagKnowledgeBaseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) => apiRequest<{ knowledgeBase: RagKnowledgeBase }>('/api/rag/knowledge-bases', {
      method: 'POST',
      body: { name, description },
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.rag.knowledgeBases() });
    },
  });
}

export function useRagDetailQuery(knowledgeBaseId: string | undefined, limit = 500) {
  return useQuery({
    queryKey: queryKeys.rag.detail(knowledgeBaseId || '', { limit }),
    queryFn: () => apiRequest<RagDetail>(`/api/rag/detail?knowledgeBaseId=${encodeURIComponent(knowledgeBaseId || '')}&limit=${encodeURIComponent(String(limit))}`),
    enabled: Boolean(knowledgeBaseId),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

function invalidateRag(queryClient: ReturnType<typeof useQueryClient>, knowledgeBaseId?: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.rag.knowledgeBases() });
  if (knowledgeBaseId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.rag.detail(knowledgeBaseId, { limit: 500 }) });
  }
}

export function useDeleteRagKnowledgeBaseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest(`/api/rag/knowledge-bases?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.rag.knowledgeBases() });
      const snapshot = getRagRowsSnapshot();
      optimisticDeleteRagKnowledgeBase(id);
      return { snapshot };
    },
    onError: (_error, _id, context) => {
      if (context?.snapshot) restoreRagRowsSnapshot(context.snapshot);
    },
    onSuccess: (_data, id) => {
      invalidateRag(queryClient, id);
    },
  });
}

export function useImportRagBundleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ knowledgeBaseId, bundle }: { knowledgeBaseId: string; bundle: unknown }) => apiRequest('/api/rag/import', {
      method: 'POST',
      body: { knowledgeBaseId, mode: 'bundle', bundle },
    }),
    onSuccess: (_data, variables) => {
      invalidateRag(queryClient, variables.knowledgeBaseId);
    },
  });
}

export function useImportRagTextMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ knowledgeBaseId, title, content }: { knowledgeBaseId: string; title: string; content: string }) => apiRequest('/api/rag/import', {
      method: 'POST',
      body: { knowledgeBaseId, title, content, sourceType: 'text' },
    }),
    onSuccess: (_data, variables) => {
      invalidateRag(queryClient, variables.knowledgeBaseId);
    },
  });
}

export function useDeleteRagDocumentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ knowledgeBaseId, documentId }: { knowledgeBaseId: string; documentId: string }) =>
      apiRequest(`/api/rag/documents?knowledgeBaseId=${encodeURIComponent(knowledgeBaseId)}&documentId=${encodeURIComponent(documentId)}`, {
        method: 'DELETE',
      }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.rag.detail(variables.knowledgeBaseId, { limit: 500 }) });
      const snapshot = getRagRowsSnapshot();
      optimisticDeleteRagDocument(variables.knowledgeBaseId, variables.documentId);
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshot) restoreRagRowsSnapshot(context.snapshot);
    },
    onSuccess: (_data, variables) => {
      invalidateRag(queryClient, variables.knowledgeBaseId);
    },
  });
}

export function useImportRagSampleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (knowledgeBaseId: string) => apiRequest(`/api/rag/v1/collections/${encodeURIComponent(knowledgeBaseId)}/import`, {
      method: 'POST',
      body: { sample: true },
    }),
    onSuccess: (_data, knowledgeBaseId) => {
      invalidateRag(queryClient, knowledgeBaseId);
    },
  });
}

export function useDeleteRagRowsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ knowledgeBaseId, rowIds, all }: { knowledgeBaseId: string; rowIds?: string[]; all?: boolean }) =>
      apiRequest(`/api/rag/v1/collections/${encodeURIComponent(knowledgeBaseId)}/rows`, {
        method: 'DELETE',
        body: all ? { all: true } : { rowIds: rowIds || [] },
      }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.rag.detail(variables.knowledgeBaseId, { limit: 500 }) });
      const snapshot = getRagRowsSnapshot();
      optimisticDeleteRagRows(variables.knowledgeBaseId, variables.rowIds, variables.all);
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshot) restoreRagRowsSnapshot(context.snapshot);
    },
    onSuccess: (_data, variables) => {
      invalidateRag(queryClient, variables.knowledgeBaseId);
    },
  });
}

export function useSearchRagMutation() {
  return useMutation({
    mutationFn: ({ knowledgeBaseId, query, topK = 8 }: { knowledgeBaseId: string; query: string; topK?: number }) =>
      apiRequest<{ results: RagVectorChunk[] }>('/api/rag/search', {
        method: 'POST',
        body: { knowledgeBaseId, query, topK },
      }),
  });
}

export function useRagApiDebuggerMutation() {
  return useMutation({
    mutationFn: ({ method, path, bodyText }: { method: string; path: string; bodyText?: string }) => {
      const normalizedMethod = method.toUpperCase();
      const trimmedBody = (bodyText || '').trim();
      const body = normalizedMethod === 'GET' || !trimmedBody ? undefined : JSON.parse(trimmedBody);
      return apiRequest<unknown>(path, {
        method: normalizedMethod,
        body,
      });
    },
  });
}
