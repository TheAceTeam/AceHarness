import { isSetup, setupFirstAdmin } from '@/lib/core/user-store';
import {
  SETUP_ACCESS_COOKIE_NAME,
  buildSetupAccessCookie,
  clearSetupAccessCookie,
  ensureSetupVerificationCode,
  getSetupVerificationFilePath,
  isSetupAccessGrantValid,
  removeSetupVerificationCode,
  verifySetupAccessCode,
} from '@/lib/auth/setup-access';
import { saveChatSettings, discoverSkills } from '@/lib/chat/settings';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import { getRuntimePlatform } from '@/lib/core/runtime-platform';
import { getLoginPasswordError } from '@/lib/auth/password-policy';
import { errorMessage, jsonError, jsonOk, readJsonBody, requestCookies } from '@/server/api-route-runtime/request-utils';
import { homedir } from 'os';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/setup - Check if admin is setup
 */
function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

async function hasSetupAccess(request: Request): Promise<boolean> {
  const grant = requestCookies(request).get(SETUP_ACCESS_COOKIE_NAME)?.value;
  return isSetupAccessGrantValid(grant);
}

export async function GET(request: Request) {
  const setup = await isSetup();
  if (setup) {
    await removeSetupVerificationCode();
    return jsonOk({ isSetup: true, setupAccessRequired: false, setupAccessVerified: false });
  }

  await ensureSetupVerificationCode();
  const setupAccessVerified = await hasSetupAccess(request);
  return jsonOk({
    isSetup: false,
    setupAccessRequired: true,
    setupAccessVerified,
    verificationFile: getSetupVerificationFilePath(),
    ...(setupAccessVerified ? {
      runtimeRoot: getWorkspaceRoot(),
      platform: getRuntimePlatform(),
      userHome: homedir(),
    } : {}),
  });
}

/**
 * POST /api/auth/setup - Setup admin account and initialize skills (first time only)
 */
export async function POST(request: Request) {
  try {
    if (await isSetup()) {
      return jsonError('管理员已设置', 409);
    }

    const body = await readJsonBody<Record<string, any>>(request, {});
    if (body.action === 'verify-access') {
      const grant = await verifySetupAccessCode(body.verificationCode);
      if (!grant) return jsonError('验证码不正确，请读取服务器上的验证码文件', 403);

      const response = jsonOk({ success: true });
      response.headers.set('Set-Cookie', buildSetupAccessCookie(grant, isSecureRequest(request)));
      return response;
    }

    if (!await hasSetupAccess(request)) {
      return jsonError('请先输入首次设置验证码', 403);
    }

    const { username, email, password, question, answer, personalDir, avatar } = body;

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

    await removeSetupVerificationCode();
    const response = jsonOk({ success: true });
    response.headers.set('Set-Cookie', clearSetupAccessCookie(isSecureRequest(request)));
    return response;
  } catch (error) {
    return jsonError(errorMessage(error) || '设置失败', 500);
  }
}
