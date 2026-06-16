import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { validateSpecArtifactsQuality } from '@/lib/spec/artifact-quality';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const artifacts = body?.artifacts && typeof body.artifacts === 'object' ? body.artifacts : {};
    const qualityValidation = validateSpecArtifactsQuality(artifacts);
    return NextResponse.json({ qualityValidation });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Spec 制品质量校验失败' },
      { status: 500 },
    );
  }
}
