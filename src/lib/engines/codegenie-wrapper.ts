/**
 * CodeGenie Engine Wrapper
 *
 * OpenCode-kernel CLI: `codegenie acp --cwd <dir>` for ACP stdio (same argv shape as opencode).
 */

import { commandExists } from '../command-exists';
import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import { ACPEngineConfig } from './acp-engine';

export class CodegenieEngineWrapper extends ACPWrapperBase {
  getName(): string {
    return 'codegenie';
  }

  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    return {
      engineType: 'codegenie',
      command: 'codegenie',
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: [],
    };
  }

  async isAvailable(): Promise<boolean> {
    return commandExists('codegenie');
  }
}
