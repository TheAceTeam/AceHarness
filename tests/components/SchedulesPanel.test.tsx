// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  listAllConfigs: vi.fn(),
}));

const toastMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/core/api', () => ({
  scheduleApi: {
    list: apiMocks.listSchedules,
    create: vi.fn(),
    update: vi.fn(),
    toggle: vi.fn(),
    trigger: vi.fn(),
    delete: vi.fn(),
  },
  configApi: {
    listAllConfigs: apiMocks.listAllConfigs,
  },
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(), dialogProps: null }),
}));

vi.mock('@/components/ConfirmDialog', () => ({
  default: () => null,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: any) => <label>{children}</label>,
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange }: any) => (
    <button type="button" aria-pressed={checked} onClick={() => onCheckedChange?.(!checked)} />
  ),
}));

vi.mock('@/components/ui/combobox', () => ({
  ComboboxPortalProvider: ({ children }: any) => <>{children}</>,
  SingleCombobox: ({ options, placeholder }: any) => (
    <div data-testid={placeholder || 'combobox'}>
      {(options || []).map((option: any) => (
        <div key={option.value}>{option.label}</div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button type="button">{children}</button>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

describe('SchedulesPanel', () => {
  beforeEach(() => {
    apiMocks.listSchedules.mockReset();
    apiMocks.listAllConfigs.mockReset();
    toastMock.mockReset();
    vi.unstubAllGlobals();
  });

  test('keeps workflow options available when schedule loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/schedules')) {
        return new Response(JSON.stringify({ error: 'scheduler route failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/configs')) {
        return new Response(JSON.stringify({
          configs: [{ filename: 'recovered.yaml', name: 'Recovered Workflow' }],
          pagination: { total: 1, totalPages: 1, page: 1, pageSize: 500, unfilteredTotal: 1 },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const { default: SchedulesPanel } = await import('@/components/SchedulesPanel');
    renderWithQuery(<SchedulesPanel />);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/configs'), expect.any(Object)));
    fireEvent.click(screen.getByText('schedules.new'));

    expect(screen.getByText('Recovered Workflow (recovered.yaml)')).toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith('error', 'scheduler route failed');
  });
});

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  );
}
