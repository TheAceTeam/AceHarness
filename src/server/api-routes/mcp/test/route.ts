import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { stat } from 'node:fs/promises';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import { loadMcpRegistry, parseCommandString } from '@/lib/mcp/registry';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const runtime = 'nodejs';

const MCP_TEST_TIMEOUT_MS = 20_000;
const STDERR_PREVIEW_LIMIT = 8_000;

type DiscoverAction = {
  action?: 'discover';
  name?: string;
  workingDirectory?: string;
};

type McpTestRequest = DiscoverAction;

type McpFailurePhase = 'validation' | 'spawn' | 'connect' | 'discover';

type McpTestErrorPayload = {
  message: string;
  hint: string;
  phase: McpFailurePhase;
  code: string;
  command?: string;
  args?: string[];
  url?: string;
  cwd?: string;
  stderr?: string;
};

class McpTestError extends Error {
  payload: McpTestErrorPayload;
  status: number;

  constructor(payload: McpTestErrorPayload, status = 500) {
    super(payload.message);
    this.name = 'McpTestError';
    this.payload = payload;
    this.status = status;
  }
}

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

function buildRequestInit(headers?: Record<string, string>): RequestInit | undefined {
  const entries = Object.entries(headers || {})
    .filter(([key, value]) => key.trim().length > 0 && typeof value === 'string');
  return entries.length > 0 ? { headers: Object.fromEntries(entries) } : undefined;
}

function createTimeoutError(label: string, phase: McpFailurePhase): McpTestError {
  return new McpTestError({
    message: `${label}耗时超过 ${MCP_TEST_TIMEOUT_MS / 1000} 秒`,
    hint: '确认命令可执行、依赖已安装、工作目录可访问，并检查 MCP Server 是否通过 stdio 返回协议响应。',
    phase,
    code: 'MCP_TEST_TIMEOUT',
  });
}

async function withTimeout<T>(promise: Promise<T>, label: string, phase: McpFailurePhase): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(createTimeoutError(label, phase)), MCP_TEST_TIMEOUT_MS);
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

function getErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) return code;
  }
  if (error instanceof McpTestError) return error.payload.code;
  return 'MCP_TEST_FAILED';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'MCP 测试失败';
}

function isSpawnFailure(error: unknown): boolean {
  const code = getErrorCode(error);
  const message = getErrorMessage(error).toLowerCase();
  return code === 'ENOENT' || message.includes('enoent') || message.includes('spawn');
}

function buildHint(error: unknown, phase: McpFailurePhase): string {
  if (isSpawnFailure(error)) {
    return '确认启动命令位于 PATH 中，或使用完整可执行文件路径；同时确认依赖已安装，工作目录设置为项目根目录。';
  }
  if (getErrorCode(error) === 'MCP_TEST_TIMEOUT') {
    return '确认命令启动后会持续通过 stdio 提供 MCP 协议响应，并检查依赖安装、网络初始化、ENV/API key 与工作目录。';
  }
  if (phase === 'connect') {
    return '确认 MCP Server 地址、transport 类型、鉴权请求头或 stdio 启动命令正确，并查看返回错误或 stderr。';
  }
  if (phase === 'discover') {
    return '连接已建立，请检查 MCP Server 的 ping/listTools/listPrompts/listResources 响应和 stderr 输出。';
  }
  return '确认启动命令、参数、工作目录、依赖安装和 ENV/API key 后再次测试。';
}

function mergeErrorContext(
  error: unknown,
  context: Partial<Pick<McpTestErrorPayload, 'command' | 'args' | 'url' | 'cwd' | 'stderr' | 'phase'>>,
): McpTestErrorPayload {
  if (error instanceof McpTestError) {
    return {
      ...error.payload,
      command: error.payload.command || context.command,
      args: error.payload.args || context.args,
      url: error.payload.url || context.url,
      cwd: error.payload.cwd || context.cwd,
      stderr: error.payload.stderr || context.stderr,
    };
  }

  const phase = context.phase || 'connect';
  return {
    message: getErrorMessage(error),
    hint: buildHint(error, phase),
    phase,
    code: getErrorCode(error),
    command: context.command,
    args: context.args,
    url: context.url,
    cwd: context.cwd,
    stderr: context.stderr,
  };
}

async function validateWorkingDirectory(cwd: string): Promise<void> {
  try {
    const stats = await stat(cwd);
    if (!stats.isDirectory()) {
      throw new McpTestError({
        message: '测试工作目录需要指向一个文件夹',
        hint: '选择 MCP Server 所在项目或依赖安装目录，然后再次运行在线测试。',
        phase: 'validation',
        code: 'WORKING_DIRECTORY_NOT_DIRECTORY',
        cwd,
      }, 400);
    }
  } catch (error) {
    if (error instanceof McpTestError) throw error;
    throw new McpTestError({
      message: '测试工作目录需要可访问的文件夹',
      hint: '选择一个已存在且可访问的项目文件夹，或清空输入使用当前 workspace 根目录。',
      phase: 'validation',
      code: getErrorCode(error) === 'ENOENT' ? 'WORKING_DIRECTORY_NOT_FOUND' : getErrorCode(error),
      cwd,
    }, 400);
  }
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
  transport: Transport;
  server: Awaited<ReturnType<typeof loadMcpRegistry>>[number];
  command?: string;
  args?: string[];
  url?: string;
  readStderr: () => string | undefined;
}> {
  const registry = await loadMcpRegistry();
  const server = registry.find((item) => item.name === name);
  if (!server) {
    throw new McpTestError({
      message: `MCP Server "${name}" 需要先完成注册`,
      hint: '刷新 MCP Server 列表后重新选择目标服务，再运行在线测试。',
      phase: 'validation',
      code: 'MCP_SERVER_NOT_FOUND',
      cwd: workingDirectory,
    }, 404);
  }

  let transport: Transport;
  let command: string | undefined;
  let args: string[] | undefined;
  let url: string | undefined;

  let stderr = '';
  if (server.type === 'stdio') {
    const commandParts = parseCommandString(server.command || '');
    [command, ...args] = commandParts;
    if (!command) {
      throw new McpTestError({
        message: `MCP Server "${name}" 需要配置启动命令`,
        hint: '填写可执行命令和参数，例如 npx -y 包名 或完整可执行文件路径。',
        phase: 'validation',
        code: 'MCP_COMMAND_EMPTY',
        cwd: workingDirectory,
      }, 400);
    }

    await validateWorkingDirectory(workingDirectory);

    const stdioTransport = new StdioClientTransport({
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(buildTransportEnv(server.env) ? { env: buildTransportEnv(server.env) } : {}),
      cwd: workingDirectory,
      stderr: 'pipe',
    });
    if (stdioTransport.stderr) {
      stdioTransport.stderr.on('data', (chunk) => {
        stderr += String(chunk);
        if (stderr.length > STDERR_PREVIEW_LIMIT * 2) {
          stderr = stderr.slice(-STDERR_PREVIEW_LIMIT * 2);
        }
      });
    }
    transport = stdioTransport;
  } else {
    url = server.url?.trim();
    if (!url) {
      throw new McpTestError({
        message: `MCP Server "${name}" 需要配置服务地址`,
        hint: '填写 MCP endpoint URL，例如 http://localhost:3001/mcp 或 http://localhost:3001/sse。',
        phase: 'validation',
        code: 'MCP_URL_EMPTY',
      }, 400);
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new McpTestError({
        message: `MCP Server "${name}" 的服务地址无效`,
        hint: '填写完整的 http:// 或 https:// MCP endpoint URL。',
        phase: 'validation',
        code: 'MCP_URL_INVALID',
        url,
      }, 400);
    }

    const requestInit = buildRequestInit(server.headers);
    transport = server.type === 'sse'
      ? new SSEClientTransport(parsedUrl, {
        ...(requestInit ? {
          requestInit,
          eventSourceInit: {
            fetch: (input: string | URL, init: any) => globalThis.fetch(input, {
              ...init,
              headers: {
                ...(init?.headers || {}),
                ...(requestInit.headers || {}),
              },
            }),
          },
        } : {}),
      })
      : new StreamableHTTPClientTransport(parsedUrl, {
        ...(requestInit ? { requestInit } : {}),
      });
  }

  const client = new Client(
    { name: 'aceharness-mcp-tester', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await withTimeout(client.connect(transport), '连接 MCP Server', 'connect');
  } catch (error) {
    throw new McpTestError(mergeErrorContext(error, {
      command,
      args,
      url,
      cwd: workingDirectory,
      stderr: trimStderr(stderr),
      phase: isSpawnFailure(error) ? 'spawn' : 'connect',
    }));
  }

  return {
    client,
    transport,
    server,
    command,
    args,
    url,
    readStderr: () => trimStderr(stderr),
  };
}

export async function POST(request: Request) {
  let transport: Transport | null = null;
  let readStderr: (() => string | undefined) | null = null;
  let errorContext: Partial<Pick<McpTestErrorPayload, 'command' | 'args' | 'url' | 'cwd'>> = {};

  try {
    const body = await readJsonBody<McpTestRequest>(request, {});
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return jsonOk({
        error: {
          message: '请选择要测试的 MCP Server',
          hint: '从 MCP Servers 列表选择一个服务后再运行在线测试。',
          phase: 'validation',
          code: 'MCP_SERVER_NAME_REQUIRED',
        },
      }, { status: 400 });
    }

    const workingDirectory = normalizeWorkingDirectory(body.workingDirectory);
    errorContext = { cwd: workingDirectory };
    const startedAt = Date.now();
    const connection = await connectManagedServer(name, workingDirectory);
    transport = connection.transport;
    readStderr = connection.readStderr;
    errorContext = {
      command: connection.command,
      args: connection.args,
      url: connection.url,
      cwd: workingDirectory,
    };

    const { client, server } = connection;
    const serverInfo = normalizeServerVersion(client.getServerVersion());
    const capabilities = client.getServerCapabilities() || {};

    const [ping, toolsResult, promptsResult, resourcesResult, resourceTemplatesResult] = await Promise.all([
      withTimeout(client.ping(), 'Ping MCP Server', 'discover'),
      capabilities.tools ? withTimeout(client.listTools(), '读取工具列表', 'discover') : Promise.resolve(null),
      capabilities.prompts ? withTimeout(client.listPrompts(), '读取 Prompt 列表', 'discover') : Promise.resolve(null),
      capabilities.resources ? withTimeout(client.listResources(), '读取资源列表', 'discover') : Promise.resolve(null),
      capabilities.resources ? withTimeout(client.listResourceTemplates(), '读取资源模板列表', 'discover') : Promise.resolve(null),
    ]);

    return jsonOk({
      success: true,
      mode: 'discover',
      server: {
        name: server.name,
        type: server.type,
        command: server.command,
        url: server.url,
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
    const payload = mergeErrorContext(error, {
      ...errorContext,
      stderr: readStderr?.(),
      phase: error instanceof McpTestError ? error.payload.phase : 'discover',
    });
    return jsonOk(
      { error: payload },
      { status: error instanceof McpTestError ? error.status : 500 },
    );
  } finally {
    if (transport) {
      try {
        await transport.close();
      } catch {}
    }
  }
}
