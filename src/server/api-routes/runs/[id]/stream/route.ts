import { jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { loadStreamContent, loadStreamToolEvents, loadRunState } from '@/lib/run/state-persistence';
import { processManager } from '@/lib/core/process-manager';
import type { RuntimeToolEvent } from '@/lib/runtime-agent/tool-events';

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
    const [content, toolEvents] = await Promise.all([
      loadStreamContent(id, step),
      loadStreamToolEvents(id, step),
    ]);
    return jsonOk({ step, content: content || '', toolEvents });
  }

  // SSE mode: stream real-time content from processManager
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      /** Bytes already sent to client from the persisted stream file. */
      let lastFileSentLen = 0;
      let initialSnapshotLoaded = false;
      let filePoll: ReturnType<typeof setInterval> | null = null;
      let checkDone: ReturnType<typeof setInterval> | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let onStream: ((evt: any) => void) | null = null;
      const pendingLiveEvents: any[] = [];
      const sentTools = new Map<string, string>();

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

      const sendTool = (tool: RuntimeToolEvent) => {
        if (!tool?.id) return;
        const signature = JSON.stringify(tool);
        if (sentTools.get(tool.id) === signature) return;
        sentTools.set(tool.id, signature);
        send('tool', { tool });
      };

      const flushPersistedTools = async () => {
        const tools = await loadStreamToolEvents(id, step);
        for (const tool of tools) sendTool(tool);
      };

      const flushPersistedUpdates = async () => {
        await flushPersistedStream();
        await flushPersistedTools();
      };

      // The first replay is a complete persisted transcript, not an append.
      // A client may have stale IndexedDB data, so it must be able to replace
      // that cache before it receives any incremental deltas.
      const sendInitialSnapshot = async () => {
        const [content, tools] = await Promise.all([
          loadStreamContent(id, step),
          loadStreamToolEvents(id, step),
        ]);
        const snapshotContent = content || '';
        lastFileSentLen = snapshotContent.length;
        send('snapshot', { content: snapshotContent });
        for (const tool of tools) sendTool(tool);
        return snapshotContent;
      };

      const handleLiveEvent = (evt: any) => {
        if (evt.thinking) {
          send('thinking', { content: evt.thinking });
          return;
        }
        if (typeof evt.delta === 'string' && evt.delta) {
          // The workflow manager persists this exact delta. Advance the file
          // cursor as well so the poller does not replay it a second time.
          lastFileSentLen += evt.delta.length;
          send('delta', { content: evt.delta });
          return;
        }
        if (evt.tool && typeof evt.tool === 'object') {
          sendTool(evt.tool as RuntimeToolEvent);
        }
      };

      // Poll the persisted transcript for reconnects and for engine paths that
      // do not have a process-local stream. Tool updates are replayed separately.
      filePoll = setInterval(() => {
        void flushPersistedUpdates();
      }, 800);

      onStream = (evt: any) => {
        if (closed) return;
        const proc = processManager.getProcessRaw?.(evt.id);
        if (proc?.runId !== id || proc.step !== step) return;
        if (!initialSnapshotLoaded) {
          pendingLiveEvents.push(evt);
          return;
        }
        handleLiveEvent(evt);
      };

      processManager.on('stream', onStream);
      heartbeat = setInterval(() => send('heartbeat', { timestamp: new Date().toISOString() }), 15000);

      void (async () => {
        const snapshotContent = await sendInitialSnapshot();
        initialSnapshotLoaded = true;
        const pending = pendingLiveEvents.splice(0);
        // appendStreamContent is asynchronous, so a queued process event may
        // already be represented in the snapshot. `total` is the process's
        // cumulative stream at that event; if the snapshot ends with it, all
        // preceding text events are already included.
        const lastSnapshotIncludedEvent = pending.reduce((last, evt, index) => (
          typeof evt?.delta === 'string'
          && typeof evt?.total === 'string'
          && evt.total
          && snapshotContent.endsWith(evt.total)
            ? index
            : last
        ), -1);
        pending.forEach((evt, index) => {
          if (index <= lastSnapshotIncludedEvent && typeof evt?.delta === 'string') return;
          handleLiveEvent(evt);
        });
      })();

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

          await flushPersistedUpdates();

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
