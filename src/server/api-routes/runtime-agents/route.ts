import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import {
  mergeAgentRuntimeState,
  runtimeStateRecordsToDtos,
  type AgentDefinition,
  type AgentRegistryEntry,
} from '@/lib/runtime-agent/agent-registry';
import { openRuntimeSqliteDatabase } from '@/lib/runtime-agent/sqlite/database';
import { RuntimeSqliteStore } from '@/lib/runtime-agent/sqlite/runtime-store';
import { errorMessage, jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';

export interface RuntimeAgentListItem extends AgentDefinition {
  name: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  engineModels: Record<string, string>;
  activeEngine: string;
  runtimeState: AgentRegistryEntry['runtimeState'];
  definition: AgentDefinition;
  sources: AgentRegistryEntry['sources'];
}

export async function GET() {
  try {
    const entries = loadMergedRuntimeAgents();
    return jsonOk({
      agents: entries.map(toRuntimeAgentListItem),
      registry: entries,
      runtimeAgentsDir: 'builtin-runtime-registry',
    });
  } catch (error: any) {
    return jsonError('获取运行时 Agent 列表失败', 500, errorMessage(error));
  }
}

function loadMergedRuntimeAgents(): AgentRegistryEntry[] {
  const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
  try {
    const store = new RuntimeSqliteStore(db);
    return mergeAgentRuntimeState(runtimeStateRecordsToDtos(store.listAgentRuntimeStates()));
  } finally {
    db.close();
  }
}

function toRuntimeAgentListItem(entry: AgentRegistryEntry): RuntimeAgentListItem {
  const definition = entry.definition;
  const capabilityTags = Object.entries(definition.capabilities)
    .filter(([, value]) => value === true)
    .map(([key]) => key);

  return {
    ...definition,
    name: definition.id,
    title: definition.displayName,
    description: `${definition.displayName} runtime agent`,
    category: definition.tier,
    tags: [definition.runtime, definition.tier, definition.family].filter((tag): tag is string => Boolean(tag)),
    engineModels: definition.modelConfigSchema?.supportsModelRoute ? { [definition.id]: '' } : {},
    activeEngine: definition.id,
    capabilities: {
      ...definition.capabilities,
      list: capabilityTags,
    },
    runtimeState: entry.runtimeState,
    definition,
    sources: entry.sources,
  };
}
