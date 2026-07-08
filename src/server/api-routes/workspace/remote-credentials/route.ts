import { requireAuth } from '@/lib/auth/middleware';
import {
  forgetRemoteCredentials,
  putRemoteCredentials,
} from '@/lib/core/remote-credential-vault';
import { normalizeRemoteWorkspaceUrl, type RemoteCredentials } from '@/lib/core/remote-workspace';
import { jsonOk, readWorkspaceJsonBody, workspaceRouteError, workspaceRouteJsonError } from '@/server/api-route-runtime/workspace-route';

function normalizeCredentials(input: any): RemoteCredentials {
  return {
    username: typeof input?.username === 'string' ? input.username : undefined,
    password: typeof input?.password === 'string' ? input.password : undefined,
    privateKey: typeof input?.privateKey === 'string' ? input.privateKey : undefined,
    privateKeyPath: typeof input?.privateKeyPath === 'string' ? input.privateKeyPath : undefined,
    passphrase: typeof input?.passphrase === 'string' ? input.passphrase : undefined,
    domain: typeof input?.domain === 'string' ? input.domain : undefined,
  };
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const body = await readWorkspaceJsonBody<Record<string, any>>(request);
    const workspace = typeof body?.workspace === 'string' ? body.workspace : '';
    if (!workspace) {
      return workspaceRouteJsonError('缺少 workspace 参数', 400);
    }
    const result = putRemoteCredentials({
      userId: auth.id,
      workspace,
      credentials: normalizeCredentials(body?.credentials || body),
    });
    return jsonOk({
      success: true,
      credentialId: result.id,
      expiresAt: result.expiresAt,
      workspace: normalizeRemoteWorkspaceUrl(workspace),
    });
  } catch (error: any) {
    return workspaceRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get('workspace');
    if (!workspace) {
      return workspaceRouteJsonError('缺少 workspace 参数', 400);
    }
    forgetRemoteCredentials({ userId: auth.id, workspace });
    return jsonOk({ success: true });
  } catch (error: any) {
    return workspaceRouteError(error);
  }
}
