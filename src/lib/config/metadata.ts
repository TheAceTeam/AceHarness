/**
 * 配置文件元数据管理
 * 管理 configs/.metadata.json 和 configs/agents/.metadata.json
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { ensureRuntimeConfigsSeeded, getRuntimeAgentsDirPath, getRuntimeConfigsDirPath } from '@/lib/run/runtime-configs';

export interface ConfigMeta {
  createdBy?: string;
  visibility: 'public' | 'private' | 'shared';
  sharedWithUserIds?: string[];
  createdAt: number;
  specCodingEnabled?: boolean;
  specCodingSkipped?: boolean;
  templateRef?: {
    source: 'builtin' | 'local';
    id: string;
    version: string;
    digest: string;
    instantiatedAt: number;
    parameterKeys: string[];
  };
}

type MetadataMap = Record<string, ConfigMeta>;

async function loadMetadata(metaPath: string): Promise<MetadataMap> {
  if (!existsSync(metaPath)) return {};
  try {
    const content = await readFile(metaPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveMetadata(metaPath: string, data: MetadataMap): Promise<void> {
  const dir = resolve(metaPath, '..');
  await mkdir(dir, { recursive: true });
  await writeFile(metaPath, JSON.stringify(data, null, 2), 'utf-8');
}

async function getMetaPath(type: 'workflow' | 'agent'): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return type === 'agent'
    ? resolve(await getRuntimeAgentsDirPath(), '.metadata.json')
    : resolve(await getRuntimeConfigsDirPath(), '.metadata.json');
}

export async function getConfigMeta(configFile: string, type: 'workflow' | 'agent' = 'workflow'): Promise<ConfigMeta | undefined> {
  const metaPath = await getMetaPath(type);
  const data = await loadMetadata(metaPath);
  return data[configFile];
}

export async function setConfigMeta(configFile: string, meta: Partial<ConfigMeta>, type: 'workflow' | 'agent' = 'workflow'): Promise<void> {
  const metaPath = await getMetaPath(type);
  const data = await loadMetadata(metaPath);
  const sharedWithUserIds = Array.isArray(meta.sharedWithUserIds)
    ? Array.from(new Set(meta.sharedWithUserIds.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)))
    : meta.sharedWithUserIds;
  data[configFile] = {
    ...data[configFile],
    ...meta,
    ...(sharedWithUserIds !== undefined ? { sharedWithUserIds } : {}),
  } as ConfigMeta;
  await saveMetadata(metaPath, data);
}

export async function deleteConfigMeta(configFile: string, type: 'workflow' | 'agent' = 'workflow'): Promise<void> {
  const metaPath = await getMetaPath(type);
  const data = await loadMetadata(metaPath);
  delete data[configFile];
  await saveMetadata(metaPath, data);
}

export async function listConfigsWithMeta(type: 'workflow' | 'agent' = 'workflow'): Promise<MetadataMap> {
  const metaPath = await getMetaPath(type);
  return loadMetadata(metaPath);
}

export function canAccessConfigMeta(
  meta: ConfigMeta | undefined,
  userId: string,
  role: 'admin' | 'user',
): boolean {
  if (!meta) return true;
  if (role === 'admin') return true;
  if (meta.visibility === 'public') return true;
  if (meta.createdBy && meta.createdBy === userId) return true;
  if (meta.visibility === 'shared') {
    return Array.isArray(meta.sharedWithUserIds) && meta.sharedWithUserIds.includes(userId);
  }
  return !meta.createdBy || meta.createdBy === userId;
}
