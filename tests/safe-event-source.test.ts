import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSafeEventSource, describeEventSourceError } from '@/lib/core/safe-event-source';

class MockEventSource extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readonly url: string;
  readyState = MockEventSource.CONNECTING;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }
}

describe('createSafeEventSource', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports a structured ACEHarness SSE open timeout', () => {
    const source = createSafeEventSource('/api/agents/demo/chat/stream?id=stream-1', {
      openTimeoutMs: 25,
      idleTimeoutMs: 0,
    });
    const errors: Event[] = [];
    source.addEventListener('error', (event) => errors.push(event));

    vi.advanceTimersByTime(25);

    expect(errors).toHaveLength(1);
    expect((errors[0] as CustomEvent).detail).toMatchObject({
      source: 'safe-event-source',
      kind: 'open-timeout',
      timeoutMs: 25,
      url: '/api/agents/demo/chat/stream?id=stream-1',
    });
    expect(describeEventSourceError(errors[0], source)).toContain('ACEHarness SSE 连接层');
  });

  it('reports a structured idle timeout after the stream has opened', () => {
    const source = createSafeEventSource('/api/agents/demo/chat/stream?id=stream-2', {
      openTimeoutMs: 0,
      idleTimeoutMs: 40,
    });
    const errors: Event[] = [];
    source.addEventListener('error', (event) => errors.push(event));
    source.dispatchEvent(new Event('open'));

    vi.advanceTimersByTime(40);

    expect(errors).toHaveLength(1);
    expect((errors[0] as CustomEvent).detail).toMatchObject({
      source: 'safe-event-source',
      kind: 'idle-timeout',
      timeoutMs: 40,
    });
  });

  it('labels a browser-native EventSource error as a connection-layer failure', () => {
    const source = createSafeEventSource('/api/agents/demo/chat/stream?id=stream-3', {
      openTimeoutMs: 0,
      idleTimeoutMs: 0,
    });
    source.close();

    expect(describeEventSourceError(new Event('error'), source)).toContain('浏览器网络/SSE 连接层');
    expect(describeEventSourceError(new Event('error'), source)).toContain('状态：CLOSED');
  });
});
