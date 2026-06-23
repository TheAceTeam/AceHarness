/**
 * CodeGenie Engine Wrapper
 *
 * OpenCode-kernel CLI: `codegenie acp --cwd <dir>` for ACP stdio (same argv shape as opencode).
 * 本机未进 PATH 时：设 `ACEH_CODEGENIE_COMMAND` 为可执行文件绝对路径或文件名（会在常见目录中查找）。
 */

import { commandExists, findCommand, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { getConfiguredCliSearchPaths, getConfiguredEnvValueSync } from '@/lib/core/configured-env';
import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import { ACPEngineConfig } from './acp-engine';

function resolveCodegenieCommand(): string {
  const explicit = getConfiguredEnvValueSync('ACEH_CODEGENIE_COMMAND')?.trim();
  if (explicit) {
    const resolved = findCommand(explicit, getConfiguredCliSearchPaths(getCommonCliSearchPaths()));
    if (resolved) return resolved;
  }
  return findCommand('codegenie', getConfiguredCliSearchPaths(getCommonCliSearchPaths())) || 'codegenie';
}

export class CodegenieEngineWrapper extends ACPWrapperBase {
  getName(): string {
    return 'codegenie';
  }

  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    return {
      engineType: 'codegenie',
      command: resolveCodegenieCommand(),
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: [],
    };
  }

  shouldUseOpenCodeCommandFileFallback(): boolean {
    return true;
  }

  async isAvailable(): Promise<boolean> {
    return commandExists(resolveCodegenieCommand(), getConfiguredCliSearchPaths(getCommonCliSearchPaths()));
  }
}
