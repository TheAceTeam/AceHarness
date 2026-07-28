import { createMiddleware, createStart } from '@tanstack/react-start';

const STREAM_LIFETIME_ERROR = 'Stream lifetime exceeded';
const streamLifetimeGuardKey = '__ACE_STREAM_LIFETIME_GUARD__';

if (typeof process !== 'undefined' && typeof process.on === 'function' && !(globalThis as any)[streamLifetimeGuardKey]) {
  (globalThis as any)[streamLifetimeGuardKey] = true;
  process.on('uncaughtException', (error) => {
    if (String((error as Error)?.message || error).includes(STREAM_LIFETIME_ERROR)) {
      console.warn('[CSIHarness] TanStack SSR stream timed out and was cleaned up.');
      return;
    }
    throw error;
  });
}

if (import.meta.env.SSR) {
  void import('@/lib/core/runtime-home')
    .then(({ ensureRuntimeHomeInitialized }) => ensureRuntimeHomeInitialized())
    .then(() => import('@/lib/run/runtime-skills'))
    .then(({ refreshBundledAceHarnessSkillsOnStartup }) => {
      refreshBundledAceHarnessSkillsOnStartup();
    })
    .catch((error) => {
      console.warn('[CSIHarness] Runtime skill startup refresh failed:', error);
    });
}

const requestContextMiddleware = createMiddleware().server(async ({ next }) => {
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [requestContextMiddleware],
}));
