'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

export type ChatPendingAttachment = {
  name: string;
  path: string;
  size: number;
  workspace: string;
};

type ConversationDraft = {
  text: string;
  attachment: ChatPendingAttachment | null;
};

const DRAFT_PREFIX = 'aceharness:chat-draft:';
const DRAFT_CHANGE = 'aceharness:chat-draft-change';
const EMPTY_DRAFT: ConversationDraft = { text: '', attachment: null };
const volatileDrafts = new Map<string, string>();

function draftKey(sessionId: string | null): string {
  return DRAFT_PREFIX + (sessionId ? 'session:' + sessionId : 'new');
}

function readDraft(key: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return volatileDrafts.get(key) ?? window.localStorage.getItem(key) ?? '';
  } catch {
    return volatileDrafts.get(key) ?? '';
  }
}

function parseDraft(raw: string): ConversationDraft {
  if (!raw) return EMPTY_DRAFT;
  try {
    const value = JSON.parse(raw) as Partial<ConversationDraft> | null;
    const attachment = value?.attachment;
    return {
      text: typeof value?.text === 'string' ? value.text : '',
      attachment: attachment && typeof attachment.name === 'string'
        && typeof attachment.path === 'string' && typeof attachment.size === 'number'
        && typeof attachment.workspace === 'string' ? attachment : null,
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

function writeDraft(key: string, draft: ConversationDraft): void {
  if (typeof window === 'undefined') return;
  const raw = draft.text || draft.attachment ? JSON.stringify(draft) : '';
  try {
    if (raw) window.localStorage.setItem(key, raw);
    else window.localStorage.removeItem(key);
    volatileDrafts.delete(key);
  } catch {
    volatileDrafts.set(key, raw);
  }
  window.dispatchEvent(new CustomEvent(DRAFT_CHANGE, { detail: key }));
}

export function moveNewConversationDraft(sessionId: string): void {
  const unassigned = draftKey(null);
  const draft = parseDraft(readDraft(unassigned));
  if (!draft.text && !draft.attachment) return;
  writeDraft(draftKey(sessionId), draft);
  writeDraft(unassigned, EMPTY_DRAFT);
}

export function clearConversationDraft(sessionId: string): void {
  writeDraft(draftKey(sessionId), EMPTY_DRAFT);
}

export function useConversationDraft(sessionId: string | null) {
  const key = draftKey(sessionId);
  const subscribe = useCallback((notify: () => void) => {
    const onDraftChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) notify();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) notify();
    };
    window.addEventListener(DRAFT_CHANGE, onDraftChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(DRAFT_CHANGE, onDraftChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [key]);
  const getSnapshot = useCallback(() => readDraft(key), [key]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => '');
  const draft = useMemo(() => parseDraft(raw), [raw]);

  const setText = useCallback((text: string, targetSessionId = sessionId) => {
    const target = draftKey(targetSessionId);
    const previous = parseDraft(readDraft(target));
    if (text !== previous.text) writeDraft(target, { ...previous, text });
  }, [sessionId]);

  const setAttachment = useCallback((attachment: ChatPendingAttachment | null, targetSessionId = sessionId) => {
    const target = draftKey(targetSessionId);
    const previous = parseDraft(readDraft(target));
    if (attachment || previous.attachment) writeDraft(target, { ...previous, attachment });
  }, [sessionId]);

  return { ...draft, setText, setAttachment };
}
