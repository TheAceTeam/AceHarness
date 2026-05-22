import { existsSync } from 'fs';
import { delimiter, join } from 'path';
import { buildConfiguredProcessEnvSync, getConfiguredEnvValueSync } from '@/lib/core/configured-env';
import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import { ACPEngineConfig } from './acp-engine';

const SEARCH_PATHS = [
  '/Users/jump/projects/cangjie/magic-cli/scripts/magic-cli.sh',
];

export function resolveBinary(): string | null {
  // 1. Check MAGIC_CLI_PATH env var first
  const envPath = getConfiguredEnvValueSync('MAGIC_CLI_PATH');
  if (envPath) {
    if (existsSync(envPath)) return envPath;
  }

  // 2. Search hardcoded paths
  for (const p of SEARCH_PATHS) {
    if (existsSync(p)) return p;
  }

  // 3. Search PATH directories for magic-cli.sh
  const env = buildConfiguredProcessEnvSync();
  const pathDirs = (env.PATH || env.Path || '').split(delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = join(dir, 'magic-cli.sh');
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

export class MagicCliEngineWrapper extends ACPWrapperBase {
  // Model is set via --model at startup, skip runtime setModel (ACP validation would fail)
  protected skipRuntimeModelSwitch = true;

  getName(): string {
    return 'magic-cli';
  }

  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    const command = resolveBinary();
    if (!command) {
      throw new Error('magic-cli.sh not found');
    }
    return {
      engineType: 'magic-cli',
      command,
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: [],
    };
  }

  async isAvailable(): Promise<boolean> {
    return resolveBinary() !== null;
  }
}
