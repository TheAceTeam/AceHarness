import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { randomBytes, randomUUID } from 'crypto';
import { setTimeout as sleep } from 'timers/promises';
import {
  getWeChatOfficialAccount,
  getWeChatAccountSyncBuf,
  getWeChatContextToken,
  saveWeChatOfficialAccount,
  setWeChatContextToken,
  setWeChatSyncState,
  type WeChatOfficialAccount,
} from '@/lib/wechat-official-store';

const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com';
const ILINK_APP_ID = 'wx3dd0f1f4d9b0b8c6';
const ILINK_APP_CLIENT_VERSION = (2 << 16) | (1 << 8) | 3;
const CHANNEL_VERSION = '1.0.3';
const EP_GET_UPDATES = 'ilink/bot/getupdates';
const EP_SEND_MESSAGE = 'ilink/bot/sendmessage';
const EP_GET_BOT_QR = 'ilink/bot/get_bot_qrcode';
const EP_GET_QR_STATUS = 'ilink/bot/get_qrcode_status';

export interface WeChatOfficialLoginResult {
  accountId: string;
  token: string;
  baseUrl: string;
  userId: string;
}

export interface WeChatOfficialQrStatus {
  status: string;
  accountId?: string;
  token?: string;
  baseUrl?: string;
  userId?: string;
}

export interface WeChatInboundEnvelope {
  conversationId: string;
  conversationName?: string;
  userId: string;
  userName?: string;
  messageId?: string;
  text: string;
  contextToken?: string;
  raw: any;
}

export interface WeChatBridgeOptions {
  integrationId: string;
  webhookUrl: string;
  secret: string;
  account: WeChatOfficialAccount;
  onEvent?: (event: string, payload?: Record<string, any>) => void;
}

function flattenReactText(node: any): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenReactText).join('');
  if (React.isValidElement(node)) {
    return flattenReactText((node.props as { children?: any })?.children);
  }
  return '';
}

function normalizePlainText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function sanitizeWeChatPlainText(input: string): string {
  const markdown = String(input || '').trim();
  if (!markdown) return '';

  const rendered = (ReactMarkdown as any)({
    children: markdown,
    remarkPlugins: [remarkGfm],
    skipHtml: true,
    components: {
      h1: ({ children }: any) => React.createElement(React.Fragment, null, children, '\n\n'),
      h2: ({ children }: any) => React.createElement(React.Fragment, null, children, '\n\n'),
      h3: ({ children }: any) => React.createElement(React.Fragment, null, children, '\n\n'),
      h4: ({ children }: any) => React.createElement(React.Fragment, null, children, '\n\n'),
      h5: ({ children }: any) => React.createElement(React.Fragment, null, children, '\n\n'),
      h6: ({ children }: any) => React.createElement(React.Fragment, null, children, '\n\n'),
      p: ({ children }: any) => React.createElement(React.Fragment, null, children, '\n\n'),
      br: () => '\n',
      ul: ({ children }: any) => React.createElement(React.Fragment, null, children, '\n'),
      ol: ({ children }: any) => React.createElement(React.Fragment, null, children, '\n'),
      li: ({ children }: any) => React.createElement(React.Fragment, null, children, '\n'),
      blockquote: ({ children }: any) => React.createElement(React.Fragment, null, children, '\n\n'),
      table: ({ children }: any) => React.createElement(React.Fragment, null, children, '\n'),
      thead: ({ children }: any) => React.createElement(React.Fragment, null, children),
      tbody: ({ children }: any) => React.createElement(React.Fragment, null, children),
      tr: ({ children }: any) => React.createElement(React.Fragment, null, children, '\n'),
      th: ({ children }: any) => React.createElement(React.Fragment, null, children, ' '),
      td: ({ children }: any) => React.createElement(React.Fragment, null, children, ' '),
      a: ({ children }: any) => React.createElement(React.Fragment, null, children),
      img: () => '',
      pre: () => '',
      code: () => '',
      hr: () => '\n',
    },
  });

  return normalizePlainText(flattenReactText(rendered));
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function randomWechatUin(): string {
  const value = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function buildHeaders(token: string | null, body: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'Content-Length': String(Buffer.byteLength(body, 'utf8')),
    'X-WECHAT-UIN': randomWechatUin(),
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function buildBaseInfo() {
  return { channel_version: CHANNEL_VERSION };
}

async function apiPost(baseUrl: string, endpoint: string, payload: Record<string, any>, token: string | null, timeoutMs = 15000): Promise<any> {
  const url = `${ensureTrailingSlash(baseUrl)}${endpoint}`;
  const body = JSON.stringify({ ...payload, base_info: buildBaseInfo() });
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token, body),
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`iLink ${endpoint} HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

async function apiGet(baseUrl: string, endpoint: string, timeoutMs = 35000): Promise<any> {
  const url = `${ensureTrailingSlash(baseUrl)}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'iLink-App-Id': ILINK_APP_ID,
      'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`iLink GET ${endpoint} HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

async function apiGetQrCode(botType: string, timeoutMs = 15000): Promise<any> {
  const url = `${ensureTrailingSlash(ILINK_BASE_URL)}${EP_GET_BOT_QR}?bot_type=${encodeURIComponent(botType)}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`iLink GET ${EP_GET_BOT_QR} HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

async function apiGetQrStatus(qrcode: string, timeoutMs = 35000): Promise<any> {
  const url = `${ensureTrailingSlash(ILINK_BASE_URL)}${EP_GET_QR_STATUS}?qrcode=${encodeURIComponent(qrcode)}`;
  try {
    const response = await fetch(url, {
      headers: {
        'iLink-App-ClientVersion': '1',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`iLink GET ${EP_GET_QR_STATUS} HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text);
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return { status: 'wait' };
    }
    throw error;
  }
}

export async function requestWeChatOfficialQr(botType = '3'): Promise<{ qrcode: string; qrcodeUrl: string }> {
  const resp = await apiGetQrCode(botType);
  return {
    qrcode: String(resp?.qrcode || ''),
    qrcodeUrl: String(resp?.qrcode_img_content || ''),
  };
}

function normalizeQrStatusPayload(statusResp: any): WeChatOfficialQrStatus {
  const rawStatus = String(statusResp?.status || '').trim().toLowerCase();
  const accountId = String(statusResp?.ilink_bot_id || '').trim();
  const token = String(statusResp?.bot_token || '').trim();
  const userId = String(statusResp?.ilink_user_id || '').trim();
  const baseUrl = String(statusResp?.baseurl || ILINK_BASE_URL).trim();

  // Some responses do not use a stable status string, but the presence of
  // account/token is enough to confirm login success.
  if (accountId && token) {
    return {
      status: 'confirmed',
      accountId,
      token,
      userId,
      baseUrl,
    };
  }

  if ([
    'confirmed',
    'confirm',
    'success',
    'ok',
    'done',
    'logined',
    'logged_in',
  ].includes(rawStatus)) {
    return { status: 'confirmed' };
  }

  if ([
    'scaned',
    'scanned',
    'scan',
    'scanning',
    'wait_confirm',
    'waiting_confirm',
    'confirming',
  ].includes(rawStatus)) {
    return { status: 'scaned' };
  }

  if ([
    'expired',
    'expire',
    'timeout',
    'invalid',
  ].includes(rawStatus)) {
    return { status: 'expired' };
  }

  return { status: 'wait' };
}

export async function getWeChatOfficialQrStatus(qrcode: string): Promise<WeChatOfficialQrStatus> {
  const statusResp = await apiGetQrStatus(qrcode);
  return normalizeWeChatOfficialQrStatus(statusResp);
}

export async function normalizeWeChatOfficialQrStatus(statusResp: any): Promise<WeChatOfficialQrStatus> {
  const normalized = normalizeQrStatusPayload(statusResp);
  const status = normalized.status;
  if (status !== 'confirmed') {
    return normalized;
  }

  const result: WeChatOfficialQrStatus = {
    status,
    accountId: normalized.accountId || '',
    token: normalized.token || '',
    baseUrl: normalized.baseUrl || ILINK_BASE_URL,
    userId: normalized.userId || '',
  };
  if (!result.accountId || !result.token) {
    throw new Error('扫码成功但未拿到 accountId / token');
  }
  return result;
}

export async function saveConfirmedWeChatOfficialAccount(
  result: WeChatOfficialQrStatus,
  input?: { createdBy?: string },
): Promise<WeChatOfficialQrStatus> {
  if (result.status !== 'confirmed' || !result.accountId || !result.token) {
    throw new Error('微信扫码状态未确认，无法保存账号');
  }
  await saveWeChatOfficialAccount({
    accountId: result.accountId,
    token: result.token,
    baseUrl: result.baseUrl || ILINK_BASE_URL,
    userId: result.userId || '',
    createdBy: input?.createdBy,
  });
  return result;
}

export async function runWeChatOfficialQrLogin(input?: {
  botType?: string;
  timeoutMs?: number;
  onQr?: (payload: { qrcode: string; qrcodeUrl: string }) => Promise<void> | void;
  onStatus?: (status: string) => Promise<void> | void;
}): Promise<WeChatOfficialLoginResult> {
  const botType = input?.botType || '3';
  const timeoutMs = input?.timeoutMs || 8 * 60_000;
  const startedAt = Date.now();
  let currentBase = ILINK_BASE_URL;
  let { qrcode, qrcodeUrl } = await requestWeChatOfficialQr(botType);

  if (!qrcode) {
    throw new Error('微信二维码获取失败');
  }

  await input?.onQr?.({ qrcode, qrcodeUrl });

  while (Date.now() - startedAt < timeoutMs) {
    const statusResp = await getWeChatOfficialQrStatus(qrcode);
    const status = statusResp.status;
    await input?.onStatus?.(status);

    if (status === 'confirmed') {
      await saveConfirmedWeChatOfficialAccount(statusResp);
      const result: WeChatOfficialLoginResult = {
        accountId: String(statusResp.accountId || ''),
        token: String(statusResp.token || ''),
        baseUrl: String(statusResp.baseUrl || currentBase || ILINK_BASE_URL),
        userId: String(statusResp.userId || ''),
      };
      return result;
    }

    if (status === 'expired') {
      const refreshed = await requestWeChatOfficialQr(botType);
      qrcode = refreshed.qrcode;
      qrcodeUrl = refreshed.qrcodeUrl;
      await input?.onQr?.({ qrcode, qrcodeUrl });
    }

    await sleep(1000);
  }

  throw new Error('微信扫码登录超时');
}

function extractText(itemList: any[]): string {
  const texts = itemList
    .filter((item) => item?.type === 1 && typeof item?.text_item?.text === 'string')
    .map((item) => item.text_item.text.trim())
    .filter(Boolean);
  return texts.join('\n').trim();
}

function normalizeMessage(msg: any): WeChatInboundEnvelope | null {
  const itemList = Array.isArray(msg?.item_list) ? msg.item_list : [];
  const text = extractText(itemList);
  if (!text) return null;

  const fromUserId = String(msg?.from_user_id || '').trim();
  const toUserId = String(msg?.to_user_id || '').trim();
  const conversationId = String(msg?.group_id || fromUserId || toUserId || '').trim();
  if (!conversationId) return null;

  return {
    conversationId,
    conversationName: typeof msg?.group_name === 'string' ? msg.group_name : undefined,
    userId: fromUserId || 'unknown',
    userName: typeof msg?.from_user_name === 'string' ? msg.from_user_name : undefined,
    messageId: msg?.client_id ? String(msg.client_id) : undefined,
    text,
    contextToken: typeof msg?.context_token === 'string' ? msg.context_token : undefined,
    raw: msg,
  };
}

async function getUpdates(account: WeChatOfficialAccount): Promise<any> {
  const syncBuf = await getWeChatAccountSyncBuf(account.accountId);
  return apiPost(account.baseUrl || ILINK_BASE_URL, EP_GET_UPDATES, { get_updates_buf: syncBuf }, account.token, 35000);
}

async function sendText(account: WeChatOfficialAccount, to: string, text: string, contextToken?: string | null): Promise<void> {
  if (!contextToken?.trim()) {
    throw new Error(`Missing context_token for ${to}. User must send at least one inbound message first.`);
  }

  const normalizedText = sanitizeWeChatPlainText(text);
  if (!normalizedText.trim()) {
    throw new Error('Empty outbound text after WeChat plain-text sanitization.');
  }

  const msg: Record<string, any> = {
    from_user_id: '',
    to_user_id: to,
    client_id: `aceharness-wechat-${randomUUID()}`,
    message_type: 2,
    message_state: 2,
    context_token: contextToken,
    item_list: [{ type: 1, text_item: { text: normalizedText } }],
  };
  await apiPost(account.baseUrl || ILINK_BASE_URL, EP_SEND_MESSAGE, { msg }, account.token, 15000);
}

export async function sendWeChatOfficialText(input: {
  accountId: string;
  userId: string;
  text: string;
}): Promise<{ ok: boolean; text?: string; error?: string }> {
  const account = await getWeChatOfficialAccount(input.accountId);
  if (!account) {
    return { ok: false, error: `WeChat account not found: ${input.accountId}` };
  }
  const contextToken = await getWeChatContextToken(account.accountId, input.userId);
  if (!contextToken) {
    return { ok: false, error: `Missing context_token for ${input.userId}` };
  }
  const text = sanitizeWeChatPlainText(input.text);
  if (!text) {
    return { ok: false, error: 'Empty outbound text after sanitization' };
  }
  await sendText(account, input.userId, text, contextToken);
  return { ok: true, text };
}

async function forwardToAceHarness(options: WeChatBridgeOptions, message: WeChatInboundEnvelope): Promise<any> {
  const response = await fetch(options.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ace-channel-secret': options.secret,
    },
    body: JSON.stringify({
      secret: options.secret,
      message: {
        conversationId: message.conversationId,
        conversationName: message.conversationName,
        userId: message.userId,
        userName: message.userName,
        messageId: message.messageId,
        text: message.text,
      },
      raw: message.raw,
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.error || `ACEHarness inbound HTTP ${response.status}`);
  }
  return json;
}

export async function runWeChatOfficialBridge(options: WeChatBridgeOptions): Promise<void> {
  options.onEvent?.('bridge-start', {
    integrationId: options.integrationId,
    accountId: options.account.accountId,
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await getUpdates(options.account).catch((error) => {
      options.onEvent?.('poll-error', { error: error instanceof Error ? error.message : String(error) });
      return null;
    });
    if (!result) {
      await sleep(2000);
      continue;
    }

    if (typeof result?.get_updates_buf === 'string') {
      await setWeChatSyncState(options.account.accountId, result.get_updates_buf);
    }

    const messages = Array.isArray(result?.msgs) ? result.msgs : [];
    for (const rawMsg of messages) {
      const normalized = normalizeMessage(rawMsg);
      if (!normalized) continue;

      const isFirstContact = !(await getWeChatContextToken(options.account.accountId, normalized.userId));
      if (normalized.contextToken) {
        await setWeChatContextToken(options.account.accountId, normalized.userId, normalized.contextToken);
      }

      options.onEvent?.('inbound', {
        conversationId: normalized.conversationId,
        userId: normalized.userId,
        text: normalized.text,
      });

      const aceResult = await forwardToAceHarness(options, normalized).catch((error) => {
        options.onEvent?.('forward-error', { error: error instanceof Error ? error.message : String(error) });
        return null;
      });
      if (!aceResult) continue;

      const contextToken = await getWeChatContextToken(options.account.accountId, normalized.userId);
      const replyMessages = Array.isArray(aceResult?.replyMessages)
        ? aceResult.replyMessages
        : Array.isArray(aceResult?.replies)
          ? aceResult.replies.map((text: string) => ({ kind: 'text', text }))
          : [];

      if (isFirstContact) {
        await sendText(
          options.account,
          normalized.userId,
          '微信已连接成功，现在可以直接在这里继续对话。',
          normalized.contextToken || contextToken,
        ).catch((error) => {
          options.onEvent?.('send-error', { error: error instanceof Error ? error.message : String(error), text: '微信已连接成功，现在可以直接在这里继续对话。' });
        });
        options.onEvent?.('outbound', { to: normalized.userId, text: '微信已连接成功，现在可以直接在这里继续对话。' });
      }

      for (const reply of replyMessages) {
        const text = reply?.speakerName ? `${reply.speakerName}: ${reply.text}` : String(reply?.text || '');
        if (!text.trim()) continue;
        await sendText(options.account, normalized.userId, text, contextToken).catch((error) => {
          options.onEvent?.('send-error', { error: error instanceof Error ? error.message : String(error), text });
        });
        options.onEvent?.('outbound', { to: normalized.userId, text });
      }
    }
  }
}
