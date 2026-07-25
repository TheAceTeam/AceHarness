// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatSessionMenu } from '@/components/chat/ChatSessionMenu';

describe('ChatSessionMenu', () => {
  test('toggles creation assistant and keeps fork available', async () => {
    const user = userEvent.setup();
    const onCreationAssistantChange = vi.fn();
    const onFork = vi.fn();

    render(
      <ChatSessionMenu
        creationAssistantEnabled
        onCreationAssistantChange={onCreationAssistantChange}
        onFork={onFork}
      />,
    );

    await user.click(screen.getByRole('button', { name: '会话菜单' }));
    const toggle = (await screen.findByText('新对话创建助手')).closest('[role="menuitemcheckbox"]') as HTMLElement;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await user.click(toggle);
    expect(onCreationAssistantChange).toHaveBeenCalledWith(false);

    await user.click(await screen.findByText('Fork 对话'));
    expect(onFork).toHaveBeenCalledTimes(1);
  });

  test('disables the creation-assistant default when unavailable', async () => {
    const user = userEvent.setup();

    render(
      <ChatSessionMenu
        creationAssistantEnabled={false}
        creationAssistantDisabled
        onCreationAssistantChange={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '会话菜单' }));
    const toggle = (await screen.findByText('新对话创建助手')).closest('[role="menuitemcheckbox"]');
    expect(toggle?.hasAttribute('data-disabled')).toBe(true);
  });
});
