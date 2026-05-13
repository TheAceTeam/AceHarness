type EngineStreamStatus = 'running' | 'completed' | 'failed' | 'killed';

interface EngineStreamState {
  chatId: string;
  frontendSessionId?: string;
  backendSessionId?: string;
  engine?: string;
  model?: string;
  status: EngineStreamStatus;
  streamContent: string;
}

const chatsById = new Map<string, EngineStreamState>();
const frontendToChatId = new Map<string, string>();
const backendToChatId = new Map<string, string>();
const frontendToBackendSessionId = new Map<string, { backendSessionId: string; expiresAt: number }>();
const FRONTEND_SESSION_REUSE_TTL_MS = 9 * 60 * 1000;

export function registerEngineStream(chatId: string, frontendSessionId?: string, engine?: string, model?: string): void {
  chatsById.set(chatId, {
    chatId,
    frontendSessionId,
    engine,
    model,
    status: 'running',
    streamContent: '',
  });
  if (frontendSessionId) {
    frontendToChatId.set(frontendSessionId, chatId);
  }
}

export function appendEngineStreamContent(chatId: string, chunk: string): void {
  const state = chatsById.get(chatId);
  if (!state || !chunk) return;
  state.streamContent += chunk;
}

export function setEngineStreamSessionId(chatId: string, backendSessionId?: string): void {
  if (!backendSessionId) return;
  const state = chatsById.get(chatId);
  if (!state) return;
  state.backendSessionId = backendSessionId;
  backendToChatId.set(backendSessionId, chatId);
  if (state.frontendSessionId) {
    frontendToBackendSessionId.set(state.frontendSessionId, {
      backendSessionId,
      expiresAt: Date.now() + FRONTEND_SESSION_REUSE_TTL_MS,
    });
  }
}

export function setEngineStreamStatus(chatId: string, status: EngineStreamStatus): void {
  const state = chatsById.get(chatId);
  if (!state) return;
  state.status = status;
}

export function getEngineStream(chatId: string): EngineStreamState | undefined {
  return chatsById.get(chatId);
}

export function getEngineStreamByFrontendSessionId(frontendSessionId: string): EngineStreamState | undefined {
  const chatId = frontendToChatId.get(frontendSessionId);
  if (!chatId) return undefined;
  return chatsById.get(chatId);
}

export function getEngineStreamByBackendSessionId(backendSessionId: string): EngineStreamState | undefined {
  const chatId = backendToChatId.get(backendSessionId);
  if (!chatId) return undefined;
  return chatsById.get(chatId);
}

export function getBackendSessionIdByFrontendSessionId(frontendSessionId: string): string | undefined {
  const entry = frontendToBackendSessionId.get(frontendSessionId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    frontendToBackendSessionId.delete(frontendSessionId);
    return undefined;
  }
  entry.expiresAt = Date.now() + FRONTEND_SESSION_REUSE_TTL_MS;
  return entry.backendSessionId;
}

export function removeEngineStream(chatId: string): void {
  const state = chatsById.get(chatId);
  if (!state) return;
  chatsById.delete(chatId);
  if (state.frontendSessionId) {
    const mapped = frontendToChatId.get(state.frontendSessionId);
    if (mapped === chatId) frontendToChatId.delete(state.frontendSessionId);
  }
  if (state.backendSessionId) {
    const mapped = backendToChatId.get(state.backendSessionId);
    if (mapped === chatId) backendToChatId.delete(state.backendSessionId);
  }
}
