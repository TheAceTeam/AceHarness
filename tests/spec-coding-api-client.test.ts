import { afterEach, describe, expect, test, vi } from 'vitest';
import { specCodingApi } from '@/lib/core/api';

describe('specCodingApi.validateArtifactsQuality', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('posts artifacts to the quality validation endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      qualityValidation: {
        ok: true,
        errors: [],
        warnings: [],
        issues: [],
        taskValidation: { ok: true, errors: [], issues: [] },
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const artifacts = {
      requirements: '# requirements.md',
      design: '# design.md',
      tasks: '# tasks.md',
    };
    const result = await specCodingApi.validateArtifactsQuality(artifacts);

    expect(fetchMock).toHaveBeenCalledWith('/api/spec-coding/quality', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifacts }),
    }));
    expect(result.qualityValidation.ok).toBe(true);
  });

  test('throws the server validation error message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Spec 制品质量校验失败',
    }), { status: 500 })));

    await expect(specCodingApi.validateArtifactsQuality({
      requirements: '',
      design: '',
      tasks: '',
    })).rejects.toThrow('Spec 制品质量校验失败');
  });
});
