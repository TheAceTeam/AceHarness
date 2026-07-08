import { loadChatSession, saveChatSession, deleteChatSession } from '@/lib/chat/persistence';
import { requireAuth } from '@/lib/auth/middleware';
import { normalizeSessionWorkbenchConversationMode } from '@/lib/chat/conversation-mode';
import { isProtectedRunningWorkflowSession } from '@/lib/chat/delete-protection';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

function isOwner(session: any, userId: string): boolean {
  // Backward compatibility: legacy sessions without createdBy are treated as shared.
  if (!session) return false;
  if (!session.createdBy) return true;
  return session.createdBy === userId;
}

export async function GET(req: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const user = await requireAuth(req);
  if (user instanceof Response) return user;
  try {
    const { id } = await params;
    const session = await loadChatSession(id);
    if (!session) {
      return jsonError('会话不存在', 404);
    }
    if (!isOwner(session, user.id)) {
      return jsonError('无权访问该会话', 403);
    }
    return jsonOk({ session });
  } catch (error: any) {
    return jsonError(errorMessage(error), 500);
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const user = await requireAuth(req);
  if (user instanceof Response) return user;
  try {
    const { id } = await params;
    const existing = await loadChatSession(id);
    if (!existing) {
      const deleted = await deleteChatSession(id);
      if (deleted) return jsonOk({ ok: true });
      return jsonError('会话不存在', 404);
    }
    if (!isOwner(existing, user.id)) {
      return jsonError('无权修改该会话', 403);
    }
    const body = await readJsonBody<any>(req, {});
    const requestedUpdatedAt = typeof body?.updatedAt === 'number' && Number.isFinite(body.updatedAt)
      ? body.updatedAt
      : existing.updatedAt;
    const session = normalizeSessionWorkbenchConversationMode({
      ...body,
      id,
      createdBy: existing.createdBy,
      updatedAt: requestedUpdatedAt,
    });
    await saveChatSession(session);
    return jsonOk({ ok: true });
  } catch (error: any) {
    return jsonError(errorMessage(error), 500);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const user = await requireAuth(req);
  if (user instanceof Response) return user;
  try {
    const { id } = await params;
    const existing = await loadChatSession(id);
    if (!existing) {
      return jsonError('会话不存在', 404);
    }
    if (!isOwner(existing, user.id)) {
      return jsonError('无权删除该会话', 403);
    }
    if (await isProtectedRunningWorkflowSession(existing)) {
      return jsonError('工作流运行中的对话不能删除', 409);
    }
    const deleted = await deleteChatSession(id);
    if (!deleted) {
      return jsonError('会话不存在', 404);
    }
    return jsonOk({ ok: true });
  } catch (error: any) {
    return jsonError(errorMessage(error), 500);
  }
}
