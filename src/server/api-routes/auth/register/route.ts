import { isSetup, registerUser } from '@/lib/core/user-store';
import { getLoginPasswordError } from '@/lib/auth/password-policy';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const setup = await isSetup();
    if (!setup) {
      return jsonError('系统尚未初始化，请先完成管理员设置', 409);
    }

    const { username, email, password, question, answer, personalDir, avatar } = await readJsonBody<Record<string, any>>(request, {});

    if (!username || !email || !password || !question || !answer) {
      return jsonError('所有字段都不能为空', 400);
    }
    const passwordError = getLoginPasswordError(password, { username, email });
    if (passwordError) return jsonError(passwordError, 400);

    const user = await registerUser({
      username,
      email,
      password,
      question,
      answer,
      personalDir,
      avatar,
    });

    return jsonOk({ user, message: '注册申请已提交，请等待管理员审核' });
  } catch (error) {
    return jsonError(errorMessage(error) || '注册失败', 400);
  }
}
