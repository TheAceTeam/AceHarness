import { jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { loadStreamContent, loadRunState } from '@/lib/run/state-persistence';
import { processManager } from '@/lib/core/process-manager';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const id = (await params).id;
  const step = requestUrl(request).searchParams.get('step');
  if (!step) {
    return jsonOk({ error: '缺少 step 参数' }, { status: 400 });
  }

  const live = requestUrl(request).searchParams.get('live');

  // Legacy non-SSE mode: return persisted content as JSON
  if (!live) {
    const content = await loadStreamContent(id, step);
    return jsonOk({ step, content: content || '' });
  }

  // SSE mode: stream real-time content from processManager
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      /** Bytes already sent to client from the persisted stream file. */
      let lastFileSentLen = 0;
      let filePoll: ReturnType<typeof setInterval> | null = null;
      let checkDone: ReturnType<typeof setInterval> | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let onStream: ((evt: any) => void) | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (onStream) processManager.off('stream', onStream);
        if (checkDone) clearInterval(checkDone);
        if (filePoll) clearInterval(filePoll);
        if (heartbeat) clearInterval(heartbeat);
        try { controller.close(); } catch {}
      };

      const send = (event: string, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
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
      filePoll = setInterval(() => {
        void flushPersistedStream();
      }, 800);

      // Listen for live stream events. Text deltas are persisted by the workflow
      // manager and then emitted by file polling so offsets never mix process-local
      // stream length with the full persisted stream length.
      onStream = (evt: any) => {
        if (closed) return;
        const proc = processManager.getProcessRaw?.(evt.id);
        if (proc?.runId !== id || proc.step !== step) return;
        if (evt.thinking) {
          send('thinking', { content: evt.thinking });
        }
      };

      processManager.on('stream', onStream);
      heartbeat = setInterval(() => send('heartbeat', { timestamp: new Date().toISOString() }), 15000);

      // Done when: no running proc AND run state no longer running, OR a finished proc exists for this run
      checkDone = setInterval(() => {
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
