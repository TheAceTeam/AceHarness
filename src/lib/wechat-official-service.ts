import { randomUUID } from 'crypto';
import { setTimeout as sleep } from 'timers/promises';
import { getWeChatOfficialAccount, type WeChatOfficialAccount } from '@/lib/wechat-official-store';
import {
  getWeChatOfficialQrStatus,
  requestWeChatOfficialQr,
  runWeChatOfficialBridge,
} from '@/lib/wechat-official-client';

type LoginSessionStatus = 'pending' | 'scanned' | 'confirmed' | 'expired' | 'error';

export interface WeChatOfficialLoginSession {
  id: string;
  qrcode: string;
  qrcodeUrl: string;
  status: LoginSessionStatus;
  accountId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

interface BridgeRuntime {
  key: string;
  accountId: string;
  integrationId: string;
  webhookUrl: string;
  running: boolean;
  startedAt: number;
  lastEventAt: number;
  lastEvent?: string;
  lastError?: string;
}

const LOGIN_SESSION_TTL_MS = 10 * 60_000;
const loginSessions = new Map<string, WeChatOfficialLoginSession>();
const bridges = new Map<string, BridgeRuntime>();
const WAIT_LOGIN_TIMEOUT_MS = 45_000;

function cleanupExpiredSessions(now = Date.now()) {
  for (const [id, session] of loginSessions.entries()) {
    if (now - session.updatedAt > LOGIN_SESSION_TTL_MS) {
      loginSessions.delete(id);
    }
  }
}

export async function createWeChatOfficialLoginSession(): Promise<WeChatOfficialLoginSession> {
  cleanupExpiredSessions();
  const qr = await requestWeChatOfficialQr();
  const now = Date.now();
  const session: WeChatOfficialLoginSession = {
    id: `wechat-login-${randomUUID()}`,
    qrcode: qr.qrcode,
    qrcodeUrl: qr.qrcodeUrl,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  loginSessions.set(session.id, session);
  return session;
}

export async function getWeChatOfficialLoginSession(id: string): Promise<WeChatOfficialLoginSession | null> {
  cleanupExpiredSessions();
  const existing = loginSessions.get(id);
  if (!existing) return null;

  if (existing.status === 'confirmed' || existing.status === 'expired' || existing.status === 'error') {
    return existing;
  }

  try {
    const result = await getWeChatOfficialQrStatus(existing.qrcode);
    const nextStatus: LoginSessionStatus =
      result.status === 'confirmed'
        ? 'confirmed'
        : result.status === 'expired'
          ? 'expired'
          : result.status === 'scaned' || result.status === 'scanned'
            ? 'scanned'
            : 'pending';

    const next: WeChatOfficialLoginSession = {
      ...existing,
      status: nextStatus,
      accountId: result.accountId || existing.accountId,
      updatedAt: Date.now(),
    };
    loginSessions.set(id, next);
    return next;
  } catch (error: any) {
    const next: WeChatOfficialLoginSession = {
      ...existing,
      status: 'error',
      error: error?.message || '获取微信扫码状态失败',
      updatedAt: Date.now(),
    };
    loginSessions.set(id, next);
    return next;
  }
}

export async function waitForWeChatOfficialLogin(id: string, timeoutMs = WAIT_LOGIN_TIMEOUT_MS): Promise<WeChatOfficialLoginSession | null> {
  cleanupExpiredSessions();
  let existing = loginSessions.get(id);
  if (!existing) return null;

  const deadline = Date.now() + Math.max(timeoutMs, 1_000);
  while (Date.now() < deadline) {
    const next = await getWeChatOfficialLoginSession(id);
    if (!next) return null;
    existing = next;

    if (next.status === 'confirmed' || next.status === 'expired' || next.status === 'error') {
      return next;
    }

    await sleep(1000);
  }

  return existing;
}

export async function startWeChatOfficialBridge(input: {
  accountId: string;
  integrationId: string;
  webhookUrl: string;
  secret: string;
}): Promise<BridgeRuntime> {
  const key = `${input.accountId}:${input.integrationId}`;
  const existing = bridges.get(key);
  if (existing?.running) {
    return existing;
  }

  const account = await getWeChatOfficialAccount(input.accountId);
  if (!account) {
    throw new Error('微信账号不存在，请先完成扫码绑定');
  }

  const runtime: BridgeRuntime = {
    key,
    accountId: input.accountId,
    integrationId: input.integrationId,
    webhookUrl: input.webhookUrl,
    running: true,
    startedAt: Date.now(),
    lastEventAt: Date.now(),
  };
  bridges.set(key, runtime);
  console.log(`[ACEHarness WeChat] bridge start account=${input.accountId} integration=${input.integrationId}`);
  console.log(`[ACEHarness WeChat] inbound webhook => ${input.webhookUrl}`);

  void runWeChatOfficialBridge({
    integrationId: input.integrationId,
    webhookUrl: input.webhookUrl,
    secret: input.secret,
    account: account as WeChatOfficialAccount,
    onEvent(event, payload) {
      const current = bridges.get(key);
      if (!current) return;
      current.lastEvent = event;
      current.lastEventAt = Date.now();
      if (event.endsWith('error')) {
        current.lastError = String(payload?.error || 'unknown error');
        console.error(`[ACEHarness WeChat] ${event}: ${current.lastError}`);
      } else if (event === 'inbound') {
        console.log(
          `[ACEHarness WeChat] inbound ${String(payload?.conversationId || 'unknown')} <= ${String(payload?.userId || 'unknown')}: ${String(payload?.text || '').slice(0, 120)}`
        );
      } else if (event === 'outbound') {
        console.log(
          `[ACEHarness WeChat] outbound -> ${String(payload?.to || 'unknown')}: ${String(payload?.text || '').slice(0, 120)}`
        );
      } else {
        console.log(`[ACEHarness WeChat] ${event}`);
      }
    },
  }).catch((error: any) => {
    const current = bridges.get(key);
    if (!current) return;
    current.running = false;
    current.lastEventAt = Date.now();
    current.lastError = error?.message || '微信桥接器启动失败';
    console.error(`[ACEHarness WeChat] bridge-crash: ${current.lastError}`);
  });

  return runtime;
}

export function getWeChatOfficialBridgeStatus(accountId: string, integrationId: string): BridgeRuntime | null {
  return bridges.get(`${accountId}:${integrationId}`) || null;
}
