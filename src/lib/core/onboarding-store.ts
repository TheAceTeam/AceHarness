import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { listUsers } from '@/lib/core/user-store';
import { getWorkspaceDataFile, getWorkspaceDataDir } from '@/lib/core/app-paths';

const ONBOARDING_FILE = getWorkspaceDataFile('onboarding-progress.json');

export type OnboardingRole = 'admin' | 'user';
export type OnboardingPhase = 'intro' | 'overview' | 'module' | 'member' | 'admin' | 'adminReport' | 'done';

export interface MemberChecks {
  homeGuideDone: boolean;
  engineModelDone: boolean;
  notebookDone: boolean;
  personalDirConfirm: boolean;
}

export interface AdminChecks {
  engineReady: boolean;
  defaultModel: boolean;
  agentGroup: boolean;
  personalDirReady: boolean;
}

export interface OnboardingProgress {
  userId: string;
  role: OnboardingRole;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  done: boolean;
  phase: OnboardingPhase;
  introIndex: number;
  selectedModule: string;
  moduleStepIndex: number;
  visitedModules: string[];
  memberChecks: MemberChecks;
  adminChecks: AdminChecks;
  maximized: boolean;
}

export interface OnboardingProgressSummary {
  userId: string;
  username: string;
  email: string;
  role: OnboardingRole;
  personalDir: string;
  done: boolean;
  startedAt?: number;
  completedAt?: number;
  updatedAt?: number;
  phase?: OnboardingPhase;
  visitedModules?: string[];
}

const DEFAULT_MEMBER_CHECKS: MemberChecks = {
  homeGuideDone: false,
  engineModelDone: false,
  notebookDone: false,
  personalDirConfirm: false,
};

const DEFAULT_ADMIN_CHECKS: AdminChecks = {
  engineReady: false,
  defaultModel: false,
  agentGroup: false,
  personalDirReady: false,
};

let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let release: () => void;
  writeLock = new Promise<void>((r) => {
    release = r;
  });
  return prev.then(fn).finally(() => release!());
}

function normalize(input: Partial<OnboardingProgress> & { userId: string; role: OnboardingRole }): OnboardingProgress {
  const now = Date.now();
  return {
    userId: input.userId,
    role: input.role,
    startedAt: typeof input.startedAt === 'number' ? input.startedAt : now,
    updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : now,
    completedAt: typeof input.completedAt === 'number' ? input.completedAt : undefined,
    done: Boolean(input.done),
    phase: (input.phase || 'intro') as OnboardingPhase,
    introIndex: Number.isFinite(input.introIndex) ? Math.max(0, Number(input.introIndex)) : 0,
    selectedModule: input.selectedModule || 'home',
    moduleStepIndex: Number.isFinite(input.moduleStepIndex) ? Math.max(0, Number(input.moduleStepIndex)) : 0,
    visitedModules: Array.isArray(input.visitedModules)
      ? Array.from(new Set(input.visitedModules.filter((v) => typeof v === 'string')))
      : [],
    memberChecks: {
      ...DEFAULT_MEMBER_CHECKS,
      ...(input.memberChecks || {}),
    },
    adminChecks: {
      ...DEFAULT_ADMIN_CHECKS,
      ...(input.adminChecks || {}),
    },
    maximized: Boolean(input.maximized),
  };
}

export function defaultProgress(userId: string, role: OnboardingRole): OnboardingProgress {
  return normalize({
    userId,
    role,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    done: false,
    phase: 'intro',
  });
}

async function saveAll(progressList: OnboardingProgress[]): Promise<void> {
  await mkdir(getWorkspaceDataDir(), { recursive: true });
  await writeFile(ONBOARDING_FILE, JSON.stringify(progressList, null, 2), 'utf-8');
}

export async function loadAllProgress(): Promise<OnboardingProgress[]> {
  if (!existsSync(ONBOARDING_FILE)) return [];
  try {
    const content = await readFile(ONBOARDING_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.userId === 'string' && (item.role === 'admin' || item.role === 'user'))
      .map((item) => normalize(item));
  } catch {
    return [];
  }
}

export async function getProgressByUser(userId: string, role: OnboardingRole): Promise<OnboardingProgress> {
  const all = await loadAllProgress();
  const found = all.find((item) => item.userId === userId);
  return found ? normalize(found) : defaultProgress(userId, role);
}

export async function upsertProgress(
  userId: string,
  role: OnboardingRole,
  patch: Partial<OnboardingProgress>,
  markCompleted = false,
): Promise<OnboardingProgress> {
  return withLock(async () => {
    const all = await loadAllProgress();
    const idx = all.findIndex((item) => item.userId === userId);
    const base = idx >= 0 ? all[idx] : defaultProgress(userId, role);

    const next = normalize({
      ...base,
      ...patch,
      role,
      userId,
      updatedAt: Date.now(),
      done: markCompleted ? true : Boolean(patch.done ?? base.done),
      completedAt: markCompleted
        ? (base.completedAt || Date.now())
        : patch.done === false
          ? undefined
          : base.completedAt,
    });

    if (next.done && !next.completedAt) {
      next.completedAt = Date.now();
    }

    if (idx >= 0) all[idx] = next;
    else all.push(next);

    await saveAll(all);
    return next;
  });
}

export async function listOnboardingSummary(): Promise<OnboardingProgressSummary[]> {
  const [users, allProgress] = await Promise.all([listUsers(), loadAllProgress()]);
  const byUser = new Map(allProgress.map((item) => [item.userId, item]));
  return users.map((user) => {
    const p = byUser.get(user.id);
    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      personalDir: user.personalDir || '',
      done: Boolean(p?.done),
      startedAt: p?.startedAt,
      completedAt: p?.completedAt,
      updatedAt: p?.updatedAt,
      phase: p?.phase,
      visitedModules: p?.visitedModules || [],
    };
  });
}
