import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

let runtimeRoot = '';

vi.mock('@/lib/core/app-paths', () => ({
  getWorkspaceRoot: () => runtimeRoot,
  getWorkspacePath: (...segments: string[]) => join(runtimeRoot, ...segments),
}));

describe('first setup access verification', () => {
  beforeEach(async () => {
    runtimeRoot = await mkdtemp(join(tmpdir(), 'ace-setup-access-'));
  });

  afterEach(async () => {
    await rm(runtimeRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('writes a stable random code into the runtime root', async () => {
    const {
      SETUP_VERIFICATION_FILE_NAME,
      ensureSetupVerificationCode,
      getSetupVerificationFilePath,
    } = await import('@/lib/auth/setup-access');

    const firstCode = await ensureSetupVerificationCode();
    const secondCode = await ensureSetupVerificationCode();

    expect(firstCode).toMatch(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){5}$/);
    expect(secondCode).toBe(firstCode);
    expect(getSetupVerificationFilePath()).toBe(join(runtimeRoot, SETUP_VERIFICATION_FILE_NAME));
    expect((await readFile(getSetupVerificationFilePath(), 'utf8')).trim()).toBe(firstCode);
  });

  test('only grants access for the exact code stored on disk', async () => {
    const {
      ensureSetupVerificationCode,
      isSetupAccessGrantValid,
      verifySetupAccessCode,
    } = await import('@/lib/auth/setup-access');

    const code = await ensureSetupVerificationCode();
    expect(await verifySetupAccessCode('wrong-code')).toBeNull();

    const grant = await verifySetupAccessCode(code);
    expect(grant).toBeTruthy();
    expect(await isSetupAccessGrantValid(grant)).toBe(true);
    expect(await isSetupAccessGrantValid('invalid-grant')).toBe(false);
  });

  test('rejects a correctly signed grant after its server-side expiry', async () => {
    const {
      ensureSetupVerificationCode,
      isSetupAccessGrantValid,
      verifySetupAccessCode,
    } = await import('@/lib/auth/setup-access');

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const code = await ensureSetupVerificationCode();
    const grant = await verifySetupAccessCode(code);
    expect(await isSetupAccessGrantValid(grant)).toBe(true);

    vi.spyOn(Date, 'now').mockReturnValue(now + 60 * 60 * 1000 + 1);
    expect(await isSetupAccessGrantValid(grant)).toBe(false);
  });
});
