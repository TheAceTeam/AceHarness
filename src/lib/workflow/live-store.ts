'use client';

import { useSyncExternalStore } from 'react';
import { runsApi, workflowApi } from '@/lib/core/api';
import type { HumanQuestion } from '@/lib/run/state-persistence';

export type WorkflowLiveChatStreamStatus = 'running' | 'completed' | 'failed' | 'killed';

export interface WorkflowLiveChatStream {
  chatId: string;
  frontendSessionId: string;
  backendSessionId?: string;
  engine?: string;
  model?: string;
  status: WorkflowLiveChatStreamStatus;
  updatedAt: number;
}

export interface WorkflowLiveStateSnapshot {
  connected: boolean;
  pendingHumanQuestions: HumanQuestion[];
  runStatusById: Record<string, string>;
  workflowStatusByConfig: Record<string, any>;
  chatStreamsBySessionId: Record<string, WorkflowLiveChatStream>;
  chatSessionSignalsById: Record<string, { updatedAt: number; removed?: boolean }>;
  lastEventAt: number | null;
}

const INITIAL_STATE: WorkflowLiveStateSnapshot = {
  connected: false,
  pendingHumanQuestions: [],
  runStatusById: {},
  workflowStatusByConfig: {},
  chatStreamsBySessionId: {},
  chatSessionSignalsById: {},
  lastEventAt: null,
};

let snapshot = INITIAL_STATE;
let eventSource: EventSource | null = null;
let closeTimer: number | null = null;
let initialHydrationPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function updateSnapshot(updater: (current: WorkflowLiveStateSnapshot) => WorkflowLiveStateSnapshot) {
  const next = updater(snapshot);
  if (next === snapshot) return;
  snapshot = next;
  emitChange();
}

function sortQuestions(questions: HumanQuestion[]): HumanQuestion[] {
  return [...questions].sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
}

function mergeQuestion(current: HumanQuestion[], question: HumanQuestion | null | undefined): HumanQuestion[] {
  if (!question?.id) return current;
  const rest = current.filter((item) => item.id !== question.id);
  if (question.status !== 'unanswered') return sortQuestions(rest);
  return sortQuestions([question, ...rest]);
}

function normalizeChatStream(input: any): WorkflowLiveChatStream | null {
  const frontendSessionId = typeof input?.frontendSessionId === 'string' ? input.frontendSessionId.trim() : '';
  if (!frontendSessionId) return null;
  const status = String(input?.status || '').trim();
  if (status !== 'running' && status !== 'completed' && status !== 'failed' && status !== 'killed') {
    return null;
  }
  return {
    chatId: String(input?.chatId || ''),
    frontendSessionId,
    backendSessionId: typeof input?.backendSessionId === 'string' && input.backendSessionId ? input.backendSessionId : undefined,
    engine: typeof input?.engine === 'string' && input.engine ? input.engine : undefined,
    model: typeof input?.model === 'string' && input.model ? input.model : undefined,
    status,
    updatedAt: typeof input?.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now(),
  };
}

function applyWorkflowStatus(nextState: WorkflowLiveStateSnapshot, statusSnapshot: any) {
  const configFile = typeof statusSnapshot?.currentConfigFile === 'string' ? statusSnapshot.currentConfigFile : '';
  if (!configFile) return nextState;
  const nextWorkflowStatusByConfig = {
    ...nextState.workflowStatusByConfig,
    [configFile]: statusSnapshot,
  };
  const nextRunStatusById = { ...nextState.runStatusById };
  if (statusSnapshot?.runId && statusSnapshot?.status) {
    nextRunStatusById[String(statusSnapshot.runId)] = String(statusSnapshot.status);
  }
  return {
    ...nextState,
    workflowStatusByConfig: nextWorkflowStatusByConfig,
    runStatusById: nextRunStatusById,
  };
}

function handleWorkflowEvent(event: any) {
  const type = String(event?.type || '');
  const data = event?.data || {};

  if (type === 'snapshot') {
    const nextQuestions = Array.isArray(data.pendingHumanQuestions) ? sortQuestions(data.pendingHumanQuestions) : snapshot.pendingHumanQuestions;
    const nextWorkflowStatusByConfig = data.workflowStatuses && typeof data.workflowStatuses === 'object'
      ? data.workflowStatuses
      : snapshot.workflowStatusByConfig;
    const nextRunStatusById = data.runStatusById && typeof data.runStatusById === 'object'
      ? data.runStatusById
      : snapshot.runStatusById;
    const rawChatStreams: unknown[] = Array.isArray(data.chatStreams) ? data.chatStreams : [];
    const nextChatStreamsBySessionId = Object.fromEntries(
      rawChatStreams
        .map((item: unknown) => normalizeChatStream(item))
        .filter((item: WorkflowLiveChatStream | null): item is WorkflowLiveChatStream => Boolean(item))
        .map((item: WorkflowLiveChatStream) => [item.frontendSessionId, item]),
    );
    updateSnapshot((current) => ({
      ...current,
      connected: true,
      pendingHumanQuestions: nextQuestions,
      runStatusById: nextRunStatusById,
      workflowStatusByConfig: nextWorkflowStatusByConfig,
      chatStreamsBySessionId: nextChatStreamsBySessionId,
      lastEventAt: Date.now(),
    }));
    return;
  }

  if (type === 'chat-stream-state') {
    const stream = normalizeChatStream(data);
    if (!stream) return;
    updateSnapshot((current) => ({
      ...current,
      connected: true,
      chatStreamsBySessionId: {
        ...current.chatStreamsBySessionId,
        [stream.frontendSessionId]: stream,
      },
      lastEventAt: Date.now(),
    }));
    return;
  }

  if (type === 'chat-stream-removed') {
    const frontendSessionId = typeof data?.frontendSessionId === 'string' ? data.frontendSessionId.trim() : '';
    if (!frontendSessionId) return;
    updateSnapshot((current) => {
      if (!current.chatStreamsBySessionId[frontendSessionId]) return current;
      const nextChatStreamsBySessionId = { ...current.chatStreamsBySessionId };
      delete nextChatStreamsBySessionId[frontendSessionId];
      return {
        ...current,
        connected: true,
        chatStreamsBySessionId: nextChatStreamsBySessionId,
        lastEventAt: Date.now(),
      };
    });
    return;
  }

  if (type === 'chat-session-updated' || type === 'chat-session-removed') {
    const sessionId = typeof data?.sessionId === 'string' ? data.sessionId.trim() : '';
    if (!sessionId) return;
    const updatedAt = typeof data?.updatedAt === 'number' && Number.isFinite(data.updatedAt) ? data.updatedAt : Date.now();
    updateSnapshot((current) => ({
      ...current,
      connected: true,
      chatSessionSignalsById: {
        ...current.chatSessionSignalsById,
        [sessionId]: {
          updatedAt,
          removed: type === 'chat-session-removed' || Boolean(data?.removed),
        },
      },
      lastEventAt: Date.now(),
    }));
    return;
  }

  if (data?.statusSnapshot) {
    updateSnapshot((current) => {
      const next = applyWorkflowStatus(current, data.statusSnapshot);
      const statusQuestions = Array.isArray(data.statusSnapshot?.humanQuestions)
        ? data.statusSnapshot.humanQuestions as HumanQuestion[]
        : null;
      if (!statusQuestions) {
        return {
          ...next,
          connected: true,
          lastEventAt: Date.now(),
        };
      }

      const questionIds = new Set(statusQuestions.map((question) => question.id));
      const preserved = next.pendingHumanQuestions.filter((question) => !questionIds.has(question.id));
      const unanswered = statusQuestions.filter((question) => question.status === 'unanswered');
      return {
        ...next,
        connected: true,
        pendingHumanQuestions: sortQuestions([...preserved, ...unanswered]),
        lastEventAt: Date.now(),
      };
    });
  }

  if (type === 'human-question-required' || type === 'human-question-updated' || type === 'human-question-answered') {
    if (Array.isArray(data?.humanQuestions)) {
      updateSnapshot((current) => {
        const merged = new Map(current.pendingHumanQuestions.map((question) => [question.id, question]));
        for (const question of data.humanQuestions as HumanQuestion[]) {
          if (!question?.id) continue;
          if (question.status === 'unanswered') {
            merged.set(question.id, question);
          } else {
            merged.delete(question.id);
          }
        }
        if (data?.question?.id && data.question.status !== 'unanswered') {
          merged.delete(data.question.id);
        }
        return {
          ...current,
          connected: true,
          pendingHumanQuestions: sortQuestions(Array.from(merged.values())),
          lastEventAt: Date.now(),
        };
      });
      return;
    }

    updateSnapshot((current) => ({
      ...current,
      connected: true,
      pendingHumanQuestions: mergeQuestion(current.pendingHumanQuestions, data?.question),
      lastEventAt: Date.now(),
    }));
  }
}

function ensureInitialHydration() {
  if (typeof window === 'undefined' || initialHydrationPromise) return;
  initialHydrationPromise = Promise.all([
    workflowApi.listHumanQuestions({ status: 'unanswered', limit: 100 }).catch(() => ({ questions: [] as HumanQuestion[] })),
    runsApi.listAll().catch(() => ({ runs: [] as Array<{ id: string; status: string }> })),
  ]).then(([questionsResult, runsResult]) => {
    updateSnapshot((current) => ({
      ...current,
      pendingHumanQuestions: current.pendingHumanQuestions.length > 0
        ? current.pendingHumanQuestions
        : sortQuestions(questionsResult.questions || []),
      runStatusById: {
        ...Object.fromEntries((runsResult.runs || []).map((run) => [run.id, run.status])),
        ...current.runStatusById,
      },
    }));
  }).finally(() => {
    initialHydrationPromise = null;
  });
}

function ensureConnected() {
  if (typeof window === 'undefined') return;
  if (closeTimer) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }

  ensureInitialHydration();

  if (eventSource || typeof EventSource === 'undefined') return;
  eventSource = workflowApi.connectEventStream(handleWorkflowEvent);
  const handleOpen = () => {
    updateSnapshot((current) => ({
      ...current,
      connected: true,
    }));
  };
  const handleError = () => {
    updateSnapshot((current) => ({
      ...current,
      connected: false,
    }));
  };
  if (typeof (eventSource as any).addEventListener === 'function') {
    eventSource.addEventListener('open', handleOpen);
  } else {
    (eventSource as any).onopen = handleOpen;
  }
  eventSource.onerror = handleError;
}

function scheduleDisconnect() {
  if (typeof window === 'undefined' || closeTimer || listeners.size > 0) return;
  closeTimer = window.setTimeout(() => {
    if (listeners.size > 0) {
      closeTimer = null;
      return;
    }
    eventSource?.close();
    eventSource = null;
    closeTimer = null;
    updateSnapshot((current) => ({
      ...current,
      connected: false,
    }));
  }, 5000);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureConnected();
  return () => {
    listeners.delete(listener);
    scheduleDisconnect();
  };
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return INITIAL_STATE;
}

export function useWorkflowLiveState(): WorkflowLiveStateSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
