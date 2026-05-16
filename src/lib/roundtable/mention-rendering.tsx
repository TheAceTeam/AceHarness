'use client';

import React from 'react';

/**
 * Parse and render mention tags in text as styled React components
 */
export function renderMentionsInText(text: string): React.ReactNode[] {
  const mentionPattern = /<mention\s+id="([^"]+)"\s+label="([^"]+)"\s*\/>/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = mentionPattern.exec(text)) !== null) {
    // Add text before the mention
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    // Add the mention component
    const mentionId = match[1];
    const mentionLabel = match[2];
    parts.push(
      <span
        key={`mention-${key++}`}
        className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-sm font-medium text-primary ring-1 ring-inset ring-primary/20"
        data-mention-id={mentionId}
      >
        @{mentionLabel}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

/**
 * Component to render text with mentions
 */
export function TextWithMentions({ children }: { children: string }) {
  const parts = renderMentionsInText(children);
  return <>{parts}</>;
}
