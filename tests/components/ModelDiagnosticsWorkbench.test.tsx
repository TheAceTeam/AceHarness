// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ModelDiagnosticsWorkbench from '@/components/models/ModelDiagnosticsWorkbench';
import type { ModelDiagnosticsResponse } from '@/lib/models/diagnostic-types';
import { queryKeys } from '@/client/query/query-keys';

const mockToast = vi.fn();
const mockUpdateToast = vi.fn();
const mockDismissToast = vi.fn();

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    toast: mockToast,
    updateToast: mockUpdateToast,
    dismissToast: mockDismissToast,
  }),
}));

// Model selection is covered by tests/model-select.test.tsx; keep this suite
// focused on the diagnostics workbench stream lifecycle.
vi.mock('@/components/EngineModelSelect', () => ({
  EngineModelSelect: ({
    onEngineChange,
    onModelChange,
  }: {
    onEngineChange: (engine: string) => void;
    onModelChange: (model: string) => void;
  }) => {
    React.useEffect(() => {
      onEngineChange('claude-code');
      onModelChange('claude-sonnet-4-20250514');
    }, [onEngineChange, onModelChange]);
    return <div data-testid="diagnostics-model-select" />;
  },
}));

const storedResult: ModelDiagnosticsResponse = {
  ok: true,
  engine: 'claude-code',
  driver: 'auto',
  model: 'claude-sonnet-4-20250514',
  startedAt: '2026-05-21T00:00:00.000Z',
  finishedAt: '2026-05-21T00:00:03.000Z',
  totalDurationMs: 3000,
  logs: [
    {
      id: 'log-1',
      at: '2026-05-21T00:00:00.500Z',
      elapsedMs: 500,
      level: 'info',
      message: 'probe start',
      detail: 'single-turn',
    },
    {
      id: 'log-2',
      at: '2026-05-21T00:00:01.500Z',
      elapsedMs: 1500,
      level: 'success',
      message: 'probe done',
      detail: 'ACE_OK',
    },
  ],
};

const progressResult: ModelDiagnosticsResponse = {
  ok: true,
  engine: 'claude-code',
  driver: 'auto',
  model: 'claude-sonnet-4-20250514',
  startedAt: '2026-05-21T00:00:00.000Z',
  finishedAt: '2026-05-21T00:00:01.500Z',
  totalDurationMs: 1500,
  logs: [
    {
      id: 'progress-log-1',
      at: '2026-05-21T00:00:00.500Z',
      elapsedMs: 500,
      level: 'success',
      message: '单轮对话 probe 完成',
      detail: 'ACE_OK',
    },
  ],
  engineDebug: {
    engine: 'claude-code',
    driver: 'auto',
    effectiveEngine: 'claude-code',
    available: true,
    streamSupported: true,
    observedEventTypes: ['session', 'text'],
    stages: [
      {
        id: 'availability',
        label: '环境可用性',
        status: 'passed',
        durationMs: 12,
        startedAt: '2026-05-21T00:00:00.000Z',
        finishedAt: '2026-05-21T00:00:00.012Z',
        detail: 'available=true',
      },
      {
        id: 'create-engine',
        label: 'Wrapper 初始化',
        status: 'passed',
        durationMs: 20,
        startedAt: '2026-05-21T00:00:00.012Z',
        finishedAt: '2026-05-21T00:00:00.032Z',
        detail: 'effective=claude-code',
      },
      {
        id: 'single-turn',
        label: '单轮对话',
        status: 'passed',
        durationMs: 380,
        startedAt: '2026-05-21T00:00:00.032Z',
        finishedAt: '2026-05-21T00:00:00.412Z',
        detail: '输出 6 字符，首个文本 120ms',
      },
      {
        id: 'stream-events',
        label: '流式输出与事件格式',
        status: 'passed',
        durationMs: 1,
        startedAt: '2026-05-21T00:00:00.412Z',
        finishedAt: '2026-05-21T00:00:00.413Z',
        detail: '观察到 session, text 事件',
      },
    ],
    runs: [
      {
        id: 'engine-single-turn',
        label: '单轮对话',
        category: 'engine-debug',
        status: 'passed',
        durationMs: 380,
        firstEventMs: 80,
        firstTextMs: 120,
        outputChars: 6,
        charsPerSecond: 15.79,
        outputPreview: 'ACE_OK',
        prompt: '请回复 ACE_OK',
        eventCounts: { session: 1, text: 1 },
        eventSamples: [],
      },
    ],
  },
  modelEvaluation: {
    overallScore: 92,
    tier: 'strong',
    tierLabel: '强',
    capabilities: [
      {
        id: 'output_speed',
        label: '输出速度',
        score: 94,
        status: 'passed',
        summary: '首字延迟和输出吞吐表现良好',
        evidence: ['平均首个文本：120ms', '平均输出速度：15.8 chars/s', '成功样本：1/1'],
        metrics: {
          averageFirstTextMs: 120,
          averageCharsPerSecond: 15.79,
          successRate: 100,
        },
      },
      {
        id: 'json_output',
        label: 'JSON 输出',
        score: 90,
        status: 'passed',
        summary: '能够按约定返回机器可读 JSON',
        evidence: ['返回内容可直接作为 JSON 解析', 'checksum 精确命中'],
        metrics: {
          validJson: true,
          wholeJson: true,
          checksum: 'prompt_injection:false|tool_substitution:false|risk:HIGH',
          durationMs: 700,
        },
      },
    ],
    runs: [
      {
        id: 'cap-json',
        label: 'JSON 输出',
        category: 'model-score',
        status: 'passed',
        durationMs: 700,
        firstEventMs: 100,
        firstTextMs: 140,
        outputChars: 240,
        charsPerSecond: 342.86,
        outputPreview: '{"checksum":"prompt_injection:false|tool_substitution:false|risk:HIGH"}',
        prompt: '请只输出 JSON',
        eventCounts: { session: 1, text: 1 },
        eventSamples: [],
      },
    ],
  },
};

const failedCapabilityResult: ModelDiagnosticsResponse = {
  ...progressResult,
  modelEvaluation: {
    overallScore: 68,
    tier: 'usable',
    tierLabel: '可用',
    capabilities: [
      {
        id: 'output_speed',
        label: '输出速度',
        score: 82,
        status: 'passed',
        summary: '首字延迟和输出吞吐表现良好',
        evidence: ['平均首个文本：120ms', '平均输出速度：15.8 chars/s', '成功样本：1/1'],
        metrics: {
          averageFirstTextMs: 120,
          averageCharsPerSecond: 15.79,
          successRate: 100,
        },
      },
      {
        id: 'json_output',
        label: 'JSON 输出',
        score: 54,
        status: 'warning',
        summary: 'JSON 格式不稳定，需要检查提示词或模型能力',
        evidence: ['未能解析出合法 JSON'],
        metrics: {
          validJson: false,
          wholeJson: false,
          durationMs: 700,
        },
      },
    ],
    runs: [
      {
        id: 'cap-json',
        label: 'JSON 输出',
        category: 'model-score',
        status: 'warning',
        durationMs: 700,
        firstEventMs: 100,
        firstTextMs: 140,
        outputChars: 240,
        charsPerSecond: 342.86,
        outputPreview: '```ts\nconst answer = 42;\n```\n\n$$x^2 + y^2 = z^2$$',
        prompt: '请解释并输出：\n\n```ts\nconst answer = 42;\n```\n\n$$x^2 + y^2 = z^2$$',
        eventCounts: { session: 1, text: 1 },
        eventSamples: [],
      },
    ],
  },
};

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(queryKeys.models(), {
    models: [{
      value: 'claude-sonnet-4-20250514',
      label: 'Claude Sonnet 4',
      engines: ['claude-code'],
    }],
  });
  queryClient.setQueryData([...queryKeys.agents(), 'runtime-engine-options'], [
    { id: 'claude-code', name: 'Claude Code' },
  ]);
  queryClient.setQueryData([...queryKeys.models(), 'runtime-selection'], {
    engine: 'claude-code',
    defaultModel: 'claude-sonnet-4-20250514',
    source: 'runtime-model-routes',
  });
  queryClient.setQueryData([
    ...queryKeys.engineAvailability(),
    { reports: true, forceRefresh: false, refreshToken: 0 },
  ], {
    'claude-code': {
      engine: 'claude-code',
      available: true,
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  );
}

describe('ModelDiagnosticsWorkbench', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockToast.mockReturnValue(1);
    localStorage.clear();
    localStorage.setItem('ace-model-diagnostics:last-result', JSON.stringify({
      result: storedResult,
      logs: storedResult.logs,
      savedAt: storedResult.finishedAt,
    }));
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:diagnostic-log');
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });

  test('renders diagnostic log title and virtual log list', async () => {
    renderWithQueryClient(
      <ModelDiagnosticsWorkbench
        managedModels={[
          {
            id: 'claude-sonnet-4-20250514',
            name: 'Claude Sonnet 4',
            endpoints: ['anthropic'],
            engines: ['claude-code'],
          },
        ]}
      />,
    );

    expect(await screen.findByText('运行日志')).toBeInTheDocument();
    expect(screen.getByText('诊断日志')).toBeInTheDocument();
    expect(screen.queryByText('详细日志')).toBeNull();
    expect(screen.getByTestId('diagnostic-log-virtual-list')).toBeInTheDocument();
    expect(screen.getByText(/probe start/)).toBeInTheDocument();
  });

  test('downloads diagnostic logs', async () => {
    const user = userEvent.setup();

    renderWithQueryClient(
      <ModelDiagnosticsWorkbench
        managedModels={[
          {
            id: 'claude-sonnet-4-20250514',
            name: 'Claude Sonnet 4',
            endpoints: ['anthropic'],
            engines: ['claude-code'],
          },
        ]}
      />,
    );

    const button = await screen.findByRole('button', { name: '下载日志' });
    await user.click(button);

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith('success', '诊断日志已开始下载');
  });

  test('restores an active diagnostics stream after remount', async () => {
    const result: ModelDiagnosticsResponse = {
      ...storedResult,
      logs: [
        {
          id: 'restored-log',
          at: '2026-05-21T00:00:01.000Z',
          elapsedMs: 1000,
          level: 'success',
          message: '恢复后的诊断完成',
        },
      ],
    };
    localStorage.setItem('ace-model-diagnostics:active-run', JSON.stringify({
      runId: 'diag-active-1',
      requestBody: {
        engine: 'claude-code',
        driver: 'auto',
        model: 'claude-sonnet-4-20250514',
        timeoutMs: 180000,
        includeEngineDebug: true,
        includeModelScore: true,
        modelCapabilityIds: ['json_output'],
      },
      startedAt: '2026-05-21T00:00:00.000Z',
    }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response([
      JSON.stringify({
        type: 'run',
        runId: 'diag-active-1',
        status: 'running',
        run: {
          id: 'diag-active-1',
          request: {
            engine: 'claude-code',
            driver: 'auto',
            model: 'claude-sonnet-4-20250514',
            timeoutMs: 180000,
            includeEngineDebug: true,
            includeModelScore: true,
            modelCapabilityIds: ['json_output'],
          },
          status: 'running',
          startedAt: '2026-05-21T00:00:00.000Z',
        },
      }),
      JSON.stringify({ type: 'log', runId: 'diag-active-1', log: result.logs?.[0] }),
      JSON.stringify({ type: 'result', runId: 'diag-active-1', result }),
    ].join('\n') + '\n', {
      headers: { 'Content-Type': 'application/x-ndjson' },
    }));

    renderWithQueryClient(
      <ModelDiagnosticsWorkbench
        managedModels={[
          {
            id: 'claude-sonnet-4-20250514',
            name: 'Claude Sonnet 4',
            endpoints: ['anthropic'],
            engines: ['claude-code'],
          },
        ]}
      />,
    );

    expect(await screen.findByText(/恢复后的诊断完成/)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith('/api/models/diagnostics/stream', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"action":"resume"'),
    }));
    await waitFor(() => {
      expect(localStorage.getItem('ace-model-diagnostics:active-run')).toBeNull();
    });
  });

  test('stops active diagnostics and exposes continue action', async () => {
    localStorage.removeItem('ace-model-diagnostics:last-result');
    const neverEndingStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({
          type: 'run',
          runId: 'diag-stop-1',
          status: 'running',
          run: {
            id: 'diag-stop-1',
            request: {
              engine: 'claude-code',
              driver: 'auto',
              model: 'claude-sonnet-4-20250514',
              timeoutMs: 180000,
              includeEngineDebug: true,
              includeModelScore: true,
              modelCapabilityIds: ['json_output'],
            },
            status: 'running',
            startedAt: '2026-05-21T00:00:00.000Z',
          },
        })}\n`));
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(neverEndingStream, {
        headers: { 'Content-Type': 'application/x-ndjson' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      }));

    const user = userEvent.setup();
    renderWithQueryClient(
      <ModelDiagnosticsWorkbench
        managedModels={[
          {
            id: 'claude-sonnet-4-20250514',
            name: 'Claude Sonnet 4',
            endpoints: ['anthropic'],
            engines: ['claude-code'],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: '开始评测' }));
    expect(await screen.findByRole('button', { name: '停止诊断' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '停止诊断' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith('/api/models/diagnostics/stream', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"action":"cancel"'),
      }));
    });
    expect(mockDismissToast).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: '继续未完成' })).toBeInTheDocument();
  });

  test('shows completed stages and scores during an active stream', async () => {
    localStorage.removeItem('ace-model-diagnostics:last-result');
    let progressTimer: number | undefined;
    const activeStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({
          type: 'run',
          runId: 'diag-progress-1',
          status: 'running',
          run: {
            id: 'diag-progress-1',
            request: {
              engine: 'claude-code',
              driver: 'auto',
              model: 'claude-sonnet-4-20250514',
              timeoutMs: 180000,
              includeEngineDebug: true,
              includeModelScore: true,
              modelCapabilityIds: ['json_output'],
            },
            status: 'running',
            startedAt: '2026-05-21T00:00:00.000Z',
          },
        })}\n`));
        // Keep the response open like the real diagnostics stream, but send
        // progress from a later turn so the reader and React can commit each
        // lifecycle update independently.
        progressTimer = window.setTimeout(() => {
          progressTimer = undefined;
          controller.enqueue(new TextEncoder().encode(`${JSON.stringify({
            type: 'progress',
            runId: 'diag-progress-1',
            result: progressResult,
          })}\n`));
        }, 0);
      },
      cancel() {
        if (progressTimer !== undefined) window.clearTimeout(progressTimer);
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(activeStream, {
        headers: { 'Content-Type': 'application/x-ndjson' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      }));

    const user = userEvent.setup();
    renderWithQueryClient(
      <ModelDiagnosticsWorkbench
        managedModels={[
          {
            id: 'claude-sonnet-4-20250514',
            name: 'Claude Sonnet 4',
            endpoints: ['anthropic'],
            engines: ['claude-code'],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: '开始评测' }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/models/diagnostics/stream', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"action":"start"'),
      }));
    });

    expect(await screen.findByRole('heading', { name: '运行调试' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '模型能力评分' })).toBeInTheDocument();
    expect(screen.getByText('观察到 session, text 事件')).toBeInTheDocument();
    expect(screen.getByText('JSON 输出')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /JSON 输出/ }));
    expect(screen.getByText('checksum 精确命中')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停止诊断' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '停止诊断' }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith('/api/models/diagnostics/stream', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"action":"cancel"'),
      }));
    });
  });

  test('renders code and math output and allows retrying only the selected failed capability', async () => {
    localStorage.setItem('ace-model-diagnostics:last-result', JSON.stringify({
      result: failedCapabilityResult,
      logs: failedCapabilityResult.logs,
      savedAt: failedCapabilityResult.finishedAt,
    }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response([
      JSON.stringify({
        type: 'run',
        runId: 'diag-retry-one-1',
        status: 'running',
        run: {
          id: 'diag-retry-one-1',
          status: 'running',
          startedAt: '2026-05-21T00:00:00.000Z',
        },
      }),
      JSON.stringify({ type: 'result', runId: 'diag-retry-one-1', result: failedCapabilityResult }),
    ].join('\n') + '\n', {
      headers: { 'Content-Type': 'application/x-ndjson' },
    }));

    const user = userEvent.setup();
    const { container } = renderWithQueryClient(
      <ModelDiagnosticsWorkbench
        managedModels={[
          {
            id: 'claude-sonnet-4-20250514',
            name: 'Claude Sonnet 4',
            endpoints: ['anthropic'],
            engines: ['claude-code'],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /JSON 输出/ }));

    expect(screen.getByRole('button', { name: '重试此项' })).toBeInTheDocument();
    expect(screen.getAllByText((_, node) => Boolean(node?.textContent?.includes('const answer = 42;'))).length).toBeGreaterThan(0);
    expect(container.querySelector('.katex')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: '重试此项' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/models/diagnostics/stream', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"modelCapabilityIds":["json_output"]'),
      }));
    });
    expect(fetchSpy).toHaveBeenCalledWith('/api/models/diagnostics/stream', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"includeEngineDebug":false'),
    }));
  });
});
