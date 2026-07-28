import { resetPasswordByQuestion, getSecurityQuestion } from '@/lib/core/user-store';
import { getLoginPasswordError } from '@/lib/auth/password-policy';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/reset-password - Reset password via security question
 */
export async function POST(request: Request) {
  try {
    const { email, answer, newPassword, step } = await readJsonBody<Record<string, any>>(request, {});

    // Step 1: get security question
    if (step === 'question') {
      if (!email) {
        return jsonError('请输入邮箱', 400);
      }
      try {
        const question = await getSecurityQuestion(email);
        return jsonOk({ question });
      } catch {
        return jsonError('用户不存在', 404);
      }
    }

    // Step 2: verify answer and reset password
    if (!email || !answer || !newPassword) {
      return jsonError('所有字段不能为空', 400);
    }
    const passwordError = getLoginPasswordError(newPassword, { email });
    if (passwordError) return jsonError(passwordError, 400);
    await resetPasswordByQuestion(email, answer, newPassword);
    return jsonOk({ success: true });
  } catch (error) {
    return jsonError(errorMessage(error) || '重置密码失败', 400);
  }
}
