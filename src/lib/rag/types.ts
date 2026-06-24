export type RagEmbeddingProvider = 'openai-compatible' | 'local-hash';

export interface RagKnowledgeBase {
  id: string;
  name: string;
  description?: string;
  tableName: string;
  databaseUri: string;
  embeddingProvider: RagEmbeddingProvider;
  embeddingModel: string;
  embeddingDimension: number;
  metric: 'cosine';
  documentCount: number;
  chunkCount: number;
  indexStatus: 'ready' | 'empty' | 'needs-index' | 'indexing' | 'failed';
  createdAt: number;
  updatedAt: number;
}

export interface RagDocument {
  id: string;
  knowledgeBaseId: string;
  title: string;
  sourceType: 'text' | 'rag-bundle' | 'dify' | 'ragflow' | 'anythingllm' | 'open-webui' | 'lancedb' | 'qdrant' | 'chroma';
  sourceSystem?: string;
  externalId?: string;
  chunkCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface RagVectorChunk {
  id: string;
  knowledgeBaseId: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  metadataJson: string;
  sourceTitle: string;
  sourceType: string;
  sourceSystem: string;
  externalId: string;
  tokenCount: number;
  embeddingProvider: RagEmbeddingProvider;
  embeddingModel: string;
  embeddingDimension: number;
  createdAt: number;
  _distance?: number;
}

export interface RagImportJob {
  id: string;
  knowledgeBaseId: string;
  sourceType: string;
  status: 'completed' | 'failed';
  message: string;
  documentCount: number;
  chunkCount: number;
  createdAt: number;
}

export interface RagDatabaseStats {
  databaseUri: string;
  tableName: string;
  tableVersion?: number;
  rowCount: number;
  embeddingProvider: RagEmbeddingProvider;
  embeddingModel: string;
  embeddingDimension: number;
}

export interface RagSchemaField {
  name: string;
  type: string;
  indexed: boolean;
  description?: string;
}

export interface RagTableSchema {
  tableName: string;
  fields: RagSchemaField[];
}

export interface RagRowsPage {
  rows: RagVectorChunk[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface RagMetaStore {
  knowledgeBases: RagKnowledgeBase[];
  documents: RagDocument[];
  importJobs: RagImportJob[];
}

export interface RagBundleInput {
  sourceSystem?: string;
  documents?: Array<{
    id?: string;
    title?: string;
    sourceSystem?: string;
    content?: string;
    metadata?: Record<string, unknown>;
    chunks?: Array<{
      id?: string;
      text?: string;
      content?: string;
      metadata?: Record<string, unknown>;
    }>;
  }>;
  chunks?: Array<{
    id?: string;
    documentId?: string;
    title?: string;
    text?: string;
    content?: string;
    metadata?: Record<string, unknown>;
  }>;
}
