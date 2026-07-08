import { requireAdmin } from '@/lib/auth/middleware';
import { createUser, listUsers } from '@/lib/core/user-store';
import { getLoginPasswordError } from '@/lib/auth/password-policy';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;

  const users = await listUsers();
  return jsonOk({ users });
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;

  try {
    const { username, email, password, question, answer, role, personalDir, avatar } = await readJsonBody<Record<string, any>>(request, {});

    if (!username || !email || !password || !question || !answer) {
      return jsonError('所有字段都不能为空', 400);
    }
    const passwordError = getLoginPasswordError(password, { username, email });
    if (passwordError) return jsonError(passwordError, 400);

    const user = await createUser({
      username,
      email,
      password,
      question,
      answer,
      role: role || 'user',
      personalDir: personalDir || '',
      avatar,
      createdBy: admin.id,
      approvedBy: admin.id,
      status: 'active',
    });

    return jsonOk({ user });
  } catch (error) {
    return jsonError(errorMessage(error) || '创建用户失败', 400);
  }
}
