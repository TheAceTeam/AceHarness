import { NextRequest, NextResponse } from 'next/server';
import { resetPasswordByQuestion, getSecurityQuestion } from '@/lib/core/user-store';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/reset-password - Reset password via security question
 */
export async function POST(request: NextRequest) {
  try {
    const { email, answer, newPassword, step } = await request.json();

    // Step 1: get security question
    if (step === 'question') {
      if (!email) {
        return NextResponse.json({ error: '请输入邮箱' }, { status: 400 });
      }
      try {
        const question = await getSecurityQuestion(email);
        return NextResponse.json({ question });
      } catch {
        return NextResponse.json({ error: '用户不存在' }, { status: 404 });
      }
    }

    // Step 2: verify answer and reset password
    if (!email || !answer || !newPassword) {
      return NextResponse.json({ error: '所有字段不能为空' }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: '新密码至少6个字符' }, { status: 400 });
    }
    await resetPasswordByQuestion(email, answer, newPassword);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '重置密码失败' }, { status: 400 });
  }
}
