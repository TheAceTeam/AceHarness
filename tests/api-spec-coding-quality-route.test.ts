import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { makeRequest, responseJson } from './helpers/route-helpers';

const routeMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  validateSpecArtifactsQuality: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: routeMocks.requireAuth,
}));

vi.mock('@/lib/spec/artifact-quality', () => ({
  validateSpecArtifactsQuality: routeMocks.validateSpecArtifactsQuality,
}));

describe('/api/spec-coding/quality route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.requireAuth.mockResolvedValue({
      id: 'user-1',
      username: 'Tester',
      email: 'tester@example.com',
      role: 'user',
      personalDir: '',
    });
    routeMocks.validateSpecArtifactsQuality.mockReturnValue({
      ok: true,
      errors: [],
      warnings: [],
      issues: [],
      taskValidation: { ok: true, errors: [], issues: [] },
    });
  });

  test('requires authentication before validating artifacts', async () => {
    routeMocks.requireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const { POST } = await import('@/app/api/spec-coding/quality/route');

    const response = await POST(makeRequest('/api/spec-coding/quality', {
      json: { artifacts: { requirements: '# requirements.md' } },
    }));

    expect(response.status).toBe(401);
    expect(routeMocks.validateSpecArtifactsQuality).not.toHaveBeenCalled();
  });

  test('returns the quality validation report for posted artifacts', async () => {
    const report = {
      ok: false,
      errors: [{ level: 'error', artifact: 'tasks', code: 'tasks_format', message: 'tasks.md 格式不合法' }],
      warnings: [],
      issues: [],
      taskValidation: {
        ok: false,
        errors: ['tasks.md 格式不合法'],
        issues: [{ code: 'missing_task_list', lineNumber: null, message: '缺少任务列表' }],
      },
    };
    routeMocks.validateSpecArtifactsQuality.mockReturnValue(report);
    const { POST } = await import('@/app/api/spec-coding/quality/route');

    const artifacts = {
      requirements: '# requirements.md',
      design: '# design.md',
      tasks: '# tasks.md',
    };
    const response = await POST(makeRequest('/api/spec-coding/quality', { json: { artifacts } }));
    const json = await responseJson<any>(response);

    expect(response.status).toBe(200);
    expect(routeMocks.validateSpecArtifactsQuality).toHaveBeenCalledWith(artifacts);
    expect(json.qualityValidation).toEqual(report);
  });
});
