export interface MemoryV2PayloadTelemetry {
  calls: number;
  returnedItems: number;
  omittedItems: number;
  totalSerializedChars: number;
  maxSerializedChars: number;
  maxItemChars: number;
}

export interface MemoryV2DetailReadTelemetry {
  pages: number;
  returnedChars: number;
  requiredReadPages: number;
  blockedRequiredReads: number;
}

export interface MemoryV2ReceiptTelemetry {
  pending: number;
  read: number;
  acknowledged: number;
  failed: number;
  cancelled: number;
  retrying: number;
}

export interface MemoryV2HandoffTelemetry {
  runStateReconstructions: number;
  batchesEmitted: number;
  requiredReadBudgetFailures: number;
  receipts: MemoryV2ReceiptTelemetry;
}

export interface MemoryV2WriteTelemetry {
  creates: number;
  upserts: number;
  resolves: number;
  discards: number;
  rejected: number;
  duplicateMerges: number;
  governanceActions: number;
  idempotentReplays: number;
}

export interface MemoryV2AuthorizationTelemetry {
  explicitReadDenied: number;
  searchDenied: number;
}

export interface MemoryV2FreshStartTelemetry {
  itemCount: number;
  detailCount: number;
}

/**
 * Process-local cutover metrics. All fields are numeric aggregates; no
 * summaries, detail bodies, prompts, identifiers, or legacy content are kept.
 */
export interface MemoryV2CutoverTelemetry {
  featureDisabledConsumerRequests: number;
  freshStartInitializations: number;
  freshStartInitializationFailures: number;
  archiveChecksumScans: number;
  manifestReads: number;
  detailReads: number;
  governanceListReads: number;
  governanceDetailReads: number;
  governanceActions: number;
  governanceActionFailures: number;
  diagnosticsReads: number;
  legacyRouteRetirements: number;
  legacyContentAccessDenied: number;
  manifest: MemoryV2PayloadTelemetry;
  search: MemoryV2PayloadTelemetry;
  detailReadMetrics: MemoryV2DetailReadTelemetry;
  handoffs: MemoryV2HandoffTelemetry;
  writes: MemoryV2WriteTelemetry;
  authorization: MemoryV2AuthorizationTelemetry;
  freshStart: MemoryV2FreshStartTelemetry;
}

const emptyPayloadTelemetry = (): MemoryV2PayloadTelemetry => ({
  calls: 0,
  returnedItems: 0,
  omittedItems: 0,
  totalSerializedChars: 0,
  maxSerializedChars: 0,
  maxItemChars: 0,
});

const telemetry: MemoryV2CutoverTelemetry = {
  featureDisabledConsumerRequests: 0,
  freshStartInitializations: 0,
  freshStartInitializationFailures: 0,
  archiveChecksumScans: 0,
  manifestReads: 0,
  detailReads: 0,
  governanceListReads: 0,
  governanceDetailReads: 0,
  governanceActions: 0,
  governanceActionFailures: 0,
  diagnosticsReads: 0,
  legacyRouteRetirements: 0,
  legacyContentAccessDenied: 0,
  manifest: emptyPayloadTelemetry(),
  search: emptyPayloadTelemetry(),
  detailReadMetrics: {
    pages: 0,
    returnedChars: 0,
    requiredReadPages: 0,
    blockedRequiredReads: 0,
  },
  handoffs: {
    runStateReconstructions: 0,
    batchesEmitted: 0,
    requiredReadBudgetFailures: 0,
    receipts: {
      pending: 0,
      read: 0,
      acknowledged: 0,
      failed: 0,
      cancelled: 0,
      retrying: 0,
    },
  },
  writes: {
    creates: 0,
    upserts: 0,
    resolves: 0,
    discards: 0,
    rejected: 0,
    duplicateMerges: 0,
    governanceActions: 0,
    idempotentReplays: 0,
  },
  authorization: {
    explicitReadDenied: 0,
    searchDenied: 0,
  },
  freshStart: {
    itemCount: 0,
    detailCount: 0,
  },
};

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function observePayload(
  target: MemoryV2PayloadTelemetry,
  input: { returnedItems: number; omittedItems: number; serializedChars: number; maxItemChars: number },
): void {
  const returnedItems = count(input.returnedItems);
  const omittedItems = count(input.omittedItems);
  const serializedChars = count(input.serializedChars);
  const maxItemChars = count(input.maxItemChars);
  target.calls += 1;
  target.returnedItems += returnedItems;
  target.omittedItems += omittedItems;
  target.totalSerializedChars += serializedChars;
  target.maxSerializedChars = Math.max(target.maxSerializedChars, serializedChars);
  target.maxItemChars = Math.max(target.maxItemChars, maxItemChars);
}

export function recordMemoryV2CutoverEvent(event: keyof Pick<MemoryV2CutoverTelemetry,
  | 'featureDisabledConsumerRequests'
  | 'freshStartInitializations'
  | 'freshStartInitializationFailures'
  | 'archiveChecksumScans'
  | 'manifestReads'
  | 'detailReads'
  | 'governanceListReads'
  | 'governanceDetailReads'
  | 'governanceActions'
  | 'governanceActionFailures'
  | 'diagnosticsReads'
  | 'legacyRouteRetirements'
  | 'legacyContentAccessDenied'
>): void {
  telemetry[event] += 1;
}

export function recordMemoryV2ManifestTelemetry(input: {
  returnedItems: number;
  omittedItems: number;
  serializedChars: number;
  maxItemChars: number;
}): void {
  observePayload(telemetry.manifest, input);
}

export function recordMemoryV2SearchTelemetry(input: {
  returnedItems: number;
  omittedItems: number;
  serializedChars: number;
  maxItemChars: number;
}): void {
  observePayload(telemetry.search, input);
}

export function recordMemoryV2DetailReadTelemetry(input: {
  returnedChars: number;
  requiredRead?: boolean;
}): void {
  telemetry.detailReadMetrics.pages += 1;
  telemetry.detailReadMetrics.returnedChars += count(input.returnedChars);
  if (input.requiredRead) telemetry.detailReadMetrics.requiredReadPages += 1;
}

export function recordMemoryV2RequiredReadBudgetFailure(): void {
  telemetry.handoffs.requiredReadBudgetFailures += 1;
}

export function recordMemoryV2BlockedRequiredRead(): void {
  telemetry.detailReadMetrics.blockedRequiredReads += 1;
}

export function recordMemoryV2ReceiptStatus(
  status: keyof MemoryV2ReceiptTelemetry,
): void {
  telemetry.handoffs.receipts[status] += 1;
}

export function recordMemoryV2HandoffBatchEmitted(): void {
  telemetry.handoffs.batchesEmitted += 1;
}

export function recordMemoryV2RunStateReconstruction(): void {
  telemetry.handoffs.runStateReconstructions += 1;
}

export function recordMemoryV2Write(
  action: keyof Omit<MemoryV2WriteTelemetry, 'idempotentReplays'>,
): void {
  telemetry.writes[action] += 1;
}

export function recordMemoryV2IdempotentReplay(): void {
  telemetry.writes.idempotentReplays += 1;
}

export function recordMemoryV2AuthorizationDenied(
  action: keyof MemoryV2AuthorizationTelemetry,
): void {
  telemetry.authorization[action] += 1;
}

export function recordMemoryV2FreshStartRows(input: {
  itemCount: number;
  detailCount: number;
}): void {
  telemetry.freshStart.itemCount = count(input.itemCount);
  telemetry.freshStart.detailCount = count(input.detailCount);
}

export function getMemoryV2CutoverTelemetry(): MemoryV2CutoverTelemetry {
  return {
    ...telemetry,
    manifest: { ...telemetry.manifest },
    search: { ...telemetry.search },
    detailReadMetrics: { ...telemetry.detailReadMetrics },
    handoffs: {
      ...telemetry.handoffs,
      receipts: { ...telemetry.handoffs.receipts },
    },
    writes: { ...telemetry.writes },
    authorization: { ...telemetry.authorization },
    freshStart: { ...telemetry.freshStart },
  };
}
