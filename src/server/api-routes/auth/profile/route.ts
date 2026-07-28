import { requireAuth } from '@/lib/auth/middleware';
import { updateUser } from '@/lib/core/user-store';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/auth/profile - Update own profile (avatar, personalDir)
 */
export async function PUT(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const patch: any = {};
    if (body.avatar !== undefined) patch.avatar = body.avatar;
    if (body.personalDir !== undefined) patch.personalDir = body.personalDir;
    if (body.username !== undefined) patch.username = body.username;

    if (Object.keys(patch).length === 0) {
      return jsonError('没有可更新的字段', 400);
    }

    const updated = await updateUser(user.id, patch);
    return jsonOk({ user: updated });
  } catch (error) {
    return jsonError(errorMessage(error) || '更新失败', 400);
  }
}
