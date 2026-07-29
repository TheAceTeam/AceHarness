import {
  createMemoryService,
  type InitializeFreshMemoryStoreResult,
} from '@/lib/memory-v2';
import { collectLegacyArchiveMetadata } from './archive-registry';
import { refreshMemoryV2RuntimePolicy } from './runtime-policy';
import { recordMemoryV2CutoverEvent } from './telemetry';

export const MEMORY_V2_FEATURE_FLAG = 'ACE_MEMORY_V2_ENABLED';

export interface MemoryV2CutoverStatus {
  enabled: boolean;
  ready: boolean;
  reason?: string;
  initializedNow?: boolean;
  itemCount?: number;
  detailCount?: number;
  archiveRegistryCount?: number;
}

let initialization: Promise<MemoryV2CutoverStatus> | undefined;

function parseEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

export function isMemoryV2FeatureEnabled(): boolean {
  return parseEnabled(process.env[MEMORY_V2_FEATURE_FLAG]);
}

function toReadyStatus(result: InitializeFreshMemoryStoreResult, expectedArchiveCount: number): MemoryV2CutoverStatus {
  if (result.archiveRegistryCount < expectedArchiveCount) {
    return {
      enabled: true,
      ready: false,
      reason: 'Memory V2 archive registry verification is incomplete',
      initializedNow: result.initializedNow,
      itemCount: result.itemCount,
      detailCount: result.detailCount,
      archiveRegistryCount: result.archiveRegistryCount,
    };
  }
  return {
    enabled: true,
    ready: true,
    initializedNow: result.initializedNow,
    itemCount: result.itemCount,
    detailCount: result.detailCount,
    archiveRegistryCount: result.archiveRegistryCount,
  };
}

async function initializeMemoryV2FreshStart(): Promise<MemoryV2CutoverStatus> {
  try {
    const legacyArchives = await collectLegacyArchiveMetadata();
    const service = createMemoryService();
    try {
      const result = service.initializeFreshStore({ legacyArchives });
      recordMemoryV2CutoverEvent('freshStartInitializations');
      return toReadyStatus(result, legacyArchives.length);
    } finally {
      service.close();
    }
  } catch (error) {
    recordMemoryV2CutoverEvent('freshStartInitializationFailures');
    return {
      enabled: true,
      ready: false,
      reason: error instanceof Error ? error.message : 'Memory V2 fresh-start initialization failed',
    };
  }
}

/**
 * Disabling the flag never opens or resets V2. Re-enabling reuses the existing
 * canonical store and rechecks metadata-only legacy archive checksums.
 */
export async function ensureMemoryV2FreshStart(): Promise<MemoryV2CutoverStatus> {
  if (!isMemoryV2FeatureEnabled()) {
    initialization = undefined;
    recordMemoryV2CutoverEvent('featureDisabledConsumerRequests');
    return {
      enabled: false,
      ready: false,
      reason: `${MEMORY_V2_FEATURE_FLAG} is disabled`,
    };
  }
  await refreshMemoryV2RuntimePolicy();
  initialization ??= initializeMemoryV2FreshStart();
  return initialization;
}
