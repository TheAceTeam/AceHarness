import { EventEmitter } from 'events';
import type { PersistedChatSession } from '@/lib/chat/persistence';

export type EngineStreamStatus = 'running' | 'completed' | 'failed' | 'killed';

export interface EngineStreamState {
  chatId: string;
  frontendSessionId?: string;
  backendSessionId?: string;
  engine?: string;
  model?: string;
  status: EngineStreamStatus;
  streamContent: string;
  liveSession?: PersistedChatSession;
  updatedAt: number;
}

export interface PublicEngineStreamState {
  chatId: string;
  frontendSessionId: string;
  backendSessionId?: string;
  engine?: string;
  model?: string;
  status: EngineStreamStatus;
  updatedAt: number;
}

export type EngineStreamStateEvent =
  | {
      type: 'upsert';
      state: PublicEngineStreamState;
    }
  | {
      type: 'remove';
      chatId: string;
      frontendSessionId: string;
      updatedAt: number;
    };

const chatsById = new Map<string, EngineStreamState>();
const frontendToChatId = new Map<string, string>();
const backendToChatId = new Map<string, string>();
const frontendToBackendSessionId = new Map<string, { backendSessionId: string; expiresAt: number }>();
const FRONTEND_SESSION_REUSE_TTL_MS = 9 * 60 * 1000;
const globalForEngineStreamEvents = globalThis as unknown as {
  __engineStreamStateEvents?: EventEmitter;
};
export const engineStreamStateEvents = globalForEngineStreamEvents.__engineStreamStateEvents ??= new EventEmitter();
engineStreamStateEvents.setMaxListeners(200);

function resolvePublicFrontendSessionId(state: EngineStreamState): string | undefined {
  if (state.liveSession?.id) return state.liveSession.id;
  if (!state.frontendSessionId) return undefined;
  return state.frontendSessionId.includes(':') ? undefined : state.frontendSessionId;
}

function toPublicEngineStreamState(state: EngineStreamState): PublicEngineStreamState | null {
  const frontendSessionId = resolvePublicFrontendSessionId(state);
  if (!frontendSessionId) return null;
  return {
    chatId: state.chatId,
    frontendSessionId,
    backendSessionId: state.backendSessionId,
    engine: state.engine,
    model: state.model,
    status: state.status,
    updatedAt: state.updatedAt,
  };
}

function emitEngineStreamState(state: EngineStreamState | undefined): void {
  if (!state) return;
  const publicState = toPublicEngineStreamState(state);
  if (!publicState) return;
  engineStreamStateEvents.emit('change', {
    type: 'upsert',
    state: publicState,
  } satisfies EngineStreamStateEvent);
}

export function registerEngineStream(chatId: string, frontendSessionId?: string, engine?: string, model?: string): void {
  chatsById.set(chatId, {
    chatId,
    frontendSessionId,
    engine,
    model,
    status: 'running',
    streamContent: '',
    updatedAt: Date.now(),
  });
  if (frontendSessionId) {
    frontendToChatId.set(frontendSessionId, chatId);
  }
  emitEngineStreamState(chatsById.get(chatId));
}

export function appendEngineStreamContent(chatId: string, chunk: string): void {
  const state = chatsById.get(chatId);
  if (!state || !chunk) return;
  state.streamContent += chunk;
  state.updatedAt = Date.now();
}

export function setEngineStreamSessionId(chatId: string, backendSessionId?: string): void {
  const state = chatsById.get(chatId);
  if (!state) return;
  state.updatedAt = Date.now();
  if (!backendSessionId) {
    const previousBackendSessionId = state.backendSessionId;
    if (previousBackendSessionId) {
      const mapped = backendToChatId.get(previousBackendSessionId);
      if (mapped === chatId) backendToChatId.delete(previousBackendSessionId);
    }
    if (state.frontendSessionId) {
      const entry = frontendToBackendSessionId.get(state.frontendSessionId);
      if (entry?.backendSessionId === previousBackendSessionId) {
        frontendToBackendSessionId.delete(state.frontendSessionId);
      }
    }
    state.backendSessionId = undefined;
    if (state.liveSession) {
      state.liveSession = {
        ...state.liveSession,
        backendSessionId: undefined,
        updatedAt: Date.now(),
      };
    }
    emitEngineStreamState(state);
    return;
  }
  state.backendSessionId = backendSessionId;
  backendToChatId.set(backendSessionId, chatId);
  if (state.liveSession) {
    state.liveSession = {
      ...state.liveSession,
      backendSessionId,
      updatedAt: Date.now(),
    };
  }
  if (state.frontendSessionId) {
    frontendToBackendSessionId.set(state.frontendSessionId, {
      backendSessionId,
      expiresAt: Date.now() + FRONTEND_SESSION_REUSE_TTL_MS,
    });
  }
  emitEngineStreamState(state);
}

export function setEngineStreamStatus(chatId: string, status: EngineStreamStatus): void {
  const state = chatsById.get(chatId);
  if (!state) return;
  state.status = status;
  state.updatedAt = Date.now();
  emitEngineStreamState(state);
}

export function setEngineStreamLiveSession(chatId: string, session: PersistedChatSession | undefined): void {
  const state = chatsById.get(chatId);
  if (!state) return;
  state.liveSession = session;
  state.updatedAt = Date.now();
  emitEngineStreamState(state);
}

export function updateEngineStreamLiveSession(
  chatId: string,
  updater: (session: PersistedChatSession | undefined) => PersistedChatSession | undefined,
): PersistedChatSession | undefined {
  const state = chatsById.get(chatId);
  if (!state) return undefined;
  const nextSession = updater(state.liveSession);
  if (!nextSession) {
    return state.liveSession;
  }
  state.liveSession = nextSession;
  state.updatedAt = Date.now();
  return state.liveSession;
}

export function getEngineStream(chatId: string): EngineStreamState | undefined {
  return chatsById.get(chatId);
}

export function listPublicEngineStreams(): PublicEngineStreamState[] {
  return Array.from(chatsById.values())
    .map((state) => toPublicEngineStreamState(state))
    .filter((state): state is PublicEngineStreamState => Boolean(state));
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
  const publicFrontendSessionId = resolvePublicFrontendSessionId(state);
  chatsById.delete(chatId);
  if (state.frontendSessionId) {
    const mapped = frontendToChatId.get(state.frontendSessionId);
    if (mapped === chatId) frontendToChatId.delete(state.frontendSessionId);
  }
  if (state.backendSessionId) {
    const mapped = backendToChatId.get(state.backendSessionId);
    if (mapped === chatId) backendToChatId.delete(state.backendSessionId);
  }
  if (publicFrontendSessionId) {
    engineStreamStateEvents.emit('change', {
      type: 'remove',
      chatId,
      frontendSessionId: publicFrontendSessionId,
      updatedAt: Date.now(),
    } satisfies EngineStreamStateEvent);
  }
}
