import { useQuery } from '@tanstack/react-query';
import { mergeRuntimeToolEvents, type RuntimeToolEvent } from '@/lib/runtime-agent/tool-events';
import { runsApi, streamApi } from '@/lib/core/api';
import { parseTasklistDocuments } from '@/components/workflow/lightweight-tasklist-evidence';

export function useLightweightTasklistEvidenceQuery(
  runId: string | null | undefined,
  enabled: boolean,
  active: boolean,
) {
  return useQuery({
    queryKey: ['lightweight-tasklist-evidence', runId || ''],
    enabled: Boolean(runId && enabled),
    staleTime: 1_000,
    refetchInterval: active ? 2_000 : false,
    queryFn: async () => {
      const listing = await runsApi.listDocuments(runId!, {
        source: 'tasklist',
        scope: 'root',
        limit: 200,
        sortDirection: 'asc',
      });
      const files = Array.isArray(listing.files) ? listing.files : [];
      const documents = await Promise.all(files.map(async (file) => {
        try {
          const result = await runsApi.getDocumentContent(runId!, {
            source: 'tasklist',
            sourceRunId: file.sourceRunId || runId!,
            file: file.relativePath || file.filename,
          });
          return { file: file.relativePath || file.filename, content: result.content || '' };
        } catch {
          return null;
        }
      }));
      return {
        tasklist: parseTasklistDocuments(documents.filter((item): item is { file: string; content: string } => Boolean(item))),
        files,
      };
    },
  });
}

export function useLightweightRuntimeToolEventsQuery(
  runId: string | null | undefined,
  stepNames: readonly string[],
  enabled: boolean,
  active: boolean,
) {
  const normalizedStepNames = Array.from(new Set(stepNames.map((step) => String(step || '').trim()).filter(Boolean)));
  return useQuery({
    queryKey: ['lightweight-runtime-tool-events', runId || '', normalizedStepNames],
    enabled: Boolean(runId && enabled && normalizedStepNames.length > 0),
    staleTime: 1_000,
    refetchInterval: active ? 2_000 : false,
    queryFn: async () => {
      const streams = await Promise.all(normalizedStepNames.map((stepName) => streamApi.getStream(runId!, stepName)));
      let events: RuntimeToolEvent[] = [];
      for (const stream of streams) {
        for (const event of stream.toolEvents) events = mergeRuntimeToolEvents(events, event);
      }
      return events;
    },
  });
}
