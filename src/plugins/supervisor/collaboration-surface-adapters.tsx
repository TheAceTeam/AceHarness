'use client';

export function getCollaborationSpeakerAvatarSrc() {
  return undefined;
}

export function getCollaborationInitials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

export function getCollaborationMessageKindLabel(message: any) {
  return message.speakerType === 'human'
    ? '人工'
    : message.speakerType === 'supervisor'
      ? 'Supervisor'
      : message.speakerType === 'system'
        ? '系统'
        : '协作 Agent';
}

export function handleCollaborationMentionKeyDown({
  event,
  mentionSuggestions,
  activeMentionIndex,
  setActiveMentionIndex,
  insertMention,
  setDraft,
}: {
  event: any;
  mentionSuggestions: string[];
  activeMentionIndex: number;
  setActiveMentionIndex: (updater: (prev: number) => number) => void;
  insertMention: (value: string) => void;
  setDraft: (updater: (prev: string) => string) => void;
}) {
  if (mentionSuggestions.length === 0) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setActiveMentionIndex((prev) => (prev + 1) % mentionSuggestions.length);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    setActiveMentionIndex((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
    return;
  }
  if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
    event.preventDefault();
    insertMention(mentionSuggestions[activeMentionIndex] || mentionSuggestions[0]);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    setDraft((prev) => `${prev} `);
  }
}
