/**
 * Intent Handler Registry
 *
 * Separated from registry.ts to avoid circular dependency issues
 * when plugins register handlers at module load time.
 */

export type IntentHandler = (ctx: {
  createSession: (opts: any) => string;
  setActiveSessionId: (id: string) => void;
  toast: (type: 'success' | 'error' | 'warning' | 'info', msg: string) => void;
  [key: string]: any;
}) => void;

const intentHandlers = new Map<string, IntentHandler>();

/** Register a runtime handler for an intent */
export function registerIntentHandler(intentId: string, handler: IntentHandler): void {
  intentHandlers.set(intentId, handler);
}

/** Unregister an intent handler */
export function unregisterIntentHandler(intentId: string): void {
  intentHandlers.delete(intentId);
}

/** Get the handler for an intent, if registered */
export function getIntentHandler(intentId: string): IntentHandler | undefined {
  return intentHandlers.get(intentId);
}

/** Dispatch a __HOME_ACTION__:xxx to its registered handler. Returns true if handled. */
export function dispatchHomeAction(actionId: string, ctx: Parameters<IntentHandler>[0]): boolean {
  const handler = intentHandlers.get(actionId);
  if (handler) {
    handler(ctx);
    return true;
  }
  return false;
}
