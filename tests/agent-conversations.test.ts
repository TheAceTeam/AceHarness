import { describe, expect, test } from 'vitest';

import {
  getSessionDirectoryKind,
  isWorkflowDirectorySession,
} from '@/lib/agent/conversations';

describe('session directory helpers', () => {
  test('treat workflow run sidebar hints as workflow sessions even on commander tab', () => {
    const session = {
      workflowBinding: undefined,
      creationSession: undefined,
      sessionWorkbenchState: {
        homeSidebar: {
          type: 'home_sidebar' as const,
          activeTab: 'commander' as const,
          intent: 'workflow-run' as const,
        },
      },
    };

    expect(isWorkflowDirectorySession(session)).toBe(true);
    expect(getSessionDirectoryKind(session)).toBe('conversation');
  });

  test('keep agent creation sidebar hints in the conversation directory', () => {
    const session = {
      workflowBinding: undefined,
      creationSession: undefined,
      sessionWorkbenchState: {
        homeSidebar: {
          type: 'home_sidebar' as const,
          activeTab: 'agent' as const,
          intent: 'create-agent' as const,
        },
      },
    };

    expect(isWorkflowDirectorySession(session)).toBe(false);
    expect(getSessionDirectoryKind(session)).toBe('conversation');
  });
});
