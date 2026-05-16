/**
 * usePluginRenderers hook
 *
 * Allows HomeCommandSidebar to register its tab renderers with the plugin system.
 * This bridges the existing monolithic component with the plugin architecture,
 * enabling new plugins to render alongside existing tabs.
 *
 * Usage in HomeCommandSidebar:
 *   const { renderActiveTab, isPluginTab } = usePluginRenderers(activeTab, {
 *     commander: () => <CommanderContent />,
 *     workflow: () => <WorkflowContent />,
 *     agent: () => <AgentContent />,
 *   });
 *
 * In the JSX:
 *   {isPluginTab ? renderActiveTab() : <ExistingTabContent />}
 */

import { useMemo, useCallback } from 'react';
import { getAllPlugins, type HomePlugin, type PluginContext } from '@/lib/sidebar-plugins';

interface TabRenderers {
  [tabId: string]: () => React.ReactNode;
}

interface UsePluginRenderersResult {
  /** All available tab IDs (built-in + plugin-contributed) */
  availableTabIds: string[];
  /** Whether the active tab is owned by an external plugin (not built-in) */
  isExternalPluginTab: boolean;
  /** Render the active tab's content (works for both built-in and plugin tabs) */
  renderActiveTab: () => React.ReactNode;
  /** Get plugin that owns a tab */
  getTabPlugin: (tabId: string) => HomePlugin | undefined;
}

export function usePluginRenderers(
  activeTab: string,
  builtinRenderers: TabRenderers,
  pluginContext: PluginContext,
): UsePluginRenderersResult {
  const plugins = getAllPlugins();

  // Collect all available tabs: built-in + plugin-contributed
  const availableTabIds = useMemo(() => {
    const ids = new Set(Object.keys(builtinRenderers));
    for (const plugin of plugins) {
      if (!plugin.tab) continue;
      if (plugin.enabled === false) continue;
      if (plugin.tab.availableWhen && !plugin.tab.availableWhen(pluginContext)) continue;
      ids.add(plugin.tab.id);
    }
    return Array.from(ids);
  }, [builtinRenderers, plugins, pluginContext]);

  // Find plugin that owns a tab
  const getTabPlugin = useCallback((tabId: string): HomePlugin | undefined => {
    return plugins.find((p) => p.tab?.id === tabId && p.enabled !== false);
  }, [plugins]);

  // Check if active tab is from an external plugin (not covered by built-in renderers)
  const isExternalPluginTab = useMemo(() => {
    return !builtinRenderers[activeTab] && plugins.some(
      (p) => p.tab?.id === activeTab && p.enabled !== false
    );
  }, [activeTab, builtinRenderers, plugins]);

  // Render the active tab
  const renderActiveTab = useCallback((): React.ReactNode => {
    // Built-in renderer takes priority
    if (builtinRenderers[activeTab]) {
      return builtinRenderers[activeTab]();
    }
    // Fall back to plugin renderer
    const plugin = getTabPlugin(activeTab);
    if (plugin?.tab?.render) {
      // Plugin render with minimal props (capabilities will be injected via context)
      return plugin.tab.render({
        ctx: null as any, // Will be provided by PluginCapabilityProvider in full migration
        capabilities: {},
        state: undefined,
        setState: () => {},
      });
    }
    return null;
  }, [activeTab, builtinRenderers, getTabPlugin]);

  return {
    availableTabIds,
    isExternalPluginTab,
    renderActiveTab,
    getTabPlugin,
  };
}
