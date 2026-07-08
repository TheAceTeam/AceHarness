import { requireAuth } from '@/lib/auth/middleware';

export type StartAuthenticatedUser = {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  personalDir?: string;
  avatar?: string;
};

export async function requireStartAuth(request: Request): Promise<StartAuthenticatedUser | Response> {
  return requireAuth(request);
}
