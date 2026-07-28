import { requireAdmin } from '@/lib/auth/middleware';
import { getLoginPasswordError } from '@/lib/auth/password-policy';
import {
  adminResetPassword,
  deleteUser,
  getUserById,
  reviewUserRegistration,
  toPublicUser,
  updateUser,
} from '@/lib/core/user-store';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const user = await getUserById(id);
  if (!user) {
    return jsonError('用户不存在', 404);
  }
  return jsonOk({ user: toPublicUser(user) });
}

export async function PUT(request: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;

  const { id } = await params;
  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const { resetPassword, reviewAction, reviewNote, ...patch } = body;

    if (reviewAction === 'approve' || reviewAction === 'reject') {
      const user = await reviewUserRegistration({
        userId: id,
        action: reviewAction,
        adminId: admin.id,
        note: typeof reviewNote === 'string' ? reviewNote : undefined,
      });
      return jsonOk({ user });
    }

    if (patch.role && patch.role !== 'admin') {
      const targetUser = await getUserById(id);
      if (targetUser && targetUser.role === 'admin' && !targetUser.createdBy) {
        return jsonError('初始管理员不能降级为普通用户', 400);
      }
    }

    if (resetPassword) {
      const targetUser = await getUserById(id);
      const passwordError = getLoginPasswordError(resetPassword, {
        username: targetUser?.username,
        email: targetUser?.email,
      });
      if (passwordError) return jsonError(passwordError, 400);
      await adminResetPassword(id, resetPassword);
    }

    const updateFields: any = {};
    if (patch.username !== undefined) updateFields.username = patch.username;
    if (patch.email !== undefined) updateFields.email = patch.email;
    if (patch.role !== undefined) updateFields.role = patch.role;
    if (patch.personalDir !== undefined) updateFields.personalDir = patch.personalDir;
    if (patch.avatar !== undefined) updateFields.avatar = patch.avatar;

    if (Object.keys(updateFields).length > 0) {
      const user = await updateUser(id, updateFields);
      return jsonOk({ user });
    }

    if (resetPassword) {
      return jsonOk({ success: true, message: '密码已重置' });
    }

    return jsonOk({ success: true });
  } catch (error) {
    return jsonError(errorMessage(error) || '更新用户失败', 400);
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;

  const { id } = await params;

  if (id === admin.id) {
    return jsonError('不能删除自己的账号', 400);
  }

  const targetUser = await getUserById(id);
  if (targetUser && targetUser.role === 'admin' && !targetUser.createdBy) {
    return jsonError('不能删除初始管理员', 400);
  }

  try {
    await deleteUser(id);
    return jsonOk({ success: true });
  } catch (error) {
    return jsonError(errorMessage(error) || '删除用户失败', 400);
  }
}
