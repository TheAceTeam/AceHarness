type SafeEventSourceOptions = EventSourceInit & {
  openTimeoutMs?: number;
  idleTimeoutMs?: number;
};

const DEFAULT_OPEN_TIMEOUT_MS = 8_000;
const DEFAULT_IDLE_TIMEOUT_MS = 180_000;

function dispatchSyntheticError(eventSource: EventSource) {
  try {
    eventSource.dispatchEvent(new Event('error'));
  } catch {
    // Some older browser-like runtimes may reject synthetic dispatches.
  }
}

export function createSafeEventSource(url: string | URL, options: SafeEventSourceOptions = {}): EventSource {
  const {
    openTimeoutMs = DEFAULT_OPEN_TIMEOUT_MS,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    ...eventSourceOptions
  } = options;
  const eventSource = new EventSource(url, eventSourceOptions);
  const rawAddEventListener = eventSource.addEventListener.bind(eventSource);
  const rawRemoveEventListener = eventSource.removeEventListener.bind(eventSource);
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

  const fail = () => {
    if (closed) return;
    dispatchSyntheticError(eventSource);
    eventSource.close();
  };

  const resetIdleTimer = () => {
    if (closed || idleTimeoutMs <= 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(fail, idleTimeoutMs);
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

  eventSource.addEventListener = ((type, listener, listenerOptions) => {
    rawAddEventListener(type, wrapListener(listener), listenerOptions);
  }) as EventSource['addEventListener'];

  eventSource.removeEventListener = ((type, listener, listenerOptions) => {
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
    openTimer = setTimeout(fail, openTimeoutMs);
  }
  resetIdleTimer();

  return eventSource;
}
