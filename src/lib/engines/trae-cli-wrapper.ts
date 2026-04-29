/**
 * Trae CLI Engine Wrapper
 *
 * Wraps ACPEngine via ACPWrapperBase to implement the Engine interface for Trae CLI.
 * Trae CLI uses standard ACP protocol with `trae-cli acp serve` command.
 */

import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import { ACPEngineConfig } from './acp-engine';
import { commandExists, getCommonCliSearchPaths } from '../command-exists';

export class TraeCliEngineWrapper extends ACPWrapperBase {
  getName(): string {
    return 'trae-cli';
  }

  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    return {
      engineType: 'trae-cli',
      command: 'trae-cli',
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: [],
    };
  }

  async isAvailable(): Promise<boolean> {
    return commandExists('trae-cli', getCommonCliSearchPaths());
  }
}
