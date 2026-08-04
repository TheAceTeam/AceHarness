export type SafeEventSourceFailureKind = 'open-timeout' | 'idle-timeout';

export type SafeEventSourceErrorDetail = {
  source: 'safe-event-source';
  kind: SafeEventSourceFailureKind;
  message: string;
  url: string;
  timeoutMs: number;
};

export type SafeEventSourceOptions = EventSourceInit & {
  openTimeoutMs?: number;
  idleTimeoutMs?: number;
};

const DEFAULT_OPEN_TIMEOUT_MS = 8_000;
const DEFAULT_IDLE_TIMEOUT_MS = 180_000;

function dispatchSyntheticError(eventSource: EventSource, detail: SafeEventSourceErrorDetail) {
  try {
    eventSource.dispatchEvent(new CustomEvent('error', { detail }));
  } catch {
    // Some older browser-like runtimes may reject synthetic dispatches.
  }
}

/**
 * Native EventSource errors do not expose the HTTP response or network cause.
 * SafeEventSource timeout errors do expose a structured detail payload; for a
 * native error we state exactly what the browser observed and keep the
 * connection-layer classification separate from engine errors.
 */
export function describeEventSourceError(event: Event, source?: EventSource): string {
  const detail = (event as Event & { detail?: Partial<SafeEventSourceErrorDetail> }).detail;
  if (detail?.message) return String(detail.message);

  const errorMessage = (event as ErrorEvent & { message?: string }).message;
  if (errorMessage) return String(errorMessage);

  const target = source || (event.target as EventSource | null | undefined);
  const state = target?.readyState;
  const stateLabel = state === EventSource.CONNECTING
    ? '浏览器网络/SSE 连接层；阶段：建立或重新建立连接；状态：CONNECTING'
    : state === EventSource.CLOSED
      ? '浏览器网络/SSE 连接层；阶段：连接已关闭；状态：CLOSED'
      : '浏览器网络/SSE 连接层；阶段：连接状态异常';
  const url = target?.url ? `：${target.url}` : '';
  return `Agent 对话连接层错误；来源：${stateLabel}${url}`;
}

export function createSafeEventSource(url: string | URL, options: SafeEventSourceOptions = {}): EventSource {
  const {
    openTimeoutMs = DEFAULT_OPEN_TIMEOUT_MS,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    ...eventSourceOptions
  } = options;
  const eventSource = new EventSource(url, eventSourceOptions);
  const rawAddEventListener = eventSource.addEventListener.bind(eventSource) as EventTarget['addEventListener'];
  const rawRemoveEventListener = eventSource.removeEventListener.bind(eventSource) as EventTarget['removeEventListener'];
  const rawClose = eventSource.close.bind(eventSource);
  const wrappedListeners = new WeakMap<EventListenerOrEventListenerObject, EventListenerOrEventListenerObject>();
  let closed = false;
  let opened = false;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (openTimer) clearTimeout(openTimer);
    if (idleTimer) clearTimeout(idleTimer);
    openTimer = null;
    idleTimer = null;
  };

  const fail = (kind: SafeEventSourceFailureKind, timeoutMs: number) => {
    if (closed) return;
    const timeoutLabel = kind === 'open-timeout' ? '建立连接' : '接收数据';
    dispatchSyntheticError(eventSource, {
      source: 'safe-event-source',
      kind,
      timeoutMs,
      url: String(url),
      message: `Agent 对话连接层错误；来源：ACEHarness SSE 连接层；阶段：${timeoutLabel}；超时：${timeoutMs}ms；接口：${String(url)}`,
    });
    eventSource.close();
  };

  const resetIdleTimer = () => {
    if (closed || idleTimeoutMs <= 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => fail('idle-timeout', idleTimeoutMs), idleTimeoutMs);
  };

  const markActivity = () => {
    if (closed) return;
    opened = true;
    if (openTimer) {
      clearTimeout(openTimer);
      openTimer = null;
    }
    resetIdleTimer();
  };

  const wrapListener = (
    listener: EventListenerOrEventListenerObject | null,
  ): EventListenerOrEventListenerObject | null => {
    if (!listener) return listener;
    const existing = wrappedListeners.get(listener);
    if (existing) return existing;
    const wrapped: EventListenerOrEventListenerObject =
      typeof listener === 'function'
        ? (event: Event) => {
            if (event.type !== 'error') markActivity();
            listener.call(eventSource, event);
          }
        : {
            handleEvent(event: Event) {
              if (event.type !== 'error') markActivity();
              listener.handleEvent(event);
            },
          };
    wrappedListeners.set(listener, wrapped);
    return wrapped;
  };

  eventSource.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    listenerOptions?: boolean | AddEventListenerOptions,
  ) => {
    if (!listener) return;
    rawAddEventListener(type, wrapListener(listener), listenerOptions);
  }) as EventSource['addEventListener'];

  eventSource.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    listenerOptions?: boolean | EventListenerOptions,
  ) => {
    if (!listener) return;
    rawRemoveEventListener(type, wrapListener(listener), listenerOptions);
  }) as EventSource['removeEventListener'];

  eventSource.close = () => {
    if (closed) return;
    closed = true;
    clearTimers();
    rawClose();
  };

  rawAddEventListener('open', markActivity);
  rawAddEventListener('message', markActivity);
  rawAddEventListener('error', () => {
    if (!opened) {
      eventSource.close();
    }
  });

  if (openTimeoutMs > 0) {
    openTimer = setTimeout(() => fail('open-timeout', openTimeoutMs), openTimeoutMs);
  }
  resetIdleTimer();

  return eventSource;
}
