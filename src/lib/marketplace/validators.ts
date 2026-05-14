import { SearchRequest, InstallRequest } from '@/types/marketplace';

export function validateSearchRequest(request: any): request is SearchRequest {
  if (request.pageNum !== undefined && typeof request.pageNum !== 'number') {
    return false;
  }
  if (request.pageSize !== undefined && typeof request.pageSize !== 'number') {
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
    typeof request === 'object' &&
    typeof request.skillName === 'string' &&
    request.skillName.length > 0
  );
}

export function validateSkillName(name: string): boolean {
  const validNamePattern = /^[a-z0-9-]+$/;
  return validNamePattern.test(name);
}
