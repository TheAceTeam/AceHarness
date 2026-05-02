import React, { type ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';

/**
 * Default mock return value for useChat().
 * Tests can override individual properties via vi.mock or by passing overrides.
 */
export const defaultChatContextMock = {
  isOpen: false,
  openChat: vi.fn(),
  closeChat: vi.fn(),
  toggleChat: vi.fn(),
  sessions: [] as any[],
  activeSessionId: null as string | null,
  activeSession: null as any,
  createSession: vi.fn(() => 'mock-session-id'),
  deleteSession: vi.fn(),
  renameSession: vi.fn(),
  setActiveSessionId: vi.fn(),
  sendMessage: vi.fn(async () => {}),
  stopStreaming: vi.fn(),
  deleteMessage: vi.fn(),
  retryFromMessage: vi.fn(),
  continueFromMessage: vi.fn(async () => {}),
  loading: false,
  streamingMessageId: null as string | null,
  model: 'claude-sonnet-4-20250514',
  setModel: vi.fn(),
  engine: 'claude-code',
  effectiveEngine: 'claude-code',
  setEngine: vi.fn(),
  confirmAction: vi.fn(async () => {}),
  rejectAction: vi.fn(),
  undoActionById: vi.fn(async () => {}),
  retryAction: vi.fn(async () => {}),
  skillSettings: {} as Record<string, boolean>,
  discoveredSkills: [] as any[],
  toggleSkill: vi.fn(),
  workingDirectory: '/tmp/project',
  setWorkingDirectory: vi.fn(),
  setSessionWorkbenchState: vi.fn(),
  appendVisibleSessionTag: vi.fn(async () => {}),
  appendSessionMessage: vi.fn(),
};

/**
 * Default mock return value for useRouter().
 */
export const defaultRouterMock = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(async () => {}),
};

/**
 * Default mock return value for useTranslations().
 */
export function mockT(key: string, values?: Record<string, any>): string {
  if (values) {
    let result = key;
    for (const [k, v] of Object.entries(values)) {
      result = result.replace(`{${k}}`, String(v));
    }
    return result;
  }
  return key;
}

/**
 * Render a component with mocked providers.
 * Each test file should use vi.mock() for the specific modules it needs.
 *
 * Example:
 * ```tsx
 * vi.mock('next/navigation', () => ({ useRouter: () => defaultRouterMock }));
 * vi.mock('@/contexts/ChatContext', () => ({ useChat: () => defaultChatContextMock }));
 *
 * test('renders', () => {
 *   renderWithProviders(<MyComponent />);
 * });
 * ```
 */
export function renderWithProviders(ui: ReactNode): RenderResult {
  return render(<>{ui}</>);
}
