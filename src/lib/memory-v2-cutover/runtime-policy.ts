import {
  loadSystemSettings,
  normalizeAgentMemorySettings,
  type NormalizedAgentMemorySettings,
} from '@/lib/config/system-settings';
import type {
  MemoryGovernanceMode,
  MemoryRequestContext,
} from '@/lib/memory-v2';

export interface MemoryV2RuntimePolicy {
  captureEnabled: boolean;
  governanceMode: MemoryGovernanceMode;
  allowLongAutoApproval: boolean;
}

const DEFAULT_POLICY: MemoryV2RuntimePolicy = {
  captureEnabled: false,
  governanceMode: 'review',
  allowLongAutoApproval: false,
};

let currentPolicy: MemoryV2RuntimePolicy = { ...DEFAULT_POLICY };
let localPolicyRevision = 0;
let policyRefreshQueue: Promise<void> = Promise.resolve();

function toRuntimePolicy(settings: NormalizedAgentMemorySettings): MemoryV2RuntimePolicy {
  return {
    captureEnabled: settings.captureEnabled,
    governanceMode: settings.governanceMode,
    allowLongAutoApproval: settings.governanceMode === 'auto',
  };
}

/**
 * Refreshes the process cache from the persisted system setting.
 *
 * Enabled consumers call this at their server-side entry gate, so another
 * process's persisted setting is observed without trusting request payloads.
 * A local settings PUT increments `localPolicyRevision`; any earlier read that
 * completes afterwards is discarded instead of overwriting that immediate
 * in-process update.
 */
export async function refreshMemoryV2RuntimePolicy(): Promise<MemoryV2RuntimePolicy> {
  const revisionAtRequest = localPolicyRevision;
  const refresh = policyRefreshQueue.then(async () => {
    const settings = await loadSystemSettings();
    if (revisionAtRequest === localPolicyRevision) {
      currentPolicy = toRuntimePolicy(normalizeAgentMemorySettings(settings.agentMemory));
    }
  });

  // Keep later reads serialized even if a future settings loader throws.
  policyRefreshQueue = refresh.then(
    () => undefined,
    () => undefined,
  );
  await refresh;
  return { ...currentPolicy };
}

/** Called after the authenticated system-settings route has persisted a change. */
export function setMemoryV2RuntimePolicy(settings: NormalizedAgentMemorySettings): MemoryV2RuntimePolicy {
  localPolicyRevision += 1;
  currentPolicy = toRuntimePolicy(settings);
  return { ...currentPolicy };
}

export function getMemoryV2RuntimePolicy(): MemoryV2RuntimePolicy {
  return { ...currentPolicy };
}

/**
 * This is the only policy projection used to form a MemoryRequestContext.
 * It overwrites any caller-supplied policy fields so the model cannot select
 * capture or governance behavior.
 */
export function applyMemoryV2RuntimePolicy(context: MemoryRequestContext): MemoryRequestContext {
  return {
    ...context,
    captureEnabled: currentPolicy.captureEnabled,
    governanceMode: currentPolicy.governanceMode,
    allowLongAutoApproval: currentPolicy.allowLongAutoApproval,
  };
}
