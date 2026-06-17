/**
 * OpenCode Engine Wrapper
 *
 * Wraps ACPEngine via ACPWrapperBase to implement the Engine interface for OpenCode.
 * OpenCode uses standard ACP protocol, so the base class handles most of the work.
 */

import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import { ACPEngineConfig } from './acp-engine';
import { commandExists, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { getConfiguredCliSearchPaths } from '@/lib/core/configured-env';
import { buildOpenCodeRawCommandPrompt, isOpenCodeSlashCommandPrompt } from './opencode-command';

export class OpenCodeEngineWrapper extends ACPWrapperBase {
  getName(): string {
    return 'opencode';
  }

  protected shouldRecoverLatestAssistantMessage(): boolean {
    return true;
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

  buildPrompt(options: EngineOptions, sessionAction: 'created' | 'resumed' | 'reused'): string {
    if (options.rawPrompt && isOpenCodeSlashCommandPrompt(options.prompt)) {
      return buildOpenCodeRawCommandPrompt(options.prompt);
    }
    return super.buildPrompt(options, sessionAction);
  }

  shouldApplyModelOverride(model: string): boolean {
    return Boolean(String(model || '').trim());
  }

  async isAvailable(): Promise<boolean> {
    return commandExists('opencode', getConfiguredCliSearchPaths(getCommonCliSearchPaths()));
  }
}
