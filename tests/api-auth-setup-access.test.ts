import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isSetup: vi.fn(),
  setupFirstAdmin: vi.fn(),
  discoverSkills: vi.fn(),
  saveChatSettings: vi.fn(),
  ensureSetupVerificationCode: vi.fn(),
  getSetupVerificationFilePath: vi.fn(),
  isSetupAccessGrantValid: vi.fn(),
  removeSetupVerificationCode: vi.fn(),
  verifySetupAccessCode: vi.fn(),
}));

vi.mock('@/lib/core/user-store', () => ({
  isSetup: mocks.isSetup,
  setupFirstAdmin: mocks.setupFirstAdmin,
}));

vi.mock('@/lib/chat/settings', () => ({
  discoverSkills: mocks.discoverSkills,
  saveChatSettings: mocks.saveChatSettings,
}));

vi.mock('@/lib/core/app-paths', () => ({
  getWorkspaceRoot: () => 'C:\\runtime',
}));

vi.mock('@/lib/core/runtime-platform', () => ({
  getRuntimePlatform: () => 'win32',
}));

vi.mock('@/lib/auth/setup-access', () => ({
  SETUP_ACCESS_COOKIE_NAME: 'ace_setup_access',
  buildSetupAccessCookie: (grant: string) => `ace_setup_access=${grant}; HttpOnly`,
  clearSetupAccessCookie: () => 'ace_setup_access=; Max-Age=0; HttpOnly',
  ensureSetupVerificationCode: mocks.ensureSetupVerificationCode,
  getSetupVerificationFilePath: mocks.getSetupVerificationFilePath,
  isSetupAccessGrantValid: mocks.isSetupAccessGrantValid,
  removeSetupVerificationCode: mocks.removeSetupVerificationCode,
  verifySetupAccessCode: mocks.verifySetupAccessCode,
}));

import { GET, POST } from '@/server/api-routes/auth/setup/route';

function request(body?: Record<string, unknown>, cookie?: string) {
  return new Request('http://localhost/api/auth/setup', {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('/api/auth/setup access gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSetup.mockResolvedValue(false);
    mocks.ensureSetupVerificationCode.mockResolvedValue('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF');
    mocks.getSetupVerificationFilePath.mockReturnValue('C:\\runtime\\setup-verification-code.txt');
    mocks.isSetupAccessGrantValid.mockResolvedValue(false);
    mocks.removeSetupVerificationCode.mockResolvedValue(undefined);
    mocks.discoverSkills.mockResolvedValue([]);
    mocks.saveChatSettings.mockResolvedValue(undefined);
    mocks.setupFirstAdmin.mockResolvedValue({ id: 'admin' });
  });

  test('does not expose setup details before verification', async () => {
    const response = await GET(request());
    const payload = await response.json();

    expect(payload).toEqual({
      isSetup: false,
      setupAccessRequired: true,
      setupAccessVerified: false,
      verificationFile: 'C:\\runtime\\setup-verification-code.txt',
    });
    expect(payload).not.toHaveProperty('userHome');
  });

  test('rejects first-admin creation without a valid setup grant', async () => {
    const response = await POST(request({
      username: 'admin',
      email: 'admin@example.com',
      password: 'StrongPass123',
      question: 'question',
      answer: 'answer',
    }));

    expect(response.status).toBe(403);
    expect(mocks.setupFirstAdmin).not.toHaveBeenCalled();
  });

  test('sets an HttpOnly grant after the file code is verified', async () => {
    mocks.verifySetupAccessCode.mockResolvedValue('valid-grant');

    const response = await POST(request({
      action: 'verify-access',
      verificationCode: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF',
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('ace_setup_access=valid-grant');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });

  test('creates the first admin only after verification and removes the code file', async () => {
    mocks.isSetupAccessGrantValid.mockResolvedValue(true);

    const response = await POST(request({
      username: 'admin',
      email: 'admin@example.com',
      password: 'StrongPass123',
      question: 'question',
      answer: 'answer',
    }, 'ace_setup_access=valid-grant'));

    expect(response.status).toBe(200);
    expect(mocks.setupFirstAdmin).toHaveBeenCalledOnce();
    expect(mocks.removeSetupVerificationCode).toHaveBeenCalledOnce();
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
