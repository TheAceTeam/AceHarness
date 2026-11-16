'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { cn } from '@/lib/core/utils';
import { extractChatMessagePreview } from '@/lib/chat/message-preview';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type OutlineMessage = {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  rawContent?: string;
};

function OutlineMessagePreview({ messages, index }: { messages: readonly OutlineMessage[]; index: number }) {
  const message = messages[index];
  if (!message) return null;
  let question: OutlineMessage | undefined;
  let reply: string | undefined;

  if (message.role === 'user') {
    question = message;
    for (let next = index + 1; next < messages.length && messages[next].role !== 'user'; next += 1) {
      reply = extractChatMessagePreview(messages[next], { maxLength: 320 });
      if (reply) break;
    }
  } else {
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      if (messages[previous].role !== 'user') continue;
      question = messages[previous];
      break;
    }
    reply = message.role === 'error'
      ? message.content.replace(/\s+/g, ' ').trim().slice(0, 320)
      : extractChatMessagePreview(message, { maxLength: 320 });
  }

  const title = extractChatMessagePreview(question, { maxLength: 160 });
  if (!title && !reply) return <span className="text-muted-foreground">第 {index + 1} 条消息</span>;

  return (
    <>
      {title ? <p className="truncate font-semibold text-popover-foreground">{title}</p> : null}
      {reply ? (
        <p className={cn('line-clamp-3 break-words leading-relaxed text-muted-foreground', title && 'mt-1.5')}>
          {reply}
        </p>
      ) : null}
    </>
  );
}

export function ConversationOutline({
  messages,
  scrollContainerRef,
  historyExpanded,
  onJump,
}: {
  messages: readonly OutlineMessage[];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  historyExpanded: boolean;
  onJump: (messageId: string) => void;
}) {
  const railRef = useRef<HTMLElement>(null);
  const [activeId, setActiveId] = useState<string>();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const emphasizedIndex = hoveredIndex ?? focusedIndex;
  const messageIds = messages.map(message => message.id).join('\n');

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;
    const elements = Array.from(scroller.querySelectorAll<HTMLElement>('[data-chat-message-id]'));
    if (!elements.length) return;
    let frame = 0;
    const update = () => {
      const targetY = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.28;
      let left = 0;
      let right = elements.length - 1;
      while (left < right) {
        const middle = Math.ceil((left + right) / 2);
        if (elements[middle].getBoundingClientRect().top <= targetY) left = middle;
        else right = middle - 1;
      }
      const atBottom = scroller.scrollHeight > scroller.clientHeight + 16
        && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 16;
      setActiveId(elements[atBottom ? elements.length - 1 : left].dataset.chatMessageId);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(onScroll);
    resize?.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', onScroll);
      resize?.disconnect();
    };
  }, [historyExpanded, messageIds, scrollContainerRef]);

  useEffect(() => {
    const rail = railRef.current;
    const marker = rail?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!rail || !marker || rail.scrollHeight <= rail.clientHeight) return;
    const offset = marker.getBoundingClientRect().top - rail.getBoundingClientRect().top;
    rail.scrollTop += offset - (rail.clientHeight - marker.offsetHeight) / 2;
  }, [activeId, messageIds]);

  if (messages.length < 2) return null;

  return (
    <nav
      ref={railRef}
      aria-label="对话定位"
      className="absolute left-1 top-1/2 z-20 hidden max-h-[min(32%,10rem)] w-8 -translate-y-1/2 overflow-y-auto overflow-x-hidden overscroll-contain md:block lg:left-3 [scrollbar-width:none]"
      onPointerLeave={() => setHoveredIndex(null)}
    >
      <TooltipProvider delayDuration={100} skipDelayDuration={200} disableHoverableContent>
        <div className="flex flex-col">
          {messages.map((message, index) => {
            const active = message.id === activeId;
            const distance = emphasizedIndex === null ? Infinity : Math.abs(index - emphasizedIndex);
            const speaker = message.role === 'user' ? '你' : '助手';
            const preview = message.content.replace(/\s+/g, ' ').trim().slice(0, 80);
            const title = speaker + ' · 第 ' + (index + 1) + ' 条' + (preview ? ' · ' + preview : '');
            return (
              <Tooltip key={message.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={title}
                    aria-current={active ? 'location' : undefined}
                    onPointerEnter={(event) => {
                      if (event.pointerType !== 'touch') setHoveredIndex(index);
                    }}
                    onFocus={() => setFocusedIndex(index)}
                    onBlur={() => setFocusedIndex(null)}
                    onClick={() => onJump(message.id)}
                    className="flex h-3 shrink-0 items-center px-1 text-left focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'h-[3px] shrink-0 rounded-full bg-foreground/25 transition-[width,background-color] duration-150 ease-out motion-reduce:transition-none',
                        message.role === 'user' ? 'w-2.5' : 'w-1.5',
                        distance === 2 && 'w-3 bg-foreground/35',
                        distance === 1 && 'w-3.5 bg-foreground/45',
                        distance === 0 && 'w-4 bg-foreground/65',
                        active && 'w-5 bg-foreground',
                      )}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={8}
                  collisionPadding={12}
                  className="w-[min(22rem,80vw)] rounded-xl px-3 py-2.5 text-sm shadow-lg motion-reduce:animate-none"
                >
                  <OutlineMessagePreview messages={messages} index={index} />
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    </nav>
  );
}
