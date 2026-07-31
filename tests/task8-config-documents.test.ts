import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';
import { makeRequest, responseJson } from './helpers/route-helpers';

function runState(runId: string, overrides: Record<string, any> = {}) {
  return {
    runId,
    configFile: 'doc-workflow.yaml',
    status: 'completed',
    startTime: new Date('2026-01-01T00:00:00Z').toISOString(),
    endTime: new Date('2026-01-01T00:01:00Z').toISOString(),
    currentPhase: null,
    currentStep: null,
    completedSteps: [],
    failedSteps: [],
    stepLogs: [],
    agents: [],
    iterationStates: {},
    processes: [],
    stateHistory: [],
    eventLog: [],
    outputs: {},
    ...overrides,
  } as any;
}

describe('task 8 config and document paging/lazy loading', () => {
  test('persists workflow config summaries in a verifiable disk index', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { getRuntimeConfigsDirPath } = await import('@/lib/run/runtime-configs');
      const {
        getConfigSummaryIndexPath,
        listIndexedConfigSummaries,
      } = await import('@/lib/config/config-summary-index');
      const configsDir = await getRuntimeConfigsDirPath();
      await mkdir(configsDir, { recursive: true });
      await writeFile(path.join(configsDir, 'indexed.yaml'), stringify({
        workflow: {
          name: 'Indexed Workflow',
          description: 'summary index fixture',
          mode: 'state-machine',
          states: [{
            name: 'Build',
            isInitial: true,
            isFinal: true,
            steps: [{ name: 'Implement', agent: 'developer', task: 'Implement the requested change' }],
            transitions: [],
          }],
        },
      }), 'utf-8');

      const first = await listIndexedConfigSummaries({
        configsDir,
        metaMap: {},
        auth: { id: 'admin', role: 'admin' },
        usersById: new Map(),
      });
      const firstStat = await stat(getConfigSummaryIndexPath());
      const second = await listIndexedConfigSummaries({
        configsDir,
        metaMap: {},
        auth: { id: 'admin', role: 'admin' },
        usersById: new Map(),
      });
      const secondStat = await stat(getConfigSummaryIndexPath());
      const index = JSON.parse(await readFile(getConfigSummaryIndexPath(), 'utf-8'));

      expect(first.configs).toEqual(expect.arrayContaining([
        expect.objectContaining({ filename: 'indexed.yaml', name: 'Indexed Workflow', stepCount: 1 }),
      ]));
      expect(second.configs).toEqual(first.configs);
      expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
      expect(index.entries[`${path.resolve(configsDir)}::indexed.yaml`].summary).toMatchObject({
        filename: 'indexed.yaml',
        name: 'Indexed Workflow',
      });
    });
  });

  test('lists source-aware tasklist and runtime documents without legacy output roots', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      vi.resetModules();
      const { getWorkspaceRunsDir } = await import('@/lib/core/app-paths');
      const { saveRunState } = await import('@/lib/run/state-persistence');
      const { listRunDocuments, readRunDocumentContent } = await import('@/lib/run/documents');
      const documentsRoute = await import('@/server/api-routes/runs/[id]/documents/route');
      const workspace = path.join(aceHome, 'workspace');
      const tasklistDirectory = path.join(workspace, 'docs', 'tasklists', 'run-docs');
      await mkdir(tasklistDirectory, { recursive: true });
      await saveRunState(runState('run-docs', {
        workingDirectory: workspace,
        childRunIds: ['child-docs'],
        lightweight: {
          profile: 'lightweight',
          tasklistDirectory: 'docs/tasklists/run-docs',
          workspaceRoot: workspace,
          resolvedTasklistDirectory: tasklistDirectory,
          stateName: '执行',
          stepName: '执行任务',
          effectiveStepSkills: ['aceharness-tasklist'],
        },
      }));
      await saveRunState(runState('child-docs', {
        workingDirectory: workspace,
        parentRunId: 'run-docs',
      }));
      const outputsDir = path.join(getWorkspaceRunsDir(), 'run-docs', 'outputs');
      const childOutputsDir = path.join(getWorkspaceRunsDir(), 'child-docs', 'outputs');
      await mkdir(outputsDir, { recursive: true });
      await mkdir(childOutputsDir, { recursive: true });
      await writeFile(path.join(outputsDir, 'Review.md'), '# Summary', 'utf-8');
      await writeFile(path.join(outputsDir, '2026-01-01T00-00-01-Review.md'), '# Detail 1', 'utf-8');
      await writeFile(path.join(outputsDir, '2026-01-01T00-00-02-Review.md'), '# Detail 2', 'utf-8');
      await writeFile(path.join(outputsDir, '2026-01-01T00-00-03-____-____.md'), '# Internal raw transcript', 'utf-8');
      await writeFile(path.join(childOutputsDir, 'child-only.md'), '# Child output', 'utf-8');
      await mkdir(path.join(tasklistDirectory, 'nested'), { recursive: true });
      await writeFile(path.join(tasklistDirectory, 'nested', 'plan.md'), '# Tasklist plan', 'utf-8');

      const summary = await listRunDocuments('run-docs', { summaryOnly: true, scope: 'root' });
      const runtimeSummary = summary?.files.find((file) => file.documentSource === 'runtime-output');
      const tasklistSummary = summary?.files.find((file) => file.documentSource === 'tasklist');
      expect(runtimeSummary).toMatchObject({
        filename: 'Review.md',
        documentKind: 'conclusion',
        detailCount: 2,
      });
      expect(tasklistSummary).toMatchObject({
        filename: 'nested/plan.md',
        documentSource: 'tasklist',
        relativePath: 'nested/plan.md',
      });
      expect(summary?.documentRoots).toMatchObject({
        tasklist: tasklistDirectory,
        'runtime-output': outputsDir,
      });
      expect(runtimeSummary).not.toHaveProperty('content');
      expect(summary?.files.some((file) => file.filename === '2026-01-01T00-00-03-____-____.md')).toBe(false);

      const details = await listRunDocuments('run-docs', {
        scope: 'root',
        groupKey: runtimeSummary!.groupKey,
        documentKind: 'detail',
      });
      expect(details?.files.map((file) => file.filename)).toEqual([
        '2026-01-01T00-00-01-Review.md',
        '2026-01-01T00-00-02-Review.md',
      ]);

      const content = await readRunDocumentContent('run-docs', {
        source: 'runtime-output',
        file: '2026-01-01T00-00-02-Review.md',
      });
      expect(content?.content).toBe('# Detail 2');

      const tasklistContent = await readRunDocumentContent('run-docs', {
        source: 'tasklist',
        file: 'nested/plan.md',
      });
      expect(tasklistContent?.content).toBe('# Tasklist plan');

      await writeFile(path.join(outputsDir, 'collision.md'), '# Runtime collision', 'utf-8');
      await writeFile(path.join(tasklistDirectory, 'collision.md'), '# Tasklist collision', 'utf-8');
      await writeFile(path.join(workspace, 'outside.md'), '# Outside tasklist root', 'utf-8');
      const collisions = await listRunDocuments('run-docs', { scope: 'root' });
      const runtimeCollision = collisions?.files.find((file) => (
        file.documentSource === 'runtime-output' && file.relativePath === 'collision.md'
      ));
      const tasklistCollision = collisions?.files.find((file) => (
        file.documentSource === 'tasklist' && file.relativePath === 'collision.md'
      ));
      expect(runtimeCollision?.documentKey).toBeDefined();
      expect(tasklistCollision?.documentKey).toBeDefined();
      expect(runtimeCollision?.documentKey).not.toBe(tasklistCollision?.documentKey);

      const params = { params: Promise.resolve({ id: 'run-docs' }) };
      const previewResponse = await documentsRoute.GET(
        makeRequest('/api/runs/run-docs/documents?file=nested%2Fplan.md&source=tasklist'),
        params,
      );
      expect(previewResponse.status).toBe(200);
      expect(await responseJson<any>(previewResponse)).toMatchObject({
        file: 'nested/plan.md',
        source: 'tasklist',
        content: '# Tasklist plan',
      });

      const childPreviewResponse = await documentsRoute.GET(
        makeRequest('/api/runs/run-docs/documents?file=child-only.md&source=runtime-output&sourceRunId=child-docs'),
        params,
      );
      expect(childPreviewResponse.status).toBe(200);
      expect(await responseJson<any>(childPreviewResponse)).toMatchObject({
        file: 'child-only.md',
        source: 'runtime-output',
        sourceRunId: 'child-docs',
        content: '# Child output',
      });

      const childRenameResponse = await documentsRoute.PATCH(makeRequest('/api/runs/run-docs/documents', {
        json: {
          source: 'runtime-output',
          sourceRunId: 'child-docs',
          file: 'child-only.md',
          newName: 'renamed.md',
        },
      }), params);
      expect(childRenameResponse.status).toBe(403);

      const childDeleteResponse = await documentsRoute.DELETE(makeRequest('/api/runs/run-docs/documents', {
        json: { files: [{ source: 'runtime-output', sourceRunId: 'child-docs', file: 'child-only.md' }] },
      }), params);
      expect(childDeleteResponse.status).toBe(403);

      const renameResponse = await documentsRoute.PATCH(makeRequest('/api/runs/run-docs/documents', {
        json: { source: 'tasklist', file: 'nested/plan.md', newName: 'plan-renamed.md' },
      }), params);
      expect(renameResponse.status).toBe(200);
      expect(await responseJson<any>(renameResponse)).toMatchObject({
        ok: true,
        source: 'tasklist',
        newFilename: 'nested/plan-renamed.md',
      });
      await expect(readRunDocumentContent('run-docs', {
        source: 'tasklist',
        file: 'nested/plan-renamed.md',
      })).resolves.toMatchObject({ content: '# Tasklist plan' });

      const deleteResponse = await documentsRoute.DELETE(makeRequest('/api/runs/run-docs/documents', {
        json: { files: [{ source: 'runtime-output', file: 'collision.md' }] },
      }), params);
      expect(deleteResponse.status).toBe(200);
      expect((await responseJson<any>(deleteResponse)).deleted).toContain(
        JSON.stringify(['run-docs', 'runtime-output', 'collision.md']),
      );
      await expect(readRunDocumentContent('run-docs', {
        source: 'runtime-output',
        file: 'collision.md',
      })).resolves.toBeNull();
      await expect(readRunDocumentContent('run-docs', {
        source: 'tasklist',
        file: 'collision.md',
      })).resolves.toMatchObject({ content: '# Tasklist collision' });

      await writeFile(path.join(outputsDir, 'legacy-delete.md'), '# Legacy delete', 'utf-8');
      const bareFilenameDeleteResponse = await documentsRoute.DELETE(makeRequest('/api/runs/run-docs/documents', {
        json: { files: ['legacy-delete.md'] },
      }), params);
      expect(bareFilenameDeleteResponse.status).toBe(400);
      await expect(readRunDocumentContent('run-docs', {
        source: 'runtime-output',
        file: 'legacy-delete.md',
      })).resolves.toMatchObject({ content: '# Legacy delete' });

      const traversalResponse = await documentsRoute.GET(
        makeRequest('/api/runs/run-docs/documents?file=..%2Foutside.md&source=tasklist'),
        params,
      );
      expect(traversalResponse.status).toBe(404);
      const invalidSourceResponse = await documentsRoute.GET(
        makeRequest('/api/runs/run-docs/documents?file=Review.md&source=unknown'),
        params,
      );
      expect(invalidSourceResponse.status).toBe(400);
    });
  });
});
