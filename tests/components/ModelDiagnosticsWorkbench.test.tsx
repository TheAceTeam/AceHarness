// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ModelDiagnosticsWorkbench from '@/components/models/ModelDiagnosticsWorkbench';
import type { ModelDiagnosticsResponse } from '@/lib/models/diagnostic-types';

const mockToast = vi.fn();
const mockUpdateToast = vi.fn();

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    toast: mockToast,
    updateToast: mockUpdateToast,
  }),
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

describe('ModelDiagnosticsWorkbench', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
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
    render(
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

    render(
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

    render(
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
    render(
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
    expect(await screen.findByRole('button', { name: '继续未完成' })).toBeInTheDocument();
  });
});
