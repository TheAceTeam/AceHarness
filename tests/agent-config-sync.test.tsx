// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  agentConfigsCollection,
  syncAgentConfigsToDb,
  useAgentConfigRows,
  useSyncAgentConfigsToDb,
} from '@/client/db/collections';
import type { AgentConfig } from '@/client/query/agents';

const TEST_AGENT: AgentConfig = {
  name: 'agent-config-sync-probe',
  team: 'red',
  roleType: 'normal',
  engineModels: {},
  activeEngine: '',
};

function AgentConfigSyncProbe() {
  // This deliberately produces a new array for every render, matching the manager's derived list.
  const agents = [TEST_AGENT].filter(() => true);
  useSyncAgentConfigsToDb(agents);
  const rows = useAgentConfigRows({
    keyword: '',
    group: 'all',
    team: 'all',
    category: 'all',
    tags: [],
  });

  return <output data-testid="agent-config-row-count">{rows.length}</output>;
}

afterEach(() => {
  syncAgentConfigsToDb([]);
  vi.useRealTimers();
});

describe('agent config collection synchronization', () => {
  test('does not rewrite an unchanged agent configuration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'));
    syncAgentConfigsToDb([TEST_AGENT]);
    const firstUpdatedAt = agentConfigsCollection.get(TEST_AGENT.name)?.updatedAt;

    vi.setSystemTime(new Date('2026-08-04T00:01:00.000Z'));
    syncAgentConfigsToDb([{ ...TEST_AGENT }]);

    expect(agentConfigsCollection.get(TEST_AGENT.name)?.updatedAt).toBe(firstUpdatedAt);
  });

  test('settles when a live subscriber derives a new agents array on each render', async () => {
    render(
      <StrictMode>
        <AgentConfigSyncProbe />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('agent-config-row-count')).toHaveTextContent('1');
    });
  });
});
