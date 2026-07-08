import { deleteChatSession, loadChatSession } from '@/lib/chat/persistence';
import { requireAuth } from '@/lib/auth/middleware';
import { isProtectedRunningWorkflowSession } from '@/lib/chat/delete-protection';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

function isOwner(session: any, userId: string): boolean {
  if (!session) return false;
  if (!session.createdBy) return true;
  return session.createdBy === userId;
}

export async function POST(req: Request) {
  const user = await requireAuth(req);
  if (user instanceof Response) return user;
  try {
    const body = await readJsonBody<Record<string, any>>(req, {});
    const ids: string[] = Array.from(new Set<string>(
      Array.isArray(body?.ids)
        ? body.ids.map((id: unknown) => String(id || '').trim()).filter(Boolean)
        : []
    ));
    if (ids.length === 0) {
      return jsonError('缺少要删除的会话', 400);
    }
    if (ids.length > 200) {
      return jsonError('一次最多删除 200 个会话', 400);
    }

    const deleted: string[] = [];
    const missing: string[] = [];
    const forbidden: string[] = [];
    const protectedRunning: string[] = [];
    for (const id of ids) {
      const existing = await loadChatSession(id);
      if (!existing) {
        const ok = await deleteChatSession(id);
        if (ok) deleted.push(id);
        else missing.push(id);
        continue;
      }
      if (!isOwner(existing, user.id)) {
        forbidden.push(id);
        continue;
      }
      if (await isProtectedRunningWorkflowSession(existing)) {
        protectedRunning.push(id);
        continue;
      }
      const ok = await deleteChatSession(id);
      if (ok) deleted.push(id);
      else missing.push(id);
    }

    return jsonOk({
      ok: forbidden.length === 0 && protectedRunning.length === 0,
      deleted,
      deletedCount: deleted.length,
      missing,
      forbidden,
      protectedRunning,
    }, { status: forbidden.length > 0 || protectedRunning.length > 0 ? 207 : 200 });
  } catch (error: any) {
    return jsonError(errorMessage(error), 500);
  }
}
