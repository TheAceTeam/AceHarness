import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { getWorkspaceRoot, getWorkspacePath } from '@/lib/core/app-paths';

export const SETUP_ACCESS_COOKIE_NAME = 'csi_setup_access';
export const SETUP_VERIFICATION_FILE_NAME = 'setup-verification-code.txt';

const SETUP_ACCESS_MAX_AGE_SECONDS = 60 * 60;
const SETUP_GRANT_CONTEXT = 'CSIHarness/setup-access/v1:';

let ensureCodePromise: Promise<string> | null = null;

export function getSetupVerificationFilePath(): string {
  return getWorkspacePath(SETUP_VERIFICATION_FILE_NAME);
}

function createVerificationCode(): string {
  return randomBytes(12)
    .toString('hex')
    .toUpperCase()
    .match(/.{1,4}/g)!
    .join('-');
}

function signSetupGrant(code: string, expiresAt: number): string {
  return createHmac('sha256', code)
    .update(`${SETUP_GRANT_CONTEXT}${expiresAt}`)
    .digest('base64url');
}

function equalSecrets(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function readVerificationCode(): Promise<string | null> {
  try {
    const code = (await readFile(getSetupVerificationFilePath(), 'utf8')).trim();
    return code || null;
  } catch {
    return null;
  }
}

export async function ensureSetupVerificationCode(): Promise<string> {
  if (ensureCodePromise) return ensureCodePromise;

  ensureCodePromise = (async () => {
    const existingCode = await readVerificationCode();
    if (existingCode) return existingCode;

    await mkdir(getWorkspaceRoot(), { recursive: true });
    const code = createVerificationCode();
    const filePath = getSetupVerificationFilePath();
    try {
      await writeFile(filePath, `${code}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      console.log(`[CSIHarness] 首次设置验证码已写入：${filePath}`);
      return code;
    } catch (error: any) {
      if (error?.code === 'EEXIST') {
        const concurrentlyCreatedCode = await readVerificationCode();
        if (concurrentlyCreatedCode) return concurrentlyCreatedCode;
      }
      throw error;
    }
  })();

  try {
    return await ensureCodePromise;
  } finally {
    ensureCodePromise = null;
  }
}

export async function verifySetupAccessCode(input: string): Promise<string | null> {
  const expectedCode = await ensureSetupVerificationCode();
  const submittedCode = String(input || '').trim();
  if (!submittedCode || !equalSecrets(submittedCode, expectedCode)) return null;
  const expiresAt = Date.now() + SETUP_ACCESS_MAX_AGE_SECONDS * 1000;
  return `${expiresAt}.${signSetupGrant(expectedCode, expiresAt)}`;
}

export async function isSetupAccessGrantValid(grant: string | null | undefined): Promise<boolean> {
  if (!grant) return false;
  const [rawExpiresAt, signature, ...extra] = grant.split('.');
  const expiresAt = Number(rawExpiresAt);
  if (extra.length > 0 || !signature || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false;
  const code = await readVerificationCode();
  if (!code) return false;
  return equalSecrets(signature, signSetupGrant(code, expiresAt));
}

export function buildSetupAccessCookie(grant: string, secure = false): string {
  return [
    `${SETUP_ACCESS_COOKIE_NAME}=${encodeURIComponent(grant)}`,
    'Path=/api/auth/setup',
    `Max-Age=${SETUP_ACCESS_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function clearSetupAccessCookie(secure = false): string {
  return [
    `${SETUP_ACCESS_COOKIE_NAME}=`,
    'Path=/api/auth/setup',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export async function removeSetupVerificationCode(): Promise<void> {
  try {
    await unlink(getSetupVerificationFilePath());
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
