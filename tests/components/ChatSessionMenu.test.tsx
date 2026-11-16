// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatSessionMenu } from '@/components/chat/ChatSessionMenu';

describe('ChatSessionMenu', () => {
  test('toggles the workflow creation guide and keeps fork available', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onFork = vi.fn();

    render(
      <ChatSessionMenu
        workflowCreationGuide={{ enabled: true, onChange }}
        onFork={onFork}
      />,
    );

    await user.click(screen.getByRole('button', { name: '会话菜单' }));
    const toggle = (await screen.findByText('工作流创建引导')).closest('[role="menuitemcheckbox"]') as HTMLElement;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);

    await user.click(await screen.findByText('Fork 对话'));
    expect(onFork).toHaveBeenCalledTimes(1);
  });

  test('hides the guide when the session is no longer new', async () => {
    const user = userEvent.setup();

    render(<ChatSessionMenu onFork={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '会话菜单' }));
    expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Fork 对话' })).toBeInTheDocument();
  });
});
