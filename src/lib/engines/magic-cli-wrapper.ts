import { existsSync } from 'fs';
import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import { ACPEngineConfig } from './acp-engine';

const SEARCH_PATHS = [
  '/Users/jump/projects/cangjie/magic-cli/scripts/magic-cli.sh',
];

function resolveBinary(): string | null {
  for (const p of SEARCH_PATHS) {
    if (existsSync(p)) return p;
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