import { requireAuth } from '@/lib/auth/middleware';
import { ensureAgoraWorkspace, removeAgoraWorkspace } from '@/lib/agora/workspace-store';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request) {
  try {
    // 该接口会在请求方指定的路径上落地目录、软链和 git 基线，必须鉴权。
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;

    const body = await readJsonBody<Record<string, any>>(request, {});
    const sessionId = String(body?.sessionId || '').trim();
    if (!sessionId) {
      return jsonError('缺少 sessionId', 400);
    }
    const result = await ensureAgoraWorkspace({
      sessionId,
      sourceWorkspace: typeof body?.sourceWorkspace === 'string' ? body.sourceWorkspace : undefined,
      targetWorkspace: typeof body?.targetWorkspace === 'string' ? body.targetWorkspace : undefined,
      title: typeof body?.title === 'string' ? body.title : undefined,
      skills: Array.isArray(body?.skills) || (body?.skills && typeof body.skills === 'object') ? body.skills : undefined,
      mcpServers: Array.isArray(body?.mcpServers) || (body?.mcpServers && typeof body.mcpServers === 'object') ? body.mcpServers : undefined,
      purpose: body?.purpose === 'chat' ? 'chat' : 'agora',
    });
    return jsonOk(result);
  } catch (error: any) {
    return jsonError(errorMessage(error) || '准备议场工作区失败', 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;

    const body = await readJsonBody<Record<string, any>>(request, {});
    const sessionId = String(body?.sessionId || '').trim();
    const workspacePath = typeof body?.workspacePath === 'string' ? body.workspacePath.trim() : '';
    if (!sessionId) {
      return jsonError('缺少 sessionId', 400);
    }
    if (!workspacePath) {
      return jsonError('缺少 workspacePath', 400);
    }

    await removeAgoraWorkspace(sessionId, workspacePath);
    return jsonOk({ success: true });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '删除议场工作目录失败', /只能删除系统默认创建/.test(error?.message || '') ? 400 : 500);
  }
}
