import net from 'net';
import tls from 'tls';
import { randomUUID } from 'crypto';

type SocketLike = net.Socket | tls.TLSSocket;

export interface SmtpTransportConfig {
  host: string;
  port: number;
  secure?: boolean;
  username?: string;
  password?: string;
  fromEmail: string;
  fromName?: string;
  replyTo?: string;
  timeoutMs?: number;
}

export interface SmtpSendMailInput {
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
}

type SmtpResponse = {
  code: number;
  lines: string[];
  text: string;
};

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function formatAddress(email: string, name?: string): string {
  const trimmedEmail = email.trim();
  const trimmedName = name?.trim();
  if (!trimmedName) return trimmedEmail;
  return `${encodeHeader(trimmedName)} <${trimmedEmail}>`;
}

function normalizeLines(text: string): string {
  return text
    .replace(/\r?\n/g, '\r\n')
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

function buildMessage(config: SmtpTransportConfig, input: SmtpSendMailInput): string {
  const headers = [
    `From: ${formatAddress(config.fromEmail, config.fromName)}`,
    `To: ${input.to.map((item) => formatAddress(item)).join(', ')}`,
    input.cc?.length ? `Cc: ${input.cc.map((item) => formatAddress(item)).join(', ')}` : '',
    config.replyTo ? `Reply-To: ${config.replyTo.trim()}` : '',
    `Subject: ${encodeHeader(input.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${config.host}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);

  return [
    ...headers,
    '',
    Buffer.from(input.text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
    '',
  ].join('\r\n');
}

class SmtpConnection {
  private socket: SocketLike;
  private buffer = '';
  private lines: string[] = [];
  private waiters: Array<() => void> = [];
  private closedError: Error | null = null;

  constructor(socket: SocketLike) {
    this.socket = socket;
    this.socket.on('data', (chunk: Buffer | string) => {
      this.buffer += chunk.toString();
      this.flushLines();
    });
    this.socket.on('error', (error) => {
      this.closedError = error instanceof Error ? error : new Error(String(error));
      this.flushWaiters();
    });
    this.socket.on('close', () => {
      if (!this.closedError) this.closedError = new Error('SMTP 连接已关闭');
      this.flushWaiters();
    });
  }

  replaceSocket(socket: tls.TLSSocket) {
    this.socket.removeAllListeners();
    this.socket = socket;
    this.buffer = '';
    this.lines = [];
    this.closedError = null;
    this.socket.on('data', (chunk: Buffer | string) => {
      this.buffer += chunk.toString();
      this.flushLines();
    });
    this.socket.on('error', (error) => {
      this.closedError = error instanceof Error ? error : new Error(String(error));
      this.flushWaiters();
    });
    this.socket.on('close', () => {
      if (!this.closedError) this.closedError = new Error('SMTP 连接已关闭');
      this.flushWaiters();
    });
  }

  async readResponse(timeoutMs: number): Promise<SmtpResponse> {
    const lines: string[] = [];
    const start = Date.now();
    while (true) {
      if (this.lines.length > 0) {
        const line = this.lines.shift()!;
        lines.push(line);
        if (/^\d{3} /.test(line)) {
          const code = Number(line.slice(0, 3));
          return { code, lines, text: lines.join('\n') };
        }
        continue;
      }
      if (this.closedError) throw this.closedError;
      const elapsed = Date.now() - start;
      const remaining = timeoutMs - elapsed;
      if (remaining <= 0) throw new Error('SMTP 响应超时');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== done);
          reject(new Error('SMTP 响应超时'));
        }, remaining);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        this.waiters.push(done);
      });
    }
  }

  async sendCommand(command: string, expectedCodes: number[], timeoutMs: number): Promise<SmtpResponse> {
    await this.write(`${command}\r\n`);
    const response = await this.readResponse(timeoutMs);
    if (!expectedCodes.includes(response.code)) {
      throw new Error(`SMTP 命令失败: ${command} -> ${response.text}`);
    }
    return response;
  }

  async sendData(data: string, timeoutMs: number): Promise<SmtpResponse> {
    await this.write(`${normalizeLines(data)}\r\n.\r\n`);
    const response = await this.readResponse(timeoutMs);
    if (response.code !== 250) {
      throw new Error(`SMTP DATA 发送失败: ${response.text}`);
    }
    return response;
  }

  async end(): Promise<void> {
    try {
      await this.write('QUIT\r\n');
    } catch {}
    this.socket.end();
  }

  getRawSocket(): SocketLike {
    return this.socket;
  }

  private async write(data: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.write(data, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private flushLines() {
    while (true) {
      const idx = this.buffer.indexOf('\r\n');
      if (idx < 0) break;
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      this.lines.push(line);
    }
    this.flushWaiters();
  }

  private flushWaiters() {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) waiter();
  }
}

function connectSocket(config: SmtpTransportConfig): Promise<SocketLike> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    const socket = config.secure
      ? tls.connect({
        host: config.host,
        port: config.port,
        servername: config.host,
      }, () => resolve(socket))
      : net.connect({
        host: config.host,
        port: config.port,
      }, () => resolve(socket));
    socket.once('error', onError);
    socket.setTimeout(config.timeoutMs || 20000, () => {
      socket.destroy(new Error('SMTP 连接超时'));
    });
  });
}

async function upgradeToTls(connection: SmtpConnection, config: SmtpTransportConfig): Promise<void> {
  const currentSocket = connection.getRawSocket();
  const tlsSocket = tls.connect({
    socket: currentSocket,
    servername: config.host,
  });
  await new Promise<void>((resolve, reject) => {
    tlsSocket.once('secureConnect', () => resolve());
    tlsSocket.once('error', reject);
  });
  connection.replaceSocket(tlsSocket);
}

export async function sendMailViaSmtp(config: SmtpTransportConfig, input: SmtpSendMailInput): Promise<void> {
  const timeoutMs = config.timeoutMs || 20000;
  const socket = await connectSocket(config);
  const connection = new SmtpConnection(socket);
  try {
    const greeting = await connection.readResponse(timeoutMs);
    if (greeting.code !== 220) {
      throw new Error(`SMTP 握手失败: ${greeting.text}`);
    }

    const ehlo = await connection.sendCommand('EHLO aceharness.local', [250], timeoutMs);
    const supportsStartTls = ehlo.lines.some((line) => /STARTTLS/i.test(line));
    if (!config.secure && supportsStartTls) {
      await connection.sendCommand('STARTTLS', [220], timeoutMs);
      await upgradeToTls(connection, config);
      await connection.sendCommand('EHLO aceharness.local', [250], timeoutMs);
    }

    if (config.username && config.password) {
      await connection.sendCommand('AUTH LOGIN', [334], timeoutMs);
      await connection.sendCommand(Buffer.from(config.username, 'utf8').toString('base64'), [334], timeoutMs);
      await connection.sendCommand(Buffer.from(config.password, 'utf8').toString('base64'), [235], timeoutMs);
    }

    await connection.sendCommand(`MAIL FROM:<${config.fromEmail.trim()}>`, [250], timeoutMs);
    for (const recipient of [...input.to, ...(input.cc || [])]) {
      await connection.sendCommand(`RCPT TO:<${recipient.trim()}>`, [250, 251], timeoutMs);
    }
    await connection.sendCommand('DATA', [354], timeoutMs);
    await connection.sendData(buildMessage(config, input), timeoutMs);
  } finally {
    await connection.end().catch(() => {});
  }
}
