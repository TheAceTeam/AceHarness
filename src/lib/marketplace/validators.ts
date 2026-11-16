import type { SearchRequest, InstallRequest, MarketplaceSource } from '@/types/marketplace';
import { isExternalMarketplaceFolder, MAX_PAGE_SIZE } from '@/constants/marketplace';

export function isMarketplaceSource(source: unknown): source is MarketplaceSource {
  return typeof source === 'string' && /^(matrix|skillhub|custom-[a-f0-9]{12})$/.test(source);
}

export function validateSearchRequest(request: any): request is SearchRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
  if (request.source !== undefined && !isMarketplaceSource(request.source)) return false;
  if (request.pageNum !== undefined && (!Number.isSafeInteger(request.pageNum) || request.pageNum < 1)) {
    return false;
  }
  if (request.pageSize !== undefined && (!Number.isInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > MAX_PAGE_SIZE)) {
    return false;
  }
  if (request.keyword !== undefined && typeof request.keyword !== 'string') {
    return false;
  }
  if (request.category !== undefined && typeof request.category !== 'string') {
    return false;
  }
  return true;
}

export function validateInstallRequest(request: any): request is InstallRequest {
  return (
    request !== null &&
    typeof request === 'object' &&
    (request.source === undefined || isMarketplaceSource(request.source)) &&
    (request.namespace === undefined || (typeof request.namespace === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(request.namespace))) &&
    (request.version === undefined || (typeof request.version === 'string' && request.version.length <= 100)) &&
    typeof request.skillName === 'string' &&
    request.skillName.length > 0
  );
}

export function validateSkillName(name: string, source: MarketplaceSource = 'matrix'): boolean {
  if (source !== 'matrix') return /^[a-z0-9][a-z0-9._-]{0,127}$/.test(name) && !name.endsWith('.');
  return /^[a-z0-9-]+$/.test(name) && !isExternalMarketplaceFolder(name);
}
