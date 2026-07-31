import { existsSync, readFileSync } from 'fs';
import { getEngineConfigPath } from '@/lib/core/app-paths';
import { resolveWorkflowAgentSelection } from '@/lib/agent/engine-selection';

export function resolveAgentEngineSelection(roleConfig: any, workflowContext?: any): { engine: string; model: string } {
  let globalEngine = '';
  let defaultModel = '';

  try {
    if (existsSync(getEngineConfigPath())) {
      const config = JSON.parse(readFileSync(getEngineConfigPath(), 'utf-8'));
      globalEngine = config.engine || globalEngine;
      defaultModel = config.defaultModel || '';
    }
  } catch {
    // Fall back to configured workflow and Agent defaults.
  }

  const resolved = resolveWorkflowAgentSelection(
    roleConfig,
    { engine: globalEngine, defaultModel },
    { agentName: roleConfig?.name, workflowContext },
  );

  if (!resolved.effectiveEngine) {
    throw new Error('No default engine is configured');
  }
  if (!resolved.effectiveModel) {
    throw new Error('No default model is configured');
  }

  return {
    engine: resolved.effectiveEngine,
    model: resolved.effectiveModel,
  };
}

export function resolveAgentModel(roleConfig: any, workflowContext?: any): string {
  return resolveAgentEngineSelection(roleConfig, workflowContext).model;
}
