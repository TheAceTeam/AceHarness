import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { buildConfiguredProcessEnvSync } from '@/lib/core/configured-env';
import type {
  RagBundleInput,
  RagDatabaseStats,
  RagDocument,
  RagEmbeddingProvider,
  RagImportJob,
  RagKnowledgeBase,
  RagMetaStore,
  RagRowsPage,
  RagSchemaField,
  RagTableSchema,
  RagVectorChunk,
} from '@/lib/rag/types';

const META_FILE = getWorkspaceDataFile('rag', 'metadata.json');
const DB_URI = getWorkspaceDataFile('rag', 'lancedb');
export const DEFAULT_RAG_KNOWLEDGE_BASE_ID = 'default';
const DEFAULT_TABLE_NAME = 'kb_default';
const DEFAULT_DIMENSION = 384;
const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 120;
const nodeRequire = createRequire(typeof __filename !== 'undefined' ? __filename : join(process.cwd(), 'package.json'));
const PRE_RUNTIME_SAMPLE_SOURCE_SYSTEM = 'aceharness-sample-rag';
const DEFAULT_SAMPLE_SOURCE_SYSTEM = 'lancedb/vectordb-recipes';
const DEFAULT_SAMPLE_RAG_DOCUMENTS = [
  {
    externalId: 'lancedb-vectordb-recipes-readme',
    title: 'lancedb/vectordb-recipes README',
    chunks: [
      {
        externalId: 'vectordb-recipes-overview',
        text: 'VectorDB-recipes is a LanceDB repository with examples, applications, starter code, and tutorials for building GenAI applications. It uses LanceDB as a free, open-source, serverless vector database and includes examples for RAG, vector search, chatbots, agents, multimodal search, evaluation, and recommender systems.',
        metadata: {
          source: 'https://github.com/lancedb/vectordb-recipes',
          license: 'Apache-2.0',
          section: 'README overview',
        },
      },
      {
        externalId: 'vectordb-recipes-rag-section',
        text: 'The RAG section in lancedb/vectordb-recipes covers retrieval augmented generation examples where relevant documents are retrieved before answering. Examples listed by the repository include RAG on PDF, contextual retrieval with hybrid search, GraphRAG, and RAG comparisons using different LLMs.',
        metadata: {
          source: 'https://github.com/lancedb/vectordb-recipes#rag',
          license: 'Apache-2.0',
          section: 'RAG',
        },
      },
    ],
  },
  {
    externalId: 'lancedb-vectordb-recipes-vector-search',
    title: 'lancedb/vectordb-recipes Vector Search',
    chunks: [
      {
        externalId: 'vectordb-recipes-vector-search-section',
        text: 'The Vector Search section in lancedb/vectordb-recipes focuses on finding relevant documents using vector-based search. It lists examples such as inbuilt hybrid search, BM25 with LanceDB, NER-powered semantic search, vector arithmetic with LanceDB, and TransformersJS vector search.',
        metadata: {
          source: 'https://github.com/lancedb/vectordb-recipes#vector-search',
          license: 'Apache-2.0',
          section: 'Vector Search',
        },
      },
      {
        externalId: 'vectordb-recipes-chatbot-section',
        text: 'The Chatbot section in lancedb/vectordb-recipes includes applications that fetch relevant information through LanceDB vector search before generating responses. Listed examples include a website chatbot, code docs QA bot, YouTube transcript search bot, and Databricks website bot.',
        metadata: {
          source: 'https://github.com/lancedb/vectordb-recipes#chatbot',
          license: 'Apache-2.0',
          section: 'Chatbot',
        },
      },
    ],
  },
];
const RAG_SCHEMA_FIELDS: RagSchemaField[] = [
  { name: 'id', type: 'VarChar', indexed: false, description: 'ACEHarness vector row id' },
  { name: 'knowledgeBaseId', type: 'VarChar', indexed: false, description: 'RAG collection id' },
  { name: 'documentId', type: 'VarChar', indexed: false, description: 'Source id in metadata store' },
  { name: 'chunkIndex', type: 'Int32', indexed: false, description: 'Ordinal row within a source' },
  { name: 'text', type: 'VarChar', indexed: false, description: 'Text used for embedding and retrieval' },
  { name: 'metadataJson', type: 'JSON', indexed: false, description: 'Source payload metadata' },
  { name: 'sourceTitle', type: 'VarChar', indexed: false, description: 'Readable source title' },
  { name: 'sourceType', type: 'VarChar', indexed: false, description: 'Import type' },
  { name: 'sourceSystem', type: 'VarChar', indexed: false, description: 'External RAG/vector system' },
  { name: 'externalId', type: 'VarChar', indexed: false, description: 'External source row id' },
  { name: 'tokenCount', type: 'Int32', indexed: false, description: 'Approximate token count' },
  { name: 'embeddingProvider', type: 'VarChar', indexed: false, description: 'Embedding provider' },
  { name: 'embeddingModel', type: 'VarChar', indexed: false, description: 'Embedding model' },
  { name: 'embeddingDimension', type: 'Int32', indexed: false, description: 'Vector dimension' },
  { name: 'createdAt', type: 'Int64', indexed: false, description: 'Unix timestamp in milliseconds' },
  { name: 'vector', type: 'FloatVector', indexed: true, description: 'Dense embedding vector' },
];

let writeLock: Promise<void> = Promise.resolve();
let lancedbModule: typeof import('@lancedb/lancedb') | null = null;

function runtimeRequire(specifier: string): unknown {
  try {
    const localRequire = eval('require') as ((id: string) => unknown) | undefined;
    if (typeof localRequire === 'function') return localRequire(specifier);
  } catch {
    // ESM/test runners may not expose a CommonJS require in local scope.
  }
  const fallbackRequire = nodeRequire as unknown as (id: string) => unknown;
  return fallbackRequire(specifier);
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = writeLock;
  let release!: () => void;
  writeLock = new Promise<void>((resolve) => { release = resolve; });
  return previous.then(fn).finally(() => release());
}

function emptyMeta(): RagMetaStore {
  return { knowledgeBases: [], documents: [], importJobs: [] };
}

function now() {
  return Date.now();
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

function sanitizeTableName(id: string): string {
  return `kb_${id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

async function readMeta(): Promise<RagMetaStore> {
  if (!existsSync(META_FILE)) return emptyMeta();
  try {
    const parsed = JSON.parse(await readFile(META_FILE, 'utf-8'));
    return {
      knowledgeBases: Array.isArray(parsed?.knowledgeBases) ? parsed.knowledgeBases : [],
      documents: Array.isArray(parsed?.documents) ? parsed.documents : [],
      importJobs: Array.isArray(parsed?.importJobs) ? parsed.importJobs : [],
    };
  } catch {
    return emptyMeta();
  }
}

async function saveMeta(meta: RagMetaStore): Promise<void> {
  await mkdir(dirname(META_FILE), { recursive: true });
  await writeFile(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');
}

async function connectDb() {
  await mkdir(DB_URI, { recursive: true });
  if (!lancedbModule) {
    const runtimeRoot = process.env.ACE_INSTALL_ROOT || process.cwd();
    const loaderPath = join(runtimeRoot, 'runtime', 'lancedb.cjs');
    const loader = runtimeRequire(loaderPath) as { loadLanceDb?: () => typeof import('@lancedb/lancedb') };
    if (typeof loader.loadLanceDb !== 'function') {
      throw new Error('LanceDB runtime loader is unavailable');
    }
    lancedbModule = loader.loadLanceDb();
  }
  return lancedbModule.connect(DB_URI);
}

function readEmbeddingConfig(userId?: string): {
  provider: RagEmbeddingProvider;
  model: string;
  dimension: number;
  apiKey?: string;
  baseUrl?: string;
} {
  const env = buildConfiguredProcessEnvSync(undefined, process.env, userId ? { userId } : undefined);
  const apiKey = String(env.ACE_RAG_OPENAI_API_KEY || env.OPENAI_API_KEY || '').trim();
  const baseUrl = String(env.ACE_RAG_OPENAI_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  const model = String(env.ACE_RAG_EMBEDDING_MODEL || 'text-embedding-3-small').trim();
  const dimension = Number(env.ACE_RAG_EMBEDDING_DIMENSION || '') || (apiKey ? 1536 : DEFAULT_DIMENSION);
  return apiKey
    ? { provider: 'openai-compatible', model, dimension, apiKey, baseUrl }
    : { provider: 'local-hash', model: 'local-hash-384', dimension: DEFAULT_DIMENSION };
}

function hashEmbedding(text: string, dimension = DEFAULT_DIMENSION): number[] {
  const vector = new Array<number>(dimension).fill(0);
  const tokens = (text.toLowerCase().match(/[a-z0-9_]{2,}|[\u3400-\u9fff]/g) || [text.toLowerCase()]).slice(0, 2048);
  for (const token of tokens) {
    const digest = createHash('sha256').update(token).digest();
    for (let i = 0; i < 4; i += 1) {
      const index = digest.readUInt16BE(i * 2) % dimension;
      const sign = digest[i + 12] % 2 === 0 ? 1 : -1;
      vector[index] += sign * (1 + Math.log(token.length + 1));
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

async function openAiEmbeddings(texts: string[], config: ReturnType<typeof readEmbeddingConfig>): Promise<number[][]> {
  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: texts,
      ...(config.dimension ? { dimensions: config.dimension } : {}),
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || `Embedding 请求失败：HTTP ${response.status}`);
  }
  const vectors = Array.isArray(data?.data)
    ? data.data.map((item: any) => item?.embedding).filter((item: unknown) => Array.isArray(item))
    : [];
  if (vectors.length !== texts.length) {
    throw new Error('Embedding 返回数量不匹配');
  }
  return vectors;
}

async function embedTexts(texts: string[], userId?: string) {
  const config = readEmbeddingConfig(userId);
  if (config.provider === 'openai-compatible') {
    const vectors = await openAiEmbeddings(texts, config);
    return { ...config, vectors };
  }
  return {
    ...config,
    vectors: texts.map((text) => hashEmbedding(text, config.dimension)),
  };
}

function splitText(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= CHUNK_SIZE) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    if (paragraph.length <= CHUNK_SIZE) {
      current = paragraph;
    } else {
      for (let start = 0; start < paragraph.length; start += CHUNK_SIZE - CHUNK_OVERLAP) {
        chunks.push(paragraph.slice(start, start + CHUNK_SIZE).trim());
      }
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

function countTokensApprox(text: string): number {
  const latin = text.match(/[A-Za-z0-9_]+/g)?.length || 0;
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length || 0;
  return latin + Math.ceil(cjk / 1.8);
}

async function tableExists(tableName: string): Promise<boolean> {
  const db = await connectDb();
  const names = await db.tableNames();
  return names.includes(tableName);
}

function seedRow(kb: RagKnowledgeBase): Record<string, unknown> {
  return {
    id: `seed_${kb.tableName}`,
    knowledgeBaseId: '__seed__',
    documentId: '__seed__',
    chunkIndex: -1,
    text: '__seed__',
    metadataJson: '{}',
    sourceTitle: '__seed__',
    sourceType: 'seed',
    sourceSystem: 'aceharness',
    externalId: '',
    tokenCount: 0,
    embeddingProvider: kb.embeddingProvider,
    embeddingModel: kb.embeddingModel,
    embeddingDimension: kb.embeddingDimension,
    createdAt: 0,
    vector: new Array<number>(kb.embeddingDimension).fill(0),
  };
}

async function ensureTable(kb: RagKnowledgeBase) {
  const db = await connectDb();
  const names = await db.tableNames();
  if (!names.includes(kb.tableName)) {
    return db.createTable(kb.tableName, [seedRow(kb)]);
  }
  return db.openTable(kb.tableName);
}

async function rowCount(tableName: string, knowledgeBaseId: string): Promise<number> {
  if (!(await tableExists(tableName))) return 0;
  const table = await (await connectDb()).openTable(tableName);
  return table.countRows(`knowledgeBaseId = '${knowledgeBaseId.replace(/'/g, "''")}'`);
}

function escapeFilterValue(value: string): string {
  return value.replace(/'/g, "''");
}

function rowFilter(knowledgeBaseId: string, documentId?: string): string {
  const base = `knowledgeBaseId = '${escapeFilterValue(knowledgeBaseId)}'`;
  return documentId ? `${base} AND documentId = '${escapeFilterValue(documentId)}'` : base;
}

function ensureDefaultKnowledgeBase(meta: RagMetaStore): boolean {
  if (meta.knowledgeBases.some((item) => item.id === DEFAULT_RAG_KNOWLEDGE_BASE_ID)) return false;
  const timestamp = now();
  meta.knowledgeBases.unshift({
    id: DEFAULT_RAG_KNOWLEDGE_BASE_ID,
    name: 'ACEHarness 默认 RAG 数据库',
    description: '内置 LanceDB 向量数据库。导入内容会切块、embedding 并写入 LanceDB table。',
    tableName: DEFAULT_TABLE_NAME,
    databaseUri: DB_URI,
    embeddingProvider: 'local-hash',
    embeddingModel: 'local-hash-384',
    embeddingDimension: DEFAULT_DIMENSION,
    metric: 'cosine',
    documentCount: 0,
    chunkCount: 0,
    indexStatus: 'empty',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return true;
}

async function refreshStats(meta: RagMetaStore, knowledgeBaseId: string): Promise<void> {
  const kb = meta.knowledgeBases.find((item) => item.id === knowledgeBaseId);
  if (!kb) return;
  kb.documentCount = meta.documents.filter((item) => item.knowledgeBaseId === knowledgeBaseId).length;
  kb.chunkCount = await rowCount(kb.tableName, knowledgeBaseId);
  kb.indexStatus = kb.chunkCount > 0 ? 'ready' : 'empty';
  kb.updatedAt = now();
}

async function deleteRowsBySourceSystem(kb: RagKnowledgeBase, sourceSystem: string): Promise<void> {
  if (!(await tableExists(kb.tableName))) return;
  const table = await (await connectDb()).openTable(kb.tableName);
  await table.delete(`knowledgeBaseId = '${kb.id.replace(/'/g, "''")}' AND sourceSystem = '${sourceSystem.replace(/'/g, "''")}'`);
}

async function replacePreRuntimeDefaultSample(meta: RagMetaStore): Promise<boolean> {
  const kb = meta.knowledgeBases.find((item) => item.id === DEFAULT_RAG_KNOWLEDGE_BASE_ID);
  if (!kb) return false;
  const preRuntimeDocumentIds = new Set(
    meta.documents
      .filter((item) => item.knowledgeBaseId === DEFAULT_RAG_KNOWLEDGE_BASE_ID && item.sourceSystem === PRE_RUNTIME_SAMPLE_SOURCE_SYSTEM)
      .map((item) => item.id)
  );
  if (preRuntimeDocumentIds.size === 0) return false;
  await deleteRowsBySourceSystem(kb, PRE_RUNTIME_SAMPLE_SOURCE_SYSTEM);
  meta.documents = meta.documents.filter((item) => !preRuntimeDocumentIds.has(item.id));
  await refreshStats(meta, DEFAULT_RAG_KNOWLEDGE_BASE_ID);
  await saveMeta(meta);
  return true;
}

export async function listRagKnowledgeBases(): Promise<RagKnowledgeBase[]> {
  let meta = await readMeta();
  if (ensureDefaultKnowledgeBase(meta)) await saveMeta(meta);
  if (await replacePreRuntimeDefaultSample(meta)) {
    meta = await readMeta();
  }
  if (!meta.documents.some((item) => item.knowledgeBaseId === DEFAULT_RAG_KNOWLEDGE_BASE_ID)) {
    await importDocuments({
      knowledgeBaseId: DEFAULT_RAG_KNOWLEDGE_BASE_ID,
      sourceType: 'rag-bundle',
      sourceSystem: DEFAULT_SAMPLE_SOURCE_SYSTEM,
      documents: DEFAULT_SAMPLE_RAG_DOCUMENTS,
    });
    meta = await readMeta();
  }
  for (const kb of meta.knowledgeBases) {
    await refreshStats(meta, kb.id);
  }
  await saveMeta(meta);
  return [...meta.knowledgeBases].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createRagKnowledgeBase(input: { name: string; description?: string }): Promise<RagKnowledgeBase> {
  const name = normalizeText(input.name);
  if (!name) throw new Error('知识库名称不能为空');
  return withLock(async () => {
    const meta = await readMeta();
    ensureDefaultKnowledgeBase(meta);
    const config = readEmbeddingConfig();
    const id = randomUUID();
    const timestamp = now();
    const kb: RagKnowledgeBase = {
      id,
      name,
      description: normalizeText(input.description),
      tableName: sanitizeTableName(id),
      databaseUri: DB_URI,
      embeddingProvider: config.provider,
      embeddingModel: config.model,
      embeddingDimension: config.dimension,
      metric: 'cosine',
      documentCount: 0,
      chunkCount: 0,
      indexStatus: 'empty',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    meta.knowledgeBases.unshift(kb);
    await ensureTable(kb);
    await saveMeta(meta);
    return kb;
  });
}

export async function deleteRagKnowledgeBase(id: string): Promise<void> {
  if (id === DEFAULT_RAG_KNOWLEDGE_BASE_ID) throw new Error('默认 RAG 数据库不能删除');
  return withLock(async () => {
    const meta = await readMeta();
    const kb = meta.knowledgeBases.find((item) => item.id === id);
    meta.knowledgeBases = meta.knowledgeBases.filter((item) => item.id !== id);
    meta.documents = meta.documents.filter((item) => item.knowledgeBaseId !== id);
    meta.importJobs = meta.importJobs.filter((item) => item.knowledgeBaseId !== id);
    if (kb && await tableExists(kb.tableName)) {
      await (await connectDb()).dropTable(kb.tableName);
    }
    await saveMeta(meta);
  });
}

export async function listRagDocuments(knowledgeBaseId: string): Promise<RagDocument[]> {
  const meta = await readMeta();
  return meta.documents
    .filter((item) => item.knowledgeBaseId === knowledgeBaseId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteRagDocument(input: { knowledgeBaseId: string; documentId: string }): Promise<void> {
  return withLock(async () => {
    const meta = await readMeta();
    const kb = meta.knowledgeBases.find((item) => item.id === input.knowledgeBaseId);
    if (!kb) throw new Error('RAG 数据库不存在');
    const document = meta.documents.find((item) => item.knowledgeBaseId === input.knowledgeBaseId && item.id === input.documentId);
    if (!document) throw new Error('来源不存在');
    if (await tableExists(kb.tableName)) {
      const table = await (await connectDb()).openTable(kb.tableName);
      await table.delete(`knowledgeBaseId = '${input.knowledgeBaseId.replace(/'/g, "''")}' AND documentId = '${input.documentId.replace(/'/g, "''")}'`);
    }
    meta.documents = meta.documents.filter((item) => !(item.knowledgeBaseId === input.knowledgeBaseId && item.id === input.documentId));
    await refreshStats(meta, input.knowledgeBaseId);
    await saveMeta(meta);
  });
}

async function refreshDocumentCounts(meta: RagMetaStore, kb: RagKnowledgeBase): Promise<void> {
  if (!(await tableExists(kb.tableName))) {
    meta.documents = meta.documents.filter((item) => item.knowledgeBaseId !== kb.id);
    return;
  }
  const table = await (await connectDb()).openTable(kb.tableName);
  const nextDocuments: RagDocument[] = [];
  for (const document of meta.documents) {
    if (document.knowledgeBaseId !== kb.id) {
      nextDocuments.push(document);
      continue;
    }
    const count = await table.countRows(rowFilter(kb.id, document.id));
    if (count > 0) {
      nextDocuments.push({ ...document, chunkCount: count, updatedAt: now() });
    }
  }
  meta.documents = nextDocuments;
}

export async function deleteRagRows(input: { knowledgeBaseId: string; rowIds: string[] }): Promise<void> {
  const rowIds = Array.from(new Set(input.rowIds.map((id) => normalizeText(id)).filter(Boolean)));
  if (rowIds.length === 0) throw new Error('缺少向量行 ID');
  return withLock(async () => {
    const meta = await readMeta();
    const kb = meta.knowledgeBases.find((item) => item.id === input.knowledgeBaseId);
    if (!kb) throw new Error('RAG 数据库不存在');
    if (await tableExists(kb.tableName)) {
      const table = await (await connectDb()).openTable(kb.tableName);
      const rowPredicate = rowIds.map((id) => `id = '${escapeFilterValue(id)}'`).join(' OR ');
      await table.delete(`knowledgeBaseId = '${escapeFilterValue(input.knowledgeBaseId)}' AND (${rowPredicate})`);
    }
    await refreshDocumentCounts(meta, kb);
    await refreshStats(meta, input.knowledgeBaseId);
    await saveMeta(meta);
  });
}

export async function emptyRagKnowledgeBase(knowledgeBaseId: string): Promise<void> {
  return withLock(async () => {
    const meta = await readMeta();
    const kb = meta.knowledgeBases.find((item) => item.id === knowledgeBaseId);
    if (!kb) throw new Error('RAG 数据库不存在');
    if (await tableExists(kb.tableName)) {
      const table = await (await connectDb()).openTable(kb.tableName);
      await table.delete(`knowledgeBaseId = '${escapeFilterValue(knowledgeBaseId)}'`);
    }
    meta.documents = meta.documents.filter((item) => item.knowledgeBaseId !== knowledgeBaseId);
    await refreshStats(meta, knowledgeBaseId);
    await saveMeta(meta);
  });
}

export async function importRagSampleKnowledgeBase(input: { knowledgeBaseId: string; userId?: string }): Promise<RagImportJob> {
  return importDocuments({
    knowledgeBaseId: input.knowledgeBaseId,
    sourceType: 'rag-bundle',
    sourceSystem: DEFAULT_SAMPLE_SOURCE_SYSTEM,
    documents: DEFAULT_SAMPLE_RAG_DOCUMENTS,
    userId: input.userId,
  });
}

export async function listRagImportJobs(knowledgeBaseId: string): Promise<RagImportJob[]> {
  const meta = await readMeta();
  return meta.importJobs
    .filter((item) => item.knowledgeBaseId === knowledgeBaseId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);
}

function rowsToChunks(rows: any[]): RagVectorChunk[] {
  return rows
    .filter((row) => row.knowledgeBaseId !== '__seed__')
    .map((row) => ({
      id: String(row.id),
      knowledgeBaseId: String(row.knowledgeBaseId),
      documentId: String(row.documentId),
      chunkIndex: Number(row.chunkIndex),
      text: String(row.text || ''),
      metadataJson: String(row.metadataJson || '{}'),
      sourceTitle: String(row.sourceTitle || ''),
      sourceType: String(row.sourceType || ''),
      sourceSystem: String(row.sourceSystem || ''),
      externalId: String(row.externalId || ''),
      tokenCount: Number(row.tokenCount || 0),
      embeddingProvider: row.embeddingProvider === 'openai-compatible' ? 'openai-compatible' : 'local-hash',
      embeddingModel: String(row.embeddingModel || ''),
      embeddingDimension: Number(row.embeddingDimension || 0),
      createdAt: Number(row.createdAt || 0),
      _distance: typeof row._distance === 'number' ? row._distance : undefined,
    }));
}

export async function listRagChunks(knowledgeBaseId: string, limit = 80): Promise<RagVectorChunk[]> {
  const meta = await readMeta();
  const kb = meta.knowledgeBases.find((item) => item.id === knowledgeBaseId);
  if (!kb || !(await tableExists(kb.tableName))) return [];
  const table = await (await connectDb()).openTable(kb.tableName);
  const rows = await table.query()
    .where(`knowledgeBaseId = '${knowledgeBaseId.replace(/'/g, "''")}'`)
    .limit(Math.max(1, Math.min(limit, 1000)))
    .toArray();
  return rowsToChunks(rows).sort((a, b) => a.documentId.localeCompare(b.documentId) || a.chunkIndex - b.chunkIndex);
}

export async function listRagRowsPage(input: {
  knowledgeBaseId: string;
  page?: number;
  pageSize?: number;
  documentId?: string;
}): Promise<RagRowsPage> {
  const page = Math.max(0, Number.isFinite(input.page) ? Math.floor(input.page || 0) : 0);
  const pageSize = Math.max(1, Math.min(Number.isFinite(input.pageSize) ? Math.floor(input.pageSize || 50) : 50, 200));
  const meta = await readMeta();
  const kb = meta.knowledgeBases.find((item) => item.id === input.knowledgeBaseId);
  if (!kb || !(await tableExists(kb.tableName))) {
    return { rows: [], page, pageSize, total: 0, hasMore: false };
  }
  const table = await (await connectDb()).openTable(kb.tableName);
  const filter = rowFilter(input.knowledgeBaseId, input.documentId);
  const total = await table.countRows(filter);
  const rows = await table.query()
    .where(filter)
    .offset(page * pageSize)
    .limit(pageSize)
    .toArray();
  return {
    rows: rowsToChunks(rows).sort((a, b) => a.documentId.localeCompare(b.documentId) || a.chunkIndex - b.chunkIndex),
    page,
    pageSize,
    total,
    hasMore: (page + 1) * pageSize < total,
  };
}

export async function getRagTableSchema(knowledgeBaseId: string): Promise<RagTableSchema | null> {
  const meta = await readMeta();
  const kb = meta.knowledgeBases.find((item) => item.id === knowledgeBaseId);
  if (!kb) return null;
  return {
    tableName: kb.tableName,
    fields: RAG_SCHEMA_FIELDS,
  };
}

function bundleDocuments(bundle: RagBundleInput) {
  const docs = Array.isArray(bundle.documents) ? bundle.documents : [];
  if (docs.length > 0) return docs;
  const grouped = new Map<string, any>();
  for (const chunk of Array.isArray(bundle.chunks) ? bundle.chunks : []) {
    const key = chunk.documentId || chunk.title || 'imported';
    const doc = grouped.get(key) || { id: key, title: chunk.title || key, chunks: [] };
    doc.chunks.push({ id: chunk.id, text: chunk.text || chunk.content, metadata: chunk.metadata });
    grouped.set(key, doc);
  }
  return Array.from(grouped.values());
}

async function importDocuments(input: {
  knowledgeBaseId: string;
  sourceType: RagDocument['sourceType'];
  sourceSystem?: string;
  documents: Array<{
    externalId?: string;
    title: string;
    content?: string;
    chunks?: Array<{ externalId?: string; text: string; metadata?: Record<string, unknown> }>;
    metadata?: Record<string, unknown>;
  }>;
  userId?: string;
}): Promise<RagImportJob> {
  return withLock(async () => {
    const meta = await readMeta();
    ensureDefaultKnowledgeBase(meta);
    const kb = meta.knowledgeBases.find((item) => item.id === input.knowledgeBaseId);
    if (!kb) throw new Error('RAG 数据库不存在');
    const timestamp = now();
    const rows: Record<string, unknown>[] = [];
    const documents: RagDocument[] = [];

    for (const docInput of input.documents) {
      const explicitChunks: Array<{ text: string; externalId?: string; metadata?: Record<string, unknown> }> = docInput.chunks?.map((chunk) => ({
        text: normalizeText(chunk.text),
        externalId: chunk.externalId,
        metadata: chunk.metadata,
      })).filter((chunk) => chunk.text) || [];
      const chunkInputs: Array<{ text: string; externalId?: string; metadata?: Record<string, unknown> }> = explicitChunks.length > 0
        ? explicitChunks
        : splitText(docInput.content || '').map((text) => ({ text, metadata: docInput.metadata }));
      if (chunkInputs.length === 0) continue;

      const documentId = randomUUID();
      const embed = await embedTexts(chunkInputs.map((chunk) => chunk.text), input.userId);
      const document: RagDocument = {
        id: documentId,
        knowledgeBaseId: kb.id,
        title: docInput.title || 'Untitled',
        sourceType: input.sourceType,
        sourceSystem: input.sourceSystem,
        externalId: docInput.externalId,
        chunkCount: chunkInputs.length,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      documents.push(document);
      kb.embeddingProvider = embed.provider;
      kb.embeddingModel = embed.model;
      kb.embeddingDimension = embed.dimension;
      for (let index = 0; index < chunkInputs.length; index += 1) {
        const chunk = chunkInputs[index];
        rows.push({
          id: randomUUID(),
          knowledgeBaseId: kb.id,
          documentId,
          chunkIndex: index,
          text: chunk.text,
          metadataJson: JSON.stringify(chunk.metadata || docInput.metadata || {}),
          sourceTitle: document.title,
          sourceType: input.sourceType,
          sourceSystem: input.sourceSystem || '',
          externalId: chunk.externalId || '',
          tokenCount: countTokensApprox(chunk.text),
          embeddingProvider: embed.provider,
          embeddingModel: embed.model,
          embeddingDimension: embed.dimension,
          createdAt: timestamp,
          vector: embed.vectors[index],
        });
      }
    }

    if (rows.length === 0) throw new Error('没有可写入向量数据库的向量行');
    const table = await ensureTable(kb);
    await table.add(rows);
    const job: RagImportJob = {
      id: randomUUID(),
      knowledgeBaseId: kb.id,
      sourceType: input.sourceType,
      status: 'completed',
      message: `已写入 LanceDB：${documents.length} sources / ${rows.length} vectors`,
      documentCount: documents.length,
      chunkCount: rows.length,
      createdAt: timestamp,
    };
    meta.documents.push(...documents);
    meta.importJobs.push(job);
    await refreshStats(meta, kb.id);
    await saveMeta(meta);
    return job;
  });
}

export async function importRagText(input: {
  knowledgeBaseId: string;
  title: string;
  content: string;
  sourceType?: RagDocument['sourceType'];
  userId?: string;
}): Promise<RagImportJob> {
  const content = normalizeText(input.content);
  if (!content) throw new Error('导入内容不能为空');
  return importDocuments({
    knowledgeBaseId: input.knowledgeBaseId,
    sourceType: input.sourceType || 'text',
    documents: [{ title: normalizeText(input.title) || 'Untitled', content }],
    userId: input.userId,
  });
}

export async function importRagBundle(input: {
  knowledgeBaseId: string;
  bundle: RagBundleInput;
  userId?: string;
}): Promise<RagImportJob> {
  const docs = bundleDocuments(input.bundle).map((doc: any) => ({
    externalId: doc.id,
    title: normalizeText(doc.title) || doc.sourceName || doc.id || 'Imported document',
    content: doc.content,
    metadata: doc.metadata,
    chunks: Array.isArray(doc.chunks)
      ? doc.chunks.map((chunk: any) => ({
        externalId: chunk.id,
        text: normalizeText(chunk.text || chunk.content),
        metadata: chunk.metadata,
      })).filter((chunk: any) => chunk.text)
      : undefined,
  }));
  if (docs.length === 0) throw new Error('RAG 导入文件中没有来源或向量行');
  return importDocuments({
    knowledgeBaseId: input.knowledgeBaseId,
    sourceType: 'rag-bundle',
    sourceSystem: input.bundle.sourceSystem,
    documents: docs,
    userId: input.userId,
  });
}

export async function searchRagKnowledgeBase(input: {
  knowledgeBaseId: string;
  query: string;
  topK?: number;
  userId?: string;
}): Promise<RagVectorChunk[]> {
  const query = normalizeText(input.query);
  if (!query) return [];
  const meta = await readMeta();
  const kb = meta.knowledgeBases.find((item) => item.id === input.knowledgeBaseId);
  if (!kb || !(await tableExists(kb.tableName))) return [];
  const table = await (await connectDb()).openTable(kb.tableName);
  const embed = await embedTexts([query], input.userId);
  const rows = await table.vectorSearch(embed.vectors[0])
    .where(`knowledgeBaseId = '${input.knowledgeBaseId.replace(/'/g, "''")}'`)
    .limit(Math.max(1, Math.min(input.topK || 8, 30)))
    .toArray();
  return rowsToChunks(rows);
}

export async function getRagDatabaseStats(knowledgeBaseId: string): Promise<RagDatabaseStats | null> {
  const meta = await readMeta();
  const kb = meta.knowledgeBases.find((item) => item.id === knowledgeBaseId);
  if (!kb) return null;
  const rowCountValue = await rowCount(kb.tableName, kb.id);
  const table = await tableExists(kb.tableName) ? await (await connectDb()).openTable(kb.tableName) : null;
  return {
    databaseUri: DB_URI,
    tableName: kb.tableName,
    tableVersion: table ? await table.version().catch(() => undefined) : undefined,
    rowCount: rowCountValue,
    embeddingProvider: kb.embeddingProvider,
    embeddingModel: kb.embeddingModel,
    embeddingDimension: kb.embeddingDimension,
  };
}
