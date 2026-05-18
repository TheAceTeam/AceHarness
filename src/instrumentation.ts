// This file only runs in Node.js runtime
export const runtime = 'nodejs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Dynamically import Node.js-specific implementation
    // This prevents Turbopack from analyzing Node.js modules at build time
    const { runNodejsInstrumentation } = await import('@/lib/core/instrumentation-nodejs');
    await runNodejsInstrumentation();
  }
}
