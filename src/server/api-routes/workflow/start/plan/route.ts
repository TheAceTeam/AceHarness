import { requireAuth } from '@/lib/auth/middleware';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { getWorkflowPreflightPlan } from '@/lib/workflow/preflight';
import {
  applyRunReviewPlanOverrides,
  createRunReviewPlanArtifact,
  validateRunReviewPlanArtifact,
} from '@/lib/workflow/run-review-plan';
import {
  discardRunReviewPlanArtifact,
  loadRunReviewPlanArtifact,
  replaceRunReviewPlanArtifact,
  saveRunReviewPlanArtifact,
} from '@/lib/workflow/run-review-plan-store';
import type {
  RunReviewOverride,
  WorkflowAdversarialIntent,
} from '@/lib/workflow/run-review-types';
import { normalizeWorkflowTaskInput } from '@/lib/workflow/task-input';

function normalizeInitialContexts(input: any) {
  const phaseContexts = Object.fromEntries(Object.entries(input?.phaseContexts || {})
    .filter(([key, value]) => String(key).trim() && typeof value === 'string' && value.trim()));
  const workingDirectory = typeof input?.workingDirectory === 'string' ? input.workingDirectory.trim() : '';
  return {
    globalContext: typeof input?.globalContext === 'string' ? input.globalContext : '',
    phaseContexts,
    taskInput: normalizeWorkflowTaskInput(input?.taskInput),
    workingDirectory: workingDirectory || undefined,
  };
}

function normalizeOverrides(input: any): RunReviewOverride[] {
  if (!Array.isArray(input)) return [];
  return input.map((item) => {
    const configFile = String(item?.configFile || '').trim();
    if (!configFile) throw new Error('运行级覆盖缺少配置文件');
    if (item?.kind === 'lightweight') {
      const requiresAdversarial = item?.requiresAdversarial;
      if (![true, false, null].includes(requiresAdversarial)) throw new Error('轻量工作流运行级覆盖格式无效');
      return { kind: 'lightweight', configFile, requiresAdversarial };
    }
    const stateId = String(item?.stateId || '').trim();
    const mode = item?.mode === null ? null : String(item?.mode || '');
    if (!stateId || !['standard', 'adversarial', null].includes(mode as any)) {
      throw new Error('逐状态运行级覆盖格式无效');
    }
    return { kind: 'state', configFile, stateId, mode } as RunReviewOverride;
  });
}

async function buildResponse(
  artifact: Awaited<ReturnType<typeof createRunReviewPlanArtifact>>,
  personalDir: string,
  workingDirectory?: string,
) {
  const preflightPreview = await getWorkflowPreflightPlan(
    artifact.plan.rootConfigFile,
    personalDir,
    workingDirectory,
    { configContents: artifact.effectiveConfigContents },
  );
  return { plan: artifact.plan, preflightPreview };
}

export async function POST(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;
  try {
    const body = await readJsonBody<any>(request, {});
    const configFile = String(body?.configFile || '').trim();
    const intent = String(body?.intent || '') as WorkflowAdversarialIntent;
    if (!configFile) return jsonOk({ error: '缺少配置文件参数' }, { status: 400 });
    if (!['disabled', 'on-demand'].includes(intent)) {
      return jsonOk({ error: '必须选择不开启对抗或按需开启' }, { status: 400 });
    }
    const initialContexts = normalizeInitialContexts(body?.initialContexts);
    const artifact = await createRunReviewPlanArtifact({
      rootConfigFile: configFile,
      intent,
      initialContexts,
      rehearsal: Boolean(body?.rehearsal),
      userId: user.id,
    });
    saveRunReviewPlanArtifact(user.id, artifact);
    return jsonOk(await buildResponse(artifact, user.personalDir || '', initialContexts.workingDirectory));
  } catch (error: any) {
    return jsonOk(
      { error: '无法生成本次运行方案', message: error?.message || String(error) },
      { status: 502 },
    );
  }
}

export async function PUT(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;
  try {
    const body = await readJsonBody<any>(request, {});
    const planId = String(body?.planId || '').trim();
    const current = loadRunReviewPlanArtifact(user.id, planId);
    if (!current) return jsonOk({ error: '本次运行方案不存在或已过期' }, { status: 404 });
    const initialContexts = normalizeInitialContexts(body?.initialContexts);
    await validateRunReviewPlanArtifact({
      artifact: current,
      initialContexts,
      rehearsal: Boolean(body?.rehearsal),
    });
    const artifact = await applyRunReviewPlanOverrides({
      artifact: current,
      overrides: normalizeOverrides(body?.overrides),
    });
    replaceRunReviewPlanArtifact(user.id, artifact);
    return jsonOk(await buildResponse(artifact, user.personalDir || '', initialContexts.workingDirectory));
  } catch (error: any) {
    return jsonOk(
      { error: '无法更新本次运行方案', message: error?.message || String(error) },
      { status: 409 },
    );
  }
}

export async function DELETE(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;
  const body = await readJsonBody<any>(request, {});
  const planId = String(body?.planId || '').trim();
  if (!planId) return jsonOk({ error: '缺少本次运行方案 ID' }, { status: 400 });
  discardRunReviewPlanArtifact(user.id, planId);
  return jsonOk({ success: true });
}
