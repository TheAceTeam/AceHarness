/**
 * Multi-user data store.
 * User records are persisted in data/users.json.
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { randomBytes, createHash, randomUUID } from 'crypto';
import { getWorkspaceDataFile, getWorkspaceDataDir } from '@/lib/app-paths';

const USERS_FILE = getWorkspaceDataFile('users.json');
const ADMIN_FILE = getWorkspaceDataFile('admin.json');

export type UserRole = 'admin' | 'user';
export type UserStatus = 'pending' | 'active' | 'rejected';

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  salt: string;
  question: string;
  answerHash: string;
  role: UserRole;
  status: UserStatus;
  personalDir: string;
  avatar?: string;
  createdAt: number;
  lastLoginAt?: number;
  createdBy?: string;
  approvedAt?: number;
  approvedBy?: string;
  rejectedAt?: number;
  rejectedBy?: string;
  reviewNote?: string;
}

export type PublicUser = Omit<User, 'passwordHash' | 'salt' | 'answerHash'>;

function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(password + salt).digest('hex');
}

function generateSalt(): string {
  return randomBytes(16).toString('hex');
}

function hashAnswer(answer: string, salt: string): string {
  return createHash('sha256').update(answer.toLowerCase().trim() + salt).digest('hex');
}

function normalizeLoadedUser(user: any): User {
  return {
    ...user,
    role: user.role === 'admin' ? 'admin' : 'user',
    status: user.status === 'pending' || user.status === 'rejected' ? user.status : 'active',
    personalDir: user.personalDir || '',
  };
}

export function toPublicUser(user: User): PublicUser {
  const { passwordHash, salt, answerHash, ...pub } = user;
  return pub;
}

let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let resolve!: () => void;
  writeLock = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(() => resolve());
}

export async function loadUsers(): Promise<User[]> {
  if (!existsSync(USERS_FILE)) return [];
  try {
    const content = await readFile(USERS_FILE, 'utf-8');
    const users = JSON.parse(content);
    return Array.isArray(users) ? users.map(normalizeLoadedUser) : [];
  } catch {
    return [];
  }
}

async function saveUsers(users: User[]): Promise<void> {
  await mkdir(getWorkspaceDataDir(), { recursive: true });
  await writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

export async function getUserById(id: string): Promise<User | undefined> {
  const users = await loadUsers();
  return users.find((u) => u.id === id);
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const users = await loadUsers();
  return users.find((u) => u.email === email);
}

export async function getUserByUsername(username: string): Promise<User | undefined> {
  const users = await loadUsers();
  return users.find((u) => u.username === username);
}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await loadUsers();
  return users
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toPublicUser);
}

export async function listPendingUsers(): Promise<PublicUser[]> {
  const users = await loadUsers();
  return users
    .filter((user) => user.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(toPublicUser);
}

async function assertUserUniqueness(users: User[], data: { email: string; username: string }, excludeId?: string) {
  if (users.find((u) => u.email === data.email && u.id !== excludeId)) {
    throw new Error('邮箱已存在');
  }
  if (users.find((u) => u.username === data.username && u.id !== excludeId)) {
    throw new Error('用户名已存在');
  }
}

export async function createUser(data: {
  username: string;
  email: string;
  password: string;
  question: string;
  answer: string;
  role: UserRole;
  personalDir: string;
  avatar?: string;
  createdBy?: string;
  status?: UserStatus;
  approvedBy?: string;
  reviewNote?: string;
}): Promise<PublicUser> {
  return withLock(async () => {
    const users = await loadUsers();
    await assertUserUniqueness(users, data);

    const salt = generateSalt();
    const status = data.status || 'active';
    const approvedAt = status === 'active' ? Date.now() : undefined;
    const user: User = {
      id: randomUUID(),
      username: data.username,
      email: data.email,
      passwordHash: hashPassword(data.password, salt),
      salt,
      question: data.question,
      answerHash: hashAnswer(data.answer, salt),
      role: data.role,
      status,
      personalDir: data.personalDir,
      avatar: data.avatar,
      createdAt: Date.now(),
      createdBy: data.createdBy,
      approvedAt,
      approvedBy: status === 'active' ? (data.approvedBy || data.createdBy) : undefined,
      reviewNote: data.reviewNote,
    };
    users.push(user);
    await saveUsers(users);
    return toPublicUser(user);
  });
}

export async function registerUser(data: {
  username: string;
  email: string;
  password: string;
  question: string;
  answer: string;
  personalDir?: string;
  avatar?: string;
}): Promise<PublicUser> {
  return createUser({
    ...data,
    role: 'user',
    personalDir: data.personalDir || '',
    status: 'pending',
  });
}

export async function reviewUserRegistration(input: {
  userId: string;
  action: 'approve' | 'reject';
  adminId: string;
  note?: string;
}): Promise<PublicUser> {
  return withLock(async () => {
    const users = await loadUsers();
    const user = users.find((item) => item.id === input.userId);
    if (!user) throw new Error('用户不存在');
    if (user.role === 'admin' && input.action === 'reject') {
      throw new Error('不能拒绝管理员账号');
    }

    if (input.action === 'approve') {
      user.status = 'active';
      user.approvedAt = Date.now();
      user.approvedBy = input.adminId;
      user.rejectedAt = undefined;
      user.rejectedBy = undefined;
    } else {
      user.status = 'rejected';
      user.rejectedAt = Date.now();
      user.rejectedBy = input.adminId;
      user.approvedAt = undefined;
      user.approvedBy = undefined;
    }
    user.reviewNote = input.note?.trim() || undefined;

    await saveUsers(users);
    return toPublicUser(user);
  });
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<User, 'username' | 'email' | 'role' | 'personalDir' | 'avatar'>>
): Promise<PublicUser> {
  return withLock(async () => {
    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) throw new Error('用户不存在');

    const nextUsername = patch.username ?? users[idx].username;
    const nextEmail = patch.email ?? users[idx].email;
    await assertUserUniqueness(users, { username: nextUsername, email: nextEmail }, id);

    Object.assign(users[idx], patch);
    await saveUsers(users);
    return toPublicUser(users[idx]);
  });
}

export async function deleteUser(id: string): Promise<void> {
  return withLock(async () => {
    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) throw new Error('用户不存在');
    users.splice(idx, 1);
    await saveUsers(users);
    for (const [token, info] of tokenStore.entries()) {
      if (info.userId === id) tokenStore.delete(token);
    }
  });
}

export async function changePassword(userId: string, currentPwd: string, newPwd: string): Promise<void> {
  return withLock(async () => {
    const users = await loadUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error('用户不存在');
    if (hashPassword(currentPwd, user.salt) !== user.passwordHash) {
      throw new Error('当前密码错误');
    }
    user.passwordHash = hashPassword(newPwd, user.salt);
    await saveUsers(users);
  });
}

export async function changeEmail(userId: string, newEmail: string): Promise<void> {
  return withLock(async () => {
    const users = await loadUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error('用户不存在');
    if (users.find((u) => u.email === newEmail && u.id !== userId)) throw new Error('邮箱已存在');
    user.email = newEmail;
    await saveUsers(users);
  });
}

export async function resetPasswordByQuestion(email: string, answer: string, newPwd: string): Promise<void> {
  return withLock(async () => {
    const users = await loadUsers();
    const user = users.find((u) => u.email === email);
    if (!user) throw new Error('用户不存在');
    if (hashAnswer(answer, user.salt) !== user.answerHash) {
      throw new Error('密保答案错误');
    }
    user.passwordHash = hashPassword(newPwd, user.salt);
    await saveUsers(users);
  });
}

export async function getSecurityQuestion(email: string): Promise<string> {
  const users = await loadUsers();
  const user = users.find((u) => u.email === email);
  if (!user) throw new Error('用户不存在');
  return user.question;
}

export async function adminResetPassword(userId: string, newPwd: string): Promise<void> {
  return withLock(async () => {
    const users = await loadUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error('用户不存在');
    user.passwordHash = hashPassword(newPwd, user.salt);
    await saveUsers(users);
  });
}

const TOKENS_FILE = getWorkspaceDataFile('tokens.json');
const tokenStore = new Map<string, { userId: string; expiry: number }>();
let tokensLoaded = false;

function loadTokensSync(): void {
  if (tokensLoaded) return;
  tokensLoaded = true;
  try {
    if (existsSync(TOKENS_FILE)) {
      const content = require('fs').readFileSync(TOKENS_FILE, 'utf-8');
      const entries: [string, { userId: string; expiry: number }][] = JSON.parse(content);
      const now = Date.now();
      for (const [token, info] of entries) {
        if (info.expiry > now) tokenStore.set(token, info);
      }
    }
  } catch {
    // ignore corrupt token cache
  }
}

function persistTokens(): void {
  try {
    const { mkdirSync, writeFileSync } = require('fs');
    mkdirSync(getWorkspaceDataDir(), { recursive: true });
    writeFileSync(TOKENS_FILE, JSON.stringify([...tokenStore.entries()]), 'utf-8');
  } catch {
    // ignore token persistence failures
  }
}

export function storeToken(token: string, userId: string): void {
  loadTokensSync();
  tokenStore.set(token, { userId, expiry: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  persistTokens();
}

export function validateToken(token: string): { userId: string } | null {
  loadTokensSync();
  const info = tokenStore.get(token);
  if (!info) return null;
  if (info.expiry < Date.now()) {
    tokenStore.delete(token);
    persistTokens();
    return null;
  }
  return { userId: info.userId };
}

export function removeToken(token: string): void {
  loadTokensSync();
  tokenStore.delete(token);
  persistTokens();
}

export async function login(
  email: string,
  password: string,
): Promise<{ success: true; token: string; user: PublicUser } | { success: false; error: string }> {
  const users = await loadUsers();
  const user = users.find((u) => u.email === email);
  if (!user) return { success: false, error: '邮箱或密码错误' };
  if (hashPassword(password, user.salt) !== user.passwordHash) {
    return { success: false, error: '邮箱或密码错误' };
  }
  if (user.status === 'pending') {
    return { success: false, error: '账号已注册，等待管理员审核' };
  }
  if (user.status === 'rejected') {
    return { success: false, error: user.reviewNote ? `注册申请未通过：${user.reviewNote}` : '注册申请未通过' };
  }

  user.lastLoginAt = Date.now();
  await withLock(async () => {
    const all = await loadUsers();
    const target = all.find((item) => item.id === user.id);
    if (target) {
      target.lastLoginAt = user.lastLoginAt;
      await saveUsers(all);
    }
  });

  const token = randomBytes(32).toString('hex');
  storeToken(token, user.id);
  return { success: true, token, user: toPublicUser(user) };
}

export async function migrateFromAdminJson(): Promise<boolean> {
  if (existsSync(USERS_FILE)) return false;
  if (!existsSync(ADMIN_FILE)) return false;
  try {
    const content = await readFile(ADMIN_FILE, 'utf-8');
    const admin = JSON.parse(content);
    const user: User = {
      id: randomUUID(),
      username: admin.username,
      email: admin.email,
      passwordHash: admin.passwordHash,
      salt: admin.salt,
      question: admin.question || '',
      answerHash: admin.answerHash || '',
      role: 'admin',
      status: 'active',
      personalDir: '',
      createdAt: admin.createdAt || Date.now(),
      lastLoginAt: admin.lastLoginAt,
      approvedAt: admin.createdAt || Date.now(),
    };
    await mkdir(getWorkspaceDataDir(), { recursive: true });
    await writeFile(USERS_FILE, JSON.stringify([user], null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export async function isSetup(): Promise<boolean> {
  await migrateFromAdminJson();
  const users = await loadUsers();
  return users.some((u) => u.role === 'admin');
}

export async function setupFirstAdmin(data: {
  username: string;
  email: string;
  password: string;
  question: string;
  answer: string;
  personalDir?: string;
  avatar?: string;
}): Promise<PublicUser> {
  const users = await loadUsers();
  if (users.some((u) => u.role === 'admin')) {
    throw new Error('管理员已设置');
  }
  return createUser({
    ...data,
    role: 'admin',
    status: 'active',
    personalDir: data.personalDir || '',
  });
}
