import { isAbsolute, relative, resolve } from 'path';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { recordMemoryV2CutoverEvent } from './telemetry';

export type LegacyMemoryAccessOperation = 'open' | 'query' | 'prompt-read' | 'fallback' | 'route';

export class LegacyMemoryAccessDeniedError extends Error {
  constructor(path: string, operation: LegacyMemoryAccessOperation) {
    super(`Memory V2 forbids legacy memory ${operation} access: ${path}`);
    this.name = 'LegacyMemoryAccessDeniedError';
  }
}

function normalizeForComparison(path: string): string {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isInside(root: string, candidate: string): boolean {
  const relativePath = relative(normalizeForComparison(root), normalizeForComparison(candidate));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

export function getLegacyMemoryArchiveRoots(): string[] {
  return [
    getWorkspaceDataFile('memory'),
    getWorkspaceDataFile('experience-library'),
    getWorkspaceDataFile('agent-relationships'),
  ];
}

export function isLegacyMemoryArchivePath(path: string): boolean {
  const candidate = String(path || '').trim();
  return Boolean(candidate) && getLegacyMemoryArchiveRoots().some((root) => isInside(root, candidate));
}

/**
 * Legacy files may be streamed once for checksum metadata before V2 enablement.
 * Their contents are otherwise prohibited from all V2 consumer paths.
 */
export function authorizeLegacyArchiveChecksum(path: string): void {
  if (!isLegacyMemoryArchivePath(path)) {
    throw new LegacyMemoryAccessDeniedError(path, 'open');
  }
  recordMemoryV2CutoverEvent('archiveChecksumScans');
}

export function assertLegacyMemoryContentAccessForbidden(
  path: string,
  operation: LegacyMemoryAccessOperation,
): never {
  recordMemoryV2CutoverEvent('legacyContentAccessDenied');
  throw new LegacyMemoryAccessDeniedError(path, operation);
}
