// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockListConfigs: vi.fn(async () => ({
    configs: [],
    pagination: {
      total: 0,
      totalPages: 1,
      page: 1,
      pageSize: 20,
      unfilteredTotal: 0,
    },
  })),
  mockListCreationSessions: vi.fn(async () => ({ sessions: [] })),
  mockListShareableUsers: vi.fn(async () => []),
  mockToast: vi.fn(),
  mockConfirm: vi.fn(async () => false),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(async () => {}),
  }),
  useSearchParams: () => ({
    get: vi.fn(() => null),
    toString: vi.fn(() => ''),
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={typeof href === 'string' ? href : href?.pathname || ''} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const createMotionComponent = (tag: keyof JSX.IntrinsicElements) =>
    React.forwardRef<any, any>(({ children, ...props }, ref) =>
      React.createElement(tag, { ref, ...props }, children)
    );

  return {
    motion: new Proxy({}, {
      get: (_target, tag: string) => createMotionComponent(tag as keyof JSX.IntrinsicElements),
    }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/components/dashboard/DashboardDockWorkspace', () => ({
  useDashboardDockWorkspace: () => null,
}));

vi.mock('@/components/dashboard/DashboardShellHeader', () => ({
  useDashboardShellHeader: () => ({ isDashboardShell: false }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: mocks.mockToast }),
}));

vi.mock('@/hooks/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: mocks.mockConfirm, dialogProps: null }),
}));

vi.mock('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: vi.fn(),
}));

vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

vi.mock('@/components/language-toggle', () => ({
  LanguageToggle: () => <div data-testid="language-toggle" />,
}));

vi.mock('@/components/NewConfigModal', () => ({
  default: ({ isOpen, initialMode, hideAiGuided, focusRequirementsOnOpen }: any) => (
    isOpen ? (
      <div
        data-testid="new-config-modal"
        data-initial-mode={initialMode}
        data-hide-ai-guided={String(hideAiGuided)}
        data-focus-requirements={String(focusRequirementsOnOpen)}
      />
    ) : null
  ),
}));

vi.mock('@/lib/core/api', () => ({
  configApi: {
    listConfigs: mocks.mockListConfigs,
    deleteConfig: vi.fn(),
    batchDeleteConfigs: vi.fn(),
    copyConfig: vi.fn(),
    getConfig: vi.fn(),
    saveConfigWithMeta: vi.fn(),
    importConfigZip: vi.fn(),
    exportConfigs: vi.fn(),
  },
  specCodingApi: {
    listCreationSessions: mocks.mockListCreationSessions,
  },
  usersApi: {
    listShareableUsers: mocks.mockListShareableUsers,
  },
}));

import WorkflowsPage from '@/app/workflows/page';

describe('WorkflowsPage AI creation entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('opens the create workflow modal directly with AI guided mode', async () => {
    const user = userEvent.setup();

    render(<WorkflowsPage />);

    await user.click(screen.getAllByRole('button', { name: /AI 创建/ })[0]);

    await waitFor(() => {
      const modal = screen.getByTestId('new-config-modal');
      expect(modal).toHaveAttribute('data-initial-mode', 'ai-guided');
      expect(modal).toHaveAttribute('data-hide-ai-guided', 'false');
      expect(modal).toHaveAttribute('data-focus-requirements', 'true');
    });

    expect(mocks.mockPush).not.toHaveBeenCalled();
  });
});
