// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ModelSelect } from '@/components/ModelSelect';
import { EngineModelSelect } from '@/components/EngineModelSelect';

const toastSpy = vi.fn();

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock('@/components/AiModelSelectorField', () => ({
  AiModelSelectorField: ({ disabled, onValueChange, options = [], groups = [] }: any) => {
    const items = options.length > 0
      ? options.map((option: any) => ({ ...option, groupLabel: '' }))
      : groups.flatMap((group: any) => (group.items || []).map((item: any) => ({
          ...item,
          groupLabel: group.label,
        })));
    return (
      <div>
        {items.length > 0 ? items.map((item: any) => (
          <button
            key={`${item.groupLabel}:${item.value}`}
            type="button"
            disabled={disabled}
            data-value={item.value}
            onClick={() => onValueChange(item.value)}
          >
            {item.groupLabel ? `${item.groupLabel}: ${item.label}` : item.label}
          </button>
        )) : (
          <button type="button" disabled={disabled}>loading</button>
        )}
      </div>
    );
  },
}));

vi.mock('@/components/EngineIcon', () => ({
  EngineIcon: ({ engineId }: any) => <span>{engineId}</span>,
}));

describe('ModelSelect', () => {
  beforeEach(() => {
    toastSpy.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        models: [
          {
            value: 'gpt-5',
            label: 'GPT-5',
            costMultiplier: 1,
          },
        ],
      }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('suppresses change toast when showChangeToast is false', async () => {
    const onChange = vi.fn();
    renderWithQuery(<ModelSelect value="" onChange={onChange} showChangeToast={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'GPT-5' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('gpt-5'));
    expect(toastSpy).not.toHaveBeenCalled();
  });

  test('shows a change toast by default', async () => {
    const onChange = vi.fn();
    renderWithQuery(<ModelSelect value="" onChange={onChange} />);

    fireEvent.click(await screen.findByRole('button', { name: 'GPT-5' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('gpt-5'));
    expect(toastSpy).toHaveBeenCalledWith('info', '模型已切换: GPT-5 (1x)');
  });

  test('loads non-global model choices from /api/models without waiting for engine config', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/models')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: async () => ({
            models: [
              {
                value: 'gpt-5',
                label: 'GPT-5',
                costMultiplier: 1,
              },
            ],
          }),
        } as Response;
      }
      if (url.includes('/api/engine')) {
        return await new Promise<Response>(() => {});
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({}),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(<ModelSelect value="" onChange={vi.fn()} />);

    const gpt5Button = await screen.findByRole('button', { name: 'GPT-5' });
    expect(gpt5Button).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledWith('/api/models', expect.anything());
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/engine'))).toBe(false);
  });

  test('does not keep showing opencode-only models for nga after nga is removed from the model engines', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/models')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: async () => ({
            models: [
              {
                value: 'opencode-only',
                label: 'OpenCode Only',
                costMultiplier: 1,
                engines: ['opencode'],
              },
              {
                value: 'nga-only',
                label: 'NGA Only',
                costMultiplier: 1,
                engines: ['nga'],
              },
            ],
          }),
        } as Response;
      }
      if (url.includes('/api/runtime-agents')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: async () => ({
            agents: [
              {
                id: 'opencode',
                name: 'opencode',
                title: 'OpenCode',
                activeEngine: 'opencode',
                runtimeState: { enabled: true, hidden: false, availability: { status: 'available' } },
              },
              {
                id: 'nga',
                name: 'nga',
                title: 'NGA',
                activeEngine: 'nga',
                runtimeState: { enabled: true, hidden: false, availability: { status: 'available' } },
              },
            ],
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({}),
      } as Response;
    }));

    renderWithQuery(
      <EngineModelSelect
        engine="nga"
        model=""
        onEngineChange={vi.fn()}
        onModelChange={vi.fn()}
      />,
    );

    expect(await screen.findByRole('button', { name: 'NGA: NGA Only' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'NGA: OpenCode Only' })).toBeNull();
  });

  test('clears a selected model when it is no longer compatible with the selected engine', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/models')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: async () => ({
            models: [
              {
                value: 'opencode-only',
                label: 'OpenCode Only',
                costMultiplier: 1,
                engines: ['opencode'],
              },
            ],
          }),
        } as Response;
      }
      if (url.includes('/api/runtime-agents')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: async () => ({
            agents: [
              {
                id: 'opencode',
                name: 'opencode',
                title: 'OpenCode',
                activeEngine: 'opencode',
                runtimeState: { enabled: true, hidden: false, availability: { status: 'available' } },
              },
              {
                id: 'nga',
                name: 'nga',
                title: 'NGA',
                activeEngine: 'nga',
                runtimeState: { enabled: true, hidden: false, availability: { status: 'available' } },
              },
            ],
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({}),
      } as Response;
    }));

    const onModelChange = vi.fn();
    renderWithQuery(
      <EngineModelSelect
        engine="nga"
        model="opencode-only"
        onEngineChange={vi.fn()}
        onModelChange={onModelChange}
      />,
    );

    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith(''));
  });

  test('exposes DeepSeek Harness models in the composite engine selector', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/models')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: async () => ({
            models: [{
              value: 'deepseek-chat',
              label: 'DeepSeek Chat',
              costMultiplier: 1,
              engines: ['deepseek-harness'],
              endpoints: ['deepseek'],
            }],
          }),
        } as Response;
      }
      if (url.includes('/api/runtime-agents')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: async () => ({
            agents: [{
              id: 'deepseek-harness',
              name: 'deepseek-harness',
              title: 'DeepSeek Harness',
              runtimeState: { enabled: true, hidden: false, availability: { status: 'available' } },
            }],
          }),
        } as Response;
      }
      if (url.includes('/api/engine/availability')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: async () => ({ 'deepseek-harness': true }),
        } as Response;
      }
      if (url.includes('/api/engine')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: async () => ({ engine: 'deepseek-harness', defaultModel: 'deepseek-chat' }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({}),
      } as Response;
    }));

    renderWithQuery(
      <EngineModelSelect
        engine="deepseek-harness"
        model=""
        onEngineChange={vi.fn()}
        onModelChange={vi.fn()}
      />,
    );

    expect(await screen.findByRole('button', { name: 'DeepSeek Harness: DeepSeek Chat' })).toBeInTheDocument();
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
