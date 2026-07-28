import {
  createMemoryService,
  type MemoryServiceBudgets,
  type MemoryV2StoreCutoverDiagnostics,
} from '@/lib/memory-v2';
import {
  ensureMemoryV2FreshStart,
  isMemoryV2FeatureEnabled,
  type MemoryV2CutoverStatus,
} from './feature-flag';
import {
  getMemoryV2CutoverTelemetry,
  recordMemoryV2CutoverEvent,
  type MemoryV2CutoverTelemetry,
} from './telemetry';

export interface MemoryV2CutoverDiagnostics {
  status: MemoryV2CutoverStatus;
  telemetry: MemoryV2CutoverTelemetry;
  /** Server-enforced numeric caps only; no index or detail content is included. */
  budgets?: MemoryServiceBudgets;
  store?: MemoryV2StoreCutoverDiagnostics;
  legacyZeroAccess: {
    contentReadsAllowed: false;
    verified: boolean;
    deniedAttempts: number;
  };
}

/**
 * Cutover diagnostics use only the V2 store and its metadata-only archive
 * registry. They never reopen, parse, or return a legacy memory body.
 */
export async function getMemoryV2CutoverDiagnostics(): Promise<MemoryV2CutoverDiagnostics> {
  const status = isMemoryV2FeatureEnabled()
    ? await ensureMemoryV2FreshStart()
    : {
      enabled: false,
      ready: false,
      reason: 'ACE_MEMORY_V2_ENABLED is disabled',
    } satisfies MemoryV2CutoverStatus;
  recordMemoryV2CutoverEvent('diagnosticsReads');
  if (!status.ready) {
    const telemetry = getMemoryV2CutoverTelemetry();
    return {
      status,
      telemetry,
      legacyZeroAccess: {
        contentReadsAllowed: false,
        verified: false,
        deniedAttempts: telemetry.legacyContentAccessDenied,
      },
    };
  }
  const service = createMemoryService();
  try {
    const store = service.getCutoverDiagnostics();
    const budgets = { ...service.budgets };
    const telemetry = getMemoryV2CutoverTelemetry();
    return {
      status,
      telemetry,
      budgets,
      store,
      legacyZeroAccess: {
        contentReadsAllowed: false,
        verified: store.legacyAccessMode === 'disabled'
          && store.archiveRegistry.entries.every((entry) => entry.accessProhibited),
        deniedAttempts: telemetry.legacyContentAccessDenied,
      },
    };
  } finally {
    service.close();
  }
}
