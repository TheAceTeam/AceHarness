'use client';

import React, { useMemo, useState, useCallback } from 'react';
import type { HomePlugin, PluginContext, PluginRenderProps } from '@/lib/sidebar-plugins';
import { usePluginContext, usePluginCapabilities } from './PluginCapabilityProvider';

interface PluginHostProps {
  /** All registered plugins */
  plugins: HomePlugin[];
  /** Current plugin context for visibility evaluation */
  pluginContext: PluginContext;
  /** Currently active tab ID */
  activeTab: string;
  /** Tab change callback */
  onTabChange: (tabId: string) => void;
  /** Per-plugin state store */
  pluginStates: Record<string, any>;
  /** Per-plugin state updater */
  onPluginStateChange: (pluginId: string, updater: (prev: any) => any) => void;
}

/**
 * PluginHost renders the active plugin's tab content.
 * It resolves which plugin owns the active tab, evaluates visibility,
 * and calls plugin.tab.render() with the appropriate props.
 *
 * This component sits inside PluginCapabilityProvider and has access
 * to all capabilities via context.
 */
export function PluginHost({
  plugins,
  pluginContext,
  activeTab,
  onTabChange,
  pluginStates,
  onPluginStateChange,
}: PluginHostProps) {
  const ctx = usePluginContext();
  const capabilities = usePluginCapabilities();

  // Find the plugin that owns the active tab
  const activePlugin = useMemo(() => {
    return plugins.find((p) => {
      if (!p.tab || p.tab.id !== activeTab) return false;
      if (p.enabled === false) return false;
      if (p.tab.availableWhen && !p.tab.availableWhen(pluginContext)) return false;
      return true;
    });
  }, [plugins, activeTab, pluginContext]);

  // Build render props for the active plugin
  const renderProps: PluginRenderProps | null = useMemo(() => {
    if (!activePlugin) return null;
    return {
      ctx,
      capabilities,
      state: pluginStates[activePlugin.id],
      setState: (updater: (prev: any) => any) => onPluginStateChange(activePlugin.id, updater),
    };
  }, [activePlugin, ctx, capabilities, pluginStates, onPluginStateChange]);

  if (!activePlugin?.tab || !renderProps) {
    return null;
  }

  return <>{activePlugin.tab.render(renderProps)}</>;
}

/**
 * Get available tab definitions from plugins, filtered by context.
 */
export function getAvailablePluginTabs(
  plugins: HomePlugin[],
  context: PluginContext
): Array<{ id: string; label: string; pluginId: string }> {
  const tabs: Array<{ id: string; label: string; pluginId: string; order: number }> = [];
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    if (!plugin.tab) continue;
    if (plugin.tab.availableWhen && !plugin.tab.availableWhen(context)) continue;
    // Deduplicate by tab ID (first plugin wins)
    if (!tabs.some((t) => t.id === plugin.tab!.id)) {
      tabs.push({
        id: plugin.tab.id,
        label: plugin.tab.label,
        pluginId: plugin.id,
        order: plugin.tab.order ?? 100,
      });
    }
  }
  return tabs.sort((a, b) => a.order - b.order);
}
