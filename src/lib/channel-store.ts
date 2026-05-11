import { randomBytes, randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { parse, stringify } from 'yaml';
import { getWorkspaceDataFile } from '@/lib/app-paths';
import type { ChannelProviderId } from '@/lib/channel-providers';

const INTEGRATIONS_PATH = getWorkspaceDataFile('channels', 'integrations.yaml');
const BINDINGS_PATH = getWorkspaceDataFile('channels', 'bindings.yaml');

export type ChannelBindingType = 'workflow-run' | 'roundtable' | 'agent-chat';
export type ChannelBindingStrategy = 'manual' | 'per-conversation-auto';

export interface ChannelDefaultBinding {
  bindingType: ChannelBindingType;
  configFile?: string;
  runId?: string;
  agentName?: string;
  workflowMode?: 'feedback-only' | 'full-control';
  roundtableParticipants?: string[];
  roundtableSummarizer?: string;
}

export interface ChannelIntegration {
  id: string;
  name: string;
  provider: ChannelProviderId;
  enabled: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  secret: string;
  webhookPath: string;
  transport: 'webhook';
  capabilities: string[];
  bindingStrategy: ChannelBindingStrategy;
  defaultBinding?: ChannelDefaultBinding | null;
  providerConfig?: Record<string, any>;
}

export interface ChannelSessionBinding {
  id: string;
  integrationId: string;
  bindingType: ChannelBindingType;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  externalConversationId: string;
  externalUserId?: string;
  externalConversationName?: string;
  runId?: string;
  configFile?: string;
  frontendSessionId?: string;
  agentName?: string;
  agentSessionId?: string;
  workflowMode?: 'feedback-only' | 'full-control';
  roundtableId?: string;
  roundtableParticipants?: string[];
  roundtableSummarizer?: string;
  metadata?: Record<string, any>;
}

let writeLock: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let release!: () => void;
  writeLock = new Promise<void>((resolve) => { release = resolve; });
  return prev.then(fn).finally(() => release());
}

async function readYamlFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(path, 'utf-8');
    const parsed = parse(content);
    return (parsed && typeof parsed === 'object' ? parsed : fallback) as T;
  } catch {
    return fallback;
  }
}

async function writeYamlFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringify(value), 'utf-8');
}

function normalizeIntegrations(raw: unknown): ChannelIntegration[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => ({
    id: typeof item?.id === 'string' ? item.id : randomUUID(),
    name: typeof item?.name === 'string' ? item.name : 'Channel Integration',
    provider: (typeof item?.provider === 'string' ? item.provider : 'generic-webhook') as ChannelProviderId,
    enabled: item?.enabled !== false,
    createdBy: typeof item?.createdBy === 'string' ? item.createdBy : 'system',
    createdAt: typeof item?.createdAt === 'number' ? item.createdAt : Date.now(),
    updatedAt: typeof item?.updatedAt === 'number' ? item.updatedAt : Date.now(),
    secret: typeof item?.secret === 'string' ? item.secret : randomBytes(24).toString('hex'),
    webhookPath: typeof item?.webhookPath === 'string' ? item.webhookPath : '',
    transport: 'webhook',
    capabilities: Array.isArray(item?.capabilities) ? item.capabilities.filter((value: unknown) => typeof value === 'string') : [],
    bindingStrategy: item?.bindingStrategy === 'manual' ? 'manual' : 'per-conversation-auto',
    defaultBinding: item?.defaultBinding && typeof item.defaultBinding === 'object' ? item.defaultBinding : null,
    providerConfig: item?.providerConfig && typeof item.providerConfig === 'object' ? item.providerConfig : {},
  }));
}

function normalizeBindings(raw: unknown): ChannelSessionBinding[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => ({
    id: typeof item?.id === 'string' ? item.id : randomUUID(),
    integrationId: typeof item?.integrationId === 'string' ? item.integrationId : '',
    bindingType: (typeof item?.bindingType === 'string' ? item.bindingType : 'workflow-run') as ChannelBindingType,
    createdBy: typeof item?.createdBy === 'string' ? item.createdBy : 'system',
    createdAt: typeof item?.createdAt === 'number' ? item.createdAt : Date.now(),
    updatedAt: typeof item?.updatedAt === 'number' ? item.updatedAt : Date.now(),
    externalConversationId: typeof item?.externalConversationId === 'string' ? item.externalConversationId : '',
    externalUserId: typeof item?.externalUserId === 'string' ? item.externalUserId : undefined,
    externalConversationName: typeof item?.externalConversationName === 'string' ? item.externalConversationName : undefined,
    runId: typeof item?.runId === 'string' ? item.runId : undefined,
    configFile: typeof item?.configFile === 'string' ? item.configFile : undefined,
    frontendSessionId: typeof item?.frontendSessionId === 'string' ? item.frontendSessionId : undefined,
    agentName: typeof item?.agentName === 'string' ? item.agentName : undefined,
    agentSessionId: typeof item?.agentSessionId === 'string' ? item.agentSessionId : undefined,
    workflowMode: (item?.workflowMode === 'feedback-only'
      ? 'feedback-only'
      : item?.workflowMode === 'full-control'
        ? 'full-control'
        : undefined) as ChannelSessionBinding['workflowMode'],
    roundtableId: typeof item?.roundtableId === 'string' ? item.roundtableId : undefined,
    roundtableParticipants: Array.isArray(item?.roundtableParticipants)
      ? item.roundtableParticipants.filter((value: unknown): value is string => typeof value === 'string')
      : undefined,
    roundtableSummarizer: typeof item?.roundtableSummarizer === 'string' ? item.roundtableSummarizer : undefined,
    metadata: item?.metadata && typeof item.metadata === 'object' ? item.metadata : undefined,
  })).filter((item) => item.integrationId && item.externalConversationId);
}

export async function listChannelIntegrations(): Promise<ChannelIntegration[]> {
  return normalizeIntegrations(await readYamlFile(INTEGRATIONS_PATH, []));
}

export async function getChannelIntegration(id: string): Promise<ChannelIntegration | null> {
  return (await listChannelIntegrations()).find((item) => item.id === id) || null;
}

export async function saveChannelIntegration(input: Omit<ChannelIntegration, 'updatedAt'> & { updatedAt?: number }): Promise<ChannelIntegration> {
  return withLock(async () => {
    const now = input.updatedAt ?? Date.now();
    const integrations = await listChannelIntegrations();
    const next: ChannelIntegration = {
      ...input,
      updatedAt: now,
      webhookPath: input.webhookPath || `/api/channels/inbound/${input.id}`,
    };
    const index = integrations.findIndex((item) => item.id === input.id);
    if (index >= 0) integrations[index] = next;
    else integrations.push(next);
    await writeYamlFile(INTEGRATIONS_PATH, integrations);
    return next;
  });
}

export async function createChannelIntegration(input: {
  name: string;
  provider: ChannelProviderId;
  createdBy: string;
  capabilities: string[];
  bindingStrategy?: ChannelBindingStrategy;
  defaultBinding?: ChannelDefaultBinding | null;
  providerConfig?: Record<string, any>;
  enabled?: boolean;
}): Promise<ChannelIntegration> {
  const id = `channel-${randomUUID()}`;
  return saveChannelIntegration({
    id,
    name: input.name,
    provider: input.provider,
    enabled: input.enabled !== false,
    createdBy: input.createdBy,
    createdAt: Date.now(),
    secret: randomBytes(24).toString('hex'),
    webhookPath: `/api/channels/inbound/${id}`,
    transport: 'webhook',
    capabilities: input.capabilities,
    bindingStrategy: input.bindingStrategy || 'per-conversation-auto',
    defaultBinding: input.defaultBinding || null,
    providerConfig: input.providerConfig || {},
  });
}

export async function deleteChannelIntegration(id: string): Promise<boolean> {
  return withLock(async () => {
    const integrations = await listChannelIntegrations();
    const next = integrations.filter((item) => item.id !== id);
    if (next.length === integrations.length) return false;
    await writeYamlFile(INTEGRATIONS_PATH, next);
    const bindings = await listChannelBindings();
    await writeYamlFile(BINDINGS_PATH, bindings.filter((item) => item.integrationId !== id));
    return true;
  });
}

export async function listChannelBindings(): Promise<ChannelSessionBinding[]> {
  return normalizeBindings(await readYamlFile(BINDINGS_PATH, []));
}

export async function findChannelBinding(integrationId: string, externalConversationId: string): Promise<ChannelSessionBinding | null> {
  return (await listChannelBindings()).find((item) => item.integrationId === integrationId && item.externalConversationId === externalConversationId) || null;
}

export async function saveChannelBinding(input: Omit<ChannelSessionBinding, 'updatedAt'> & { updatedAt?: number }): Promise<ChannelSessionBinding> {
  return withLock(async () => {
    const now = input.updatedAt ?? Date.now();
    const bindings = await listChannelBindings();
    const next: ChannelSessionBinding = {
      ...input,
      updatedAt: now,
    };
    const index = bindings.findIndex((item) => item.id === input.id);
    if (index >= 0) bindings[index] = next;
    else bindings.push(next);
    await writeYamlFile(BINDINGS_PATH, bindings);
    return next;
  });
}

export async function createBindingFromDefault(input: {
  integration: ChannelIntegration;
  createdBy: string;
  externalConversationId: string;
  externalConversationName?: string;
  externalUserId?: string;
}): Promise<ChannelSessionBinding | null> {
  const base = input.integration.defaultBinding;
  if (!base) return null;
  return saveChannelBinding({
    id: `binding-${randomUUID()}`,
    integrationId: input.integration.id,
    bindingType: base.bindingType,
    createdBy: input.createdBy,
    createdAt: Date.now(),
    externalConversationId: input.externalConversationId,
    externalConversationName: input.externalConversationName,
    externalUserId: input.externalUserId,
    runId: base.runId,
    configFile: base.configFile,
    agentName: base.agentName,
    workflowMode: base.workflowMode || 'full-control',
    roundtableParticipants: base.roundtableParticipants,
    roundtableSummarizer: base.roundtableSummarizer,
  });
}

export async function deleteChannelBinding(id: string): Promise<boolean> {
  return withLock(async () => {
    const bindings = await listChannelBindings();
    const next = bindings.filter((item) => item.id !== id);
    if (next.length === bindings.length) return false;
    await writeYamlFile(BINDINGS_PATH, next);
    return true;
  });
}
