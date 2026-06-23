/**
 * NGA / ngagent Engine Wrapper
 *
 * OpenCode-compatible CLI (`nga`): ACP 启动参数与 opencode 一致，进程级默认附带 `--disable-update`（见 acp-engine buildCommandArgs）。
 */

import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { commandExists, findCommand, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import {
  getConfiguredCliSearchPaths,
  getConfiguredEnvValueSync,
} from '@/lib/core/configured-env';
import { isWindows } from '@/lib/core/runtime-platform';
import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import { ACPEngine, ACPEngineConfig } from './acp-engine';

interface NgaCommandResolution {
  command: string;
  skipDisableUpdate?: boolean;
  env?: Record<string, string>;
  source?: 'primary' | 'codeagent';
}

export class NgaEngineWrapper extends ACPWrapperBase {
  private static cachedResolution: NgaCommandResolution | null = null;

  private resolveCommand(): NgaCommandResolution {
    const searchPaths = getConfiguredCliSearchPaths(getCommonCliSearchPaths());
    const ngagent = findCommand('ngagent', searchPaths);
    if (ngagent) return { command: ngagent, source: 'primary' };

    const nga = findCommand('nga', searchPaths);
    if (nga && !this.shouldPreferCodeagent()) return { command: nga, source: 'primary' };

    const codeagent = nga
      ? this.findSiblingCodeagent(nga) ?? this.findConfiguredCodeagent()
      : this.findConfiguredCodeagent();
    if (!codeagent) return { command: nga ?? 'nga' };

    const env = this.buildCodeagentEnv(codeagent);
    console.log(`[NGA] using codeagent for ACP: ${codeagent}`);
    return {
      command: codeagent,
      skipDisableUpdate: true,
      env,
      source: 'codeagent',
    };
  }

  protected async createStartedEngine(options: EngineOptions, diagnosticLoggingEnabled: boolean): Promise<ACPEngine> {
    const cached = NgaEngineWrapper.cachedResolution;
    if (cached) {
      try {
        console.log(`[NGA] using cached ACP command: ${cached.command} (${cached.source ?? 'unknown'})`);
        return await this.startEngineWithConfig(this.buildConfig(options, cached), diagnosticLoggingEnabled);
      } catch (cachedError) {
        NgaEngineWrapper.cachedResolution = null;
        console.warn(
          `[NGA] cached ACP command failed, clearing cache and retrying discovery. command=${cached.command}, reason=${this.errorMessage(cachedError)}`,
        );
      }
    }

    const primary = this.resolveCommand();
    const primaryConfig = this.buildConfig(options, primary);

    try {
      const engine = await this.startEngineWithConfig(primaryConfig, diagnosticLoggingEnabled);
      NgaEngineWrapper.cachedResolution = { ...primary, source: primary.source ?? 'primary' };
      console.log(`[NGA] ACP handshake succeeded with primary command: ${primary.command}`);
      return engine;
    } catch (error) {
      if (primary.skipDisableUpdate) {
        throw error;
      }

      const fallback = this.resolveCodeagentFallback(primary.command);
      if (!fallback) {
        console.warn(
          `[NGA] ACP handshake failed for ${primary.command}, and no codeagent fallback was found: ${this.errorMessage(error)}`,
        );
        throw error;
      }

      console.warn(
        `[NGA] ACP handshake failed for ${primary.command}; falling back to codeagent ${fallback.command}. reason: ${this.errorMessage(error)}`,
      );

      try {
        const engine = await this.startEngineWithConfig(this.buildConfig(options, fallback), diagnosticLoggingEnabled);
        NgaEngineWrapper.cachedResolution = { ...fallback, source: 'codeagent' };
        console.log(`[NGA] codeagent ACP handshake succeeded: ${fallback.command}`);
        return engine;
      } catch (fallbackError) {
        NgaEngineWrapper.cachedResolution = null;
        throw new Error(
          `[NGA] ACP handshake failed for both ${primary.command} and codeagent ${fallback.command}. ` +
          `primary=${this.errorMessage(error)}; fallback=${this.errorMessage(fallbackError)}`,
        );
      }
    }
  }

  private async startEngineWithConfig(config: ACPEngineConfig, diagnosticLoggingEnabled: boolean): Promise<ACPEngine> {
    const engine = new ACPEngine({
      ...config,
      diagnosticLogging: diagnosticLoggingEnabled,
    });
    try {
      await engine.start();
      return engine;
    } catch (error) {
      try {
        engine.stop();
      } catch {
        // ignore cleanup failures after a failed handshake
      }
      throw error;
    }
  }

  private resolveCodeagentFallback(primaryCommand: string): NgaCommandResolution | null {
    const codeagent =
      this.findConfiguredCodeagent() ??
      this.findSiblingCodeagent(primaryCommand) ??
      (() => {
        const nga = findCommand('nga', getCommonCliSearchPaths());
        return nga ? this.findSiblingCodeagent(nga) : null;
      })();

    if (!codeagent) return null;
    return {
      command: codeagent,
      skipDisableUpdate: true,
      env: this.buildCodeagentEnv(codeagent),
      source: 'codeagent',
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private shouldPreferCodeagent(): boolean {
    return /^(1|true|yes)$/i.test(getConfiguredEnvValueSync('ACEH_NGA_USE_CODEAGENT') || '');
  }

  private findConfiguredCodeagent(): string | null {
    const explicitPath = getConfiguredEnvValueSync('ACEH_NGA_CODEAGENT_PATH');
    if (explicitPath) {
      const resolved = findCommand(explicitPath);
      if (resolved) return resolved;
    }

    const ochome = getConfiguredEnvValueSync('OCHOME');
    const home = getConfiguredEnvValueSync('HOME') || getConfiguredEnvValueSync('USERPROFILE');
    const candidates = [
      ochome ? join(ochome, 'bin', 'codeagent') : '',
      home ? join(home, 'OCHOME', 'bin', 'codeagent') : '',
    ].filter(Boolean);

    for (const candidate of candidates) {
      const resolved = findCommand(candidate);
      if (resolved) return resolved;
    }
    return null;
  }

  private findSiblingCodeagent(ngaPath: string): string | null {
    const ngaDir = dirname(ngaPath);
    const installRoot = dirname(ngaDir);
    const candidates = [
      join(ngaDir, 'codeagent'),
      join(ngaDir, 'bin', 'codeagent'),
      join(installRoot, 'bin', 'codeagent'),
    ];
    for (const candidate of candidates) {
      const resolved = findCommand(candidate);
      if (resolved) return resolved;
    }
    return null;
  }

  private buildCodeagentEnv(codeagentPath: string): Record<string, string> | undefined {
    if (isWindows()) return undefined;

    const installRoot = dirname(dirname(codeagentPath));
    const muslLibDir = join(installRoot, 'bun-musl-dir', 'musl-lib');
    if (!existsSync(muslLibDir)) return undefined;

    const inherited = getConfiguredEnvValueSync('LD_LIBRARY_PATH') || '';
    return {
      LD_LIBRARY_PATH: [muslLibDir, inherited].filter(Boolean).join(':'),
    };
  }

  getName(): string {
    return 'nga';
  }

  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    const resolved = this.resolveCommand();
    return this.buildConfig(options, resolved);
  }

  shouldUseOpenCodeCommandFileFallback(): boolean {
    return true;
  }

  private buildConfig(
    options: EngineOptions,
    resolved: NgaCommandResolution,
    diagnosticLogging?: boolean,
  ): ACPEngineConfig {
    return {
      engineType: 'nga',
      command: resolved.command,
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: [],
      skipNgaDisableUpdate: resolved.skipDisableUpdate,
      env: resolved.env,
      userId: options.userId,
      diagnosticLogging,
    };
  }

  async isAvailable(): Promise<boolean> {
    const searchPaths = getConfiguredCliSearchPaths(getCommonCliSearchPaths());
    return commandExists('ngagent', searchPaths) || commandExists('nga', searchPaths) || this.findConfiguredCodeagent() !== null;
  }
}
