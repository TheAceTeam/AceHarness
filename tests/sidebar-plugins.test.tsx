// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import {
  definePlugin,
  getAllPlugins,
  getCategories,
  getActions,
  getPinnedActions,
  getCollapsibleActions,
  getActionsGrouped,
  getIntent,
  applySidebarPluginPreferences,
  registerPlugin,
  unregisterPlugin,
} from '@/lib/sidebar-plugins';
import { createResultExtractionCapability } from '@/lib/sidebar-plugins/capabilities/result-extraction';
import { createBreakpointResumeCapability } from '@/lib/sidebar-plugins/capabilities/breakpoint-resume';
import { createPersistenceCapability } from '@/lib/sidebar-plugins/capabilities/persistence';
import QuickActions, { QuickActionsBar } from '@/components/chat/QuickActions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  applySidebarPluginPreferences({ disabledPluginIds: [], enabledPluginIds: [] });
});

describe('sidebar plugin system', () => {
  describe('registry', () => {
    test('getAllPlugins returns enabled built-in plugins', () => {
      const plugins = getAllPlugins();
      expect(plugins.length).toBeGreaterThanOrEqual(3);
      expect(plugins.find((p) => p.id === 'werewolf-lab')).toBeFalsy();
      expect(plugins.find((p) => p.id === 'codespec')).toBeFalsy();
      expect(plugins.find((p) => p.id === 'create-workflow')).toBeTruthy();
      expect(plugins.find((p) => p.id === 'create-agent')).toBeTruthy();
      expect(plugins.find((p) => p.id === 'supervisor')).toBeTruthy();
    });

    test('codespec plugin is disabled by default and exposes init action when enabled', () => {
      applySidebarPluginPreferences({ disabledPluginIds: [], enabledPluginIds: [] });

      const allPlugins = getAllPlugins({ includeDisabled: true });
      expect(allPlugins.find((p) => p.id === 'codespec')?.enabled).toBe(false);
      expect(getActions().find((a) => a.id === 'codespec-init')).toBeFalsy();

      applySidebarPluginPreferences({ disabledPluginIds: [], enabledPluginIds: ['codespec'] });
      expect(getAllPlugins().find((p) => p.id === 'codespec')).toBeTruthy();
      expect(getActions().find((a) => a.id === 'codespec-init')?.prompt).toBe('__HOME_ACTION__:codespec:init');
      expect(getActions().find((a) => a.id === 'codespec-init')?.category).toBe('codespec');
      expect(getActions().find((a) => a.id === 'codespec-sync')?.prompt).toBe('__HOME_ACTION__:codespec:sync');
      expect(getActions().find((a) => a.id === 'codespec-sync-generate')?.prompt).toBe('__HOME_ACTION__:codespec:sync-generate');
      expect(getActions().find((a) => a.id === 'codespec-start')?.prompt).toBe('__HOME_ACTION__:codespec:start');
      expect(getCategories().find((category) => category.id === 'codespec')?.title).toBe('CodeSpec');

      applySidebarPluginPreferences({ disabledPluginIds: [], enabledPluginIds: [] });
    });

    test('getCategories returns deduplicated sorted categories', () => {
      const categories = getCategories();
      expect(categories.length).toBeGreaterThanOrEqual(3);
      // Check order
      for (let i = 1; i < categories.length; i++) {
        expect((categories[i].order ?? 100) >= (categories[i - 1].order ?? 100)).toBe(true);
      }
      // No duplicates
      const ids = categories.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    test('getActions returns all actions sorted by order', () => {
      const actions = getActions();
      expect(actions.length).toBeGreaterThanOrEqual(8);
      expect(actions.find((a) => a.id === 'werewolf-lab')).toBeFalsy();
      expect(actions.find((a) => a.id === 'create-workflow')).toBeTruthy();
      expect(actions.find((a) => a.id === 'create-agent')).toBeTruthy();
    });

    test('getPinnedActions returns only pinned actions', () => {
      const pinned = getPinnedActions();
      expect(pinned.every((a) => a.pinned)).toBe(true);
      expect(pinned.find((a) => a.id === 'create-workflow')).toBeTruthy();
      expect(pinned.find((a) => a.id === 'create-agent')).toBeTruthy();
    });

    test('getCollapsibleActions excludes pinned', () => {
      const collapsible = getCollapsibleActions();
      expect(collapsible.every((a) => !a.pinned)).toBe(true);
      expect(collapsible.find((a) => a.id === 'werewolf-lab')).toBeFalsy();
    });

    test('getActionsGrouped groups by category', () => {
      const grouped = getActionsGrouped();
      expect(grouped.length).toBeGreaterThanOrEqual(3);
      for (const group of grouped) {
        expect(group.actions.length).toBeGreaterThan(0);
        expect(group.actions.every((a) => a.category === group.category.id)).toBe(true);
      }
    });

    test('getIntent finds intents from plugins', () => {
      const intent = getIntent('create-workflow');
      expect(intent).toBeTruthy();
      expect(intent!.targetTab).toBe('workflow');
      expect(intent!.opensModal).toBe(true);

      const supervisorIntent = getIntent('supervisor-chat');
      expect(supervisorIntent).toBeTruthy();
      expect(supervisorIntent!.targetTab).toBe('commander');
    });

    test('registerPlugin adds a new plugin', () => {
      const before = getAllPlugins().length;
      const testPlugin = definePlugin({
        id: 'test-dynamic',
        name: 'Test Dynamic',
        capabilities: ['persistence'],
        actions: {
          items: [
            { id: 'test-action', label: 'Test', icon: 'star', color: 'from-red-500 to-red-600', prompt: 'test', category: 'view', order: 99 },
          ],
        },
      });
      registerPlugin(testPlugin);
      expect(getAllPlugins().length).toBe(before + 1);
      expect(getActions().find((a) => a.id === 'test-action')).toBeTruthy();

      // Cleanup
      unregisterPlugin('test-dynamic');
      expect(getAllPlugins().length).toBe(before);
      expect(getActions().find((a) => a.id === 'test-action')).toBeFalsy();
    });
  });

  describe('capabilities', () => {
    test('result-extraction extracts structured results', () => {
      const cap = createResultExtractionCapability();
      const text = '一些发言内容\n\n<result>{"action":"day-vote","target":"玩家A","reason":"可疑"}</result>';
      const result = cap.extract(text, (v): v is { action: string; target: string } =>
        v?.action === 'day-vote' && typeof v?.target === 'string'
      );
      expect(result).toEqual({ action: 'day-vote', target: '玩家A', reason: '可疑' });
    });

    test('result-extraction strips result blocks', () => {
      const cap = createResultExtractionCapability();
      const text = '发言内容\n\n<result>{"action":"stay"}</result>';
      expect(cap.strip(text)).toBe('发言内容');
    });

    test('breakpoint-resume shouldSkip works correctly', () => {
      let bp: any = { handler: 'night', resumeFrom: 'witch-action' };
      const cap = createBreakpointResumeCapability(
        () => bp,
        (data) => { bp = data; },
      );
      const steps = ['wolf-meeting', 'guard-action', 'wolf-kill', 'witch-action', 'seer-check'];
      expect(cap.shouldSkip('wolf-meeting', steps)).toBe(true);
      expect(cap.shouldSkip('guard-action', steps)).toBe(true);
      expect(cap.shouldSkip('wolf-kill', steps)).toBe(true);
      expect(cap.shouldSkip('witch-action', steps)).toBe(false); // resume FROM this step
      expect(cap.shouldSkip('seer-check', steps)).toBe(false);
    });

    test('breakpoint-resume set/get/clear', () => {
      let bp: any = null;
      const cap = createBreakpointResumeCapability(
        () => bp,
        (data) => { bp = data; },
      );
      expect(cap.get()).toBeNull();
      cap.set({ handler: 'night', resumeFrom: 'seer-check', error: 'timeout' });
      expect(cap.get()?.handler).toBe('night');
      expect(cap.get()?.resumeFrom).toBe('seer-check');
      cap.clear();
      expect(cap.get()).toBeNull();
    });

    test('persistence scoped read/write', () => {
      let state: any = {};
      const cap = createPersistenceCapability(
        'test-plugin',
        () => state,
        (updater) => { state = updater(state); },
      );
      expect(cap.get()).toBeUndefined();
      cap.set((prev) => ({ count: 1 }));
      expect(cap.get<{ count: number }>()?.count).toBe(1);
      cap.set((prev: any) => ({ ...prev, count: (prev?.count || 0) + 1 }));
      expect(cap.get<{ count: number }>()?.count).toBe(2);
    });
  });

  describe('QuickActions integration', () => {
    test('renders all plugin categories and actions', () => {
      const onAction = vi.fn();
      render(<QuickActions onAction={onAction} />);

      // Categories from built-in actions/plugins
      expect(screen.getByText('创建')).toBeInTheDocument();
      expect(screen.getByText('查看')).toBeInTheDocument();

      // Actions
      expect(screen.getByText('创建工作流')).toBeInTheDocument();
      expect(screen.getByText('创建 Agent')).toBeInTheDocument();
      expect(screen.queryByText('创建狼人杀')).toBeNull();
    });

    test('werewolf is not exposed as a home quick action', async () => {
      const onAction = vi.fn();
      render(<QuickActions onAction={onAction} />);

      expect(screen.queryByRole('button', { name: /创建狼人杀/ })).toBeNull();
    });

    test('QuickActionsBar shows pinned actions and expandable section', async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      render(<QuickActionsBar onAction={onAction} />);

      // Pinned actions visible
      expect(screen.getByRole('button', { name: /创建工作流/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /创建 Agent/ })).toBeInTheDocument();

      // Werewolf is an agora extension, not a home quick action
      expect(screen.queryByRole('button', { name: /创建狼人杀/ })).toBeNull();

      // Expand
      await user.click(screen.getByRole('button', { name: /快捷操作/ }));
      expect(screen.queryByRole('button', { name: /创建狼人杀/ })).toBeNull();
    });

    test('codespec slash commands become quick actions when codespec plugin is enabled', async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      applySidebarPluginPreferences({ disabledPluginIds: [], enabledPluginIds: ['codespec'] });

      render(
        <QuickActions
          onAction={onAction}
          slashCommands={[
            {
              id: 'opencode-codespec-plan',
              command: '/opencode:codespec-plan',
              title: 'opencode: codespec-plan',
              subtext: 'Run CodeSpec plan command',
              icon: 'terminal',
              aliases: ['opencode', 'codespec-plan'],
              prompt: '/opencode:codespec-plan',
            },
            {
              id: 'opencode-other',
              command: '/opencode:help',
              title: 'opencode: help',
              subtext: 'Other command',
              icon: 'terminal',
              aliases: ['opencode', 'help'],
              prompt: '/opencode:help',
            },
          ]}
        />,
      );

      const action = screen.getByRole('button', { name: /opencode: codespec-plan/ });
      expect(action).toBeInTheDocument();
      expect(screen.getByText('CodeSpec')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /opencode: help/ })).toBeNull();

      await user.click(action);
      expect(onAction).toHaveBeenCalledWith('/opencode:codespec-plan');
    });

    test('codespec plugin exposes sync quick actions when enabled', async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      applySidebarPluginPreferences({ disabledPluginIds: [], enabledPluginIds: ['codespec'] });

      render(<QuickActionsBar onAction={onAction} />);

      await user.click(screen.getByRole('button', { name: /快捷操作/ }));
      expect(screen.getByText('CodeSpec')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /CodeSpec 同步/ }));
      expect(onAction).toHaveBeenCalledWith('__HOME_ACTION__:codespec:sync');

      await user.click(screen.getByRole('button', { name: /生成 CodeWiki/ }));
      expect(onAction).toHaveBeenCalledWith('__HOME_ACTION__:codespec:sync-generate');

      await user.click(screen.getByRole('button', { name: /CodeSpec 创建 AR/ }));
      expect(onAction).toHaveBeenCalledWith('__HOME_ACTION__:codespec:start');
    });
  });
});
