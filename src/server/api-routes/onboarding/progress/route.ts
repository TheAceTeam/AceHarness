import { requireAuth } from '@/lib/auth/middleware';
import {
  getProgressByUser,
  upsertProgress,
  type OnboardingProgress,
  type OnboardingPhase,
  type AdminChecks,
  type MemberChecks,
} from '@/lib/core/onboarding-store';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

function pickProgressPatch(input: any): Partial<OnboardingProgress> {
  if (!input || typeof input !== 'object') return {};

  const patch: Partial<OnboardingProgress> = {};

  if (typeof input.done === 'boolean') patch.done = input.done;
  if (typeof input.phase === 'string') patch.phase = input.phase as OnboardingPhase;
  if (typeof input.introIndex === 'number') patch.introIndex = input.introIndex;
  if (typeof input.selectedModule === 'string') patch.selectedModule = input.selectedModule;
  if (typeof input.moduleStepIndex === 'number') patch.moduleStepIndex = input.moduleStepIndex;
  if (typeof input.maximized === 'boolean') patch.maximized = input.maximized;
  if (Array.isArray(input.visitedModules)) {
    patch.visitedModules = input.visitedModules.filter((m: unknown) => typeof m === 'string');
  }
  if (input.memberChecks && typeof input.memberChecks === 'object') {
    patch.memberChecks = input.memberChecks as MemberChecks;
  }
  if (input.adminChecks && typeof input.adminChecks === 'object') {
    patch.adminChecks = input.adminChecks as AdminChecks;
  }

  return patch;
}

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const progress = await getProgressByUser(auth.id, auth.role);
  return jsonOk({ progress, role: auth.role });
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const patch = pickProgressPatch(body?.progress || body);
    const markCompleted = body?.markCompleted === true;

    const progress = await upsertProgress(auth.id, auth.role, patch, markCompleted);
    return jsonOk({ progress });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '保存引导进度失败', 500);
  }
}
