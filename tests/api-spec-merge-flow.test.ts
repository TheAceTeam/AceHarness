import { describe, expect, test, vi, beforeEach } from 'vitest';
import { makeRequest, responseJson, assertErrorResponse } from './helpers/route-helpers';

vi.mock('@/lib/run-state-persistence', () => ({
  loadRunState: vi.fn(),
  saveRunState: vi.fn(),
}));

vi.mock('@/lib/spec-persistence', () => ({
  applyMergedMasterSpec: vi.fn(),
  buildStructuralMergedMasterSpec: vi.fn(),
  getSpecRootDir: vi.fn().mockReturnValue('/tmp/spec-root'),
  readDeltaSpec: vi.fn(),
}));

vi.mock('@/lib/engines/engine-factory', () => ({
  createEngine: vi.fn(),
}));

vi.mock('@/lib/app-paths', () => ({
  getWorkspaceRunsDir: vi.fn().mockReturnValue('/tmp/runs'),
}));

vi.mock('@/lib/runtime-configs', () => ({
  getRuntimeWorkflowConfigPath: vi.fn().mockResolvedValue('/tmp/config.yaml'),
}));

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('yaml', () => ({
  parse: vi.fn().mockReturnValue({ workflow: { name: 'Test Workflow' } }),
}));

function makeRunState(overrides: Record<string, any> = {}) {
  return {
    runId: 'run-123',
    configFile: 'test.yaml',
    workflowName: 'Test Workflow',
    workingDirectory: '/tmp/project',
    persistMode: 'repository',
    runSpecCoding: { specRoot: 'spec' },
    deltaMergeState: undefined,
    ...overrides,
  };
}

describe('spec merge flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns 400 when action is missing', async () => {
    const { POST } = await import('@/app/api/workflow/spec-merge/route');
    const response = await POST(makeRequest('/api/workflow/spec-merge', {
      json: { runId: 'run-123' },
    }));

    await assertErrorResponse(response, 400);
  });

  test('returns 400 when runId is missing', async () => {
    const { POST } = await import('@/app/api/workflow/spec-merge/route');
    const response = await POST(makeRequest('/api/workflow/spec-merge', {
      json: { action: 'preview' },
    }));

    await assertErrorResponse(response, 400);
  });

  test('returns 400 for unsupported action', async () => {
    const { POST } = await import('@/app/api/workflow/spec-merge/route');
    const response = await POST(makeRequest('/api/workflow/spec-merge', {
      json: { action: 'invalid', runId: 'run-123' },
    }));

    await assertErrorResponse(response, 400);
  });

  test('preview returns mergeState with awaiting-confirmation and mergedHash', async () => {
    const { loadRunState, saveRunState } = await import('@/lib/run-state-persistence');
    const { readDeltaSpec, buildStructuralMergedMasterSpec } = await import('@/lib/spec-persistence');
    const { readFile } = await import('fs/promises');

    (loadRunState as any).mockResolvedValue(makeRunState());
    (readFile as any).mockResolvedValue('# Master Spec\nExisting content');
    (readDeltaSpec as any).mockResolvedValue({
      artifacts: {
        requirements: '- Req 1',
        design: '# Design',
        tasks: '- [ ] Task 1',
      },
    });
    (buildStructuralMergedMasterSpec as any).mockResolvedValue('# Merged\nContent');

    const { POST } = await import('@/app/api/workflow/spec-merge/route');
    const response = await POST(makeRequest('/api/workflow/spec-merge', {
      json: { action: 'preview', runId: 'run-123' },
    }));

    expect(response.status).toBe(200);
    const json = await responseJson(response);
    expect(json.mergeState.status).toBe('awaiting-confirmation');
    expect(json.mergeState.mergedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(json.diff).toBeTruthy();
  });

  test('falls back to structural merge when AI engine is unavailable', async () => {
    const { loadRunState } = await import('@/lib/run-state-persistence');
    const { readDeltaSpec, buildStructuralMergedMasterSpec } = await import('@/lib/spec-persistence');
    const { createEngine } = await import('@/lib/engines/engine-factory');
    const { readFile } = await import('fs/promises');

    (loadRunState as any).mockResolvedValue(makeRunState());
    (readFile as any).mockResolvedValue('# Master');
    (readDeltaSpec as any).mockResolvedValue({
      artifacts: { requirements: 'req', design: 'des', tasks: 'tsk' },
    });
    (createEngine as any).mockResolvedValue(null); // AI unavailable
    (buildStructuralMergedMasterSpec as any).mockResolvedValue('# Structural Merge');

    const { POST } = await import('@/app/api/workflow/spec-merge/route');
    const response = await POST(makeRequest('/api/workflow/spec-merge', {
      json: { action: 'preview', runId: 'run-123' },
    }));

    expect(response.status).toBe(200);
    const json = await responseJson(response);
    expect(json.aiSummary).toContain('结构化合并');
    expect(buildStructuralMergedMasterSpec).toHaveBeenCalled();
  });

  test('apply returns 409 when mergedHash does not match', async () => {
    const { loadRunState } = await import('@/lib/run-state-persistence');

    (loadRunState as any).mockResolvedValue(makeRunState({
      deltaMergeState: {
        status: 'awaiting-confirmation',
        mergedHash: 'correct-hash-abc123',
        baseHash: 'base-hash',
        previewPath: '/tmp/preview.md',
      },
    }));

    const { POST } = await import('@/app/api/workflow/spec-merge/route');
    const response = await POST(makeRequest('/api/workflow/spec-merge', {
      json: { action: 'apply', runId: 'run-123', mergedHash: 'wrong-hash' },
    }));

    expect(response.status).toBe(409);
    const json = await responseJson(response);
    expect(json.message).toContain('变化');
  });

  test('apply returns 409 when master spec has been modified', async () => {
    const { loadRunState } = await import('@/lib/run-state-persistence');
    const { readFile } = await import('fs/promises');
    const { sha256 } = await import('@/lib/spec-merge-utils');

    const originalMaster = '# Original Master';
    const modifiedMaster = '# Modified Master'; // different content
    const mergedContent = '# Merged Content';
    const mergedHash = sha256(mergedContent);

    (loadRunState as any).mockResolvedValue(makeRunState({
      deltaMergeState: {
        status: 'awaiting-confirmation',
        mergedHash,
        baseHash: sha256(originalMaster), // hash of original
        previewPath: '/tmp/preview.md',
      },
    }));
    // readFile returns modified master (different from what was hashed)
    (readFile as any).mockImplementation(async (path: string) => {
      if (path.includes('preview')) return mergedContent;
      return modifiedMaster; // master was modified
    });

    const { POST } = await import('@/app/api/workflow/spec-merge/route');
    const response = await POST(makeRequest('/api/workflow/spec-merge', {
      json: { action: 'apply', runId: 'run-123', mergedHash },
    }));

    expect(response.status).toBe(409);
    const json = await responseJson(response);
    expect(json.message).toContain('已被修改');
  });
});
