import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { parse, stringify } from 'yaml';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { mcpServerSchema, type ManagedMcpServer } from '@/lib/mcp/types';

export type { ManagedMcpServer } from '@/lib/mcp/types';

const MCP_REGISTRY_PATH = getWorkspaceDataFile('mcp-servers.yaml');
const CACHE_TTL_MS = 5_000;

let registryCache: { value: ManagedMcpServer[]; expiresAt: number } | null = null;

function normalizeManagedMcpServer(input: unknown): ManagedMcpServer | null {
  const parsed = mcpServerSchema.safeParse(input);
  if (!parsed.success) return null;

  const name = parsed.data.name.trim();
  const command = parsed.data.command.trim();
  const envEntries = Object.entries(parsed.data.env || {})
    .filter(([key, value]) => key.trim().length > 0 && typeof value === 'string');
  const env = envEntries.length > 0
    ? Object.fromEntries(envEntries.map(([key, value]) => [key.trim(), String(value)]))
    : undefined;

  if (!name || !command) return null;

  return {
    name,
    type: 'stdio',
    command,
    ...(env ? { env } : {}),
  };
}

function uniqueServersByName(servers: ManagedMcpServer[]): ManagedMcpServer[] {
  const map = new Map<string, ManagedMcpServer>();
  for (const server of servers) {
    map.set(server.name, server);
  }
  return Array.from(map.values()).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

function readRegistryArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray((raw as { servers?: unknown[] }).servers)) {
    return (raw as { servers?: unknown[] }).servers || [];
  }
  return [];
}

export function invalidateMcpRegistryCache(): void {
  registryCache = null;
}

export async function loadMcpRegistry(_baseDirectory?: string): Promise<ManagedMcpServer[]> {
  const now = Date.now();
  if (registryCache && registryCache.expiresAt > now) {
    return registryCache.value.map((server) => ({ ...server }));
  }

  let value: ManagedMcpServer[] = [];
  try {
    const content = await readFile(MCP_REGISTRY_PATH, 'utf-8');
    const parsed = parse(content);
    value = uniqueServersByName(
      readRegistryArray(parsed)
        .map((server) => normalizeManagedMcpServer(server))
        .filter((server): server is ManagedMcpServer => Boolean(server)),
    );
  } catch {
    value = [];
  }

  registryCache = { value, expiresAt: now + CACHE_TTL_MS };
  return value.map((server) => ({ ...server }));
}

export async function saveMcpRegistry(servers: unknown[]): Promise<ManagedMcpServer[]> {
  const normalized = uniqueServersByName(
    servers
      .map((server) => normalizeManagedMcpServer(server))
      .filter((server): server is ManagedMcpServer => Boolean(server)),
  );

  await mkdir(dirname(MCP_REGISTRY_PATH), { recursive: true });
  await writeFile(MCP_REGISTRY_PATH, stringify({ servers: normalized }), 'utf-8');
  invalidateMcpRegistryCache();
  return normalized;
}

export function parseCommandString(command: string): string[] {
  const input = String(command || '').trim();
  if (!input) return [];

  const parts: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;
  let escaping = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (quote) {
      if (char === '\\' && (input[index + 1] === quote || input[index + 1] === '\\')) {
        escaping = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '\\') {
      current += char;
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaping) current += '\\';
  if (current) parts.push(current);
  return parts;
}

export async function resolveMcpServersByNames(
  names: string[] | undefined,
  baseDirectory?: string,
): Promise<ManagedMcpServer[]> {
  const normalizedNames = Array.from(new Set(
    (names || [])
      .filter((name): name is string => typeof name === 'string')
      .map((name) => name.trim())
      .filter(Boolean),
  ));
  if (normalizedNames.length === 0) return [];

  const registry = await loadMcpRegistry(baseDirectory);
  const registryMap = new Map(registry.map((server) => [server.name, server]));
  return normalizedNames
    .map((name) => registryMap.get(name))
    .filter((server): server is ManagedMcpServer => Boolean(server));
}

export function mergeMcpServers(...groups: Array<ManagedMcpServer[] | undefined>): ManagedMcpServer[] {
  const merged: ManagedMcpServer[] = [];
  const seen = new Map<string, number>();

  for (const group of groups) {
    for (const server of group || []) {
      const normalized = normalizeManagedMcpServer(server);
      if (!normalized) continue;
      const existingIndex = seen.get(normalized.name);
      if (existingIndex === undefined) {
        seen.set(normalized.name, merged.length);
        merged.push(normalized);
      } else {
        merged[existingIndex] = normalized;
      }
    }
  }

  return merged;
}

export function toClaudeSdkMcpServers(servers: ManagedMcpServer[]): Record<string, {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}> {
  return Object.fromEntries(servers.flatMap((server) => {
    const [command, ...args] = parseCommandString(server.command);
    if (!command) return [];
    return [[server.name, {
      type: 'stdio' as const,
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(server.env ? { env: server.env } : {}),
    }]];
  }));
}

export function toAcpMcpServers(servers: ManagedMcpServer[]): Array<{
  name: string;
  command: string;
  args: string[];
  env: Array<{ name: string; value: string }>;
}> {
  return servers.flatMap((server) => {
    const [command, ...args] = parseCommandString(server.command);
    if (!command) return [];
    return [{
      name: server.name,
      command,
      args,
      env: Object.entries(server.env || {}).map(([name, value]) => ({ name, value })),
    }];
  });
}

export function toOpenCodeMcpConfig(server: ManagedMcpServer): {
  type: 'local';
  command: string[];
  environment?: Record<string, string>;
  enabled: true;
} | null {
  const command = parseCommandString(server.command);
  if (command.length === 0) return null;
  return {
    type: 'local',
    command,
    ...(server.env ? { environment: server.env } : {}),
    enabled: true,
  };
}

export function toCodexMcpServers(servers: ManagedMcpServer[]): Record<string, {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: true;
}> {
  return Object.fromEntries(servers.flatMap((server) => {
    const [command, ...args] = parseCommandString(server.command);
    if (!command) return [];
    return [[server.name, {
      type: 'stdio' as const,
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(server.env ? { env: server.env } : {}),
      enabled: true as const,
    }]];
  }));
}

export async function ensureOpenCodeCompatibleMcpServers(
  client: any,
  workingDirectory: string | undefined,
  servers: ManagedMcpServer[] | undefined,
): Promise<void> {
  if (!client?.mcp || !workingDirectory || !servers || servers.length === 0) return;

  const query = { directory: workingDirectory };
  const statusResponse = await client.mcp.status({ query });
  if (statusResponse?.error) {
    throw new Error(`读取 MCP 状态失败: ${JSON.stringify(statusResponse.error)}`);
  }
  const statusMap = (statusResponse?.data && typeof statusResponse.data === 'object')
    ? statusResponse.data as Record<string, { status?: string }>
    : {};

  for (const server of servers) {
    if (!statusMap[server.name]) {
      const config = toOpenCodeMcpConfig(server);
      if (!config) continue;
      const addResponse = await client.mcp.add({
        query,
        body: {
          name: server.name,
          config,
        },
      });
      if (addResponse?.error) {
        throw new Error(`添加 MCP "${server.name}" 失败: ${JSON.stringify(addResponse.error)}`);
      }
    }

    const connectResponse = await client.mcp.connect({
      query,
      path: { name: server.name },
    });
    if (connectResponse?.error) {
      throw new Error(`连接 MCP "${server.name}" 失败: ${JSON.stringify(connectResponse.error)}`);
    }
  }
}
