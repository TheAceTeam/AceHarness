import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { getWorkspaceDataFile } from '@/lib/app-paths';

export interface WeChatOfficialAccount {
  accountId: string;
  token: string;
  baseUrl: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
}

const ACCOUNTS_PATH = getWorkspaceDataFile('wechat-official', 'accounts.json');
const CONTEXT_TOKENS_PATH = getWorkspaceDataFile('wechat-official', 'context-tokens.json');
const SYNC_STATE_PATH = getWorkspaceDataFile('wechat-official', 'sync-state.json');

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(path, 'utf8');
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

export async function listWeChatOfficialAccounts(): Promise<WeChatOfficialAccount[]> {
  return readJsonFile<WeChatOfficialAccount[]>(ACCOUNTS_PATH, []);
}

export async function saveWeChatOfficialAccount(input: Omit<WeChatOfficialAccount, 'createdAt' | 'updatedAt'> & Partial<Pick<WeChatOfficialAccount, 'createdAt' | 'updatedAt'>>): Promise<WeChatOfficialAccount> {
  const accounts = await listWeChatOfficialAccounts();
  const now = Date.now();
  const next: WeChatOfficialAccount = {
    ...input,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
  const index = accounts.findIndex((item) => item.accountId === next.accountId);
  if (index >= 0) accounts[index] = { ...accounts[index], ...next, createdAt: accounts[index].createdAt, updatedAt: now };
  else accounts.push(next);
  await writeJsonFile(ACCOUNTS_PATH, accounts);
  return next;
}

export async function getWeChatOfficialAccount(accountId: string): Promise<WeChatOfficialAccount | null> {
  return (await listWeChatOfficialAccounts()).find((item) => item.accountId === accountId) || null;
}

export async function getWeChatContextTokens(): Promise<Record<string, string>> {
  return readJsonFile<Record<string, string>>(CONTEXT_TOKENS_PATH, {});
}

export async function setWeChatContextToken(accountId: string, userId: string, token: string): Promise<void> {
  const tokens = await getWeChatContextTokens();
  tokens[`${accountId}:${userId}`] = token;
  await writeJsonFile(CONTEXT_TOKENS_PATH, tokens);
}

export async function getWeChatContextToken(accountId: string, userId: string): Promise<string | null> {
  const tokens = await getWeChatContextTokens();
  return tokens[`${accountId}:${userId}`] || null;
}

export async function getWeChatSyncState(): Promise<Record<string, string>> {
  return readJsonFile<Record<string, string>>(SYNC_STATE_PATH, {});
}

export async function setWeChatSyncState(accountId: string, syncBuf: string): Promise<void> {
  const state = await getWeChatSyncState();
  state[accountId] = syncBuf;
  await writeJsonFile(SYNC_STATE_PATH, state);
}

export async function getWeChatAccountSyncBuf(accountId: string): Promise<string> {
  const state = await getWeChatSyncState();
  return state[accountId] || '';
}
