import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';
import { makeRequest } from './helpers/route-helpers';

function readSseData(text: string, eventName: string) {
  const eventStart = text.indexOf(`event: ${eventName}\n`);
  if (eventStart < 0) return null;
  const dataStart = text.indexOf('data: ', eventStart);
  const dataEnd = text.indexOf('\n\n', dataStart);
  if (dataStart < 0 || dataEnd < 0) return null;
  return JSON.parse(text.slice(dataStart + 'data: '.length, dataEnd));
}

describe('run stream SSE route', () => {
  test('replays persisted output as an authoritative snapshot before incremental deltas', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { appendStreamContent } = await import('@/lib/run/state-persistence');
      const transcript = '<!-- timestamp: 2026-08-01T10:35:58.818Z -->\n首条真实消息';
      await appendStreamContent('run-snapshot', 'execute-task', transcript);

      const { GET } = await import('@/server/api-routes/runs/[id]/stream/route');
      const controller = new AbortController();
      const response = await GET(
        makeRequest('/api/runs/run-snapshot/stream?step=execute-task&live=1', { signal: controller.signal }),
        { params: { id: 'run-snapshot' } },
      );
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      let emitted = '';
      try {
        for (let index = 0; index < 3 && !emitted.includes('event: snapshot\n'); index += 1) {
          const { value, done } = await reader!.read();
          if (done || !value) break;
          emitted += new TextDecoder().decode(value);
        }

        expect(emitted).toContain('event: connected');
        expect(emitted).toContain('event: snapshot');
        expect(emitted.slice(0, emitted.indexOf('event: snapshot'))).not.toContain('event: delta');
        expect(readSseData(emitted, 'snapshot')).toEqual({ content: transcript });
      } finally {
        controller.abort();
        await reader?.cancel().catch(() => {});
      }
    });
  });
});
