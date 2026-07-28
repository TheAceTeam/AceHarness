export const PASSWORD_POLICY_DESCRIPTION = '至少 8 个字符，且包含字母、数字和符号，不能包含空格，也不能与用户名或邮箱过于相似。';

export type PasswordPolicyContext = {
  username?: string;
  email?: string;
  currentPassword?: string;
};

export type PasswordValidationResult = {
  valid: boolean;
  error?: string;
};

const COMMON_WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'admin123',
  'admin1234',
  'abc12345',
  '12345678',
  'qwerty123',
  'letmein1',
  'welcome1',
]);

function normalizeComparable(value: string | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function localPart(email: string | undefined): string {
  return normalizeComparable(email).split('@')[0] || '';
}

export function validateLoginPassword(
  password: string | undefined,
  context: PasswordPolicyContext = {},
): PasswordValidationResult {
  const value = String(password || '');
  if (!value) {
    return { valid: false, error: '密码不能为空' };
  }
  if (value.length < 8) {
    return { valid: false, error: '密码至少 8 个字符' };
  }
  if (/\s/.test(value)) {
    return { valid: false, error: '密码不能包含空格或换行' };
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9\s]/.test(value)) {
    return { valid: false, error: '密码需要同时包含字母、数字和符号' };
  }
  const lowered = value.toLowerCase();
  if (COMMON_WEAK_PASSWORDS.has(lowered)) {
    return { valid: false, error: '密码过于常见，请使用更难猜的新密码' };
  }
  if (/^(.)\1+$/.test(value)) {
    return { valid: false, error: '密码不能由同一个字符重复组成' };
  }
  const username = normalizeComparable(context.username);
  if (username.length >= 3 && (lowered === username || lowered.includes(username))) {
    return { valid: false, error: '密码不能包含用户名' };
  }
  const emailName = localPart(context.email);
  if (emailName && emailName.length >= 3 && (lowered === emailName || lowered.includes(emailName))) {
    return { valid: false, error: '密码不能包含邮箱前缀' };
  }
  if (context.currentPassword && value === context.currentPassword) {
    return { valid: false, error: '新密码不能与当前密码相同' };
  }
  return { valid: true };
}

export function getLoginPasswordError(
  password: string | undefined,
  context: PasswordPolicyContext = {},
): string | null {
  const result = validateLoginPassword(password, context);
  return result.valid ? null : result.error || PASSWORD_POLICY_DESCRIPTION;
}
