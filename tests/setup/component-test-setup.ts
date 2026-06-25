import '@testing-library/jest-dom/vitest';

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}
