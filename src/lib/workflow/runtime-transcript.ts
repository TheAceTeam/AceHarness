import { getWorkflowEventStore, type WorkflowEventRecord } from '@/lib/workflow/event-store';

export const WORKFLOW_RUNTIME_TRANSCRIPT_EVENT = 'workflow.runtime-transcript';

export interface WorkflowRuntimeTranscriptInput {
  runId: string;
  type: string;
  title: string;
  body?: string;
  tags?: string[];
  dedupeKey?: string;
  speakerName?: string;
  speakerType?: 'human' | 'agent' | 'system';
  createdAt?: string | number;
}

export function toWorkflowRuntimeTranscriptLiveEvent(event: WorkflowEventRecord) {
  return {
    runId: event.runId,
    seq: event.seq,
    timestamp: event.timestamp,
    transcript: event.payload,
  };
}

function normalizeCreatedAt(value?: string | number): string {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  return new Date().toISOString();
}

export async function appendWorkflowRuntimeTranscript(
  input: WorkflowRuntimeTranscriptInput,
): Promise<WorkflowEventRecord | null> {
  const runId = String(input.runId || '').trim();
  const title = String(input.title || '').trim();
  if (!runId || !title) return null;

  const body = String(input.body || '').trim();
  const tags = Array.isArray(input.tags)
    ? input.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];
  return getWorkflowEventStore().append(runId, WORKFLOW_RUNTIME_TRANSCRIPT_EVENT, {
    version: 1,
    type: String(input.type || 'status').trim() || 'status',
    title,
    ...(body ? { body } : {}),
    ...(tags.length ? { tags } : {}),
    ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
    ...(input.speakerName ? { speakerName: input.speakerName } : {}),
    ...(input.speakerType ? { speakerType: input.speakerType } : {}),
    createdAt: normalizeCreatedAt(input.createdAt),
  });
}
