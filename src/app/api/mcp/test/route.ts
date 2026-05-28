import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import { loadMcpRegistry, parseCommandString } from '@/lib/mcp/registry';

export const runtime = 'nodejs';

const MCP_TEST_TIMEOUT_MS = 20_000;
const STDERR_PREVIEW_LIMIT = 8_000;

type DiscoverAction = {
  action?: 'discover';
  name?: string;
  workingDirectory?: string;
};

type McpTestRequest = DiscoverAction;

function normalizeWorkingDirectory(input: string | undefined): string {
  const trimmed = typeof input === 'string' ? input.trim() : '';
  return trimmed || getWorkspaceRoot();
}

function buildTransportEnv(env?: Record<string, string>): Record<string, string> | undefined {
  const merged = Object.entries({
    ...process.env,
    ...(env || {}),
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return merged.length > 0 ? Object.fromEntries(merged) : undefined;
}

function createTimeoutError(label: string): Error {
  return new Error(`${label}超时，请检查命令是否可执行、依赖是否已安装，或改用更准确的工作目录重试`);
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(createTimeoutError(label)), MCP_TEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function trimStderr(stderr: string): string | undefined {
  const text = stderr.trim();
  if (!text) return undefined;
  if (text.length <= STDERR_PREVIEW_LIMIT) return text;
  return text.slice(-STDERR_PREVIEW_LIMIT);
}

function formatErrorMessage(error: unknown, stderr: string): string {
  const stderrText = trimStderr(stderr);
  const message = error instanceof Error ? error.message : 'MCP 测试失败';
  return stderrText ? `${message}\n\nstderr:\n${stderrText}` : message;
}

function normalizeServerVersion(version: { name?: string; version?: string } | undefined) {
  if (!version) return undefined;
  return {
    name: version.name || '',
    version: version.version || '',
  };
}

async function connectManagedServer(
  name: string,
  workingDirectory: string,
): Promise<{
  client: Client;
  transport: StdioClientTransport;
  server: Awaited<ReturnType<typeof loadMcpRegistry>>[number];
  readStderr: () => string | undefined;
}> {
  const registry = await loadMcpRegistry();
  const server = registry.find((item) => item.name === name);
  if (!server) {
    throw new Error(`未找到 MCP Server: ${name}`);
  }

  const [command, ...args] = parseCommandString(server.command);
  if (!command) {
    throw new Error(`MCP Server "${name}" 的启动命令为空`);
  }

  const transport = new StdioClientTransport({
    command,
    ...(args.length > 0 ? { args } : {}),
    ...(buildTransportEnv(server.env) ? { env: buildTransportEnv(server.env) } : {}),
    cwd: workingDirectory,
    stderr: 'pipe',
  });

  let stderr = '';
  if (transport.stderr) {
    transport.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > STDERR_PREVIEW_LIMIT * 2) {
        stderr = stderr.slice(-STDERR_PREVIEW_LIMIT * 2);
      }
    });
  }

  const client = new Client(
    { name: 'aceharness-mcp-tester', version: '1.0.0' },
    { capabilities: {} },
  );

  await withTimeout(client.connect(transport), '连接 MCP Server');

  return {
    client,
    transport,
    server,
    readStderr: () => trimStderr(stderr),
  };
}

export async function POST(request: NextRequest) {
  let transport: StdioClientTransport | null = null;
  let readStderr: (() => string | undefined) | null = null;

  try {
    const body = await request.json() as McpTestRequest;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: '缺少 MCP Server 名称' }, { status: 400 });
    }

    const workingDirectory = normalizeWorkingDirectory(body.workingDirectory);
    const startedAt = Date.now();
    const connection = await connectManagedServer(name, workingDirectory);
    transport = connection.transport;
    readStderr = connection.readStderr;

    const { client, server } = connection;
    const serverInfo = normalizeServerVersion(client.getServerVersion());
    const capabilities = client.getServerCapabilities() || {};

    const [ping, toolsResult, promptsResult, resourcesResult, resourceTemplatesResult] = await Promise.all([
      withTimeout(client.ping(), 'Ping MCP Server'),
      capabilities.tools ? withTimeout(client.listTools(), '读取工具列表') : Promise.resolve(null),
      capabilities.prompts ? withTimeout(client.listPrompts(), '读取 Prompt 列表') : Promise.resolve(null),
      capabilities.resources ? withTimeout(client.listResources(), '读取资源列表') : Promise.resolve(null),
      capabilities.resources ? withTimeout(client.listResourceTemplates(), '读取资源模板列表') : Promise.resolve(null),
    ]);

    return NextResponse.json({
      success: true,
      mode: 'discover',
      server: {
        name: server.name,
        command: server.command,
      },
      workingDirectory,
      serverInfo,
      ping,
      capabilities: {
        tools: Boolean(capabilities.tools),
        prompts: Boolean(capabilities.prompts),
        resources: Boolean(capabilities.resources),
      },
      tools: toolsResult?.tools || [],
      prompts: promptsResult?.prompts || [],
      resources: resourcesResult?.resources || [],
      resourceTemplates: resourceTemplatesResult?.resourceTemplates || [],
      stderr: readStderr?.(),
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: formatErrorMessage(error, readStderr?.() || '') },
      { status: 500 },
    );
  } finally {
    if (transport) {
      try {
        await transport.close();
      } catch {}
    }
  }
}
