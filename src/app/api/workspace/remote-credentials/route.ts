import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import {
  forgetRemoteCredentials,
  putRemoteCredentials,
} from '@/lib/core/remote-credential-vault';
import { normalizeRemoteWorkspaceUrl, type RemoteCredentials } from '@/lib/core/remote-workspace';
import { workspaceErrorResponse } from '@/lib/core/workspace-path-safety';

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

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const body = await request.json();
    const workspace = typeof body?.workspace === 'string' ? body.workspace : '';
    if (!workspace) {
      return NextResponse.json({ error: '缺少 workspace 参数' }, { status: 400 });
    }
    const result = putRemoteCredentials({
      userId: auth.id,
      workspace,
      credentials: normalizeCredentials(body?.credentials || body),
    });
    return NextResponse.json({
      success: true,
      credentialId: result.id,
      expiresAt: result.expiresAt,
      workspace: normalizeRemoteWorkspaceUrl(workspace),
    });
  } catch (error: any) {
    const { message, status } = workspaceErrorResponse(error);
    return NextResponse.json({ error: message, message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get('workspace');
    if (!workspace) {
      return NextResponse.json({ error: '缺少 workspace 参数' }, { status: 400 });
    }
    forgetRemoteCredentials({ userId: auth.id, workspace });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const { message, status } = workspaceErrorResponse(error);
    return NextResponse.json({ error: message, message }, { status });
  }
}
