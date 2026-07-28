import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

let aceHome = '';

async function loadStore() {
  vi.resetModules();
  process.env.ACE_HOME = aceHome;
  return import('@/lib/rag/store');
}

beforeEach(async () => {
  aceHome = await mkdtemp(join(tmpdir(), 'ace-rag-test-'));
});

afterEach(async () => {
  await rm(aceHome, { recursive: true, force: true });
  delete process.env.ACE_HOME;
});

describe('rag store', () => {
  test('seeds the default knowledge base from a real open-source RAG source', async () => {
    const store = await loadStore();
    const knowledgeBases = await store.listRagKnowledgeBases();
    const defaultKb = knowledgeBases.find((item) => item.id === 'default');
    expect(defaultKb?.documentCount).toBeGreaterThan(0);
    expect(defaultKb?.chunkCount).toBeGreaterThan(0);

    const documents = await store.listRagDocuments('default');
    const chunks = await store.listRagChunks('default');
    expect(documents.some((item) => item.sourceSystem === 'lancedb/vectordb-recipes')).toBe(true);
    expect(chunks.some((item) => item.sourceSystem === 'lancedb/vectordb-recipes')).toBe(true);
  });

  test('creates knowledge base, imports text, and searches chunks', async () => {
    const store = await loadStore();
    const kb = await store.createRagKnowledgeBase({ name: 'Test KB', description: 'RAG test' });
    await store.importRagText({
      knowledgeBaseId: kb.id,
      title: 'Architecture',
      content: 'ACEHarness RAG knowledge base stores documents and chunks independently from Notebook.',
    });

    const knowledgeBases = await store.listRagKnowledgeBases();
    const targetKb = knowledgeBases.find((item) => item.id === kb.id);
    expect(targetKb?.documentCount).toBe(1);
    expect(targetKb?.chunkCount).toBeGreaterThan(0);
    expect(knowledgeBases.find((item) => item.id === 'default')).toBeTruthy();

    const results = await store.searchRagKnowledgeBase({ knowledgeBaseId: kb.id, query: 'RAG chunks' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].sourceTitle).toBe('Architecture');
    expect(typeof results[0]._distance).toBe('number');

    const stats = await store.getRagDatabaseStats(kb.id);
    expect(stats?.tableName).toBe(kb.tableName);
    expect(stats?.rowCount).toBeGreaterThan(0);
    expect(stats?.embeddingProvider).toBe('local-hash');
  });

  test('imports generic rag bundle chunks', async () => {
    const store = await loadStore();
    const kb = await store.createRagKnowledgeBase({ name: 'Bundle KB' });
    await store.importRagBundle({
      knowledgeBaseId: kb.id,
      bundle: {
        sourceSystem: 'dify-export',
        documents: [
          {
            id: 'external-doc',
            title: 'External RAG',
            chunks: [
              { id: 'external-chunk', text: 'Dify and RAGFlow imports are normalized into ACEHarness chunks.' },
            ],
          },
        ],
      },
    });

    const documents = await store.listRagDocuments(kb.id);
    const chunks = await store.listRagChunks(kb.id);
    expect(documents).toHaveLength(1);
    expect(documents[0].sourceSystem).toBe('dify-export');
    expect(chunks[0].externalId).toBe('external-chunk');
    expect(chunks[0].sourceSystem).toBe('dify-export');
    expect(chunks[0].embeddingDimension).toBe(384);
  });

  test('deletes a source and its vector rows', async () => {
    const store = await loadStore();
    const kb = await store.createRagKnowledgeBase({ name: 'Managed KB' });
    await store.importRagBundle({
      knowledgeBaseId: kb.id,
      bundle: {
        sourceSystem: 'managed-import',
        documents: [
          {
            id: 'managed-doc',
            title: 'Managed source',
            chunks: [
              { id: 'row-1', text: 'First managed vector row.' },
              { id: 'row-2', text: 'Second managed vector row.' },
            ],
          },
        ],
      },
    });

    const [document] = await store.listRagDocuments(kb.id);
    expect((await store.listRagChunks(kb.id)).length).toBe(2);

    await store.deleteRagDocument({ knowledgeBaseId: kb.id, documentId: document.id });

    expect(await store.listRagDocuments(kb.id)).toHaveLength(0);
    expect(await store.listRagChunks(kb.id)).toHaveLength(0);
    const knowledgeBases = await store.listRagKnowledgeBases();
    expect(knowledgeBases.find((item) => item.id === kb.id)?.chunkCount).toBe(0);
  });

  test('deletes selected vector rows and empties a knowledge base', async () => {
    const store = await loadStore();
    const kb = await store.createRagKnowledgeBase({ name: 'Rows KB' });
    await store.importRagSampleKnowledgeBase({ knowledgeBaseId: kb.id });
    const rows = await store.listRagChunks(kb.id);
    expect(rows.length).toBeGreaterThan(1);

    await store.deleteRagRows({ knowledgeBaseId: kb.id, rowIds: [rows[0].id] });
    expect(await store.listRagChunks(kb.id)).toHaveLength(rows.length - 1);

    await store.emptyRagKnowledgeBase(kb.id);
    expect(await store.listRagChunks(kb.id)).toHaveLength(0);
    expect(await store.listRagDocuments(kb.id)).toHaveLength(0);
  });
});
