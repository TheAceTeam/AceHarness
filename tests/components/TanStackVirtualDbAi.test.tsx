// @vitest-environment jsdom
import React, { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import {
  agentMessagesCollection,
  agentConfigsCollection,
  deriveAgentConfigRows,
  deriveLocalSkillRows,
  deriveModelCatalogRows,
  deriveRagChunkRows,
  deriveRagDocumentRows,
  deriveRagKnowledgeBaseRows,
  deriveWorkspaceTreeRows,
  documentsMetadataCollection,
  deriveRunHistoryRows,
  deriveWorkflowConfigRows,
  getDocumentMetadataId,
  getDocumentMetadataSnapshot,
  getAgentConfigsSnapshot,
  getLocalSkillsSnapshot,
  getModelCatalogSnapshot,
  getRagRowsSnapshot,
  getWorkflowConfigSnapshot,
  optimisticDeleteAgentConfigs,
  optimisticDeleteDocumentMetadata,
  optimisticDeleteLocalSkills,
  optimisticDeleteRagKnowledgeBase,
  optimisticDeleteWorkflowConfig,
  optimisticRenameDocumentMetadata,
  restoreAgentConfigsSnapshot,
  restoreDocumentMetadataSnapshot,
  restoreLocalSkillsSnapshot,
  restoreModelCatalogSnapshot,
  restoreRagRowsSnapshot,
  restoreWorkflowConfigSnapshot,
  syncDocumentsMetadataToDb,
  syncRunHistoryToDb,
  syncAgentConfigsToDb,
  syncLocalSkillsToDb,
  syncModelCatalogToDb,
  syncModelDiagnosticsResultToDb,
  syncModelProbesToDb,
  syncRagDetailRowsToDb,
  syncRagKnowledgeBasesToDb,
  syncWorkflowConfigsToDb,
  syncWorkspaceTreeToDb,
  runHistoryCollection,
  localSkillsCollection,
  modelCatalogCollection,
  modelDiagnosticsCollection,
  modelProbesCollection,
  ragChunksCollection,
  ragDocumentsCollection,
  ragKnowledgeBasesCollection,
  workflowConfigsCollection,
  workspaceTreeCollection,
  type RunHistoryRow,
} from '../../src/client/db/collections';
import {
  agentMessageRowFromAiMessage,
  agentMessageRowFromStreamChunk,
  createAceAiMessage,
  normalizeAceStreamChunk,
  normalizeDiagnosticMetadata,
  normalizeToolCall,
  parseAceSseEventData,
  storeChatStreamSseEventAsAgentMessage,
  storeAceAgentMessage,
  storeWorkflowSseEventAsAgentMessage,
} from '../../src/client/ai/messages';
import { VirtualList } from '../../src/client/virtual/VirtualList';

describe('TanStack Virtual, DB and AI client adapters', () => {
  test('VirtualList exposes className, empty state and a measurable DOM item cap', () => {
    const items = Array.from({ length: 500 }, (_, index) => ({ id: `item-${index}`, label: `Item ${index}` }));

    const { rerender } = render(
      <VirtualList
        items={items}
        className="test-list"
        height={360}
        estimateSize={32}
        maxRenderedItems={10}
        testId="virtual-under-test"
        getKey={(item) => item.id}
        renderItem={(item) => <div>{item.label}</div>}
      />,
    );

    const list = screen.getByTestId('virtual-under-test');
    expect(list).toHaveClass('test-list');
    expect(list).toHaveAttribute('data-total-count', '500');
    expect(Number(list.getAttribute('data-rendered-count'))).toBeLessThanOrEqual(10);
    expect(screen.queryAllByTestId('virtual-under-test-item').length).toBeLessThanOrEqual(10);

    rerender(
      <VirtualList
        items={[]}
        className="test-list"
        height={120}
        estimateSize={32}
        emptyState={<div>No rows</div>}
        testId="virtual-under-test"
        getKey={(item: { id: string; label?: string }) => item.id}
        renderItem={(item: { id: string; label?: string }) => <div>{item.label}</div>}
      />,
    );

    expect(screen.getByText('No rows')).toBeInTheDocument();
    expect(screen.getByTestId('virtual-under-test')).toHaveAttribute('data-rendered-count', '0');
  });

  test('VirtualList can reuse a caller scroll ref and preserve scroll contracts', () => {
    const scrollRef = createRef<HTMLDivElement>();
    const onScroll = vi.fn();
    render(
      <VirtualList
        items={Array.from({ length: 200 }, (_, index) => index)}
        height={240}
        estimateSize={28}
        maxRenderedItems={12}
        testId="virtual-scroll-contract"
        scrollRef={scrollRef}
        onScroll={onScroll}
        getKey={(item) => item}
        renderItem={(item) => <div>Row {item}</div>}
      />,
    );

    const list = screen.getByTestId('virtual-scroll-contract');
    expect(scrollRef.current).toBe(list);
    expect(list).toHaveAttribute('data-total-count', '200');
    expect(Number(list.getAttribute('data-rendered-count'))).toBeLessThanOrEqual(12);

    fireEvent.scroll(list);
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  test('DB helpers derive filtered and sorted config and run-history rows', () => {
    const configs = deriveWorkflowConfigRows([
      { id: 'b.yaml', filename: 'b.yaml', name: 'Beta', mode: 'state-machine', createdAt: '2026-01-02' },
      { id: 'a.yaml', filename: 'a.yaml', name: 'Alpha', mode: 'state-machine', createdAt: '2026-01-01' },
    ], {
      keyword: 'a',
      mode: 'all',
      sortKey: 'name',
      sortDirection: 'asc',
    });

    expect(configs.map((config) => config.name)).toEqual(['Alpha', 'Beta']);

    const runs = deriveRunHistoryRows([
      baseRun({ id: 'slow', configName: 'Slow', totalTokens: 10, startTime: '2026-01-01T00:00:00Z' }),
      baseRun({ id: 'fast', configName: 'Fast', totalTokens: 30, startTime: '2026-01-02T00:00:00Z' }),
    ], {
      keyword: '',
      ownerId: 'all',
      sortKey: 'totalTokens',
      sortDirection: 'desc',
    });

    expect(runs.map((run) => run.id)).toEqual(['fast', 'slow']);
  });

  test('DB helpers sync nested run history rows and filter multiple owners', () => {
    syncRunHistoryToDb(([
      baseRun({
        id: 'parent-run',
        ownerId: 'alice',
        configName: 'Parent Workflow',
        totalTokens: 15,
        inputTokens: 5,
        childRunIds: ['child-run'],
        childRuns: [
          baseRun({
            id: 'child-run',
            ownerId: 'bob',
            parentRunId: 'parent-run',
            parentStateName: 'Build',
            parentStepName: 'Child Step',
            configName: 'Child Workflow',
            totalTokens: 25,
            outputTokens: 7,
          } as any),
        ],
      } as any),
    ]) as any);

    expect(runHistoryCollection.get('child-run')).toMatchObject({
      parentRunId: 'parent-run',
      parentStateName: 'Build',
      parentStepName: 'Child Step',
      outputTokens: 7,
    });

    const rows = deriveRunHistoryRows(Array.from(runHistoryCollection.values()), {
      keyword: 'workflow',
      ownerId: 'alice,bob',
      sortKey: 'totalTokens',
      sortDirection: 'desc',
    });
    expect(rows.map((run) => run.id)).toContain('parent-run');
    expect(rows.map((run) => run.id)).toContain('child-run');
  });

  test('DB helpers derive agent rows by keyword group team category and tags', () => {
    syncAgentConfigsToDb([
      {
        name: 'compiler_fix_agent',
        team: 'red',
        roleType: 'normal',
        category: '编码',
        tags: ['编译器', '修复'],
        engineModels: {},
        activeEngine: '',
      },
      {
        name: 'planner',
        team: 'black-gold',
        roleType: 'supervisor',
        category: '规划',
        tags: ['计划'],
        engineModels: {},
        activeEngine: '',
      },
    ]);

    const compilerRows = deriveAgentConfigRows(Array.from(agentConfigsCollection.values()), {
      keyword: 'fix',
      group: 'compiler',
      team: 'red',
      category: '编码',
      tags: ['修复'],
    });
    expect(compilerRows.map((agent) => agent.name)).toEqual(['compiler_fix_agent']);

    syncAgentConfigsToDb([
      {
        name: 'planner',
        team: 'black-gold',
        roleType: 'supervisor',
        category: '规划',
        tags: ['计划'],
        engineModels: {},
        activeEngine: '',
      },
    ]);
    expect(agentConfigsCollection.get('compiler_fix_agent')).toBeUndefined();
  });

  test('DB helpers derive local skill rows by keyword source tags and sort', () => {
    syncLocalSkillsToDb([
      {
        name: 'ace-skill',
        path: 'ace-skill',
        description: 'ACE local skill',
        descriptionZh: '本地技能',
        tags: ['local', 'ace'],
        source: 'ace-custom',
        updatedAt: '2026-01-02T00:00:00Z',
      },
      {
        name: 'anthropic-skill',
        path: 'anthropic-skill',
        description: 'Anthropic skill',
        tags: ['remote'],
        source: 'anthropics',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    const rows = deriveLocalSkillRows(Array.from(localSkillsCollection.values()), {
      keyword: '技能',
      source: 'ace-custom',
      tags: ['ace'],
      sortKey: 'updatedAt',
      sortDirection: 'desc',
    });
    expect(rows.map((skill) => skill.name)).toEqual(['ace-skill']);

    syncLocalSkillsToDb([
      {
        name: 'anthropic-skill',
        path: 'anthropic-skill',
        description: 'Anthropic skill',
        tags: ['remote'],
        source: 'anthropics',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]);
    expect(localSkillsCollection.get('ace-skill')).toBeUndefined();
  });

  test('DB helpers derive model catalog rows by keyword facets and preserve order', () => {
    syncModelCatalogToDb([
      {
        id: 'model-b',
        name: 'Model B',
        endpoints: ['openai'],
        engines: ['codex'],
        status: 'active',
        costMultiplier: 1,
      },
      {
        id: 'model-a',
        name: 'Model A',
        endpoints: ['anthropic'],
        engines: ['claude'],
        status: 'inactive',
        costMultiplier: 2,
      },
    ]);

    const rows = deriveModelCatalogRows(Array.from(modelCatalogCollection.values()), {
      keyword: 'model',
      endpoints: ['openai', 'anthropic'],
      engines: [],
      statuses: [],
    });
    expect(rows.map((model) => model.id)).toEqual(['model-b', 'model-a']);

    const inactiveRows = deriveModelCatalogRows(Array.from(modelCatalogCollection.values()), {
      statuses: ['inactive'],
    });
    expect(inactiveRows.map((model) => model.id)).toEqual(['model-a']);

    syncModelCatalogToDb([
      {
        id: 'model-a',
        name: 'Model A',
        endpoints: ['anthropic'],
        engines: ['claude'],
        status: 'inactive',
        costMultiplier: 2,
      },
    ]);
    expect(modelCatalogCollection.get('model-b')).toBeUndefined();
  });

  test('DB helpers sync model probe and diagnostics rows', () => {
    syncModelProbesToDb({
      probes: [{
        id: 'probe-model-a',
        groupId: 'group-a',
        groupName: 'Group A',
        name: 'Model A probe',
        engine: 'claude-code',
        engineLabel: 'Claude Code',
        driver: 'sdk',
        model: 'model-a',
        endpoints: ['anthropic'],
        intervalMinutes: 15,
        timeoutMs: 30000,
        enabled: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        running: false,
        status: 'operational',
        consecutiveFailures: 0,
        nextRunAt: null,
        latestRun: null,
        availability: {
          days7: { successRate: 1, successCount: 1, totalCount: 1 },
          days15: { successRate: 1, successCount: 1, totalCount: 1 },
          days30: { successRate: 1, successCount: 1, totalCount: 1 },
        },
        averageResponseLatencyMs: null,
        averageAvailabilityCheckMs: null,
        history: [],
      }],
      summary: {
        total: 1,
        enabled: 1,
        running: 0,
        operational: 1,
        degraded: 0,
        down: 0,
        paused: 0,
        unknown: 0,
        lastUpdatedAt: '2026-01-01T00:00:00Z',
        nextRunAt: null,
        minIntervalMinutes: 15,
      },
    });
    expect(modelProbesCollection.get('probe-model-a')?.model).toBe('model-a');

    syncModelDiagnosticsResultToDb({
      ok: true,
      engine: 'claude-code',
      driver: 'sdk',
      model: 'model-a',
      startedAt: '2026-01-01T00:00:00Z',
      finishedAt: '2026-01-01T00:00:02Z',
      totalDurationMs: 2000,
      modelEvaluation: {
        overallScore: 88,
        tier: 'stable',
        tierLabel: '稳定',
        capabilities: [],
        runs: [],
      },
      logs: [],
    }, '2026-01-01T00:00:03Z');

    const [diagnostic] = Array.from(modelDiagnosticsCollection.values());
    expect(diagnostic).toMatchObject({ model: 'model-a', ok: true, overallScore: 88 });
  });

  test('DB helpers derive RAG knowledge bases documents and chunks', () => {
    syncRagKnowledgeBasesToDb([
      baseKnowledgeBase({ id: 'kb-old', name: 'Old KB', updatedAt: 1 }),
      baseKnowledgeBase({ id: 'kb-new', name: 'New KB', updatedAt: 2 }),
    ]);
    expect(deriveRagKnowledgeBaseRows(Array.from(ragKnowledgeBasesCollection.values())).map((kb) => kb.id)).toEqual(['kb-new', 'kb-old']);

    syncRagDetailRowsToDb('kb-new', [
      baseRagDocument({ id: 'doc-1', knowledgeBaseId: 'kb-new', title: 'Alpha Doc', createdAt: 2 }),
      baseRagDocument({ id: 'doc-2', knowledgeBaseId: 'kb-new', title: 'Beta Doc', createdAt: 1 }),
    ], [
      baseRagChunk({ id: 'chunk-1', knowledgeBaseId: 'kb-new', documentId: 'doc-1', chunkIndex: 1, text: 'LanceDB metadata row' }),
      baseRagChunk({ id: 'chunk-0', knowledgeBaseId: 'kb-new', documentId: 'doc-1', chunkIndex: 0, text: 'Vector database RAG' }),
    ]);

    const docs = deriveRagDocumentRows(Array.from(ragDocumentsCollection.values()), 'kb-new');
    expect(docs.map((doc) => doc.id)).toEqual(['doc-1', 'doc-2']);

    const chunks = deriveRagChunkRows(Array.from(ragChunksCollection.values()), {
      knowledgeBaseId: 'kb-new',
      documentId: 'doc-1',
      keyword: 'metadata',
    });
    expect(chunks.map((chunk) => chunk.id)).toEqual(['chunk-1']);

    syncRagDetailRowsToDb('kb-new', [
      baseRagDocument({ id: 'doc-2', knowledgeBaseId: 'kb-new', title: 'Beta Doc', createdAt: 1 }),
    ], []);
    expect(ragDocumentsCollection.get('doc-1')).toBeUndefined();
    expect(ragChunksCollection.get('chunk-1')).toBeUndefined();
  });

  test('DB optimistic config delete hides stale Query sync and rollback restores the snapshot', () => {
    const config = {
      filename: 'optimistic-delete-test.yaml',
      name: 'Optimistic Delete Test',
      description: 'rollback coverage',
      mode: 'state-machine' as const,
      stateCount: 1,
      stepCount: 2,
      agentCount: 1,
      createdAt: '2026-01-03T00:00:00Z',
      visibility: 'private' as const,
      ownerName: 'Tester',
    };

    syncWorkflowConfigsToDb([config]);
    expect(getWorkflowConfigSnapshot(config.filename)?.name).toBe(config.name);

    const snapshot = optimisticDeleteWorkflowConfig(config.filename);
    expect(snapshot?.filename).toBe(config.filename);
    expect(workflowConfigsCollection.get(config.filename)).toBeUndefined();

    syncWorkflowConfigsToDb([config]);
    expect(workflowConfigsCollection.get(config.filename)).toBeUndefined();

    restoreWorkflowConfigSnapshot(snapshot, config.filename);
    expect(workflowConfigsCollection.get(config.filename)?.name).toBe(config.name);
  });

  test('DB optimistic document metadata rename delete and rollback update local rows', () => {
    syncDocumentsMetadataToDb('run-doc-optimistic', [{
      filename: 'summary.md',
      baseName: 'summary.md',
      documentSource: 'runtime-output',
      sourceRunId: 'run-doc-optimistic',
      size: 10,
      modifiedTime: '2026-01-01T00:00:00.000Z',
    }, {
      filename: 'detail.md',
      baseName: 'detail.md',
      documentSource: 'runtime-output',
      sourceRunId: 'run-doc-optimistic',
      size: 20,
      modifiedTime: '2026-01-01T00:00:01.000Z',
    }, {
      filename: 'summary.md',
      baseName: 'summary.md',
      documentSource: 'tasklist',
      sourceRunId: 'run-doc-optimistic',
      size: 30,
      modifiedTime: '2026-01-01T00:00:02.000Z',
    }]);
    const snapshot = getDocumentMetadataSnapshot('run-doc-optimistic');
    const runtimeSummary = { source: 'runtime-output' as const, sourceRunId: 'run-doc-optimistic', file: 'summary.md' };
    const tasklistSummary = { source: 'tasklist' as const, sourceRunId: 'run-doc-optimistic', file: 'summary.md' };
    const runtimeDetail = { source: 'runtime-output' as const, sourceRunId: 'run-doc-optimistic', file: 'detail.md' };

    optimisticRenameDocumentMetadata('run-doc-optimistic', runtimeSummary, 'renamed.md');
    expect(documentsMetadataCollection.get(getDocumentMetadataId('run-doc-optimistic', runtimeSummary))).toBeUndefined();
    expect(documentsMetadataCollection.get(getDocumentMetadataId('run-doc-optimistic', {
      ...runtimeSummary,
      file: 'renamed.md',
    }))?.filename).toBe('renamed.md');
    expect(documentsMetadataCollection.get(getDocumentMetadataId('run-doc-optimistic', tasklistSummary))?.filename).toBe('summary.md');

    optimisticDeleteDocumentMetadata('run-doc-optimistic', [runtimeDetail]);
    expect(documentsMetadataCollection.get(getDocumentMetadataId('run-doc-optimistic', runtimeDetail))).toBeUndefined();

    restoreDocumentMetadataSnapshot('run-doc-optimistic', snapshot);
    expect(documentsMetadataCollection.get(getDocumentMetadataId('run-doc-optimistic', runtimeSummary))?.filename).toBe('summary.md');
    expect(documentsMetadataCollection.get(getDocumentMetadataId('run-doc-optimistic', tasklistSummary))?.filename).toBe('summary.md');
    expect(documentsMetadataCollection.get(getDocumentMetadataId('run-doc-optimistic', runtimeDetail))?.filename).toBe('detail.md');
  });

  test('DB optimistic list snapshots rollback agent skill model and RAG rows', () => {
    syncAgentConfigsToDb([{
      name: 'rollback-agent',
      team: 'blue',
      roleType: 'normal',
      engineModels: {},
      activeEngine: '',
    }]);
    const agentSnapshot = getAgentConfigsSnapshot();
    optimisticDeleteAgentConfigs(['rollback-agent']);
    expect(agentConfigsCollection.get('rollback-agent')).toBeUndefined();
    restoreAgentConfigsSnapshot(agentSnapshot);
    expect(agentConfigsCollection.get('rollback-agent')?.name).toBe('rollback-agent');

    syncLocalSkillsToDb([{
      name: 'rollback-skill',
      path: 'rollback-skill',
      description: 'rollback skill',
      tags: [],
      source: 'ace-custom',
    }]);
    const skillSnapshot = getLocalSkillsSnapshot();
    optimisticDeleteLocalSkills(['rollback-skill']);
    expect(localSkillsCollection.get('rollback-skill')).toBeUndefined();
    restoreLocalSkillsSnapshot(skillSnapshot);
    expect(localSkillsCollection.get('rollback-skill')?.name).toBe('rollback-skill');

    syncModelCatalogToDb([{ id: 'rollback-model', name: 'Rollback Model', endpoints: [], engines: [], status: 'active' }]);
    const modelSnapshot = getModelCatalogSnapshot();
    syncModelCatalogToDb([]);
    expect(modelCatalogCollection.get('rollback-model')).toBeUndefined();
    restoreModelCatalogSnapshot(modelSnapshot);
    expect(modelCatalogCollection.get('rollback-model')?.name).toBe('Rollback Model');

    syncRagKnowledgeBasesToDb([baseKnowledgeBase({ id: 'rollback-kb', name: 'Rollback KB' })]);
    syncRagDetailRowsToDb('rollback-kb', [
      baseRagDocument({ id: 'rollback-doc', knowledgeBaseId: 'rollback-kb', title: 'Rollback Doc' }),
    ], [
      baseRagChunk({ id: 'rollback-chunk', knowledgeBaseId: 'rollback-kb', documentId: 'rollback-doc', text: 'rollback chunk' }),
    ]);
    const ragSnapshot = getRagRowsSnapshot();
    optimisticDeleteRagKnowledgeBase('rollback-kb');
    expect(ragKnowledgeBasesCollection.get('rollback-kb')).toBeUndefined();
    expect(ragDocumentsCollection.get('rollback-doc')).toBeUndefined();
    expect(ragChunksCollection.get('rollback-chunk')).toBeUndefined();
    restoreRagRowsSnapshot(ragSnapshot);
    expect(ragKnowledgeBasesCollection.get('rollback-kb')?.name).toBe('Rollback KB');
    expect(ragDocumentsCollection.get('rollback-doc')?.title).toBe('Rollback Doc');
    expect(ragChunksCollection.get('rollback-chunk')?.text).toBe('rollback chunk');
  });

  test('DB helpers derive workspace and notebook tree rows by source and parent path', () => {
    const workspaceSourceKey = 'workspace-tree-db-test-root';
    const notebookSourceKey = 'personal:share-token-db-test';

    syncWorkspaceTreeToDb({
      source: 'workspace',
      sourceKey: workspaceSourceKey,
      tree: [
        { name: 'src', path: 'src', type: 'directory', children: [{ name: 'index.ts', path: 'src/index.ts', type: 'file' }] },
        { name: 'README.md', path: 'README.md', type: 'file' },
      ],
    });
    syncWorkspaceTreeToDb({
      source: 'workspace',
      sourceKey: workspaceSourceKey,
      orderOffset: 2,
      tree: [
        { name: 'package.json', path: 'package.json', type: 'file' },
      ],
    });
    syncWorkspaceTreeToDb({
      source: 'notebook',
      sourceKey: notebookSourceKey,
      tree: [
        { name: 'notes.md', path: 'notes.md', type: 'file', readOnly: true },
      ],
    });

    const workspaceRoot = deriveWorkspaceTreeRows(Array.from(workspaceTreeCollection.values()), {
      source: 'workspace',
      sourceKey: workspaceSourceKey,
      parentPath: '',
    });
    expect(workspaceRoot.map((node) => node.path)).toEqual(['src', 'README.md', 'package.json']);

    const workspaceSrc = deriveWorkspaceTreeRows(Array.from(workspaceTreeCollection.values()), {
      source: 'workspace',
      sourceKey: workspaceSourceKey,
      parentPath: 'src',
    });
    expect(workspaceSrc.map((node) => node.path)).toEqual(['src/index.ts']);

    const notebookRoot = deriveWorkspaceTreeRows(Array.from(workspaceTreeCollection.values()), {
      source: 'notebook',
      sourceKey: notebookSourceKey,
      parentPath: '',
    });
    expect(notebookRoot).toHaveLength(1);
    expect(notebookRoot[0]).toMatchObject({ path: 'notes.md', readOnly: true });

    syncWorkspaceTreeToDb({
      source: 'workspace',
      sourceKey: workspaceSourceKey,
      replaceParents: true,
      tree: [
        { name: 'src', path: 'src', type: 'directory' },
      ],
    });
    const replacedWorkspaceRoot = deriveWorkspaceTreeRows(Array.from(workspaceTreeCollection.values()), {
      source: 'workspace',
      sourceKey: workspaceSourceKey,
      parentPath: '',
    });
    expect(replacedWorkspaceRoot.map((node) => node.path)).toEqual(['src']);

    syncWorkspaceTreeToDb({
      source: 'workspace',
      sourceKey: workspaceSourceKey,
      rootPath: 'src',
      replaceParents: true,
      tree: [],
    });
    const emptiedWorkspaceSrc = deriveWorkspaceTreeRows(Array.from(workspaceTreeCollection.values()), {
      source: 'workspace',
      sourceKey: workspaceSourceKey,
      parentPath: 'src',
    });
    expect(emptiedWorkspaceSrc).toEqual([]);
  });

  test('AI adapter normalizes stream chunks, tool calls, diagnostics and stores agent messages', () => {
    const first = normalizeAceStreamChunk({
      id: 'message-stream',
      content: 'Hel',
      status: 'streaming',
      toolCalls: [{ id: 'tool-1', name: 'lookup', state: 'input-streaming', arguments: '{"q"' }],
      metadata: { provider: 'test-provider', model: 'test-model', usage: { inputTokens: 2 } },
    });
    const second = normalizeAceStreamChunk({
      id: 'message-stream',
      delta: 'lo',
      status: 'complete',
      toolCalls: [{ id: 'tool-1', name: 'lookup', state: 'complete', output: { ok: true } }],
      diagnostics: { latencyMs: 25, usage: { outputTokens: 3, totalTokens: 5 } },
    }, first);

    expect(second.content).toBe('Hello');
    expect(second.status).toBe('done');
    expect(second.toolCalls[0]).toMatchObject({ id: 'tool-1', name: 'lookup', status: 'success' });
    expect(normalizeToolCall({ id: 'tool-2', function: { name: 'write', arguments: '{}' }, state: 'error', error: 'denied' }))
      .toMatchObject({ id: 'tool-2', name: 'write', status: 'error', error: 'denied' });
    expect(normalizeDiagnosticMetadata({ provider: 'p', usage: { promptTokens: 1, completionTokens: 2 } }))
      .toMatchObject({ provider: 'p', tokenUsage: { input: 1, output: 2 } });

    const streamRow = storeAceAgentMessage(agentMessageRowFromStreamChunk(second, { runId: 'run-1' }));
    expect(agentMessagesCollection.get(streamRow.id)?.content).toBe('Hello');

    const uiMessage = createAceAiMessage({ role: 'assistant', content: 'Stored AI message' });
    const messageRow = storeAceAgentMessage(agentMessageRowFromAiMessage(uiMessage, { runId: 'run-1' }));
    expect(agentMessagesCollection.get(messageRow.id)?.content).toBe('Stored AI message');
  });

  test('AI adapter stores real workflow SSE events as agent messages', () => {
    const row = storeWorkflowSseEventAsAgentMessage({
      type: 'workflow-step-delta',
      data: {
        runId: 'run-sse',
        stepKey: 'implement',
        seq: 7,
        delta: 'streamed workflow output',
        metadata: { provider: 'workflow-runtime', model: 'event-log' },
      },
    });

    expect(row).toMatchObject({
      id: 'workflow:run-sse:implement:7',
      runId: 'run-sse',
      stepKey: 'implement',
      content: 'streamed workflow output',
      status: 'streaming',
    });
    expect(agentMessagesCollection.get(row.id)?.diagnostics?.provider).toBe('workflow-runtime');
  });

  test('AI adapter stores chat stream SSE events without duplicating final output', () => {
    const first = storeChatStreamSseEventAsAgentMessage('delta', {
      content: 'Hel',
      toolCalls: [{ id: 'tool-chat', name: 'search', state: 'running' }],
    }, {
      chatId: 'chat-stream',
      stepKey: 'agent-a',
      provider: 'agent-runtime',
      model: 'chat-model',
      sessionId: 'session-a',
      streamScope: 'workflow-agent-chat',
    });
    const second = storeChatStreamSseEventAsAgentMessage('delta', {
      content: 'lo',
    }, {
      chatId: 'chat-stream',
      stepKey: 'agent-a',
      provider: 'agent-runtime',
      model: 'chat-model',
      sessionId: 'session-a',
      streamScope: 'workflow-agent-chat',
    }, first);
    const done = storeChatStreamSseEventAsAgentMessage('done', {
      output: 'Hello',
      sessionId: 'session-a',
    }, {
      chatId: 'chat-stream',
      stepKey: 'agent-a',
      provider: 'agent-runtime',
      model: 'chat-model',
      streamScope: 'workflow-agent-chat',
    }, second);

    expect(done).toMatchObject({
      id: 'chat-stream',
      stepKey: 'agent-a',
      status: 'done',
      content: 'Hello',
    });
    expect(agentMessagesCollection.get('chat-stream')?.content).toBe('Hello');
    expect(agentMessagesCollection.get('chat-stream')?.diagnostics?.provider).toBe('agent-runtime');
  });

  test('AI adapter stores thinking, tool_call aliases, errors and diagnostics consistently', () => {
    const thinking = storeChatStreamSseEventAsAgentMessage('thinking', {
      content: 'reasoning ',
      tool_calls: [{ id: 'tool-alias', function: { name: 'inspect', arguments: '{"target":"x"}' }, state: 'input-streaming' }],
      metadata: { latencyMs: 10 },
    }, {
      chatId: 'chat-thinking',
      stepKey: 'agent-b',
      provider: 'agent-runtime',
      model: 'chat-model',
      sessionId: 'session-b',
      streamScope: 'agent-chat',
    });
    const failed = storeChatStreamSseEventAsAgentMessage('error', {
      message: 'failed',
      isError: true,
      tool_calls: [{ id: 'tool-alias', function: { name: 'inspect' }, state: 'error', error: 'denied' }],
      usage: { inputTokens: 4, outputTokens: 2 },
    }, {
      chatId: 'chat-thinking',
      stepKey: 'agent-b',
      provider: 'agent-runtime',
      model: 'chat-model',
      sessionId: 'session-b',
      streamScope: 'agent-chat',
    }, thinking);

    expect(failed).toMatchObject({
      id: 'chat-thinking',
      status: 'error',
      content: 'reasoning failed',
    });
    expect(failed.toolCalls[0]).toMatchObject({
      id: 'tool-alias',
      name: 'inspect',
      status: 'error',
      error: 'denied',
    });
    expect(failed.diagnostics).toMatchObject({
      provider: 'agent-runtime',
      model: 'chat-model',
      sessionId: 'session-b',
    });
    expect(agentMessagesCollection.get('chat-thinking')?.chunks).toEqual(['reasoning ', 'failed']);
  });

  test('AI SSE parser normalizes JSON, plain text and done sentinels', () => {
    expect(parseAceSseEventData('{"content":"hello","sessionId":"session"}')).toMatchObject({
      content: 'hello',
      sessionId: 'session',
    });
    expect(parseAceSseEventData('plain stream payload')).toEqual({ content: 'plain stream payload' });
    expect(parseAceSseEventData('[DONE]')).toEqual({});
  });
});

function baseRun(overrides: Partial<RunHistoryRow> = {}): RunHistoryRow {
  return {
    id: 'run',
    configFile: 'workflow.yaml',
    configName: 'Workflow',
    status: 'completed',
    startTime: '2026-01-01T00:00:00Z',
    endTime: null,
    currentPhase: null,
    totalSteps: 1,
    completedSteps: 1,
    totalTokens: 0,
    cost: 0,
    ownerId: 'owner',
    ownerName: 'Owner',
    ...overrides,
  };
}

function baseKnowledgeBase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'kb',
    name: 'Knowledge Base',
    description: '',
    tableName: 'kb_table',
    databaseUri: 'memory://rag',
    embeddingProvider: 'local-hash',
    embeddingModel: 'hash',
    embeddingDimension: 64,
    metric: 'cosine',
    documentCount: 0,
    chunkCount: 0,
    indexStatus: 'ready',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as any;
}

function baseRagDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc',
    knowledgeBaseId: 'kb',
    title: 'Document',
    sourceType: 'text',
    sourceSystem: 'test',
    externalId: 'external-doc',
    chunkCount: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as any;
}

function baseRagChunk(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chunk',
    knowledgeBaseId: 'kb',
    documentId: 'doc',
    chunkIndex: 0,
    text: 'Chunk text',
    metadataJson: '{}',
    sourceTitle: 'Document',
    sourceType: 'text',
    sourceSystem: 'test',
    externalId: 'external-chunk',
    tokenCount: 2,
    embeddingProvider: 'local-hash',
    embeddingModel: 'hash',
    embeddingDimension: 64,
    createdAt: 1,
    ...overrides,
  } as any;
}
