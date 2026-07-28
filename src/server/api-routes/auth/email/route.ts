import { requireAuth } from '@/lib/auth/middleware';
import { changeEmail } from '@/lib/core/user-store';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/auth/email - Change email
 */
export async function PUT(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const { newEmail } = await readJsonBody<Record<string, any>>(request, {});
    if (!newEmail) {
      return jsonError('新邮箱不能为空', 400);
    }
    await changeEmail(user.id, newEmail);
    return jsonOk({ success: true });
  } catch (error) {
    return jsonError(errorMessage(error) || '修改邮箱失败', 400);
  }
}
