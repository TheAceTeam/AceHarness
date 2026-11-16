// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ChatWorkspaceToolbar } from '@/components/chat/ChatWorkspaceToolbar';
import { Tabs } from '@/components/ui/tabs';

const menuProps = {
  onFork: vi.fn(),
};

describe('ChatWorkspaceToolbar', () => {
  test('keeps the title, tab selector, workspace and menu accessible in one header', async () => {
    const user = userEvent.setup();
    const onSwitchWorkspace = vi.fn();
    const path = 'C:\\Users\\Shawn\\Documents\\my-project';
    render(
      <Tabs defaultValue="chat">
        <ChatWorkspaceToolbar
          title="我的会话"
          messageCount={12}
          workspacePath={path}
          onSwitchWorkspace={onSwitchWorkspace}
          menuProps={menuProps}
        />
      </Tabs>,
    );
    const header = screen.getByRole('banner', { name: '对话工具栏' });
    expect(within(header).getByRole('heading', { name: '我的会话' })).toBeInTheDocument();
    expect(within(header).getByText('12 条消息')).toBeInTheDocument();
    expect(within(header).getByRole('tab', { name: '聊天' })).toHaveAttribute('aria-selected', 'true');
    const workspaceTab = within(header).getByRole('tab', { name: '工作区' });
    await user.click(workspaceTab);
    expect(workspaceTab).toHaveAttribute('aria-selected', 'true');

    const workspaceButton = within(header).getByRole('button', { name: '切换工作区' });
    expect(workspaceButton).toHaveTextContent('my-project');
    expect(workspaceButton).toHaveAttribute('title', '切换工作区 · ' + path);
    await user.click(workspaceButton);
    expect(onSwitchWorkspace).toHaveBeenCalledOnce();
    expect(within(header).getByRole('button', { name: '会话菜单' })).toBeInTheDocument();
  });

  test('uses a short label for automatically created workspaces', () => {
    const path = 'D:/app-data/agora-workspaces/123456';
    render(
      <Tabs defaultValue="chat">
        <ChatWorkspaceToolbar
          title="自动工作区会话"
          messageCount={2}
          workspacePath={path}
          automaticWorkspace
          onSwitchWorkspace={() => {}}
          menuProps={menuProps}
        />
      </Tabs>,
    );
    const button = screen.getByRole('button', { name: '切换工作区' });
    expect(button).toHaveTextContent('会话工作区');
    expect(button).toHaveAttribute('title', '切换工作区 · ' + path);
  });
});
