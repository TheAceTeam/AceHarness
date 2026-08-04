import { createCollection, localOnlyCollectionOptions } from '@tanstack/db';
import { useLiveQuery } from '@tanstack/react-db';
import { startTransition, useEffect, useMemo } from 'react';
import type { ConfigListParams, WorkflowConfigSummary } from '../query/configs';
import type { AgentConfig } from '../query/agents';
import type { LocalSkill } from '../query/skills';
import type { RunHistoryItem, RunHistoryParams } from '../query/run-history';
import type { RunDocumentReference, RunDocumentSource, TreeNode } from '@/lib/core/api';
import type { ModelDiagnosticsResponse } from '@/lib/models/diagnostic-types';
import type { ModelProbeListResponse, ModelProbeSummary } from '@/lib/models/probe-types';
import { DEFAULT_MODEL_CONTEXT_WINDOW, DEFAULT_MODEL_ENDPOINTS } from '@/lib/models/defaults';
import type { HumanQuestion } from '@/lib/run/state-persistence';
import type { RagDocument, RagKnowledgeBase, RagVectorChunk } from '@/lib/rag/types';

export * from './runtime-agent-collections';

export type WorkflowConfigRow = {
  id: string;
  filename: string;
  name: string;
  description?: string;
  mode?: 'state-machine';
  kind?: 'lightweight' | 'state-machine';
  profile?: 'lightweight';
  stateCount?: number;
  stepCount?: number;
  agentCount?: number;
  createdAt?: number | string;
  visibility?: 'private' | 'shared' | 'public';
  ownerName?: string;
  updatedAt?: string;
};

export type RunHistoryRow = {
  id: string;
  configFile: string;
  configName: string;
  status: string;
  startTime: string;
  endTime: string | null;
  currentPhase: string | null;
  totalSteps: number;
  completedSteps: number;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cost: number;
  ownerId: string;
  ownerName: string;
  parentStateName?: string;
  parentStepName?: string;
  parentRunId?: string;
  rootRunId?: string;
  childRunIds?: Array<string>;
};

export type DocumentMetadataRow = {
  id: string;
  runId: string;
  sourceRunId: string;
  documentSource: RunDocumentSource;
  documentKey: string;
  filename: string;
  relativePath: string;
  documentSourceLabel?: string;
  documentDirectory?: string;
  name: string;
  baseName?: string;
  logicalName?: string;
  stepName?: string;
  iteration?: number | null;
  agent?: string;
  phaseName?: string;
  role?: string;
  size?: number;
  modifiedTime?: string;
  documentKind?: string;
  groupKey?: string;
  groupLabel?: string;
  detailCount?: number;
  sourceConfigFile?: string;
  sourceLabel?: string;
  parentRunId?: string | null;
  rootRunId?: string | null;
  updatedAt?: string;
};

export type WorkflowEventRow = {
  id: string;
  runId: string;
  seq: number;
  type: string;
  timestamp?: string;
  state?: string;
  step?: string;
  agent?: string;
  message?: string;
  payload?: Record<string, unknown>;
};

export type WorkflowStateHistoryRow = {
  id: string;
  runId: string;
  index: number;
  timestamp?: string;
  fromState?: string;
  toState?: string;
  state?: string;
  step?: string;
  status?: string;
  reason?: string;
  summary?: string;
  payload?: Record<string, unknown>;
};

export type WorkflowStepLogRow = {
  id: string;
  runId: string;
  index: number;
  stepName?: string;
  agent?: string;
  status?: string;
  timestamp?: string;
  durationMs?: number;
  costUsd?: number;
  engineName?: string;
  sessionId?: string | null;
  childRunId?: string;
  childStatus?: string;
  outputRef?: string;
  outputBytes?: number;
  outputPreview?: string;
  errorPreview?: string;
  payload?: Record<string, unknown>;
};

export type WorkflowHumanQuestionRow = {
  id: string;
  runId: string;
  configFile: string;
  status: HumanQuestion['status'];
  kind: HumanQuestion['kind'];
  title: string;
  message: string;
  createdAt: string;
  answeredAt?: string;
  currentState?: string | null;
  previousState?: string | null;
  suggestedNextState?: string;
  requiresWorkflowPause?: boolean;
  workflowFrontendSessionId?: string | null;
  sourceRunId?: string;
  sourceConfigFile?: string;
  answerSchema?: Record<string, unknown>;
  answer?: Record<string, unknown>;
  source?: Record<string, unknown>;
};

export type AgentMessageRow = {
  id: string;
  runId?: string;
  stepKey?: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  status: 'pending' | 'streaming' | 'done' | 'error';
  content: string;
  chunks: Array<string>;
  toolCalls: Array<{
    id: string;
    name: string;
    status: 'pending' | 'running' | 'success' | 'error';
    arguments?: string;
    output?: unknown;
    error?: string;
  }>;
  toolEvents?: Array<import('@/lib/runtime-agent/tool-events').RuntimeToolEvent>;
  diagnostics?: {
    provider?: string;
    model?: string;
    sessionId?: string;
    latencyMs?: number;
    tokenUsage?: {
      input?: number;
      output?: number;
      total?: number;
    };
    raw?: Record<string, unknown>;
  };
  createdAt?: string;
  updatedAt?: string;
};

export type WorkspaceTreeRow = {
  id: string;
  source: 'workspace' | 'notebook';
  sourceKey: string;
  parentPath: string;
  path: string;
  name: string;
  type: TreeNode['type'];
  depth: number;
  order: number;
  modifiedTime?: number;
  readOnly?: boolean;
  iconEmoji?: string;
  node: TreeNode;
  updatedAt?: string;
};

export type AgentConfigRow = AgentConfig & {
  id: string;
  updatedAt?: string;
};

export type LocalSkillRow = LocalSkill & {
  id: string;
  updatedAt?: string;
};

export type ModelCatalogInput = {
  id?: string;
  value?: string;
  name?: string;
  label?: string;
  endpoints?: Array<string>;
  engines?: Array<string>;
  status?: string;
  costMultiplier?: number;
  contextWindow?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type ModelCatalogRow = {
  id: string;
  name: string;
  endpoints: Array<string>;
  engines: Array<string>;
  status: 'active' | 'inactive';
  costMultiplier: number;
  contextWindow?: number;
  createdAt?: string;
  updatedAt?: string;
  order: number;
};

export type RagKnowledgeBaseRow = RagKnowledgeBase & {
  updatedAtIso?: string;
};

export type RagDocumentRow = RagDocument & {
  updatedAtIso?: string;
};

export type RagVectorChunkRow = RagVectorChunk & {
  updatedAtIso?: string;
};

export type ModelProbeRow = ModelProbeSummary & {
  updatedAtIso?: string;
};

export type ModelDiagnosticsRow = {
  id: string;
  engine: string;
  driver: string;
  model: string;
  ok: boolean;
  status: 'passed' | 'failed';
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  overallScore?: number;
  tierLabel?: string;
  error?: string;
  savedAt: string;
  result: ModelDiagnosticsResponse;
};

export const workflowConfigsCollection = createCollection(
  localOnlyCollectionOptions<WorkflowConfigRow, string>({
    id: 'workflow-configs',
    getKey: (item) => item.id,
  }),
);

export const runHistoryCollection = createCollection(
  localOnlyCollectionOptions<RunHistoryRow, string>({
    id: 'run-history',
    getKey: (item) => item.id,
  }),
);

export const documentsMetadataCollection = createCollection(
  localOnlyCollectionOptions<DocumentMetadataRow, string>({
    id: 'documents-metadata',
    getKey: (item) => item.id,
  }),
);

export const workflowEventsCollection = createCollection(
  localOnlyCollectionOptions<WorkflowEventRow, string>({
    id: 'workflow-events',
    getKey: (item) => item.id,
  }),
);

export const workflowStateHistoryCollection = createCollection(
  localOnlyCollectionOptions<WorkflowStateHistoryRow, string>({
    id: 'workflow-state-history',
    getKey: (item) => item.id,
  }),
);

export const workflowStepLogsCollection = createCollection(
  localOnlyCollectionOptions<WorkflowStepLogRow, string>({
    id: 'workflow-step-logs',
    getKey: (item) => item.id,
  }),
);

export const workflowHumanQuestionsCollection = createCollection(
  localOnlyCollectionOptions<WorkflowHumanQuestionRow, string>({
    id: 'workflow-human-questions',
    getKey: (item) => item.id,
  }),
);

export const agentMessagesCollection = createCollection(
  localOnlyCollectionOptions<AgentMessageRow, string>({
    id: 'agent-messages',
    getKey: (item) => item.id,
  }),
);

export const workspaceTreeCollection = createCollection(
  localOnlyCollectionOptions<WorkspaceTreeRow, string>({
    id: 'workspace-tree',
    getKey: (item) => item.id,
  }),
);

export const agentConfigsCollection = createCollection(
  localOnlyCollectionOptions<AgentConfigRow, string>({
    id: 'agent-configs',
    getKey: (item) => item.id,
  }),
);

export const localSkillsCollection = createCollection(
  localOnlyCollectionOptions<LocalSkillRow, string>({
    id: 'local-skills',
    getKey: (item) => item.id,
  }),
);

export const modelCatalogCollection = createCollection(
  localOnlyCollectionOptions<ModelCatalogRow, string>({
    id: 'model-catalog',
    getKey: (item) => item.id,
  }),
);

export const ragKnowledgeBasesCollection = createCollection(
  localOnlyCollectionOptions<RagKnowledgeBaseRow, string>({
    id: 'rag-knowledge-bases',
    getKey: (item) => item.id,
  }),
);

export const ragDocumentsCollection = createCollection(
  localOnlyCollectionOptions<RagDocumentRow, string>({
    id: 'rag-documents',
    getKey: (item) => item.id,
  }),
);

export const ragChunksCollection = createCollection(
  localOnlyCollectionOptions<RagVectorChunkRow, string>({
    id: 'rag-chunks',
    getKey: (item) => item.id,
  }),
);

export const modelProbesCollection = createCollection(
  localOnlyCollectionOptions<ModelProbeRow, string>({
    id: 'model-probes',
    getKey: (item) => item.id,
  }),
);

export const modelDiagnosticsCollection = createCollection(
  localOnlyCollectionOptions<ModelDiagnosticsRow, string>({
    id: 'model-diagnostics',
    getKey: (item) => item.id,
  }),
);

function upsertWorkflowConfig(row: WorkflowConfigRow) {
  if (workflowConfigsCollection.has(row.id)) {
    workflowConfigsCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  workflowConfigsCollection.insert(row);
}

function upsertRunHistory(row: RunHistoryRow) {
  if (runHistoryCollection.has(row.id)) {
    runHistoryCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  runHistoryCollection.insert(row);
}

function upsertDocumentMetadata(row: DocumentMetadataRow) {
  if (documentsMetadataCollection.has(row.id)) {
    documentsMetadataCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  documentsMetadataCollection.insert(row);
}

export function getDocumentMetadataSnapshot(runId?: string): DocumentMetadataRow[] {
  return readCollectionRows<DocumentMetadataRow>(documentsMetadataCollection)
    .filter((row) => !runId || row.runId === runId)
    .map((row) => ({ ...row }));
}

export function restoreDocumentMetadataSnapshot(runId: string, snapshot: DocumentMetadataRow[]) {
  readCollectionRows<DocumentMetadataRow>(documentsMetadataCollection)
    .filter((row) => row.runId === runId)
    .forEach((row) => documentsMetadataCollection.delete(row.id));
  snapshot.forEach((row) => documentsMetadataCollection.insert({ ...row }));
}

export function getDocumentMetadataId(runId: string, reference: RunDocumentReference): string {
  return JSON.stringify([
    runId,
    reference.sourceRunId?.trim() || runId,
    reference.source,
    reference.file,
  ]);
}

export function getDocumentReferenceKey(reference: RunDocumentReference, fallbackRunId = ''): string {
  return JSON.stringify([
    reference.sourceRunId?.trim() || fallbackRunId || null,
    reference.source,
    reference.file,
  ]);
}

function renamedDocumentPath(file: string, newName: string): string {
  const normalizedName = newName.trim();
  const currentBaseName = file.split('/').pop() || file;
  const extension = /\.[^.]+$/.exec(currentBaseName)?.[0] || '';
  const nextBaseName = /\.[^.]+$/.test(normalizedName) ? normalizedName : `${normalizedName}${extension}`;
  const parentPath = file.split('/').slice(0, -1).join('/');
  return parentPath ? `${parentPath}/${nextBaseName}` : nextBaseName;
}

export function optimisticRenameDocumentMetadata(
  runId: string,
  reference: RunDocumentReference,
  newName: string,
): string {
  const sourceRunId = reference.sourceRunId?.trim() || runId;
  const existingId = getDocumentMetadataId(runId, { ...reference, sourceRunId });
  const existing = documentsMetadataCollection.get(existingId);
  const newFilename = renamedDocumentPath(reference.file, newName);
  if (!existing) return newFilename;
  documentsMetadataCollection.delete(existingId);
  const nextRow: DocumentMetadataRow = {
    ...existing,
    id: getDocumentMetadataId(runId, { ...reference, sourceRunId, file: newFilename }),
    documentKey: getDocumentReferenceKey({ ...reference, sourceRunId, file: newFilename }),
    sourceRunId,
    filename: newFilename,
    relativePath: newFilename,
    name: newFilename,
    baseName: newFilename.split('/').pop() || newFilename,
    updatedAt: new Date().toISOString(),
  };
  documentsMetadataCollection.insert(nextRow);
  return newFilename;
}

export function optimisticDeleteDocumentMetadata(runId: string, references: RunDocumentReference[]) {
  const targets = new Set(references.map((reference) => getDocumentMetadataId(runId, reference)));
  readCollectionRows<DocumentMetadataRow>(documentsMetadataCollection)
    .filter((row) => row.runId === runId && targets.has(row.id))
    .forEach((row) => documentsMetadataCollection.delete(row.id));
}

export function upsertWorkflowEvent(row: WorkflowEventRow) {
  if (workflowEventsCollection.has(row.id)) {
    workflowEventsCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  workflowEventsCollection.insert(row);
}

export function upsertWorkflowStateHistory(row: WorkflowStateHistoryRow) {
  if (workflowStateHistoryCollection.has(row.id)) {
    workflowStateHistoryCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  workflowStateHistoryCollection.insert(row);
}

export function upsertWorkflowStepLog(row: WorkflowStepLogRow) {
  if (workflowStepLogsCollection.has(row.id)) {
    workflowStepLogsCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  workflowStepLogsCollection.insert(row);
}

export function upsertWorkflowHumanQuestion(row: WorkflowHumanQuestionRow) {
  if (workflowHumanQuestionsCollection.has(row.id)) {
    workflowHumanQuestionsCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  workflowHumanQuestionsCollection.insert(row);
}

export function upsertAgentMessage(row: AgentMessageRow) {
  if (agentMessagesCollection.has(row.id)) {
    agentMessagesCollection.update(row.id, (draft) => {
      const existingChunks = Array.isArray(draft.chunks) ? [...draft.chunks] : [];
      const nextChunks = Array.isArray(row.chunks) ? row.chunks.filter(Boolean) : [];
      const toolCallsById = new Map<string, AgentMessageRow['toolCalls'][number]>();
      for (const call of draft.toolCalls || []) toolCallsById.set(call.id, call);
      for (const call of row.toolCalls || []) toolCallsById.set(call.id, { ...toolCallsById.get(call.id), ...call });
      Object.assign(draft, {
        ...row,
        createdAt: draft.createdAt || row.createdAt,
        chunks: [...existingChunks, ...nextChunks],
        toolCalls: Array.from(toolCallsById.values()),
        diagnostics: {
          ...(draft.diagnostics || {}),
          ...(row.diagnostics || {}),
          raw: {
            ...(draft.diagnostics?.raw || {}),
            ...(row.diagnostics?.raw || {}),
          },
        },
      });
    });
    return;
  }
  agentMessagesCollection.insert(row);
}

export function upsertWorkspaceTreeRow(row: WorkspaceTreeRow) {
  if (workspaceTreeCollection.has(row.id)) {
    workspaceTreeCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  workspaceTreeCollection.insert(row);
}

function upsertAgentConfig(row: AgentConfigRow) {
  if (agentConfigsCollection.has(row.id)) {
    agentConfigsCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  agentConfigsCollection.insert(row);
}

function hasSameAgentConfigPayload(existing: AgentConfigRow, incoming: AgentConfig) {
  const { id: _id, updatedAt: _updatedAt, ...existingPayload } = existing;
  return JSON.stringify(existingPayload) === JSON.stringify(incoming);
}

function upsertLocalSkill(row: LocalSkillRow) {
  if (localSkillsCollection.has(row.id)) {
    localSkillsCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  localSkillsCollection.insert(row);
}

function upsertModelCatalogRow(row: ModelCatalogRow) {
  if (modelCatalogCollection.has(row.id)) {
    modelCatalogCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  modelCatalogCollection.insert(row);
}

function upsertRagKnowledgeBase(row: RagKnowledgeBaseRow) {
  if (ragKnowledgeBasesCollection.has(row.id)) {
    ragKnowledgeBasesCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  ragKnowledgeBasesCollection.insert(row);
}

function upsertRagDocument(row: RagDocumentRow) {
  if (ragDocumentsCollection.has(row.id)) {
    ragDocumentsCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  ragDocumentsCollection.insert(row);
}

function upsertRagChunk(row: RagVectorChunkRow) {
  if (ragChunksCollection.has(row.id)) {
    ragChunksCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  ragChunksCollection.insert(row);
}

function upsertModelProbe(row: ModelProbeRow) {
  if (modelProbesCollection.has(row.id)) {
    modelProbesCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  modelProbesCollection.insert(row);
}

function upsertModelDiagnostics(row: ModelDiagnosticsRow) {
  if (modelDiagnosticsCollection.has(row.id)) {
    modelDiagnosticsCollection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  modelDiagnosticsCollection.insert(row);
}

type LocalCollection<T extends { id: string }> = {
  has: (id: string) => boolean;
  get?: (id: string) => T | undefined;
  insert: (row: T) => void;
  update?: (id: string, updater: (draft: T) => void) => void;
  delete: (id: string) => void;
  toArray?: Array<T> | (() => Array<T>);
  values?: () => Iterable<T>;
};

function getLocalCollectionSnapshot<T extends { id: string }>(collection: LocalCollection<T>): T[] {
  return readCollectionRows<T>(collection).map((row) => ({ ...row }));
}

function restoreLocalCollectionSnapshot<T extends { id: string }>(collection: LocalCollection<T>, snapshot: T[]) {
  for (const row of readCollectionRows<T>(collection)) {
    if (collection.has(row.id)) collection.delete(row.id);
  }
  snapshot.forEach((row) => collection.insert({ ...row }));
}

export function getAgentConfigsSnapshot() {
  return getLocalCollectionSnapshot<AgentConfigRow>(agentConfigsCollection);
}

export function restoreAgentConfigsSnapshot(snapshot: AgentConfigRow[]) {
  restoreLocalCollectionSnapshot(agentConfigsCollection, snapshot);
}

export function optimisticUpsertAgentConfig(agent: AgentConfig) {
  if (!agent.name) return;
  upsertAgentConfig({ ...agent, id: agent.name, updatedAt: new Date().toISOString() });
}

export function optimisticDeleteAgentConfigs(names: string[]) {
  names.forEach((name) => {
    if (agentConfigsCollection.has(name)) agentConfigsCollection.delete(name);
  });
}

export function getLocalSkillsSnapshot() {
  return getLocalCollectionSnapshot<LocalSkillRow>(localSkillsCollection);
}

export function restoreLocalSkillsSnapshot(snapshot: LocalSkillRow[]) {
  restoreLocalCollectionSnapshot(localSkillsCollection, snapshot);
}

export function optimisticDeleteLocalSkills(names: string[]) {
  names.forEach((name) => {
    if (localSkillsCollection.has(name)) localSkillsCollection.delete(name);
  });
}

export function getModelCatalogSnapshot() {
  return getLocalCollectionSnapshot<ModelCatalogRow>(modelCatalogCollection);
}

export function restoreModelCatalogSnapshot(snapshot: ModelCatalogRow[]) {
  restoreLocalCollectionSnapshot(modelCatalogCollection, snapshot);
}

export function getRagRowsSnapshot() {
  return {
    knowledgeBases: getLocalCollectionSnapshot<RagKnowledgeBaseRow>(ragKnowledgeBasesCollection),
    documents: getLocalCollectionSnapshot<RagDocumentRow>(ragDocumentsCollection),
    chunks: getLocalCollectionSnapshot<RagVectorChunkRow>(ragChunksCollection),
  };
}

export function restoreRagRowsSnapshot(snapshot: ReturnType<typeof getRagRowsSnapshot>) {
  restoreLocalCollectionSnapshot(ragKnowledgeBasesCollection, snapshot.knowledgeBases);
  restoreLocalCollectionSnapshot(ragDocumentsCollection, snapshot.documents);
  restoreLocalCollectionSnapshot(ragChunksCollection, snapshot.chunks);
}

export function optimisticDeleteRagKnowledgeBase(id: string) {
  if (ragKnowledgeBasesCollection.has(id)) ragKnowledgeBasesCollection.delete(id);
  for (const row of readCollectionRows<RagDocumentRow>(ragDocumentsCollection)) {
    if (row.knowledgeBaseId === id && ragDocumentsCollection.has(row.id)) ragDocumentsCollection.delete(row.id);
  }
  for (const row of readCollectionRows<RagVectorChunkRow>(ragChunksCollection)) {
    if (row.knowledgeBaseId === id && ragChunksCollection.has(row.id)) ragChunksCollection.delete(row.id);
  }
}

export function optimisticDeleteRagDocument(knowledgeBaseId: string, documentId: string) {
  if (ragDocumentsCollection.has(documentId)) ragDocumentsCollection.delete(documentId);
  for (const row of readCollectionRows<RagVectorChunkRow>(ragChunksCollection)) {
    if (row.knowledgeBaseId === knowledgeBaseId && row.documentId === documentId && ragChunksCollection.has(row.id)) {
      ragChunksCollection.delete(row.id);
    }
  }
}

export function optimisticDeleteRagRows(knowledgeBaseId: string, rowIds?: string[], all?: boolean) {
  const ids = new Set(rowIds || []);
  for (const row of readCollectionRows<RagVectorChunkRow>(ragChunksCollection)) {
    if (row.knowledgeBaseId !== knowledgeBaseId) continue;
    if (!all && !ids.has(row.id)) continue;
    if (ragChunksCollection.has(row.id)) ragChunksCollection.delete(row.id);
  }
}

const optimisticDeletedWorkflowConfigIds = new Set<string>();

export function getWorkflowConfigSnapshot(id: string): WorkflowConfigRow | undefined {
  const row = workflowConfigsCollection.get(id);
  return row ? stripCollectionMetadata(row) : undefined;
}

export function optimisticDeleteWorkflowConfig(id: string): WorkflowConfigRow | undefined {
  const snapshot = getWorkflowConfigSnapshot(id);
  optimisticDeletedWorkflowConfigIds.add(id);
  if (workflowConfigsCollection.has(id)) {
    workflowConfigsCollection.delete(id);
  }
  return snapshot;
}

export function restoreWorkflowConfigSnapshot(snapshot: WorkflowConfigRow | undefined, id?: string) {
  const configId = snapshot?.id || id;
  if (configId) optimisticDeletedWorkflowConfigIds.delete(configId);
  if (snapshot) {
    upsertWorkflowConfig(snapshot);
  }
}

export function finalizeWorkflowConfigDelete(id: string) {
  optimisticDeletedWorkflowConfigIds.delete(id);
}

export function syncWorkflowConfigsToDb(configs: Array<WorkflowConfigSummary>) {
  configs.forEach((config) => {
    if (optimisticDeletedWorkflowConfigIds.has(config.filename)) return;
    upsertWorkflowConfig({
      id: config.filename,
      filename: config.filename,
      name: config.name,
      description: config.description,
      mode: config.mode,
      kind: config.kind,
      profile: config.profile,
      stateCount: config.stateCount,
      stepCount: config.stepCount,
      agentCount: config.agentCount,
      createdAt: config.createdAt,
      visibility: config.visibility,
      ownerName: config.ownerName,
      updatedAt: new Date().toISOString(),
    });
  });
}

export function syncRunHistoryToDb(runs: Array<RunHistoryItem>) {
  const visit = (run: RunHistoryItem) => {
    upsertRunHistory({
      id: run.id,
      configFile: run.configFile,
      configName: run.configName,
      status: run.status,
      startTime: run.startTime,
      endTime: run.endTime,
      currentPhase: run.currentPhase,
      totalSteps: run.totalSteps,
      completedSteps: run.completedSteps,
      totalTokens: run.totalTokens,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      cacheCreationInputTokens: run.cacheCreationInputTokens,
      cacheReadInputTokens: run.cacheReadInputTokens,
      cost: run.cost,
      ownerId: run.ownerId,
      ownerName: run.ownerName,
      parentStateName: run.parentStateName,
      parentStepName: run.parentStepName,
      parentRunId: run.parentRunId,
      rootRunId: run.rootRunId,
      childRunIds: run.childRunIds,
    });
    if (Array.isArray(run.childRuns)) {
      run.childRuns.forEach(visit);
    }
  };
  runs.forEach(visit);
}

export function syncDocumentsMetadataToDb(runId: string, files: Array<unknown>) {
  if (!runId) return;
  files.forEach((input) => {
    const file = asRecord(input);
    const documentSource = documentSourceValue(file.documentSource);
    if (!documentSource) return;
    const sourceRunId = stringValue(file.sourceRunId) || runId;
    const filename = stringValue(file.relativePath) || stringValue(file.filename) || stringValue(file.name) || stringValue(file.baseName);
    if (!filename) return;
    const reference = { source: documentSource, sourceRunId, file: filename };
    upsertDocumentMetadata({
      id: getDocumentMetadataId(runId, reference),
      runId,
      sourceRunId,
      documentSource,
      documentKey: getDocumentReferenceKey(reference),
      filename,
      relativePath: filename,
      documentSourceLabel: stringValue(file.documentSourceLabel),
      documentDirectory: stringValue(file.documentDirectory),
      name: stringValue(file.name) || filename,
      baseName: stringValue(file.baseName),
      logicalName: stringValue(file.logicalName),
      stepName: stringValue(file.stepName),
      iteration: numberValue(file.iteration) ?? null,
      agent: stringValue(file.agent),
      phaseName: stringValue(file.phaseName),
      role: stringValue(file.role),
      size: numberValue(file.size),
      modifiedTime: stringValue(file.modifiedTime),
      documentKind: stringValue(file.documentKind),
      groupKey: stringValue(file.groupKey),
      groupLabel: stringValue(file.groupLabel),
      detailCount: numberValue(file.detailCount),
      sourceConfigFile: stringValue(file.sourceConfigFile),
      sourceLabel: stringValue(file.sourceLabel),
      parentRunId: stringValue(file.parentRunId) ?? null,
      rootRunId: stringValue(file.rootRunId) ?? null,
      updatedAt: new Date().toISOString(),
    });
  });
}

export function syncWorkflowEventsToDb(runId: string, events: Array<Record<string, unknown>>) {
  if (!runId) return;
  events.forEach((event, index) => {
    const payload = asRecord(event.payload || event.data);
    const seq = numberValue(event.seq) ?? index;
    upsertWorkflowEvent({
      id: `${runId}:${seq}`,
      runId,
      seq,
      type: stringValue(event.type) || stringValue(event.event) || 'event',
      timestamp: stringValue(event.timestamp) || stringValue(event.time),
      state: stringValue(event.state) || stringValue(payload.state) || stringValue(payload.stateName),
      step: stringValue(event.step) || stringValue(payload.step) || stringValue(payload.stepName),
      agent: stringValue(event.agent) || stringValue(payload.agent),
      message: stringValue(event.message) || stringValue(payload.message) || stringValue(payload.summary),
      payload,
    });
  });
}

export function syncWorkflowStateHistoryToDb(runId: string, items: Array<Record<string, unknown>>, offset = 0) {
  if (!runId) return;
  items.forEach((item, index) => {
    const absoluteIndex = offset + index;
    const payload = asRecord(item);
    upsertWorkflowStateHistory({
      id: stringValue(item.id) || `${runId}:state:${absoluteIndex}`,
      runId,
      index: absoluteIndex,
      timestamp: stringValue(item.timestamp) || stringValue(item.time) || stringValue(item.createdAt),
      fromState: stringValue(item.fromState) || stringValue(item.previousState),
      toState: stringValue(item.toState) || stringValue(item.nextState),
      state: stringValue(item.state) || stringValue(item.currentState) || stringValue(item.stateName),
      step: stringValue(item.step) || stringValue(item.stepName) || stringValue(item.currentStep),
      status: stringValue(item.status),
      reason: stringValue(item.reason) || stringValue(item.message),
      summary: stringValue(item.summary),
      payload,
    });
  });
}

export function syncWorkflowStepLogsToDb(runId: string, logs: Array<Record<string, unknown>>, offset = 0) {
  if (!runId) return;
  logs.forEach((log, index) => {
    const absoluteIndex = offset + index;
    const id = stringValue(log.id) || `${runId}:step-log:${absoluteIndex}`;
    upsertWorkflowStepLog({
      id,
      runId,
      index: absoluteIndex,
      stepName: stringValue(log.stepName) || stringValue(log.step) || stringValue(log.name),
      agent: stringValue(log.agent),
      status: stringValue(log.status),
      timestamp: stringValue(log.timestamp) || stringValue(log.createdAt),
      durationMs: numberValue(log.durationMs),
      costUsd: numberValue(log.costUsd) ?? numberValue(log.cost),
      engineName: stringValue(log.engineName),
      sessionId: stringValue(log.sessionId) ?? null,
      childRunId: stringValue(log.childRunId),
      childStatus: stringValue(log.childStatus),
      outputRef: stringValue(log.outputRef),
      outputBytes: numberValue(log.outputBytes),
      outputPreview: previewText(log.output),
      errorPreview: previewText(log.error),
      payload: asRecord(log),
    });
  });
}

export function syncWorkflowHumanQuestionsToDb(questions: Array<HumanQuestion>) {
  questions.forEach((question) => {
    upsertWorkflowHumanQuestion({
      id: question.id,
      runId: question.runId,
      configFile: question.configFile,
      status: question.status,
      kind: question.kind,
      title: question.title,
      message: question.message,
      createdAt: question.createdAt,
      answeredAt: question.answeredAt,
      currentState: question.currentState,
      previousState: question.previousState,
      suggestedNextState: question.suggestedNextState,
      requiresWorkflowPause: question.requiresWorkflowPause,
      workflowFrontendSessionId: question.workflowFrontendSessionId,
      sourceRunId: question.sourceRunId,
      sourceConfigFile: question.sourceConfigFile,
      answerSchema: asRecord(question.answerSchema),
      answer: asRecord(question.answer),
      source: asRecord(question.source),
    });
  });
}

export function syncWorkspaceTreeToDb(input: {
  source: WorkspaceTreeRow['source'];
  sourceKey: string;
  tree: Array<TreeNode>;
  rootPath?: string;
  orderOffset?: number;
  replaceParents?: boolean;
}) {
  const sourceKey = String(input.sourceKey || '').trim();
  if (!sourceKey) return;
  const updatedAt = new Date().toISOString();
  const incomingIdsByParent = new Map<string, Set<string>>();
  incomingIdsByParent.set(normalizeTreePath(input.rootPath), new Set<string>());
  const visit = (nodes: Array<TreeNode>, parentPath: string, depth: number) => {
    nodes.forEach((node, order) => {
      const path = normalizeTreePath(node.path) || node.path || node.name;
      const normalizedParent = normalizeTreePath(parentPath);
      const id = workspaceTreeRowId(input.source, sourceKey, path);
      const incomingIds = incomingIdsByParent.get(normalizedParent) || new Set<string>();
      incomingIds.add(id);
      incomingIdsByParent.set(normalizedParent, incomingIds);
      const row: WorkspaceTreeRow = {
        id,
        source: input.source,
        sourceKey,
        parentPath: normalizedParent,
        path,
        name: node.name,
        type: node.type,
        depth,
        order: depth === 0 ? (input.orderOffset || 0) + order : order,
        modifiedTime: node.modifiedTime,
        readOnly: node.readOnly,
        iconEmoji: node.iconEmoji,
        node,
        updatedAt,
      };
      upsertWorkspaceTreeRow(row);
      if (Array.isArray(node.children) && node.children.length > 0) {
        visit(node.children, path, depth + 1);
      }
    });
  };
  visit(input.tree, normalizeTreePath(input.rootPath), 0);
  if (input.replaceParents) {
    let deleted = false;
    for (const row of readCollectionRows<WorkspaceTreeRow>(workspaceTreeCollection)) {
      if (row.source !== input.source || row.sourceKey !== sourceKey) continue;
      const incomingIds = incomingIdsByParent.get(row.parentPath);
      if (!incomingIds || incomingIds.has(row.id)) continue;
      if (workspaceTreeCollection.has(row.id)) {
        workspaceTreeCollection.delete(row.id);
        deleted = true;
      }
    }
  }
}

export function syncAgentConfigsToDb(agents: Array<AgentConfig>) {
  const seen = new Set<string>();
  agents.forEach((agent) => {
    if (!agent.name) return;
    seen.add(agent.name);
    const existing = agentConfigsCollection.get(agent.name);
    if (existing && hasSameAgentConfigPayload(stripCollectionMetadata(existing), agent)) return;
    upsertAgentConfig({
      ...agent,
      id: agent.name,
      updatedAt: new Date().toISOString(),
    });
  });
  let deleted = false;
  for (const row of readCollectionRows<AgentConfigRow>(agentConfigsCollection)) {
    if (seen.has(row.id)) continue;
    if (agentConfigsCollection.has(row.id)) {
      agentConfigsCollection.delete(row.id);
      deleted = true;
    }
  }
}

export function syncLocalSkillsToDb(skills: Array<LocalSkill>) {
  const seen = new Set<string>();
  skills.forEach((skill) => {
    if (!skill.name) return;
    seen.add(skill.name);
    upsertLocalSkill({
      ...skill,
      id: skill.name,
      updatedAt: skill.updatedAt,
    });
  });
  let deleted = false;
  for (const row of readCollectionRows<LocalSkillRow>(localSkillsCollection)) {
    if (seen.has(row.id)) continue;
    if (localSkillsCollection.has(row.id)) {
      localSkillsCollection.delete(row.id);
      deleted = true;
    }
  }
}

export function syncModelCatalogToDb(models: Array<ModelCatalogInput>) {
  const seen = new Set<string>();
  models.forEach((model, index) => {
    const id = String(model.id || model.value || '').trim();
    if (!id) return;
    seen.add(id);
    upsertModelCatalogRow({
      id,
      name: String(model.name || model.label || id),
      endpoints: Array.isArray(model.endpoints) && model.endpoints.length > 0 ? model.endpoints : [...DEFAULT_MODEL_ENDPOINTS],
      engines: Array.isArray(model.engines) ? model.engines : [],
      status: model.status === 'inactive' ? 'inactive' : 'active',
      costMultiplier: Number.isFinite(Number(model.costMultiplier)) ? Number(model.costMultiplier) : 1,
      contextWindow: Number.isFinite(Number(model.contextWindow)) && Number(model.contextWindow) > 0
        ? Number(model.contextWindow)
        : DEFAULT_MODEL_CONTEXT_WINDOW,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
      order: index,
    });
  });
  let deleted = false;
  for (const row of readCollectionRows<ModelCatalogRow>(modelCatalogCollection)) {
    if (seen.has(row.id)) continue;
    if (modelCatalogCollection.has(row.id)) {
      modelCatalogCollection.delete(row.id);
      deleted = true;
    }
  }
}

export function syncModelProbesToDb(response: ModelProbeListResponse | null | undefined) {
  const probes = response?.probes || [];
  const seen = new Set<string>();
  const updatedAtIso = new Date().toISOString();
  probes.forEach((probe) => {
    if (!probe.id) return;
    seen.add(probe.id);
    upsertModelProbe({ ...probe, updatedAtIso });
  });
  for (const row of readCollectionRows<ModelProbeRow>(modelProbesCollection)) {
    if (seen.has(row.id)) continue;
    if (modelProbesCollection.has(row.id)) {
      modelProbesCollection.delete(row.id);
    }
  }
}

export function syncModelDiagnosticsResultToDb(result: ModelDiagnosticsResponse | null | undefined, savedAt = new Date().toISOString()) {
  if (!result) return;
  const id = `${result.engine || 'engine'}:${result.driver || 'auto'}:${result.model || 'model'}:${result.startedAt || savedAt}`;
  upsertModelDiagnostics({
    id,
    engine: result.engine,
    driver: result.driver,
    model: result.model,
    ok: result.ok,
    status: result.ok ? 'passed' : 'failed',
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    totalDurationMs: result.totalDurationMs,
    overallScore: result.modelEvaluation?.overallScore,
    tierLabel: result.modelEvaluation?.tierLabel,
    error: result.error,
    savedAt,
    result,
  });
}

export function syncRagKnowledgeBasesToDb(knowledgeBases: Array<RagKnowledgeBase>) {
  const seen = new Set<string>();
  knowledgeBases.forEach((knowledgeBase) => {
    if (!knowledgeBase.id) return;
    seen.add(knowledgeBase.id);
    upsertRagKnowledgeBase({
      ...knowledgeBase,
      updatedAtIso: new Date().toISOString(),
    });
  });
  let deleted = false;
  for (const row of readCollectionRows<RagKnowledgeBaseRow>(ragKnowledgeBasesCollection)) {
    if (seen.has(row.id)) continue;
    if (ragKnowledgeBasesCollection.has(row.id)) {
      ragKnowledgeBasesCollection.delete(row.id);
      deleted = true;
    }
  }
}

export function syncRagDetailRowsToDb(knowledgeBaseId: string, documents: Array<RagDocument>, chunks: Array<RagVectorChunk>) {
  if (!knowledgeBaseId) return;
  const updatedAtIso = new Date().toISOString();
  const seenDocuments = new Set<string>();
  documents.forEach((document) => {
    if (!document.id) return;
    seenDocuments.add(document.id);
    upsertRagDocument({ ...document, updatedAtIso });
  });
  const seenChunks = new Set<string>();
  chunks.forEach((chunk) => {
    if (!chunk.id) return;
    seenChunks.add(chunk.id);
    upsertRagChunk({ ...chunk, updatedAtIso });
  });

  let deleted = false;
  for (const row of readCollectionRows<RagDocumentRow>(ragDocumentsCollection)) {
    if (row.knowledgeBaseId !== knowledgeBaseId || seenDocuments.has(row.id)) continue;
    if (ragDocumentsCollection.has(row.id)) {
      ragDocumentsCollection.delete(row.id);
      deleted = true;
    }
  }
  for (const row of readCollectionRows<RagVectorChunkRow>(ragChunksCollection)) {
    if (row.knowledgeBaseId !== knowledgeBaseId || seenChunks.has(row.id)) continue;
    if (ragChunksCollection.has(row.id)) {
      ragChunksCollection.delete(row.id);
      deleted = true;
    }
  }
}

export function useSyncWorkflowConfigsToDb(configs: Array<WorkflowConfigSummary>) {
  useEffect(() => {
    syncWorkflowConfigsToDb(configs);
  }, [configs]);
}

export function useSyncRunHistoryToDb(runs: Array<RunHistoryItem>) {
  useEffect(() => {
    syncRunHistoryToDb(runs);
  }, [runs]);
}

export function useSyncDocumentsMetadataToDb(runId: string | undefined, files: Array<unknown>) {
  useEffect(() => {
    if (runId) syncDocumentsMetadataToDb(runId, files);
  }, [runId, files]);
}

export function useSyncWorkflowEventsToDb(runId: string | undefined, events: Array<Record<string, unknown>>) {
  useEffect(() => {
    if (runId) syncWorkflowEventsToDb(runId, events);
  }, [runId, events]);
}

export function useSyncWorkflowStateHistoryToDb(runId: string | undefined, items: Array<Record<string, unknown>>, offset = 0) {
  useEffect(() => {
    if (runId) syncWorkflowStateHistoryToDb(runId, items, offset);
  }, [runId, items, offset]);
}

export function useSyncWorkflowStepLogsToDb(runId: string | undefined, logs: Array<Record<string, unknown>>, offset = 0) {
  useEffect(() => {
    if (runId) syncWorkflowStepLogsToDb(runId, logs, offset);
  }, [runId, logs, offset]);
}

export function useSyncWorkflowHumanQuestionsToDb(questions: Array<HumanQuestion>) {
  useEffect(() => {
    syncWorkflowHumanQuestionsToDb(questions);
  }, [questions]);
}

export function useSyncWorkspaceTreeToDb(input: {
  source: WorkspaceTreeRow['source'];
  sourceKey: string;
  tree?: Array<TreeNode>;
  rootPath?: string;
  orderOffset?: number;
  replaceParents?: boolean;
}) {
  useEffect(() => {
    if (input.tree) {
      syncWorkspaceTreeToDb({
        source: input.source,
        sourceKey: input.sourceKey,
        tree: input.tree,
        rootPath: input.rootPath,
        orderOffset: input.orderOffset,
        replaceParents: input.replaceParents,
      });
    }
  }, [input.source, input.sourceKey, input.tree, input.rootPath, input.orderOffset, input.replaceParents]);
}

export function useSyncAgentConfigsToDb(agents: Array<AgentConfig>) {
  useEffect(() => {
    startTransition(() => {
      syncAgentConfigsToDb(agents);
    });
  }, [agents]);
}

export function useSyncLocalSkillsToDb(skills: Array<LocalSkill>) {
  useEffect(() => {
    syncLocalSkillsToDb(skills);
  }, [skills]);
}

export function useSyncModelCatalogToDb(models: Array<ModelCatalogInput>) {
  useEffect(() => {
    syncModelCatalogToDb(models);
  }, [models]);
}

export function useSyncModelProbesToDb(response: ModelProbeListResponse | null | undefined) {
  useEffect(() => {
    syncModelProbesToDb(response);
  }, [response]);
}

export function useSyncRagKnowledgeBasesToDb(knowledgeBases: Array<RagKnowledgeBase>) {
  useEffect(() => {
    syncRagKnowledgeBasesToDb(knowledgeBases);
  }, [knowledgeBases]);
}

export function useSyncRagDetailRowsToDb(knowledgeBaseId: string | undefined, detail: { documents?: Array<RagDocument>; chunks?: Array<RagVectorChunk> } | undefined) {
  useEffect(() => {
    if (knowledgeBaseId && detail) {
      syncRagDetailRowsToDb(knowledgeBaseId, detail.documents || [], detail.chunks || []);
    }
  }, [knowledgeBaseId, detail]);
}

export function useWorkflowConfigRows(params: Pick<ConfigListParams, 'keyword' | 'mode' | 'sortKey' | 'sortDirection'>) {
  const rows = useLiveCollectionRows<WorkflowConfigRow>(workflowConfigsCollection);
  return useMemo(() => deriveWorkflowConfigRows(rows, params), [rows, params.keyword, params.mode, params.sortKey, params.sortDirection]);
}

export function useDocumentMetadataRows(runId?: string) {
  const rows = useLiveCollectionRows<DocumentMetadataRow>(documentsMetadataCollection);
  return useMemo(() => {
    return rows
      .filter((row) => (!runId || row.runId === runId) && Boolean(documentSourceValue(row.documentSource)))
      .sort((left, right) => toTime(right.modifiedTime || right.updatedAt) - toTime(left.modifiedTime || left.updatedAt));
  }, [rows, runId]);
}

export function useWorkflowEventRows(runId?: string) {
  const rows = useLiveCollectionRows<WorkflowEventRow>(workflowEventsCollection);
  return useMemo(() => {
    return rows
      .filter((row) => !runId || row.runId === runId)
      .sort((left, right) => left.seq - right.seq);
  }, [rows, runId]);
}

export function useWorkflowStateHistoryRows(runId?: string) {
  const rows = useLiveCollectionRows<WorkflowStateHistoryRow>(workflowStateHistoryCollection);
  return useMemo(() => {
    return rows
      .filter((row) => !runId || row.runId === runId)
      .sort((left, right) => left.index - right.index);
  }, [rows, runId]);
}

export function useWorkflowStepLogRows(runId?: string) {
  const rows = useLiveCollectionRows<WorkflowStepLogRow>(workflowStepLogsCollection);
  return useMemo(() => {
    return rows
      .filter((row) => !runId || row.runId === runId)
      .sort((left, right) => left.index - right.index);
  }, [rows, runId]);
}

export function useWorkflowHumanQuestionRows(filters: {
  runId?: string;
  configFile?: string;
  status?: HumanQuestion['status'];
} = {}) {
  const rows = useLiveCollectionRows<WorkflowHumanQuestionRow>(workflowHumanQuestionsCollection);
  return useMemo(() => {
    return rows
      .filter((row) => !filters.runId || row.runId === filters.runId)
      .filter((row) => !filters.configFile || row.configFile === filters.configFile)
      .filter((row) => !filters.status || row.status === filters.status)
      .sort((left, right) => toTime(right.createdAt) - toTime(left.createdAt));
  }, [rows, filters.runId, filters.configFile, filters.status]);
}

export function useAgentMessageRows(filters?: string | {
  runId?: string;
  stepKey?: string;
  frontendSessionId?: string;
  streamScope?: string;
}) {
  const rows = useLiveCollectionRows<AgentMessageRow>(agentMessagesCollection);
  const runId = typeof filters === 'string' ? filters : filters?.runId;
  const stepKey = typeof filters === 'string' ? undefined : filters?.stepKey;
  const frontendSessionId = typeof filters === 'string' ? undefined : filters?.frontendSessionId;
  const streamScope = typeof filters === 'string' ? undefined : filters?.streamScope;
  return useMemo(() => {
    return rows
      .filter((row) => !runId || row.runId === runId)
      .filter((row) => !stepKey || row.stepKey === stepKey)
      .filter((row) => !frontendSessionId || row.diagnostics?.raw?.frontendSessionId === frontendSessionId)
      .filter((row) => !streamScope || row.diagnostics?.raw?.streamScope === streamScope)
      .sort((left, right) => toTime(left.createdAt) - toTime(right.createdAt));
  }, [rows, runId, stepKey, frontendSessionId, streamScope]);
}

export function useWorkspaceTreeRows(filters: {
  source: WorkspaceTreeRow['source'];
  sourceKey: string;
  parentPath?: string;
}) {
  const rows = useLiveCollectionRows<WorkspaceTreeRow>(workspaceTreeCollection);
  return useMemo(() => {
    return deriveWorkspaceTreeRows(rows, filters);
  }, [rows, filters.source, filters.sourceKey, filters.parentPath]);
}

export function useAgentConfigRows(filters: {
  keyword?: string;
  group?: string;
  team?: string;
  category?: string;
  tags?: Array<string>;
}) {
  const rows = useLiveCollectionRows<AgentConfigRow>(agentConfigsCollection);
  return useMemo(() => {
    return deriveAgentConfigRows(rows, filters);
  }, [rows, filters.keyword, filters.group, filters.team, filters.category, JSON.stringify(filters.tags || [])]);
}

export function useLocalSkillRows(filters: {
  keyword?: string;
  source?: string;
  tags?: Array<string>;
  sortKey?: 'name' | 'updatedAt' | 'source';
  sortDirection?: 'asc' | 'desc';
}) {
  const rows = useLiveCollectionRows<LocalSkillRow>(localSkillsCollection);
  return useMemo(() => {
    return deriveLocalSkillRows(rows, filters);
  }, [rows, filters.keyword, filters.source, JSON.stringify(filters.tags || []), filters.sortKey, filters.sortDirection]);
}

export function useModelCatalogRows(filters: {
  keyword?: string;
  endpoints?: Array<string>;
  engines?: Array<string>;
  statuses?: Array<string>;
}) {
  const rows = useLiveCollectionRows<ModelCatalogRow>(modelCatalogCollection);
  return useMemo(() => {
    return deriveModelCatalogRows(rows, filters);
  }, [rows, filters.keyword, JSON.stringify(filters.endpoints || []), JSON.stringify(filters.engines || []), JSON.stringify(filters.statuses || [])]);
}

export function useRagKnowledgeBaseRows() {
  const rows = useLiveCollectionRows<RagKnowledgeBaseRow>(ragKnowledgeBasesCollection);
  return useMemo(() => deriveRagKnowledgeBaseRows(rows), [rows]);
}

export function useRagDocumentRows(knowledgeBaseId: string | undefined) {
  const rows = useLiveCollectionRows<RagDocumentRow>(ragDocumentsCollection);
  return useMemo(() => deriveRagDocumentRows(rows, knowledgeBaseId), [rows, knowledgeBaseId]);
}

export function useRagChunkRows(filters: {
  knowledgeBaseId?: string;
  documentId?: string;
  keyword?: string;
}) {
  const rows = useLiveCollectionRows<RagVectorChunkRow>(ragChunksCollection);
  return useMemo(() => deriveRagChunkRows(rows, filters), [rows, filters.knowledgeBaseId, filters.documentId, filters.keyword]);
}

export function useModelProbeRows() {
  const rows = useLiveCollectionRows<ModelProbeRow>(modelProbesCollection);
  return useMemo(() => [...rows].sort((left, right) => {
    const leftTime = toTime(left.updatedAt) || toTime(left.updatedAtIso);
    const rightTime = toTime(right.updatedAt) || toTime(right.updatedAtIso);
    return rightTime - leftTime;
  }), [rows]);
}

export function useModelDiagnosticsRows() {
  const rows = useLiveCollectionRows<ModelDiagnosticsRow>(modelDiagnosticsCollection);
  return useMemo(() => [...rows].sort((left, right) => toTime(right.savedAt || right.finishedAt) - toTime(left.savedAt || left.finishedAt)), [rows]);
}

export function useRunHistoryRows(params: Pick<RunHistoryParams, 'keyword' | 'ownerId' | 'sortKey' | 'sortDirection'>) {
  const rows = useLiveCollectionRows<RunHistoryRow>(runHistoryCollection);
  return useMemo(() => deriveRunHistoryRows(rows, params), [rows, params.keyword, params.ownerId, params.sortKey, params.sortDirection]);
}

function useLiveCollectionRows<T extends object>(collection: unknown): Array<T> {
  if (typeof window === 'undefined') {
    return readCollectionRows(collection as any) as Array<T>;
  }
  const { data } = useLiveQuery(collection as any);
  return useMemo(() => (data || []).map(stripCollectionMetadata) as Array<T>, [data]);
}

function readCollectionRows<T>(collection: { toArray?: Array<T> | (() => Array<T>); values?: () => Iterable<T> }): Array<T> {
  if (Array.isArray(collection.toArray)) return collection.toArray.map(stripCollectionMetadata);
  if (typeof collection.toArray === 'function') return collection.toArray().map(stripCollectionMetadata);
  if (typeof collection.values === 'function') return Array.from(collection.values()).map(stripCollectionMetadata);
  return [];
}

function stripCollectionMetadata<T>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  const {
    $synced: _synced,
    $origin: _origin,
    $key: _key,
    $collectionId: _collectionId,
    ...rest
  } = row as T & Record<string, unknown>;
  return rest as T;
}

function normalizeLocalSkillSource(skill: Pick<LocalSkillRow, 'source'>): string {
  return skill.source?.trim() === 'anthropics' ? 'anthropics' : 'ace-custom';
}

export function deriveLocalSkillRows(
  rows: Array<LocalSkillRow>,
  filters: {
    keyword?: string;
    source?: string;
    tags?: Array<string>;
    sortKey?: 'name' | 'updatedAt' | 'source';
    sortDirection?: 'asc' | 'desc';
  },
) {
  const keyword = (filters.keyword || '').trim().toLowerCase();
  const source = filters.source && filters.source !== 'all' ? filters.source : '';
  const tags = filters.tags || [];
  const direction = filters.sortDirection === 'asc' ? 1 : -1;
  return rows
    .filter((skill) => {
      if (source && normalizeLocalSkillSource(skill) !== source) return false;
      if (tags.length > 0 && !tags.some((tag) => skill.tags?.includes(tag))) return false;
      if (!keyword) return true;
      return (
        skill.name.toLowerCase().includes(keyword)
        || skill.description.toLowerCase().includes(keyword)
        || (skill.descriptionZh || '').toLowerCase().includes(keyword)
        || skill.tags?.some((tag) => tag.toLowerCase().includes(keyword))
      );
    })
    .sort((left, right) => {
      let value = 0;
      if (filters.sortKey === 'name') {
        value = left.name.localeCompare(right.name, 'zh-CN');
      } else if (filters.sortKey === 'source') {
        value = normalizeLocalSkillSource(left).localeCompare(normalizeLocalSkillSource(right), 'zh-CN');
      } else {
        value = (Date.parse(left.updatedAt || '') || 0) - (Date.parse(right.updatedAt || '') || 0);
      }
      return value * direction;
    });
}

export function deriveModelCatalogRows(
  rows: Array<ModelCatalogRow>,
  filters: {
    keyword?: string;
    endpoints?: Array<string>;
    engines?: Array<string>;
    statuses?: Array<string>;
  },
) {
  const keyword = (filters.keyword || '').trim().toLowerCase();
  const endpoints = filters.endpoints || [];
  const engines = filters.engines || [];
  const statuses = filters.statuses || [];
  return rows
    .filter((model) => {
      if (keyword) {
        const matchesKeyword = model.name.toLowerCase().includes(keyword)
          || model.id.toLowerCase().includes(keyword)
          || model.endpoints.some((endpoint) => endpoint.toLowerCase().includes(keyword))
          || model.engines.some((engine) => engine.toLowerCase().includes(keyword));
        if (!matchesKeyword) return false;
      }
      if (endpoints.length > 0 && !model.endpoints.some((endpoint) => endpoints.includes(endpoint))) return false;
      if (engines.length > 0 && !model.engines.some((engine) => engines.includes(engine))) return false;
      if (statuses.length > 0 && !statuses.includes(model.status)) return false;
      return true;
    })
    .sort((left, right) => left.order - right.order);
}

export function deriveRagKnowledgeBaseRows(rows: Array<RagKnowledgeBaseRow>) {
  return [...rows].sort((left, right) => {
    const leftUpdated = Number(left.updatedAt || left.createdAt || 0);
    const rightUpdated = Number(right.updatedAt || right.createdAt || 0);
    return rightUpdated - leftUpdated || left.name.localeCompare(right.name);
  });
}

export function deriveRagDocumentRows(rows: Array<RagDocumentRow>, knowledgeBaseId: string | undefined) {
  return rows
    .filter((row) => !knowledgeBaseId || row.knowledgeBaseId === knowledgeBaseId)
    .sort((left, right) => right.createdAt - left.createdAt || left.title.localeCompare(right.title));
}

export function deriveRagChunkRows(
  rows: Array<RagVectorChunkRow>,
  filters: {
    knowledgeBaseId?: string;
    documentId?: string;
    keyword?: string;
  },
) {
  const keyword = (filters.keyword || '').trim().toLowerCase();
  return rows
    .filter((row) => {
      if (filters.knowledgeBaseId && row.knowledgeBaseId !== filters.knowledgeBaseId) return false;
      if (filters.documentId && row.documentId !== filters.documentId) return false;
      if (!keyword) return true;
      return row.text.toLowerCase().includes(keyword)
        || row.sourceTitle.toLowerCase().includes(keyword)
        || row.sourceSystem.toLowerCase().includes(keyword)
        || row.externalId.toLowerCase().includes(keyword)
        || row.metadataJson.toLowerCase().includes(keyword);
    })
    .sort((left, right) => left.chunkIndex - right.chunkIndex || left.id.localeCompare(right.id));
}

export function deriveWorkflowConfigRows(
  rows: Array<WorkflowConfigRow>,
  params: Pick<ConfigListParams, 'keyword' | 'mode' | 'sortKey' | 'sortDirection'>,
) {
  const keyword = (params.keyword || '').trim().toLowerCase();
  const mode = params.mode && params.mode !== 'all' ? params.mode : '';
  const direction = params.sortDirection === 'asc' ? 1 : -1;
  return rows
    .filter((row) => {
      const matchesKeyword = !keyword
        || row.name.toLowerCase().includes(keyword)
        || row.filename.toLowerCase().includes(keyword)
        || (row.description || '').toLowerCase().includes(keyword);
      const kind = row.kind || (row.profile === 'lightweight' ? 'lightweight' : 'state-machine');
      const matchesMode = !mode || kind === mode;
      return matchesKeyword && matchesMode;
    })
    .sort((left, right) => {
      if (params.sortKey === 'name') {
        return left.name.localeCompare(right.name) * direction;
      }
      return (toTime(left.createdAt) - toTime(right.createdAt)) * direction;
    });
}

export function deriveRunHistoryRows(
  rows: Array<RunHistoryRow>,
  params: Pick<RunHistoryParams, 'keyword' | 'ownerId' | 'sortKey' | 'sortDirection'>,
) {
  const keyword = (params.keyword || '').trim().toLowerCase();
  const ownerIds = (params.ownerId && params.ownerId !== 'all' ? params.ownerId : '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const direction = params.sortDirection === 'asc' ? 1 : -1;
  return rows
    .filter((row) => {
      const matchesKeyword = !keyword
        || row.configName.toLowerCase().includes(keyword)
        || row.configFile.toLowerCase().includes(keyword)
        || row.status.toLowerCase().includes(keyword);
      const matchesOwner = ownerIds.length === 0 || ownerIds.includes(row.ownerId);
      return matchesKeyword && matchesOwner;
    })
    .sort((left, right) => compareRunRows(left, right, params.sortKey || 'startTime') * direction);
}

export function deriveWorkspaceTreeRows(
  rows: Array<WorkspaceTreeRow>,
  filters: {
    source: WorkspaceTreeRow['source'];
    sourceKey: string;
    parentPath?: string;
  },
) {
  const parentPath = normalizeTreePath(filters.parentPath);
  return rows
    .filter((row) => row.source === filters.source)
    .filter((row) => row.sourceKey === filters.sourceKey)
    .filter((row) => row.parentPath === parentPath)
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
    .map((row) => row.node);
}

export function deriveAgentConfigRows(
  rows: Array<AgentConfigRow>,
  filters: {
    keyword?: string;
    group?: string;
    team?: string;
    category?: string;
    tags?: Array<string>;
  } = {},
) {
  const keyword = (filters.keyword || '').trim().toLowerCase();
  const group = filters.group && filters.group !== 'all' ? filters.group : '';
  const team = filters.team && filters.team !== 'all' ? filters.team : '';
  const category = filters.category && filters.category !== 'all' ? filters.category : '';
  const tags = filters.tags || [];
  return rows
    .filter((agent) => !group || getAgentGroup(agent) === group)
    .filter((agent) => !keyword || agent.name.toLowerCase().includes(keyword))
    .filter((agent) => !team || agent.team === team)
    .filter((agent) => !category || agent.category === category)
    .filter((agent) => tags.length === 0 || tags.some((tag) => agent.tags?.includes(tag)))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getAgentGroup(agent: Pick<AgentConfig, 'name' | 'tags'>) {
  if (agent.name.startsWith('compiler_')) return 'compiler';
  if (agent.name.startsWith('oh-cangjie')) return 'openharmony';
  const firstTag = agent.tags?.[0] || '';
  if (firstTag === 'OH' || firstTag === '仓颉') return 'openharmony';
  if (firstTag === 'C++' || firstTag === '编译器' || firstTag === 'LLVM') return 'compiler';
  return 'common';
}

function workspaceTreeRowId(source: WorkspaceTreeRow['source'], sourceKey: string, path: string) {
  return `${source}:${sourceKey}:${normalizeTreePath(path)}`;
}

function normalizeTreePath(value?: string | null) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function compareRunRows(left: RunHistoryRow, right: RunHistoryRow, sortKey: RunHistoryParams['sortKey']) {
  if (sortKey === 'name') return left.configName.localeCompare(right.configName);
  if (sortKey === 'totalTokens') return left.totalTokens - right.totalTokens;
  if (sortKey === 'cost') return left.cost - right.cost;
  return toTime(left.startTime) - toTime(right.startTime);
}

function toTime(value?: number | string | null) {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function documentSourceValue(value: unknown): RunDocumentSource | undefined {
  return value === 'tasklist' || value === 'runtime-output' ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function previewText(value: unknown, limit = 600) {
  if (typeof value !== 'string') return undefined;
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}
