// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AgentEditModal from '@/components/AgentEditModal';

const mockToast = vi.fn();

function renderWithQueryClient(ui: React.ReactElement) {
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

vi.mock('@/components/SpriteAvatar', () => ({
  default: () => <div data-testid="sprite-avatar" />,
}));

vi.mock('@/components/ModelSelect', () => ({
  ModelSelect: ({ value, onChange }: any) => (
    <input aria-label="model-select" value={value || ''} onChange={(event) => onChange?.(event.target.value)} />
  ),
}));

vi.mock('@/components/EngineSelect', () => ({
  EngineSelect: ({ value, onChange }: any) => (
    <input aria-label="engine-select" value={value || ''} onChange={(event) => onChange?.(event.target.value)} />
  ),
}));

vi.mock('@/components/ui/combobox', () => ({
  SingleCombobox: ({ value, onValueChange, options = [] }: any) => (
    <select value={value || ''} onChange={(event) => onValueChange?.(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  MultiCombobox: ({ value = [], onValueChange, options = [] }: any) => (
    <select
      multiple
      value={value}
      onChange={(event) => {
        const next = Array.from(event.currentTarget.selectedOptions).map((option) => option.value);
        onValueChange?.(next);
      }}
    >
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange }: any) => (
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock('@/lib/core/api', () => ({
  agentApi: {
    generateAvatar: vi.fn(),
  },
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe('AgentEditModal suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/engine')) {
        return {
          ok: true,
          json: async () => ({ engine: 'codex', model: 'gpt-5' }),
        } as Response;
      }
      if (url.includes('/api/skills')) {
        return {
          ok: true,
          json: async () => ({ skills: [] }),
        } as Response;
      }
      if (url.includes('/api/rag/knowledge-bases')) {
        return {
          ok: true,
          json: async () => ({ knowledgeBases: [] }),
        } as Response;
      }
      return {
        ok: false,
        json: async () => ({}),
      } as Response;
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('adds recommended capabilities constraints and keywords to saved agent', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    renderWithQueryClient(
      <AgentEditModal
        isNew
        onClose={vi.fn()}
        onSave={onSave}
        agent={{
          name: 'defender',
          team: 'red',
          roleType: 'normal',
          category: '编码',
          engineModels: {},
          activeEngine: '',
          systemPrompt: '你负责修复和验证问题。',
          capabilities: [],
          constraints: [],
          keywords: [],
          skills: [],
        }}
      />
    );

    await user.click(screen.getByRole('button', { name: '修复实施' }));
    await user.click(screen.getByRole('button', { name: '保持最小改动' }));
    await user.click(screen.getByRole('button', { name: '修复' }));

    expect(screen.queryByRole('button', { name: '修复实施' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      capabilities: ['修复实施'],
      constraints: ['保持最小改动'],
      keywords: ['修复'],
    });
  });
});
