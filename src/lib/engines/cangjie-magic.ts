/**
 * CangjieMagic Engine
 *
 * Lightweight MCP client that communicates with CangjieMagic MCP Server
 * via stdio using JSON-RPC 2.0 protocol.
 */

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { detectCangjieHome, buildCangjieSpawnEnv, buildCjpmShellCommand } from '@/lib/cangjie/env';

interface CangjieMagicOptions {
  projectDir: string;       // CangjieMagic project directory
  command: string;          // e.g. "cjpm run --name magic.examples.mcp_server"
  cangjieHome?: string;     // Override auto-detected CANGJIE_HOME
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

export class CangjieMagicEngine extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }>();
  private buffer = '';
  private tools: McpTool[] = [];
  private options: CangjieMagicOptions;
  private cangjieHome: string | null = null;
  private spawnEnv: Record<string, string> | null = null;

  constructor(options: CangjieMagicOptions) {
    super();
    this.options = options;
  }

  /**
   * Start the MCP server process and perform initialize handshake.
   */
  async start(): Promise<void> {
    // Detect Cangjie environment
    this.cangjieHome = this.options.cangjieHome || await detectCangjieHome();
    if (!this.cangjieHome) {
      throw new Error('CANGJIE_HOME not found. Please configure it in env vars.');
    }

    this.spawnEnv = await buildCangjieSpawnEnv(this.cangjieHome);

    const { command: shellCmd, args: shellArgs } = await buildCjpmShellCommand(
      this.cangjieHome,
      this.options.command,
      this.options.projectDir,
    );

    const proc = spawn(shellCmd, shellArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.spawnEnv as NodeJS.ProcessEnv,
      shell: false,
    });
    this.process = proc;

    proc.stdout!.on('data', (chunk: Buffer) => {
      this.handleData(chunk.toString());
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      const msg = chunk.toString();
      this.emit('log', `[CangjieMagic stderr] ${msg.trim()}`);
    });

    proc.on('error', (err) => {
      this.emit('error', err);
    });

    proc.on('close', (code) => {
      this.emit('log', `[CangjieMagic] process exited with code ${code}`);
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error(`Process exited with code ${code}`));
      }
      this.pendingRequests.clear();
      this.process = null;
    });

    // MCP initialize handshake
    const initResult = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'aceharness-cangjie-magic', version: '1.0.0' },
    });
    this.emit('log', `[CangjieMagic] initialized: ${JSON.stringify(initResult?.serverInfo || {})}`);

    // Send initialized notification
    this.sendNotification('notifications/initialized', {});

    // Get available tools
    const toolsResult = await this.sendRequest('tools/list', {});
    this.tools = toolsResult?.tools || [];
    this.emit('log', `[CangjieMagic] ${this.tools.length} tools available: ${this.tools.map(t => t.name).join(', ')}`);
  }

  /**
   * Call a tool on the MCP server.
   */
  async callTool(toolName: string, args: Record<string, any> = {}): Promise<any> {
    return this.sendRequest('tools/call', { name: toolName, arguments: args });
  }

  /**
   * Send a chat prompt by finding and calling an appropriate agent tool.
   */
  async chat(prompt: string): Promise<string> {
    const agentTool = this.tools.find(t =>
      t.name.toLowerCase().includes('agent') ||
      t.name.toLowerCase().includes('chat') ||
      t.name.toLowerCase().includes('ask')
    ) || this.tools[0];

    if (!agentTool) {
      throw new Error('No tools available on CangjieMagic MCP server');
    }

    this.emit('log', `[CangjieMagic] calling tool: ${agentTool.name}`);
    const result = await this.callTool(agentTool.name, { prompt });

    if (result?.content) {
      const textParts = result.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text);
      return textParts.join('\n');
    }

    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  getTools(): McpTool[] {
    return [...this.tools];
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
          this.process = null;
        }
      }, 3000);
    }
  }

  // --- Private methods ---

  private handleData(data: string): void {
    this.buffer += data;

    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (!line) continue;

      try {
        const msg: JsonRpcResponse = JSON.parse(line);
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const pending = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            pending.resolve(msg.result);
          }
        }
      } catch {
        // Not valid JSON, ignore
      }
    }
  }

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error('MCP server process is not running'));
        return;
      }

      const id = ++this.requestId;
      const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, 30_000);

      this.pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      });

      this.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  private sendNotification(method: string, params: any): void {
    if (!this.process?.stdin?.writable) return;
    const notification = { jsonrpc: '2.0', method, params };
    this.process.stdin.write(JSON.stringify(notification) + '\n');
  }
}
