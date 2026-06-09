// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  });

  test('keeps workflow options available when schedule loading fails', async () => {
    apiMocks.listSchedules.mockRejectedValue(new Error('scheduler route failed'));
    apiMocks.listAllConfigs.mockResolvedValue({
      configs: [{ filename: 'recovered.yaml', name: 'Recovered Workflow' }],
    });

    const { default: SchedulesPanel } = await import('@/components/SchedulesPanel');
    render(<SchedulesPanel />);

    await waitFor(() => expect(apiMocks.listAllConfigs).toHaveBeenCalled());
    fireEvent.click(screen.getByText('schedules.new'));

    expect(screen.getByText('Recovered Workflow (recovered.yaml)')).toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith('error', 'scheduler route failed');
  });
});
