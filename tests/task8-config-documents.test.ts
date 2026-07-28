import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';

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
          phases: [{ name: 'Build', steps: [{ name: 'Implement', agent: 'developer' }] }],
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

  test('lists document summaries first and loads group details/content lazily', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { getRuntimeConfigsDirPath } = await import('@/lib/run/runtime-configs');
      const { getWorkspaceRunsDir } = await import('@/lib/core/app-paths');
      const { saveRunState } = await import('@/lib/run/state-persistence');
      const { listRunDocuments, readRunDocumentContent } = await import('@/lib/run/documents');
      const configsDir = await getRuntimeConfigsDirPath();
      await mkdir(configsDir, { recursive: true });
      await writeFile(path.join(configsDir, 'doc-workflow.yaml'), stringify({
        workflow: {
          name: 'Doc Workflow',
          phases: [{ name: 'Phase A', steps: [{ name: 'Review', agent: 'developer', role: 'defender' }] }],
        },
      }), 'utf-8');
      await saveRunState(runState('run-docs'));
      const outputsDir = path.join(getWorkspaceRunsDir(), 'run-docs', 'outputs');
      await mkdir(outputsDir, { recursive: true });
      await writeFile(path.join(outputsDir, 'Review.md'), '# Summary', 'utf-8');
      await writeFile(path.join(outputsDir, '2026-01-01T00-00-01-Review.md'), '# Detail 1', 'utf-8');
      await writeFile(path.join(outputsDir, '2026-01-01T00-00-02-Review.md'), '# Detail 2', 'utf-8');

      const summary = await listRunDocuments('run-docs', { summaryOnly: true, scope: 'root' });
      expect(summary?.files).toHaveLength(1);
      expect(summary?.files[0]).toMatchObject({
        filename: 'Review.md',
        documentKind: 'conclusion',
        detailCount: 2,
      });
      expect(summary?.files[0]).not.toHaveProperty('content');

      const details = await listRunDocuments('run-docs', {
        scope: 'children',
        groupKey: summary!.files[0].groupKey,
        documentKind: 'detail',
      });
      expect(details?.files.map((file) => file.filename)).toEqual([
        '2026-01-01T00-00-01-Review.md',
        '2026-01-01T00-00-02-Review.md',
      ]);

      const content = await readRunDocumentContent('run-docs', '2026-01-01T00-00-02-Review.md');
      expect(content?.content).toBe('# Detail 2');
    });
  });
});
