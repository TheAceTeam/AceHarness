import { describe, expect, test } from 'vitest';
import { shouldStoreWorkflowLiveEventAsAgentMessage } from '@/lib/workflow/live-store';

describe('workflow live store event routing', () => {
  test('does not store workflow control events as agent message content', () => {
    expect(shouldStoreWorkflowLiveEventAsAgentMessage('connected')).toBe(false);
    expect(shouldStoreWorkflowLiveEventAsAgentMessage('heartbeat')).toBe(false);
    expect(shouldStoreWorkflowLiveEventAsAgentMessage('snapshot')).toBe(false);
    expect(shouldStoreWorkflowLiveEventAsAgentMessage('status')).toBe(false);
    expect(shouldStoreWorkflowLiveEventAsAgentMessage('step-start')).toBe(false);
    expect(shouldStoreWorkflowLiveEventAsAgentMessage('step-complete')).toBe(false);
    expect(shouldStoreWorkflowLiveEventAsAgentMessage('runtime-transcript')).toBe(false);
    expect(shouldStoreWorkflowLiveEventAsAgentMessage('chat-stream-state')).toBe(false);
    expect(shouldStoreWorkflowLiveEventAsAgentMessage('chat-stream-removed')).toBe(false);
    expect(shouldStoreWorkflowLiveEventAsAgentMessage('chat-session-updated')).toBe(false);
    expect(shouldStoreWorkflowLiveEventAsAgentMessage('chat-session-removed')).toBe(false);
  });

  test('keeps storing workflow output events as agent messages', () => {
    expect(shouldStoreWorkflowLiveEventAsAgentMessage('workflow.step-output')).toBe(true);
    expect(shouldStoreWorkflowLiveEventAsAgentMessage('workflow-event')).toBe(true);
  });
});
