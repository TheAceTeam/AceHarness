import { NextRequest, NextResponse } from 'next/server';
import { loadStreamContent, loadRunState } from '@/lib/run/state-persistence';
import { processManager } from '@/lib/core/process-manager';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const step = request.nextUrl.searchParams.get('step');
  if (!step) {
    return NextResponse.json({ error: '缺少 step 参数' }, { status: 400 });
  }

  const live = request.nextUrl.searchParams.get('live');

  // Legacy non-SSE mode: return persisted content as JSON
  if (!live) {
    const content = await loadStreamContent(id, step);
    return NextResponse.json({ step, content: content || '' });
  }

  // SSE mode: stream real-time content from processManager
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      /** Bytes already sent to client from the persisted stream file. */
      let lastFileSentLen = 0;

      const send = (event: string, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const flushPersistedStream = async () => {
        const c = await loadStreamContent(id, step);
        if (!c) return;
        if (c.length < lastFileSentLen) {
          lastFileSentLen = 0;
        }
        if (c.length <= lastFileSentLen) return;
        send('delta', { content: c.slice(lastFileSentLen) });
        lastFileSentLen = c.length;
      };

      // Initial snapshot from disk. The persisted stream is authoritative because it
      // contains workflow chunk boundaries, human feedback markers, and resumed output
      // in the correct order.
      void flushPersistedStream();

      // Poll persisted stream file — SDK Plan / engines that only use saveStreamContent
      const filePoll = setInterval(() => {
        void flushPersistedStream();
      }, 800);

      // Listen for live stream events. Text deltas are persisted by the workflow
      // manager and then emitted by file polling so offsets never mix process-local
      // stream length with the full persisted stream length.
      const onStream = (evt: any) => {
        if (closed) return;
        const proc = processManager.getProcessRaw?.(evt.id);
        if (proc?.runId !== id || proc.step !== step) return;
        if (evt.thinking) {
          send('thinking', { content: evt.thinking });
        }
      };

      processManager.on('stream', onStream);

      // Done when: no running proc AND run state no longer running, OR a finished proc exists for this run
      const checkDone = setInterval(() => {
        void (async () => {
          if (closed) return;
          const procs = processManager.getAllProcesses();
          const hasRunningProc = procs.some((p: any) => p.runId === id && p.status === 'running');
          let runStillActive = false;
          try {
            const rs = await loadRunState(id);
            runStillActive = rs?.status === 'running';
          } catch {
            /* ignore */
          }
          if (hasRunningProc || runStillActive) return;

          await flushPersistedStream();

          const finished = procs.find(
            (p: any) =>
              p.runId === id &&
              p.step === step &&
              (p.status === 'completed' || p.status === 'failed' || p.status === 'killed'),
          );
          if (finished) {
            send('done', { status: finished.status });
            cleanup();
            return;
          }

          try {
            const rs = await loadRunState(id);
            if (rs && rs.status !== 'running') {
              send('done', { status: rs.status });
              cleanup();
            }
          } catch {
            /* ignore */
          }
        })();
      }, 2000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        processManager.off('stream', onStream);
        clearInterval(checkDone);
        clearInterval(filePoll);
        try { controller.close(); } catch {}
      };

      request.signal.addEventListener('abort', cleanup);
      send('connected', { runId: id, step });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
