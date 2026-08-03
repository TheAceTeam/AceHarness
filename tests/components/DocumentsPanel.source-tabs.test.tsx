// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { DocumentSourceTabs } from '@/components/documents/DocumentSourceTabs';

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div role="tablist">{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button type="button" role="tab">{children}</button>,
}));

const sourceOptions = [
  { value: 'all' as const, label: '全部', count: 3 },
  { value: 'runtime-output' as const, label: '步骤文档', count: 2 },
  { value: 'tasklist' as const, label: '任务清单', count: 1 },
];

describe('DocumentsPanel document-source tabs', () => {
  test('hides source-switching tabs for a locked tasklist view while normal views retain them', () => {
    const locked = render(
      <DocumentSourceTabs
        activeSource="tasklist"
        lockedSource="tasklist"
        options={sourceOptions}
        onSourceChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('tab', { name: /全部/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /步骤文档/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /任务清单/ })).not.toBeInTheDocument();

    locked.unmount();
    render(
      <DocumentSourceTabs
        activeSource="all"
        options={sourceOptions}
        onSourceChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: /全部/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /步骤文档/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /任务清单/ })).toBeInTheDocument();
  });
});
