import { requireAuth } from '@/lib/auth/middleware';
import { validateSpecArtifactsQuality } from '@/lib/spec/artifact-quality';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<any>(request, {});
    const artifacts = body?.artifacts && typeof body.artifacts === 'object' ? body.artifacts : {};
    const qualityValidation = validateSpecArtifactsQuality(artifacts);
    return jsonOk({ qualityValidation });
  } catch (error: any) {
    return jsonOk(
      { error: error?.message || 'Spec 制品质量校验失败' },
      { status: 500 },
    );
  }
}
