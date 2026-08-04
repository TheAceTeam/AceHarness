import type {
  HomePlugin,
  HomePluginManifest,
  HomePluginQuickAction,
  HomePluginActionCategory,
  HomePluginTab,
  HomePluginIntent,
  HomePluginContext,
} from './types';

// Import JSON manifests (for actions without full plugin implementations)
import coreViews from './manifests/core-views.json';
import coreOptimize from './manifests/core-optimize.json';

// Import TypeScript plugin definitions
import supervisorPlugin from '@/plugins/supervisor';
import createAgentPlugin from '@/plugins/create-agent';
import aiWorkflowCreatorPlugin from '@/plugins/ai-workflow-creator';
import codespecPlugin from '@/plugins/codespec';

// ─── Dual registry: JSON manifests (actions-only) + full plugins ───

const jsonManifests: HomePluginManifest[] = [
  coreViews,
  coreOptimize,
] as HomePluginManifest[];

const defaultFullPlugins: HomePlugin[] = [
  supervisorPlugin,
  createAgentPlugin,
  aiWorkflowCreatorPlugin,
  codespecPlugin,
];

let fullPlugins: HomePlugin[] = defaultFullPlugins.map((plugin) => ({ ...plugin }));

// ─── Plugin CRUD ───

export function registerPlugin(plugin: HomePlugin): void {
  const idx = fullPlugins.findIndex((p) => p.id === plugin.id);
  if (idx >= 0) fullPlugins[idx] = plugin;
  else fullPlugins.push(plugin);
}

export function unregisterPlugin(id: string): void {
  fullPlugins = fullPlugins.filter((p) => p.id !== id);
}

export function getAllPlugins(options?: { includeDisabled?: boolean }): HomePlugin[] {
  if (options?.includeDisabled) {
    return [...fullPlugins];
  }
  return fullPlugins.filter((p) => p.enabled !== false);
}

export function applyDisabledPluginIds(disabledPluginIds: string[]): void {
  applySidebarPluginPreferences({ disabledPluginIds, enabledPluginIds: [] });
}

export function applySidebarPluginPreferences(preferences: { disabledPluginIds?: string[]; enabledPluginIds?: string[] }): void {
  const disabled = new Set(preferences.disabledPluginIds || []);
  const enabled = new Set(preferences.enabledPluginIds || []);
  const currentById = new Map(fullPlugins.map((plugin) => [plugin.id, plugin]));
  const sourcePlugins = [
    ...defaultFullPlugins,
    ...fullPlugins.filter((plugin) => !defaultFullPlugins.some((builtin) => builtin.id === plugin.id)),
  ];

  fullPlugins = sourcePlugins.map((plugin) => ({
    ...(currentById.get(plugin.id) || plugin),
    ...plugin,
    enabled: enabled.has(plugin.id) ? true : (plugin.enabled === false ? false : !disabled.has(plugin.id)),
  }));
}

export function getAllManifests(): HomePluginManifest[] {
  return jsonManifests.filter((m) => m.enabled !== false);
}

// ─── Derived queries (merge JSON manifests + full plugins) ───

export function getCategories(): HomePluginActionCategory[] {
  const categories: HomePluginActionCategory[] = [];
  for (const manifest of getAllManifests()) {
    if (manifest.categories) categories.push(...manifest.categories);
  }
  for (const plugin of getAllPlugins()) {
    if (plugin.actions?.categories) categories.push(...plugin.actions.categories);
  }
  // Deduplicate by id
  const seen = new Set<string>();
  return categories
    .filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function getActions(categoryId?: string): HomePluginQuickAction[] {
  const actions: HomePluginQuickAction[] = [];
  for (const manifest of getAllManifests()) {
    if (manifest.actions) actions.push(...manifest.actions);
  }
  for (const plugin of getAllPlugins()) {
    if (plugin.actions?.items) actions.push(...plugin.actions.items);
  }
  const filtered = categoryId ? actions.filter((a) => a.category === categoryId) : actions;
  return filtered.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function getPinnedActions(): HomePluginQuickAction[] {
  return getActions().filter((a) => a.pinned);
}

export function getCollapsibleActions(): HomePluginQuickAction[] {
  return getActions().filter((a) => !a.pinned);
}

export function getTabs(context?: HomePluginContext): HomePluginTab[] {
  const tabs: HomePluginTab[] = [];
  // From JSON manifests
  for (const manifest of getAllManifests()) {
    if (!manifest.tabs) continue;
    for (const tab of manifest.tabs) {
      if (tab.availableWhen?.length && context) {
        const allMet = tab.availableWhen.every((cond) => context[cond]);
        if (!allMet) continue;
      }
      if (!tabs.some((t) => t.id === tab.id)) tabs.push(tab);
    }
  }
  // From full plugins
  for (const plugin of getAllPlugins()) {
    if (!plugin.tab) continue;
    if (!tabs.some((t) => t.id === plugin.tab!.id)) {
      tabs.push({ id: plugin.tab.id, label: plugin.tab.label, order: plugin.tab.order });
    }
  }
  return tabs.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function getIntent(intentId: string): HomePluginIntent | undefined {
  for (const manifest of getAllManifests()) {
    const found = manifest.intents?.find((i) => i.id === intentId);
    if (found) return found;
  }
  for (const plugin of getAllPlugins()) {
    const found = plugin.intents?.find((i) => i.id === intentId);
    if (found) return found;
  }
  return undefined;
}

export function getAllIntents(): HomePluginIntent[] {
  const intents: HomePluginIntent[] = [];
  for (const manifest of getAllManifests()) {
    if (manifest.intents) intents.push(...manifest.intents);
  }
  for (const plugin of getAllPlugins()) {
    if (plugin.intents) intents.push(...plugin.intents);
  }
  return intents;
}

export function getActionsGrouped(): Array<{ category: HomePluginActionCategory; actions: HomePluginQuickAction[] }> {
  const categories = getCategories();
  return categories.map((category) => ({
    category,
    actions: getActions(category.id),
  })).filter((group) => group.actions.length > 0);
}

// Re-export intent handlers from separate module (avoids circular deps)
export { registerIntentHandler, unregisterIntentHandler, getIntentHandler, dispatchHomeAction } from './intent-handlers';
export type { IntentHandler } from './intent-handlers';
