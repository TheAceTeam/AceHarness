/**
 * OpenCode Engine Wrapper
 *
 * Wraps ACPEngine via ACPWrapperBase to implement the Engine interface for OpenCode.
 * OpenCode uses standard ACP protocol, so the base class handles most of the work.
 */

import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import { ACPEngineConfig } from './acp-engine';
import { commandExists, getCommonCliSearchPaths } from '../command-exists';

export class OpenCodeEngineWrapper extends ACPWrapperBase {
  getName(): string {
    return 'opencode';
  }

  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    return {
      engineType: 'opencode',
      command: 'opencode',
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: [],
    };
  }

  async isAvailable(): Promise<boolean> {
    return commandExists('opencode', getCommonCliSearchPaths());
  }
}
