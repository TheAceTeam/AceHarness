/**
 * Engine-aware configuration directory mapping.
 * Maps engine types to their workspace agent config directories.
 */

import type { EngineType } from './engine-factory';

const ENGINE_CONFIG_DIRS: Record<string, string> = {
  'claude-code': '.claude',
  'kiro-cli': '.kiro',
  'opencode': '.opencode',
  'nga': '.opencode',
  'codegenie': '.opencode',
  'codex': '.codex',
  'cursor': '.cursor',
  'cangjie-magic': '.claude',
  'trae-cli': '.trae',
};

/**
 * Get the workspace agent config directory for a given engine type.
 * e.g. 'kiro-cli' → '.kiro', 'opencode' → '.opencode'
 */
export function getEngineConfigDir(engineType: EngineType | string): string {
  return ENGINE_CONFIG_DIRS[engineType] || '.claude';
}

/**
 * Get the workspace skills subdirectory for a given engine type.
 * e.g. 'kiro-cli' → '.kiro/skills', 'opencode' → '.opencode/skills'
 */
export function getEngineSkillsSubdir(engineType: EngineType | string): string {
  return `${getEngineConfigDir(engineType)}/skills`;
}
