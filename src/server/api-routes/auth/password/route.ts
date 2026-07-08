import { requireAuth } from '@/lib/auth/middleware';
import { changePassword } from '@/lib/core/user-store';
import { getLoginPasswordError } from '@/lib/auth/password-policy';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/auth/password - Change password (requires currentPassword + newPassword)
 */
export async function PUT(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const { currentPassword, newPassword } = await readJsonBody<Record<string, any>>(request, {});
    if (!currentPassword || !newPassword) {
      return jsonError('当前密码和新密码不能为空', 400);
    }
    const passwordError = getLoginPasswordError(newPassword, {
      username: user.username,
      email: user.email,
      currentPassword,
    });
    if (passwordError) return jsonError(passwordError, 400);
    await changePassword(user.id, currentPassword, newPassword);
    return jsonOk({ success: true });
  } catch (error) {
    return jsonError(errorMessage(error) || '修改密码失败', 400);
  }
}
