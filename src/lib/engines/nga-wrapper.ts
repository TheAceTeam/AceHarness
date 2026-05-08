/**
 * NGA / ngagent Engine Wrapper
 *
 * OpenCode-compatible CLI (`nga`): ACP 启动参数与 opencode 一致，进程级默认附带 `--disable-update`（见 acp-engine buildCommandArgs）。
 */

import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { commandExists, findCommand, getCommonCliSearchPaths } from '../command-exists';
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
    const searchPaths = getCommonCliSearchPaths();
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

  protected async startNewEngine(options: EngineOptions): Promise<void> {
    const cached = NgaEngineWrapper.cachedResolution;
    if (cached) {
      try {
        console.log(`[NGA] using cached ACP command: ${cached.command} (${cached.source ?? 'unknown'})`);
        await this.startEngineWithConfig(this.buildConfig(options, cached));
        return;
      } catch (cachedError) {
        await this.stopFailedEngine();
        NgaEngineWrapper.cachedResolution = null;
        console.warn(
          `[NGA] cached ACP command failed, clearing cache and retrying discovery. command=${cached.command}, reason=${this.errorMessage(cachedError)}`,
        );
      }
    }

    const primary = this.resolveCommand();
    const primaryConfig = this.buildConfig(options, primary);

    try {
      await this.startEngineWithConfig(primaryConfig);
      NgaEngineWrapper.cachedResolution = { ...primary, source: primary.source ?? 'primary' };
      console.log(`[NGA] ACP handshake succeeded with primary command: ${primary.command}`);
      return;
    } catch (error) {
      await this.stopFailedEngine();

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
        await this.startEngineWithConfig(this.buildConfig(options, fallback));
        NgaEngineWrapper.cachedResolution = { ...fallback, source: 'codeagent' };
        console.log(`[NGA] codeagent ACP handshake succeeded: ${fallback.command}`);
      } catch (fallbackError) {
        await this.stopFailedEngine();
        NgaEngineWrapper.cachedResolution = null;
        throw new Error(
          `[NGA] ACP handshake failed for both ${primary.command} and codeagent ${fallback.command}. ` +
          `primary=${this.errorMessage(error)}; fallback=${this.errorMessage(fallbackError)}`,
        );
      }
    }
  }

  private async startEngineWithConfig(config: ACPEngineConfig): Promise<void> {
    this.engine = new ACPEngine(config);
    this.setupEngineEvents();
    await this.engine.start();
  }

  private async stopFailedEngine(): Promise<void> {
    if (!this.engine) return;
    try {
      await this.engine.stop();
    } catch {
      // ignore cleanup failures after a failed handshake
    } finally {
      this.engine = null;
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
    return /^(1|true|yes)$/i.test(process.env.ACEH_NGA_USE_CODEAGENT || '');
  }

  private findConfiguredCodeagent(): string | null {
    const explicitPath = process.env.ACEH_NGA_CODEAGENT_PATH;
    if (explicitPath) {
      const resolved = findCommand(explicitPath);
      if (resolved) return resolved;
    }

    const ochome = process.env.OCHOME;
    const home = process.env.HOME || process.env.USERPROFILE;
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
    if (process.platform === 'win32') return undefined;

    const installRoot = dirname(dirname(codeagentPath));
    const muslLibDir = join(installRoot, 'bun-musl-dir', 'musl-lib');
    if (!existsSync(muslLibDir)) return undefined;

    const inherited = process.env.LD_LIBRARY_PATH || '';
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

  private buildConfig(options: EngineOptions, resolved: NgaCommandResolution): ACPEngineConfig {
    return {
      engineType: 'nga',
      command: resolved.command,
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: [],
      skipNgaDisableUpdate: resolved.skipDisableUpdate,
      env: resolved.env,
    };
  }

  async isAvailable(): Promise<boolean> {
    return commandExists('ngagent') || commandExists('nga') || this.findConfiguredCodeagent() !== null;
  }
}
