import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BUILTIN_MARKETPLACE_SOURCES } from '@/constants/marketplace';
import { getWorkspaceConfigFile } from '@/lib/core/app-paths';
import type { MarketplaceSourceConfig } from '@/types/marketplace';

function configPath() {
  return getWorkspaceConfigFile('marketplace-sources.json');
}

async function readCustomSources(): Promise<MarketplaceSourceConfig[]> {
  const content = await readFile(configPath(), 'utf-8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return '[]';
  });
  return JSON.parse(content) as MarketplaceSourceConfig[];
}

export async function listMarketplaceSources(): Promise<MarketplaceSourceConfig[]> {
  return [...BUILTIN_MARKETPLACE_SOURCES, ...await readCustomSources()];
}

export async function getMarketplaceSource(id: string): Promise<MarketplaceSourceConfig | undefined> {
  return BUILTIN_MARKETPLACE_SOURCES.find((source) => source.id === id)
    || (await readCustomSources()).find((source) => source.id === id);
}

export function parseMarketplaceSource(value: unknown): MarketplaceSourceConfig {
  if (!value || typeof value !== 'object') throw new Error('请填写市场名称、协议和地址。');
  const { label, protocol, url } = value as Record<string, unknown>;
  if (typeof label !== 'string' || !label.trim() || label.trim().length > 80) {
    throw new Error('市场名称须为 1 至 80 个字符。');
  }
  if (protocol !== 'matrix' && protocol !== 'skillhub' && protocol !== 'catalog') throw new Error('请选择市场协议。');
  let target: URL;
  try {
    target = new URL(typeof url === 'string' ? url.trim() : '');
  } catch {
    throw new Error('请输入有效的 HTTPS 地址。');
  }
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) {
    throw new Error('市场地址须为 HTTPS，且不能包含凭据、查询参数或片段。');
  }
  const address = protocol === 'catalog' ? target.href : target.href.replace(/\/+$/, '');
  const hash = createHash('sha256').update(protocol + ':' + address).digest('hex').slice(0, 12);
  return { id: 'custom-' + hash, label: label.trim(), protocol, url: address, builtin: false };
}

let pendingWrite: Promise<void> = Promise.resolve();

export function updateCustomSources(update: (sources: MarketplaceSourceConfig[]) => MarketplaceSourceConfig[]): Promise<void> {
  const write = pendingWrite.then(async () => {
    const next = update(await readCustomSources());
    const target = configPath();
    const temp = target + '.' + randomUUID() + '.tmp';
    await mkdir(dirname(target), { recursive: true });
    try {
      await writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf-8');
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true }).catch(() => {});
    }
  });
  pendingWrite = write.catch(() => {});
  return write;
}
