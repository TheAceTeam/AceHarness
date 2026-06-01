/**
 * Shared ACE agent configuration directory.
 * Supported engines discover the same `.agents` workspace metadata, so ACE keeps
 * skills and agent-facing runtime files in one place instead of mirroring them
 * under engine-specific directories.
 */

import type { EngineType } from './engine-factory';

export const SHARED_AGENT_CONFIG_DIR = '.agents';

/**
 * Get the workspace agent config directory for a given engine type.
 * All supported engines share `.agents` for ACE-provided agent metadata.
 */
export function getEngineConfigDir(_engineType: EngineType | string): string {
  return SHARED_AGENT_CONFIG_DIR;
}

/**
 * Get the workspace skills subdirectory for a given engine type.
 * e.g. 'codex' → '.agents/skills', 'opencode' → '.agents/skills'
 */
export function getEngineSkillsSubdir(engineType: EngineType | string): string {
  return `${getEngineConfigDir(engineType)}/skills`;
}
