// @vitest-environment jsdom
import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import UniversalCard, { type CardSchema } from '@/components/chat/cards/UniversalCard';

vi.mock('@/lib/core/clipboard', () => ({
  copyText: vi.fn(async () => true),
}));

describe('UniversalCard', () => {
  test('renders workflow-style summary cards with clearer hierarchy and spacing classes', () => {
    const card: CardSchema = {
      header: {
        icon: 'account_tree',
        title: '可用工作流配置',
        subtitle: '当前在 C:/Users/Shawn/AppData/Roaming/ACEHarness/configs 下识别到 3 个工作流',
        gradient: 'from-blue-500 to-cyan-500',
        badges: [{ text: '3 workflows', color: 'blue' }],
      },
      blocks: [
        {
          type: 'list',
          items: [
            { icon: 'settings', text: 'markit-fix-codeblock-i18n  state-machine | C:/Users/Shawn/markit/markit | 修复 markit 的 toMarkdown 代码块 i18n 过滤，仅输出 targetLanguage 对应语言' },
            { icon: 'search', text: 'message-history-search-workflow  state-machine | C:/Users/Shawn/Desktop/AI_Chat/AI_Chat | 为 AI_Chat 消息页增加历史消息搜索，覆盖分析、设计、实现、验证、评审' },
            { icon: 'account_tree', text: 'markit-dsl-redesign  state-machine | C:/Users/Shawn/markit/markit | 重设计 markit DSL，覆盖需求分析、DSL 设计、原型编码、回归验证与交付' },
          ],
        },
        {
          type: 'badges',
          items: [
            { text: 'state-machine: 3', color: 'green' },
            { text: 'workspaceMode: in-place', color: 'gray' },
          ],
        },
        {
          type: 'text',
          content: '对应文件分别是 workflow-20260507-2026-mjed.yaml、workflow-20260515-1636-d239.yaml、workflow-20260517-1605-37hl.yaml。三者都绑定到具体项目目录，且都使用 in-place 工作区模式。',
        },
      ],
    };

    const { container } = render(<UniversalCard card={card} />);

    const root = screen.getByTestId('universal-card');
    expect(root.className).toContain('rounded-xl');
    expect(root.className).toContain('shadow-sm');

    const header = screen.getByTestId('universal-card-header');
    expect(header.className).toContain('px-4');
    expect(header.className).toContain('py-4');

    const title = screen.getByText('可用工作流配置');
    expect(title.className).toContain('text-base');
    expect(title.className).toContain('font-semibold');

    const subtitle = screen.getByText('当前在 C:/Users/Shawn/AppData/Roaming/ACEHarness/configs 下识别到 3 个工作流');
    expect(subtitle.className).toContain('text-sm');
    expect(subtitle.className).toContain('break-all');
    expect(subtitle.className.includes('truncate')).toBe(false);

    const badgeGroup = screen.getByTestId('universal-card-badges');
    const renderedBadges = within(badgeGroup).getAllByText(/.+/);
    expect(renderedBadges.map((node) => node.textContent)).toEqual([
      'state-machine: 3',
      'workspaceMode: in-place',
    ]);
    renderedBadges.forEach((node) => {
      expect(node.className).toContain('rounded-md');
      expect(node.className).toContain('text-xs');
    });

    const list = screen.getByTestId('universal-card-list');
    const items = Array.from(list.children) as HTMLDivElement[];
    expect(items).toHaveLength(3);
    items.forEach((item) => {
      expect(item.className).toContain('text-sm');
      expect(item.className).toContain('leading-6');
      expect(item.className).toContain('gap-3');
    });

    expect(screen.getByText('3 workflows')).toBeInTheDocument();
    expect(screen.getByText('对应文件分别是 workflow-20260507-2026-mjed.yaml、workflow-20260515-1636-d239.yaml、workflow-20260517-1605-37hl.yaml。三者都绑定到具体项目目录，且都使用 in-place 工作区模式。')).toBeInTheDocument();

    const body = container.querySelector('[data-testid="universal-card"] > div:nth-child(2)') as HTMLDivElement | null;
    expect(body).not.toBeNull();
    expect(body?.className).toContain('space-y-4');
    expect(body?.className).toContain('p-4');
  });

  test('renders info rows as roomy label-value sections instead of dense inline text', () => {
    const card: CardSchema = {
      blocks: [
        {
          type: 'info',
          rows: [
            { label: '模式', value: 'state-machine', icon: 'device_hub' },
            { label: '项目目录', value: 'C:/Users/Shawn/Desktop/AI_Chat/AI_Chat', icon: 'folder' },
          ],
        },
      ],
    };

    render(<UniversalCard card={card} />);

    const info = screen.getByTestId('universal-card-info');
    const rows = Array.from(info.children) as HTMLDivElement[];
    expect(rows).toHaveLength(2);

    const firstRow = rows[0];
    expect(firstRow.className).toContain('rounded-lg');
    expect(firstRow.className).toContain('border');
    expect(firstRow.className).toContain('px-3');
    expect(firstRow.className).toContain('py-2.5');

    const firstLabel = screen.getByText('模式');
    expect(firstLabel.parentElement?.className).toContain('text-xs');
    expect(firstLabel.parentElement?.className?.includes('uppercase')).toBe(false);

    const firstValue = screen.getByText('state-machine');
    expect(firstValue.className).toContain('text-sm');
    expect(firstValue.className).toContain('leading-6');

    const secondValue = screen.getByText('C:/Users/Shawn/Desktop/AI_Chat/AI_Chat');
    expect(secondValue.className).toContain('break-all');
  });

  test('renders table block with local detail panel instead of forcing a second AI round-trip', () => {
    const onAction = vi.fn();
    const card: CardSchema = {
      header: {
        icon: 'smart_toy',
        title: 'Agent 列表',
        badges: [{ text: '2 个', color: 'purple' }],
      },
      blocks: [
        {
          type: 'table',
          maxHeight: 240,
          columns: [
            { key: 'name', label: '名称', width: 'minmax(220px,1.8fr)' },
            { key: 'team', label: '阵营', width: '96px' },
            { key: 'model', label: '模型', width: '160px' },
          ],
          rows: [
            {
              id: 'architect',
              cells: { name: 'architect', team: '红队', model: 'default' },
              badges: [{ text: '红队', color: 'red' }],
              detailTitle: 'architect',
              detailBlocks: [
                { type: 'text', content: '负责整体设计与实现推进。' },
                { type: 'actions', items: [{ label: '优化提示词', prompt: '优化 architect', icon: 'auto_fix_high' }] },
              ],
            },
            {
              id: 'judge',
              cells: { name: 'code-judge', team: '裁判', model: 'gpt-5.5' },
              badges: [{ text: '裁判', color: 'yellow' }],
              detailTitle: 'code-judge',
              detailBlocks: [
                { type: 'text', content: '负责最终裁决与验收。' },
              ],
            },
          ],
        },
      ],
    };

    render(<UniversalCard card={card} onAction={onAction} />);

    const table = screen.getByTestId('universal-card-table');
    expect(within(table).getByText('名称')).toBeInTheDocument();
    expect(within(table).getAllByText('architect').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('负责整体设计与实现推进。')).toBeInTheDocument();

    fireEvent.click(screen.getByText('code-judge'));
    expect(screen.getByText('负责最终裁决与验收。')).toBeInTheDocument();

    fireEvent.click(screen.getByText('architect'));
    fireEvent.click(screen.getByText('优化提示词'));
    expect(onAction).toHaveBeenCalledWith('优化 architect');
  });
});
