/**
 * Engine-aware configuration directory mapping.
 * Maps engine types to their workspace agent config directories.
 */

import type { EngineType } from './engine-factory';

const ENGINE_CONFIG_DIRS: Record<string, string> = {
  'claude-code': '.claude',
  'claude-code-acp': '.claude',
  'kiro-cli': '.kiro',
  'opencode': '.opencode',
  'opencode-sdk': '.opencode',
  'nga': '.opencode',
  'codegenie': '.opencode',
  'codegenie-sdk': '.opencode',
  'codex': '.codex',
  'cursor': '.cursor',
  'trae-cli': '.trae',
  'magic-cli': '.magic-cli',
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
