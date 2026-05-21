import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/middleware';
import {
  cancelModelDiagnosticRun,
  getModelDiagnosticRun,
  startModelDiagnosticRun,
  subscribeModelDiagnosticRun,
  type ModelDiagnosticRunSnapshot,
  type ModelDiagnosticRunStreamEvent,
} from '@/lib/models/diagnostic-runs';
import type { ModelDiagnosticsRequest } from '@/lib/models/diagnostic-types';

export const dynamic = 'force-dynamic';

type DiagnosticsStreamRequest = ModelDiagnosticsRequest & {
  action?: 'start' | 'resume' | 'cancel';
  runId?: string;
};

function runPayload(run: ModelDiagnosticRunSnapshot) {
  return {
    type: 'run',
    runId: run.id,
    status: run.status,
    run: {
      id: run.id,
      request: run.request,
      status: run.status,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      finishedAt: run.finishedAt,
      error: run.error,
    },
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({})) as DiagnosticsStreamRequest;
  const action = body?.action === 'resume' || body?.action === 'cancel' ? body.action : 'start';
  const requestedRunId = typeof body?.runId === 'string' ? body.runId.trim() : '';

  if (action === 'cancel') {
    const cancelled = requestedRunId ? cancelModelDiagnosticRun(requestedRunId) : null;
    if (!cancelled) {
      return NextResponse.json(
        { ok: false, error: '诊断任务已结束或不存在，无法停止' },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, run: runPayload(cancelled).run });
  }

  const run = action === 'resume'
    ? (requestedRunId ? getModelDiagnosticRun(requestedRunId) : null)
    : startModelDiagnosticRun(body || {}, requestedRunId || undefined);

  if (!run) {
    return NextResponse.json(
      { ok: false, error: requestedRunId ? '诊断任务已结束或不存在，无法恢复' : '缺少诊断任务 ID' },
      { status: 404 },
    );
  }

  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          closed = true;
          unsubscribe?.();
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // The browser may have already detached from the stream.
        }
      };
      const sendTerminal = (event: ModelDiagnosticRunStreamEvent) => {
        send(event);
        close();
      };

      send(runPayload(run));
      for (const log of run.logs) {
        send({ type: 'log', runId: run.id, log });
      }

      if ((run.status === 'completed' || run.status === 'cancelled') && run.result) {
        sendTerminal({ type: 'result', runId: run.id, result: run.result });
        return;
      }
      if (run.status === 'failed' || run.status === 'cancelled') {
        sendTerminal({ type: 'error', runId: run.id, error: run.error || '诊断任务失败' });
        return;
      }

      unsubscribe = subscribeModelDiagnosticRun(run.id, (event) => {
        if (event.type === 'result' || event.type === 'error') {
          sendTerminal(event);
          return;
        }
        send(event);
      });
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      // Detaching the page only closes this subscription. The diagnostic run
      // continues in the in-memory registry and can be resumed by runId.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
