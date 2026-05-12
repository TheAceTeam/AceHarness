import { randomUUID } from 'crypto';
import { setTimeout as sleep } from 'timers/promises';
import { listChatSessions } from '@/lib/chat-persistence';
import {
  deleteChannelIntegration,
  listChannelBindings,
  listChannelIntegrations,
  saveChannelIntegration,
  type ChannelIntegration,
} from '@/lib/channel-store';
import {
  getWeChatOfficialAccount,
  listWeChatOfficialAccounts,
  saveWeChatOfficialAccount,
  type WeChatOfficialAccount,
} from '@/lib/wechat-official-store';
import {
  getWeChatOfficialQrStatus,
  requestWeChatOfficialQr,
  runWeChatOfficialBridge,
  saveConfirmedWeChatOfficialAccount,
} from '@/lib/wechat-official-client';

type LoginSessionStatus = 'pending' | 'scanned' | 'confirmed' | 'expired' | 'error';

export interface WeChatOfficialLoginSession {
  id: string;
  qrcode: string;
  qrcodeUrl: string;
  status: LoginSessionStatus;
  createdBy?: string;
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
const RESTORE_GUARD_KEY = '__aceharnessWechatOfficialRestoreScheduled';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function hostForUrl(host: string): string {
  if (host === '0.0.0.0' || host === '::' || host === '[::]') return '127.0.0.1';
  if (host.includes(':') && !host.startsWith('[') && !host.startsWith('http://') && !host.startsWith('https://')) {
    return `[${host}]`;
  }
  return host;
}

function resolveLocalOrigin(origin?: string): string {
  const explicit = String(
    origin
    || process.env.ACE_PUBLIC_ORIGIN
    || process.env.NEXT_PUBLIC_ACE_ORIGIN
    || process.env.NEXT_PUBLIC_APP_ORIGIN
    || ''
  ).trim();
  if (explicit) return trimTrailingSlash(explicit);

  const host = hostForUrl(String(process.env.ACE_HOST || '127.0.0.1').trim() || '127.0.0.1');
  const port = String(process.env.PORT || process.env.ACE_PORT || '3000').trim() || '3000';
  if (host.startsWith('http://') || host.startsWith('https://')) return trimTrailingSlash(host);
  return `http://${host}:${port}`;
}

function buildWebhookUrl(integration: ChannelIntegration, origin?: string): string {
  const path = String(integration.webhookPath || '').trim();
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${resolveLocalOrigin(origin)}${path.startsWith('/') ? path : `/${path}`}`;
}

function configuredOfficialAccountId(integration: ChannelIntegration): string {
  const config = integration.providerConfig || {};
  return String(
    config.wechatOfficialAccountId
    || config.officialAccountId
    || config.accountId
    || ''
  ).trim();
}

function hasExplicitOfficialRestoreConfig(integration: ChannelIntegration): boolean {
  return integration.providerConfig?.wechatOfficialAutoStart === true || Boolean(configuredOfficialAccountId(integration));
}

function findRunningBridgeByAccount(accountId: string): BridgeRuntime | null {
  for (const bridge of bridges.values()) {
    if (bridge.accountId === accountId && bridge.running) return bridge;
  }
  return null;
}

function resolveRestorableAccountId(input: {
  integration: ChannelIntegration;
  chatSessions: Awaited<ReturnType<typeof listChatSessions>>;
}): string {
  const configured = configuredOfficialAccountId(input.integration);
  if (configured) return configured;

  const sessionAccountIds = Array.from(new Set(input.chatSessions
    .filter((session) => session.createdBy === input.integration.createdBy)
    .map((session) => session.sessionWorkbenchState?.wechatBinding)
    .filter((binding) => binding?.integrationId === input.integration.id && binding.accountId)
    .map((binding) => String(binding?.accountId || '').trim())
    .filter(Boolean)));
  if (sessionAccountIds.length === 1) return sessionAccountIds[0];

  return '';
}

function isOfficialRestoreCandidate(input: {
  integration: ChannelIntegration;
  chatSessions: Awaited<ReturnType<typeof listChatSessions>>;
  bindings: Awaited<ReturnType<typeof listChannelBindings>>;
}): boolean {
  if (input.integration.provider !== 'wechat-bridge' || !input.integration.enabled) return false;
  if (hasExplicitOfficialRestoreConfig(input.integration)) return true;

  const hasHomeBinding = input.bindings.some((binding) =>
    binding.integrationId === input.integration.id
    && binding.metadata?.source === 'home-session-bind'
  );
  if (hasHomeBinding) return true;

  return input.chatSessions.some((session) =>
    session.sessionWorkbenchState?.wechatBinding?.integrationId === input.integration.id
  );
}

function cleanupExpiredSessions(now = Date.now()) {
  for (const [id, session] of loginSessions.entries()) {
    if (now - session.updatedAt > LOGIN_SESSION_TTL_MS) {
      loginSessions.delete(id);
    }
  }
}

export async function createWeChatOfficialLoginSession(input?: { createdBy?: string }): Promise<WeChatOfficialLoginSession> {
  cleanupExpiredSessions();
  const qr = await requestWeChatOfficialQr();
  const now = Date.now();
  const session: WeChatOfficialLoginSession = {
    id: `wechat-login-${randomUUID()}`,
    qrcode: qr.qrcode,
    qrcodeUrl: qr.qrcodeUrl,
    status: 'pending',
    createdBy: input?.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  loginSessions.set(session.id, session);
  return session;
}

export async function getWeChatOfficialLoginSession(id: string, input?: { createdBy?: string }): Promise<WeChatOfficialLoginSession | null> {
  cleanupExpiredSessions();
  const existing = loginSessions.get(id);
  if (!existing) return null;
  if (existing.createdBy && input?.createdBy && existing.createdBy !== input.createdBy) return null;

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
    if (nextStatus === 'confirmed') {
      await saveConfirmedWeChatOfficialAccount(result, { createdBy: existing.createdBy });
    }
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

export async function waitForWeChatOfficialLogin(id: string, timeoutMs = WAIT_LOGIN_TIMEOUT_MS, input?: { createdBy?: string }): Promise<WeChatOfficialLoginSession | null> {
  cleanupExpiredSessions();
  let existing = loginSessions.get(id);
  if (!existing) return null;
  if (existing.createdBy && input?.createdBy && existing.createdBy !== input.createdBy) return null;

  const deadline = Date.now() + Math.max(timeoutMs, 1_000);
  while (Date.now() < deadline) {
    const next = await getWeChatOfficialLoginSession(id, input);
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
  createdBy?: string;
}): Promise<BridgeRuntime> {
  const key = `${input.accountId}:${input.integrationId}`;
  const existing = bridges.get(key);
  if (existing?.running) {
    return existing;
  }
  const accountBridge = findRunningBridgeByAccount(input.accountId);
  if (accountBridge && accountBridge.integrationId !== input.integrationId) {
    throw new Error(`微信账号已在接入点 ${accountBridge.integrationId} 上运行，请勿重复启动同一账号`);
  }

  const account = await getWeChatOfficialAccount(input.accountId);
  if (!account) {
    throw new Error('微信账号不存在，请先完成扫码绑定');
  }
  if (account.createdBy && input.createdBy && account.createdBy !== input.createdBy) {
    throw new Error('微信账号不属于当前用户');
  }
  const ownedAccount = !account.createdBy && input.createdBy
    ? await saveWeChatOfficialAccount({ ...account, createdBy: input.createdBy })
    : account;

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
    account: ownedAccount as WeChatOfficialAccount,
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

export async function rememberWeChatOfficialBridge(input: {
  integration: ChannelIntegration;
  accountId: string;
  origin?: string;
}): Promise<ChannelIntegration> {
  return saveChannelIntegration({
    ...input.integration,
    providerConfig: {
      ...(input.integration.providerConfig || {}),
      wechatOfficialAccountId: input.accountId,
      wechatOfficialOwnerId: input.integration.createdBy,
      wechatOfficialAutoStart: true,
      wechatOfficialWebhookOrigin: resolveLocalOrigin(input.origin),
      wechatOfficialStartedAt: Date.now(),
    },
  });
}

export async function restoreWeChatOfficialBridges(input: {
  origin?: string;
} = {}): Promise<{
  restored: BridgeRuntime[];
  skipped: Array<{ integrationId: string; reason: string }>;
  cleaned: Array<{ integrationId: string; reason: string }>;
}> {
  const integrations = await listChannelIntegrations();
  const [chatSessions, accounts, bindings] = await Promise.all([
    listChatSessions().catch(() => []),
    listWeChatOfficialAccounts().catch(() => []),
    listChannelBindings().catch(() => []),
  ]);

  const restorableIntegrations = integrations.filter((integration) =>
    isOfficialRestoreCandidate({ integration, chatSessions, bindings })
  );

  if (restorableIntegrations.length === 0) {
    return { restored: [], skipped: [], cleaned: [] };
  }
  const accountById = new Map(accounts.map((account) => [account.accountId, account]));
  const restoredAccountIds = new Set<string>();
  const restored: BridgeRuntime[] = [];
  const skipped: Array<{ integrationId: string; reason: string }> = [];
  const cleaned: Array<{ integrationId: string; reason: string }> = [];

  const cleanInvalidIntegration = async (integration: ChannelIntegration, reason: string) => {
    await deleteChannelIntegration(integration.id).catch(() => false);
    cleaned.push({ integrationId: integration.id, reason });
  };

  const orderedIntegrations = [...restorableIntegrations].sort((a, b) => {
    const aStarted = typeof a.providerConfig?.wechatOfficialStartedAt === 'number' ? a.providerConfig.wechatOfficialStartedAt : a.updatedAt;
    const bStarted = typeof b.providerConfig?.wechatOfficialStartedAt === 'number' ? b.providerConfig.wechatOfficialStartedAt : b.updatedAt;
    return bStarted - aStarted;
  });

  for (const integration of orderedIntegrations) {
    const accountId = resolveRestorableAccountId({
      integration,
      chatSessions,
    });
    if (!accountId) {
      await cleanInvalidIntegration(integration, 'missing-account-id');
      continue;
    }
    const account = accountById.get(accountId);
    if (!account) {
      await cleanInvalidIntegration(integration, 'account-not-found');
      continue;
    }
    if (!account.createdBy || account.createdBy !== integration.createdBy) {
      await cleanInvalidIntegration(integration, account.createdBy ? 'account-owner-mismatch' : 'unowned-account');
      continue;
    }
    if (restoredAccountIds.has(accountId)) {
      await cleanInvalidIntegration(integration, 'account-already-restored');
      continue;
    }
    if (!integration.secret || !integration.webhookPath) {
      await cleanInvalidIntegration(integration, 'missing-webhook-or-secret');
      continue;
    }

    try {
      const origin = String(integration.providerConfig?.wechatOfficialWebhookOrigin || input.origin || '').trim();
      const runtime = await startWeChatOfficialBridge({
        accountId,
        integrationId: integration.id,
        webhookUrl: buildWebhookUrl(integration, origin),
        secret: integration.secret,
        createdBy: integration.createdBy,
      });
      restored.push(runtime);
      restoredAccountIds.add(accountId);

      if (configuredOfficialAccountId(integration) !== accountId) {
        await rememberWeChatOfficialBridge({
          integration,
          accountId,
          origin: origin || input.origin,
        }).catch(() => integration);
      }
    } catch (error: any) {
      await cleanInvalidIntegration(integration, error?.message || 'restore-failed');
    }
  }

  if (restored.length > 0) {
    console.log(`[ACEHarness WeChat] restored ${restored.length} official bridge(s)`);
  }
  for (const item of skipped) {
    console.warn(`[ACEHarness WeChat] skipped restore integration=${item.integrationId}: ${item.reason}`);
  }
  for (const item of cleaned) {
    console.warn(`[ACEHarness WeChat] removed invalid restore integration=${item.integrationId}: ${item.reason}`);
  }

  return { restored, skipped, cleaned };
}

export function scheduleWeChatOfficialBridgeRestore(input: {
  origin?: string;
  delayMs?: number;
} = {}): void {
  if (process.env.ACE_WECHAT_AUTO_RESTORE === '0' || process.env.ACE_WECHAT_AUTO_RESTORE === 'false') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const globalScope = globalThis as typeof globalThis & Record<string, boolean | undefined>;
  if (globalScope[RESTORE_GUARD_KEY]) return;
  globalScope[RESTORE_GUARD_KEY] = true;

  const configuredDelay = Number(process.env.ACE_WECHAT_RESTORE_DELAY_MS || '');
  const delayMs = input.delayMs ?? (Number.isFinite(configuredDelay) && configuredDelay >= 0 ? configuredDelay : 3000);
  const timer = setTimeout(() => {
    void restoreWeChatOfficialBridges({ origin: input.origin }).catch((error: any) => {
      console.error('[ACEHarness WeChat] bridge restore failed:', error?.message || error);
    });
  }, delayMs);
  if (typeof (timer as any)?.unref === 'function') {
    (timer as any).unref();
  }
}

export function getWeChatOfficialBridgeStatus(accountId: string, integrationId: string): BridgeRuntime | null {
  return bridges.get(`${accountId}:${integrationId}`) || null;
}
