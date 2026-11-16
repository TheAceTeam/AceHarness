// @vitest-environment jsdom
import { useRef } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ConversationOutline } from '@/components/chat/ConversationOutline';
import { clearConversationDraft, moveNewConversationDraft, useConversationDraft } from '@/hooks/useConversationDraft';

describe('conversation controls', () => {
  test('restores the draft and uploaded attachment for the selected session', () => {
    const first = 'draft-session-a';
    const second = 'draft-session-b';
    clearConversationDraft(first);
    clearConversationDraft(second);
    const attachment = { name: 'notes.md', path: '.aceharness/notes.md', size: 16, workspace: '/a' };
    const { result, rerender, unmount } = renderHook(({ id }) => useConversationDraft(id), {
      initialProps: { id: first },
    });
    act(() => result.current.setText('**Draft A**'));
    rerender({ id: second });
    expect(result.current.text).toBe('');
    act(() => {
      result.current.setText('Draft B');
      result.current.setAttachment(attachment, first);
    });
    expect(result.current.attachment).toBeNull();
    rerender({ id: first });
    expect(result.current).toMatchObject({ text: '**Draft A**', attachment });
    unmount();

    const reopened = renderHook(() => useConversationDraft(second));
    expect(reopened.result.current.text).toBe('Draft B');
    act(() => reopened.result.current.setText(''));
    expect(reopened.result.current.text).toBe('');
  });

  test('moves the first composer draft into the newly created conversation', () => {
    const id = 'draft-first-conversation';
    clearConversationDraft(id);
    const { result, rerender } = renderHook(({ sessionId }) => useConversationDraft(sessionId), {
      initialProps: { sessionId: null as string | null },
    });
    act(() => {
      result.current.setText('A first draft');
      moveNewConversationDraft(id);
    });
    expect(result.current.text).toBe('');
    rerender({ sessionId: id });
    expect(result.current.text).toBe('A first draft');
  });

  test('outline markers preview the turn and navigate to the corresponding message', async () => {
    const onJump = vi.fn();
    function Transcript() {
      const scroller = useRef<HTMLDivElement>(null);
      const messages = [
        { id: 'first', role: 'user' as const, content: 'Review this change' },
        { id: 'second', role: 'assistant' as const, content: 'Here are the results' },
      ];
      return (
        <>
          <div ref={scroller} data-testid="outline-transcript">
            {messages.map(message => <div key={message.id} data-chat-message-id={message.id}>{message.content}</div>)}
          </div>
          <ConversationOutline
            messages={messages}
            scrollContainerRef={scroller}
            historyExpanded={false}
            onJump={onJump}
          />
        </>
      );
    }
    render(<Transcript />);
    expect(screen.getByRole('navigation', { name: '对话定位' })).toBeInTheDocument();
    const firstMarker = screen.getByRole('button', { name: /第 1 条.*Review this change/ });
    fireEvent.pointerOver(firstMarker, { pointerType: 'mouse' });
    fireEvent.pointerMove(firstMarker, { pointerType: 'mouse' });
    const preview = await screen.findByRole('tooltip');
    expect(preview).toHaveTextContent('Review this change');
    expect(preview).toHaveTextContent('Here are the results');
    fireEvent.click(firstMarker);
    expect(onJump).toHaveBeenCalledWith('first');

    const secondMarker = screen.getByRole('button', { name: /第 2 条.*Here are the results/ });
    const scroller = screen.getByTestId('outline-transcript');
    Object.defineProperties(scroller, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 600 },
    });
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    await waitFor(() => expect(secondMarker).toHaveAttribute('aria-current', 'location'));
    expect(firstMarker).not.toHaveAttribute('aria-current');
    expect(secondMarker.querySelector('span')).toHaveClass('w-5');
    fireEvent.click(secondMarker);
    expect(onJump).toHaveBeenCalledWith('second');
  });
});
