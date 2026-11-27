// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EnvVarsDialog, { EnvVarsEditor } from '@/components/EnvVarsDialog';

const envApiMock = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@/lib/core/api', () => ({
  envApi: envApiMock,
}));

describe('EnvVarsDialog', () => {
  beforeEach(() => {
    envApiMock.get.mockResolvedValue({
      vars: [
        { key: 'ANTHROPIC_AUTH_TOKEN', value: 'claude-token', enabled: true },
        { key: 'OPENAI_API_KEY', value: 'codex-key', enabled: true },
        { key: 'LEGACY_INTERNAL_FLAG', value: 'hidden', enabled: true },
      ],
    });
    envApiMock.save.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('renders CLI tabs and exposes existing custom variables in their own tab', async () => {
    const { container } = render(<EnvVarsDialog scope="user" onClose={vi.fn()} />);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.getByRole('heading', { name: '个人 CLI 环境变量' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Claude' })).toHaveAttribute('data-state', 'active');
    expect(screen.getAllByText('ANTHROPIC_AUTH_TOKEN')).toHaveLength(2);
    expect(screen.queryByText('LEGACY_INTERNAL_FLAG')).toBeNull();
    expect(screen.getByDisplayValue('ANTHROPIC_AUTH_TOKEN')).toBeDisabled();

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Codex' }));

    expect(screen.getByDisplayValue('OPENAI_API_KEY')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('ANTHROPIC_AUTH_TOKEN')).toBeNull();
    expect(screen.getByRole('tab', { name: 'OpenCode' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '其他 CLI' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '自定义' }));
    expect(screen.getByDisplayValue('LEGACY_INTERNAL_FLAG')).toBeEnabled();
  });

  test.each(['system', 'user'] as const)('adds and saves a case-sensitive custom variable for %s scope', async (scope) => {
    const user = userEvent.setup();
    render(<EnvVarsEditor scope={scope} inline />);
    await screen.findByRole('tab', { name: 'Claude' });
    await user.click(screen.getByRole('button', { name: '新增变量' }));
    const keyInput = screen.getAllByPlaceholderText('例如：my_key').at(-1)!;
    await user.type(keyInput, 'gitcode_token');
    expect(keyInput).toHaveFocus();
    await user.type(screen.getAllByPlaceholderText('输入变量值').at(-1)!, 'test-value');
    await user.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(envApiMock.save).toHaveBeenCalledWith(scope, expect.arrayContaining([
      { key: 'gitcode_token', value: 'test-value', enabled: true },
      { key: 'LEGACY_INTERNAL_FLAG', value: 'hidden', enabled: true },
    ])));
  });

  test('saves edited values through the selected scope and closes after success', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<EnvVarsDialog scope="user" onClose={onClose} />);

    await screen.findByRole('dialog');
    const valueInput = screen.getByDisplayValue('claude-token');
    await user.clear(valueInput);
    await user.type(valueInput, 'updated-token');
    await user.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => expect(envApiMock.save).toHaveBeenCalledWith(
      'user',
      expect.arrayContaining([
        expect.objectContaining({ key: 'ANTHROPIC_AUTH_TOKEN', value: 'updated-token', enabled: true }),
      ]),
    ));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('renders system scope inline without a dialog and keeps save status in place', async () => {
    const user = userEvent.setup();
    render(<EnvVarsEditor scope="system" inline />);

    expect(await screen.findByRole('tab', { name: 'Claude' })).toBeInTheDocument();
    expect(envApiMock.get).toHaveBeenCalledWith('system');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: '保存配置' })).toBeInTheDocument();

    const valueInput = screen.getByDisplayValue('claude-token');
    await user.clear(valueInput);
    await user.type(valueInput, 'updated-system-token');
    await user.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => expect(envApiMock.save).toHaveBeenCalledWith(
      'system',
      expect.arrayContaining([
        expect.objectContaining({ key: 'ANTHROPIC_AUTH_TOKEN', value: 'updated-system-token', enabled: true }),
      ]),
    ));
    expect(await screen.findByRole('status')).toHaveTextContent('已保存');
  });
});
