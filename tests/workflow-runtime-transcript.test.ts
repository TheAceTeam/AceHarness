import { beforeEach, describe, expect, test, vi } from 'vitest';

const eventStoreMocks = vi.hoisted(() => ({
  append: vi.fn(),
}));

vi.mock('@/lib/workflow/event-store', () => ({
  getWorkflowEventStore: () => ({ append: eventStoreMocks.append }),
}));

describe('workflow runtime transcript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventStoreMocks.append.mockResolvedValue({
      runId: 'run-1',
      seq: 1,
      type: 'workflow.runtime-transcript',
      timestamp: '2026-07-28T00:00:00.000Z',
      payload: {},
    });
  });

  test('persists lifecycle text as a run event instead of a chatroom message', async () => {
    const {
      appendWorkflowRuntimeTranscript,
      WORKFLOW_RUNTIME_TRANSCRIPT_EVENT,
    } = await import('@/lib/workflow/runtime-transcript');

    await appendWorkflowRuntimeTranscript({
      runId: 'run-1',
      type: 'human-question',
      title: 'Need input',
      body: 'Choose a next state.',
      tags: ['human', 'approval'],
      speakerName: 'default-supervisor',
      speakerType: 'agent',
      dedupeKey: 'question-1',
    });

    expect(eventStoreMocks.append).toHaveBeenCalledWith('run-1', WORKFLOW_RUNTIME_TRANSCRIPT_EVENT, expect.objectContaining({
      type: 'human-question',
      title: 'Need input',
      body: 'Choose a next state.',
      tags: ['human', 'approval'],
      dedupeKey: 'question-1',
    }));
  });
});
