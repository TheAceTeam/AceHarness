'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ChatSession } from '@/contexts/ChatContext';
import type { SessionWorkbenchState } from '@/lib/core/home-sidebar-state';
import { useWorkflowLiveState } from '@/lib/workflow/live-store';
import { resolveConversationMode } from '@/lib/chat/conversation-mode';
import {
  ConversationRightRailEmptyState,
  createBuiltInConversationRightRailPlugins,
  type ConversationRightRailContext,
} from '@/lib/chat/right-rail-plugins';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/core/utils';

export interface ConversationRightRailProps {
  session: ChatSession | null;
  className?: string;
  legacyPanel?: ReactNode;
  onCollapse?: () => void;
  setSessionWorkbenchState?: (state: SessionWorkbenchState | ((prev: SessionWorkbenchState | undefined) => SessionWorkbenchState)) => void;
}

export default function ConversationRightRail({
  session,
  className,
  legacyPanel,
  onCollapse,
  setSessionWorkbenchState,
}: ConversationRightRailProps) {
  const live = useWorkflowLiveState();
  const mode = resolveConversationMode(session, { runStatusById: live.runStatusById });
  const context = useMemo<ConversationRightRailContext>(() => ({
    session,
    mode,
    live,
    setSessionWorkbenchState,
  }), [live, mode, session, setSessionWorkbenchState]);
  const plugins = useMemo(() => createBuiltInConversationRightRailPlugins(legacyPanel), [legacyPanel]);
  const activePlugins = useMemo(
    () => plugins
      .filter((plugin) => plugin.modes.includes(mode) && plugin.shouldActivate(context))
      .sort((a, b) => b.priority - a.priority),
    [context, mode, plugins],
  );
  const persistedPluginId = session?.sessionWorkbenchState?.rightRail?.activePluginId;
  const [localPluginId, setLocalPluginId] = useState<string | null>(persistedPluginId || null);
  const activePlugin = activePlugins.find((plugin) => plugin.id === (localPluginId || persistedPluginId))
    || activePlugins[0];
  const shouldRenderLegacyPanel = Boolean(legacyPanel) && activePlugins.length === 0;

  useEffect(() => {
    if (!activePlugin) return;
    if (localPluginId && activePlugins.some((plugin) => plugin.id === localPluginId)) return;
    setLocalPluginId(activePlugin.id);
  }, [activePlugin, activePlugins, localPluginId]);

  const selectPlugin = (pluginId: string) => {
    setLocalPluginId(pluginId);
    setSessionWorkbenchState?.((prev) => ({
      ...(prev || {}),
      rightRail: {
        ...(prev?.rightRail || {}),
        activePluginId: pluginId,
        collapsed: false,
        updatedAt: Date.now(),
      },
    }));
  };

  return (
    <aside className={cn('flex h-full min-h-0 flex-col border-l bg-card/30', className)}>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{activePlugin?.title || (shouldRenderLegacyPanel ? '创建工作流' : '工作流侧栏')}</div>
          <div className="truncate text-[10px] text-muted-foreground">{activePlugin ? '对话内工作流能力' : shouldRenderLegacyPanel ? '创建、启动和管理工作流' : '当前对话暂无可用面板'}</div>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onCollapse} title="收起右侧边栏">
          <span className="material-symbols-outlined text-[18px]">right_panel_close</span>
        </Button>
      </div>
      {activePlugins.length > 0 ? (
        <div className="shrink-0 border-b px-2 py-2">
          <div className="flex gap-1 overflow-x-auto">
            {activePlugins.map((plugin) => (
              <button
                key={plugin.id}
                type="button"
                className={cn(
                  'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
                  plugin.id === activePlugin?.id
                    ? 'bg-background text-primary ring-1 ring-primary/20'
                    : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                )}
                onClick={() => selectPlugin(plugin.id)}
              >
                <span className="material-symbols-outlined text-[15px]">{plugin.icon}</span>
                <span>{plugin.title}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="home-chat-scroll min-h-0 flex-1 overflow-auto p-3">
        {activePlugin
          ? <div key={activePlugin.id} className="h-full min-h-0">{activePlugin.render(context)}</div>
          : shouldRenderLegacyPanel
            ? legacyPanel
            : <ConversationRightRailEmptyState text="当前对话没有可用右侧面板" />}
      </div>
    </aside>
  );
}
