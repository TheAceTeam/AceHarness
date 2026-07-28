import { EventEmitter } from 'events';
import type { PersistedChatSession } from '@/lib/chat/persistence';

export type EngineStreamStatus = 'running' | 'completed' | 'failed' | 'killed';

export interface EngineStreamState {
  chatId: string;
  frontendSessionId?: string;
  runtimeSessionId?: string;
  turnId?: string;
  traceId?: string;
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
  runtimeSessionId?: string;
  turnId?: string;
  traceId?: string;
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
const runtimeToChatId = new Map<string, string>();
const frontendToRuntimeSessionId = new Map<string, { runtimeSessionId: string; expiresAt: number }>();
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
    runtimeSessionId: state.runtimeSessionId,
    turnId: state.turnId,
    traceId: state.traceId,
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

export function setEngineStreamSessionId(chatId: string, runtimeSessionId?: string): void {
  const state = chatsById.get(chatId);
  if (!state) return;
  state.updatedAt = Date.now();
  if (!runtimeSessionId) {
    const previousRuntimeSessionId = state.runtimeSessionId;
    if (previousRuntimeSessionId) {
      const mapped = runtimeToChatId.get(previousRuntimeSessionId);
      if (mapped === chatId) runtimeToChatId.delete(previousRuntimeSessionId);
    }
    if (state.frontendSessionId) {
      const entry = frontendToRuntimeSessionId.get(state.frontendSessionId);
      if (entry?.runtimeSessionId === previousRuntimeSessionId) {
        frontendToRuntimeSessionId.delete(state.frontendSessionId);
      }
    }
    state.runtimeSessionId = undefined;
    if (state.liveSession) {
      state.liveSession = {
        ...state.liveSession,
        runtimeSessionId: undefined,
        updatedAt: Date.now(),
      };
    }
    emitEngineStreamState(state);
    return;
  }
  state.runtimeSessionId = runtimeSessionId;
  runtimeToChatId.set(runtimeSessionId, chatId);
  if (state.liveSession) {
    state.liveSession = {
      ...state.liveSession,
      runtimeSessionId,
      updatedAt: Date.now(),
    };
  }
  if (state.frontendSessionId) {
    frontendToRuntimeSessionId.set(state.frontendSessionId, {
      runtimeSessionId,
      expiresAt: Date.now() + FRONTEND_SESSION_REUSE_TTL_MS,
    });
  }
  emitEngineStreamState(state);
}

export function setEngineStreamTurn(chatId: string, turnId?: string, traceId?: string): void {
  const state = chatsById.get(chatId);
  if (!state) return;
  state.turnId = turnId;
  state.traceId = traceId;
  state.updatedAt = Date.now();
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

export function getEngineStreamByRuntimeSessionId(runtimeSessionId: string): EngineStreamState | undefined {
  const chatId = runtimeToChatId.get(runtimeSessionId);
  if (!chatId) return undefined;
  return chatsById.get(chatId);
}

export function getRuntimeSessionIdByFrontendSessionId(frontendSessionId: string): string | undefined {
  const entry = frontendToRuntimeSessionId.get(frontendSessionId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    frontendToRuntimeSessionId.delete(frontendSessionId);
    return undefined;
  }
  entry.expiresAt = Date.now() + FRONTEND_SESSION_REUSE_TTL_MS;
  return entry.runtimeSessionId;
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
  if (state.runtimeSessionId) {
    const mapped = runtimeToChatId.get(state.runtimeSessionId);
    if (mapped === chatId) runtimeToChatId.delete(state.runtimeSessionId);
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
