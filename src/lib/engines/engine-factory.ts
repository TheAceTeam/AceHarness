/**
 * Engine Factory
 *
 * Creates and manages different AI engine instances
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { getEngineConfigPath } from '@/lib/app-paths';
import type { Engine } from './engine-interface';
import { KiroCliEngineWrapper } from './kiro-cli-wrapper';
import { CangjieMagicEngineWrapper } from './cangjie-magic-wrapper';
import { OpenCodeEngineWrapper } from './opencode-wrapper';
import { CodexEngineWrapper } from './codex-wrapper';
import { CursorEngineWrapper } from './cursor-wrapper';
import { ClaudeCodeEngineWrapper } from './claude-code-wrapper';
import { TraeCliEngineWrapper } from './trae-cli-wrapper';
import { NgaEngineWrapper } from './nga-wrapper';
import { CodegenieEngineWrapper } from './codegenie-wrapper';

export type EngineType = 'claude-code' | 'kiro-cli' | 'codex' | 'cursor' | 'cangjie-magic' | 'opencode' | 'nga' | 'codegenie' | 'trae-cli';

interface EngineConfig {
  engine: EngineType;
  updatedAt?: string;
}

/**
 * Get the configured engine type
 */
export async function getConfiguredEngine(): Promise<EngineType> {
  const configPath = getEngineConfigPath();

  if (existsSync(configPath)) {
    try {
      const content = await readFile(configPath, 'utf-8');
      const config: EngineConfig = JSON.parse(content);
      if (config.engine) return config.engine;
    } catch (error) {
      console.warn('Failed to read engine config:', error);
    }
  }

  throw new Error('默认引擎未配置，请先完成初始化设置');
}

// Engine pool: reuse engine instances across messages in the same chat session
const enginePool = new Map<string, { engine: Engine; engineType: EngineType; lastUsed: number }>();
const ENGINE_POOL_TTL = 10 * 60 * 1000; // 10 minutes idle timeout

// Periodically clean up idle engines
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of enginePool) {
    if (now - entry.lastUsed > ENGINE_POOL_TTL) {
      if (typeof (entry.engine as any).cleanup === 'function') {
        (entry.engine as any).cleanup();
      }
      enginePool.delete(key);
    }
  }
}, 60_000);

/**
 * Get or create an engine instance for a session.
 * When sessionKey is provided, engines are pooled and reused across messages.
 */
export async function getOrCreateEngine(type?: EngineType, sessionKey?: string): Promise<Engine | null> {
  const engineType = type || await getConfiguredEngine();
  if (sessionKey) {
    const cached = enginePool.get(sessionKey);
    if (cached) {
      // Engine type changed — discard the old cached engine
      if (cached.engineType !== engineType) {
        if (typeof (cached.engine as any).cleanup === 'function') {
          (cached.engine as any).cleanup();
        }
        enginePool.delete(sessionKey);
      } else {
        cached.lastUsed = Date.now();
        return cached.engine;
      }
    }
  }
  const engine = await createEngine(engineType);
  if (engine && sessionKey) {
    enginePool.set(sessionKey, { engine, engineType, lastUsed: Date.now() });
  }
  return engine;
}

/**
 * Create an engine instance based on type
 */
export async function createEngine(type?: EngineType): Promise<Engine | null> {
  const engineType = type || await getConfiguredEngine();

  switch (engineType) {
    case 'kiro-cli':
      const kiroEngine = new KiroCliEngineWrapper();
      const kiroAvailable = await kiroEngine.isAvailable();
      if (!kiroAvailable) {
        console.warn('[EngineFactory] Kiro CLI is not available, falling back to Claude Code');
        return null;
      }
      return kiroEngine;

    case 'claude-code':
      const ccEngine = new ClaudeCodeEngineWrapper();
      if (!(await ccEngine.isAvailable())) {
        console.warn('[EngineFactory] Claude Code CLI is not available');
        return null;
      }
      return ccEngine;

    case 'codex':
      const codexEngine = new CodexEngineWrapper();
      const codexAvailable = await codexEngine.isAvailable();
      if (!codexAvailable) {
        console.warn('[EngineFactory] Codex is not available, falling back to Claude Code');
        return null;
      }
      return codexEngine;

    case 'cursor':
      const cursorEngine = new CursorEngineWrapper();
      const cursorAvailable = await cursorEngine.isAvailable();
      if (!cursorAvailable) {
        console.warn('[EngineFactory] Cursor CLI is not available, falling back to Claude Code');
        return null;
      }
      return cursorEngine;

    case 'cangjie-magic':
      const cjEngine = new CangjieMagicEngineWrapper();
      if (!(await cjEngine.isAvailable())) {
        console.warn('[EngineFactory] CangjieMagic is not available, falling back to Claude Code');
        return null;
      }
      return cjEngine;

    case 'opencode':
      const ocEngine = new OpenCodeEngineWrapper();
      if (!(await ocEngine.isAvailable())) {
        console.warn('[EngineFactory] OpenCode is not available, falling back to Claude Code');
        return null;
      }
      return ocEngine;

    case 'nga':
      const ngaEngine = new NgaEngineWrapper();
      if (!(await ngaEngine.isAvailable())) {
        console.warn('[EngineFactory] NGA (nga) is not available, falling back to Claude Code');
        return null;
      }
      return ngaEngine;

    case 'codegenie':
      const codegenieEngine = new CodegenieEngineWrapper();
      if (!(await codegenieEngine.isAvailable())) {
        console.warn('[EngineFactory] CodeGenie is not available, falling back to Claude Code');
        return null;
      }
      return codegenieEngine;

    case 'trae-cli':
      const traeEngine = new TraeCliEngineWrapper();
      if (!(await traeEngine.isAvailable())) {
        console.warn('[EngineFactory] Trae CLI is not available, falling back to Claude Code');
        return null;
      }
      return traeEngine;

    default:
      console.warn(`Unknown engine type: ${engineType}`);
      return null;
  }
}

/**
 * Check if an engine is available
 */
export async function isEngineAvailable(type: EngineType): Promise<boolean> {
  switch (type) {
    case 'kiro-cli':
      const kiroEngine = new KiroCliEngineWrapper();
      return await kiroEngine.isAvailable();

    case 'claude-code':
      const ccCheck = new ClaudeCodeEngineWrapper();
      return await ccCheck.isAvailable();

    case 'cangjie-magic':
      const cjCheck = new CangjieMagicEngineWrapper();
      return await cjCheck.isAvailable();

    case 'opencode':
      const ocCheck = new OpenCodeEngineWrapper();
      return await ocCheck.isAvailable();

    case 'nga':
      const ngaCheck = new NgaEngineWrapper();
      return await ngaCheck.isAvailable();

    case 'codegenie':
      const codegenieCheck = new CodegenieEngineWrapper();
      return await codegenieCheck.isAvailable();

    case 'codex':
      const codexCheck = new CodexEngineWrapper();
      return await codexCheck.isAvailable();

    case 'cursor':
      const cursorCheck = new CursorEngineWrapper();
      return await cursorCheck.isAvailable();

    case 'trae-cli':
      const traeCheck = new TraeCliEngineWrapper();
      return await traeCheck.isAvailable();

    default:
      return false;
  }
}
