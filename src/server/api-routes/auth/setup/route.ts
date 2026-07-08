import { isSetup, setupFirstAdmin } from '@/lib/core/user-store';
import { saveChatSettings, discoverSkills } from '@/lib/chat/settings';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import { getRuntimePlatform } from '@/lib/core/runtime-platform';
import { getLoginPasswordError } from '@/lib/auth/password-policy';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { homedir } from 'os';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/setup - Check if admin is setup
 */
export async function GET() {
  const setup = await isSetup();
  return jsonOk({
    isSetup: setup,
    runtimeRoot: getWorkspaceRoot(),
    platform: getRuntimePlatform(),
    userHome: homedir(),
  });
}

/**
 * POST /api/auth/setup - Setup admin account and initialize skills (first time only)
 */
export async function POST(request: Request) {
  try {
    const { username, email, password, question, answer, personalDir, avatar } = await readJsonBody<Record<string, any>>(request, {});

    if (!username || !email || !password || !question || !answer) {
      return jsonError('所有字段都不能为空', 400);
    }

    const passwordError = getLoginPasswordError(password, { username, email });
    if (passwordError) return jsonError(passwordError, 400);

    await setupFirstAdmin({ username, email, password, question, answer, personalDir, avatar });

    // Initialize skills settings
    const discovered = await discoverSkills();
    const DEFAULT_ENABLED = ['aceharness-chat-card'];
    const skills: Record<string, boolean> = {};
    for (const s of discovered) {
      skills[s.name] = DEFAULT_ENABLED.includes(s.name);
    }
    await saveChatSettings({ skills, mcpServers: {} });

    return jsonOk({ success: true });
  } catch (error) {
    return jsonError(errorMessage(error) || '设置失败', 500);
  }
}
