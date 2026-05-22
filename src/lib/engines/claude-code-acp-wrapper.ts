/**
 * Claude Code ACP Engine Wrapper
 *
 * Uses the standalone `claude-agent-acp` binary provided by
 * @agentclientprotocol/claude-agent-acp.
 */

import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import type { ACPEngineConfig } from './acp-engine';
import { commandExists, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { getConfiguredCliSearchPaths } from '@/lib/core/configured-env';

export class ClaudeCodeAcpEngineWrapper extends ACPWrapperBase {
  getName(): string {
    return 'claude-code-acp';
  }

  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    return {
      engineType: 'claude-code-acp',
      command: 'claude-agent-acp',
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: [],
    };
  }

  async isAvailable(): Promise<boolean> {
    return commandExists('claude-agent-acp', getConfiguredCliSearchPaths(getCommonCliSearchPaths()));
  }
}
