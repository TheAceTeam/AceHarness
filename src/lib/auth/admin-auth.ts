/**
 * Admin User Management
 * Now delegates to user-store for multi-user support.
 * This file is kept for backward compatibility.
 */

import {
  login as userLogin,
  validateToken as userValidateToken,
  removeToken,
  storeToken as userStoreToken,
  isSetup,
  setupFirstAdmin,
  getUserById,
  type PublicUser,
} from '@/lib/core/user-store';

export interface AdminUser {
  username: string;
  email: string;
  passwordHash: string;
  salt: string;
  question: string;
  answerHash: string;
  createdAt: number;
  lastLoginAt?: number;
}

export interface SetupResult {
  success: true;
}

export async function isAdminSetup(): Promise<boolean> {
  return isSetup();
}

export async function setupAdmin(
  username: string,
  email: string,
  password: string,
  question: string,
  answer: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await setupFirstAdmin({ username, email, password, question, answer });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function login(
  email: string,
  password: string
): Promise<{ success: true; token: string; user?: PublicUser } | { success: false; error: string }> {
  const result = await userLogin(email, password);
  return result;
}

export async function validateToken(token: string): Promise<boolean> {
  return userValidateToken(token) !== null;
}

export async function logout(token: string): Promise<void> {
  removeToken(token);
}

export function storeToken(token: string): void {
  // Legacy: no userId available, this is a no-op now.
  // Login flow in user-store handles token storage.
}

export function isValidToken(token: string): boolean {
  return userValidateToken(token) !== null;
}

export function getTokenUserId(token: string): string | null {
  const info = userValidateToken(token);
  return info?.userId ?? null;
}

export async function getAdminInfo(): Promise<{ username: string; email: string } | null> {
  // For backward compat, return info from token is not possible here.
  // This is only called from /api/auth/me which will be updated.
  return null;
}

export async function resetAdmin(newUsername: string, newEmail: string, newPassword: string, newQuestion: string, newAnswer: string): Promise<{ success: true } | { success: false; error: string }> {
  // Deprecated — use user-store directly
  return { success: false, error: '请使用新的用户管理接口' };
}
