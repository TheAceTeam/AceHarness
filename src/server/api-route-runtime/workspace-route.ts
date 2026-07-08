import { remoteCredentialErrorBody } from '@/lib/core/remote-credential-vault';
import { workspaceErrorResponse } from '@/lib/core/workspace-path-safety';
import { jsonError, jsonOk, readJsonBody } from './request-utils';

export { jsonOk };

export async function readWorkspaceJsonBody<T = Record<string, unknown>>(request: Request): Promise<T> {
  return readJsonBody<T>(request, {} as T);
}

export function workspaceRouteError(error: unknown, workspace = ''): Response {
  const response = workspaceErrorResponse(error);
  if (response.status === 428 && response.message.includes('凭据')) {
    return jsonOk(remoteCredentialErrorBody(workspace), { status: 428 });
  }
  return jsonError(response.message, response.status, response.message);
}

export function workspaceRouteJsonError(message: string, status = 400): Response {
  return jsonError(message, status);
}
