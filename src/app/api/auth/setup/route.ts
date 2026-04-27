import { NextRequest, NextResponse } from 'next/server';
import { isSetup, setupFirstAdmin } from '@/lib/user-store';
import { saveChatSettings, discoverSkills } from '@/lib/chat-settings';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/setup - Check if admin is setup
 */
export async function GET() {
  const setup = await isSetup();
  return NextResponse.json({ isSetup: setup });
}

/**
 * POST /api/auth/setup - Setup admin account and initialize skills (first time only)
 */
export async function POST(request: NextRequest) {
  try {
    const { username, email, password, question, answer, personalDir, avatar } = await request.json();

    if (!username || !email || !password || !question || !answer) {
      return NextResponse.json({ error: '所有字段都不能为空' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: '密码至少6个字符' }, { status: 400 });
    }

    await setupFirstAdmin({ username, email, password, question, answer, personalDir, avatar });

    // Initialize skills settings
    const discovered = await discoverSkills();
    const DEFAULT_ENABLED = ['aceharness-chat-card'];
    const skills: Record<string, boolean> = {};
    for (const s of discovered) {
      skills[s.name] = DEFAULT_ENABLED.includes(s.name);
    }
    await saveChatSettings({ skills });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '设置失败' }, { status: 500 });
  }
}
