/**
 * Engine Factory
 *
 * Creates and manages different AI engine instances
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { getEngineConfigPath } from '@/lib/core/app-paths';
import type { Engine } from './engine-interface';
import { KiroCliEngineWrapper } from './kiro-cli-wrapper';
import { CangjieMagicEngineWrapper } from './cangjie-magic-wrapper';
import { OpenCodeEngineWrapper } from './opencode-wrapper';
import { OpenCodeSdkEngineWrapper } from './opencode-sdk-wrapper';
import { CodexEngineWrapper } from './codex-wrapper';
import { CursorEngineWrapper } from './cursor-wrapper';
import { ClaudeCodeEngineWrapper } from './claude-code-wrapper';
import { ClaudeCodeAcpEngineWrapper } from './claude-code-acp-wrapper';
import { TraeCliEngineWrapper } from './trae-cli-wrapper';
import { NgaEngineWrapper } from './nga-wrapper';
import { CodegenieEngineWrapper } from './codegenie-wrapper';
import { CodegenieSdkEngineWrapper } from './codegenie-sdk-wrapper';

export type EngineType = 'claude-code' | 'claude-code-acp' | 'kiro-cli' | 'codex' | 'cursor' | 'cangjie-magic' | 'opencode' | 'opencode-sdk' | 'nga' | 'codegenie' | 'codegenie-sdk' | 'trae-cli';
export type EngineDriver = 'stdio' | 'sdk';

interface EngineConfig {
  engine: EngineType;
  driver?: EngineDriver;
  drivers?: Partial<Record<'claude-code' | 'opencode' | 'codegenie', EngineDriver>>;
  updatedAt?: string;
}

export interface EngineAvailabilityReport {
  engine: string;
  available: boolean;
  drivers?: Partial<Record<EngineDriver, boolean>>;
}

const DRIVER_CAPABLE_ENGINES = new Set<EngineType | 'claude-code' | 'opencode' | 'codegenie'>(['claude-code', 'opencode', 'codegenie']);
const DEFAULT_DRIVER_BY_ENGINE: Partial<Record<EngineType | 'claude-code' | 'opencode' | 'codegenie', EngineDriver>> = {
  'claude-code': 'sdk',
  'opencode': 'sdk',
  'codegenie': 'stdio',
};

const EFFECTIVE_TO_LOGICAL_ENGINE: Partial<Record<EngineType, EngineType>> = {
  'claude-code-acp': 'claude-code',
  'opencode-sdk': 'opencode',
  'codegenie-sdk': 'codegenie',
};

export function getLogicalEngineId(engine?: string | null): EngineType | null {
  const normalized = String(engine || '').trim() as EngineType | '';
  if (!normalized) return null;
  return EFFECTIVE_TO_LOGICAL_ENGINE[normalized] || normalized;
}

export function supportsDriverSelection(engine?: string | null): boolean {
  return DRIVER_CAPABLE_ENGINES.has(String(engine || '').trim() as EngineType);
}

export function getDefaultDriver(engine?: string | null): EngineDriver | undefined {
  const normalized = String(engine || '').trim() as EngineType;
  return DEFAULT_DRIVER_BY_ENGINE[normalized];
}

export function normalizeDriverSelection(engine?: string | null, driver?: string | null): EngineDriver | undefined {
  if (!supportsDriverSelection(engine)) return undefined;
  if (driver === 'sdk' || driver === 'stdio') return driver;
  return getDefaultDriver(engine);
}

export function resolveEffectiveEngine(engine?: string | null, driver?: string | null): EngineType | null {
  const normalizedEngine = String(engine || '').trim() as EngineType | '';
  if (!normalizedEngine) return null;
  const normalizedDriver = normalizeDriverSelection(normalizedEngine, driver);

  if (normalizedEngine === 'claude-code') {
    return normalizedDriver === 'stdio' ? 'claude-code-acp' : 'claude-code';
  }

  if (normalizedEngine === 'opencode') {
    return normalizedDriver === 'sdk' ? 'opencode-sdk' : 'opencode';
  }

  if (normalizedEngine === 'codegenie') {
    return normalizedDriver === 'sdk' ? 'codegenie-sdk' : 'codegenie';
  }

  return normalizedEngine as EngineType;
}

async function loadEngineConfig(): Promise<EngineConfig | null> {
  const configPath = getEngineConfigPath();
  if (!existsSync(configPath)) return null;
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content) as EngineConfig;
  } catch (error) {
    console.warn('Failed to read engine config:', error);
    return null;
  }
}

async function selectPreferredEffectiveEngine(engine: EngineType, configuredDriver?: string | null): Promise<EngineType | null> {
  const explicitDriver = configuredDriver === 'sdk' || configuredDriver === 'stdio' ? configuredDriver : undefined;
  if (explicitDriver) {
    const explicitEngine = resolveEffectiveEngine(engine, explicitDriver);
    const fallbackDriver = explicitDriver === 'sdk' ? 'stdio' : 'sdk';
    const fallbackEngine = resolveEffectiveEngine(engine, fallbackDriver);
    if (explicitEngine && await isEngineAvailable(explicitEngine)) {
      return explicitEngine;
    }
    if (fallbackEngine && await isEngineAvailable(fallbackEngine)) {
      return fallbackEngine;
    }
    return explicitEngine ?? fallbackEngine;
  }

  const preferredDriver = getDefaultDriver(engine);
  const fallbackDriver = preferredDriver === 'sdk' ? 'stdio' : 'sdk';
  const preferredEngine = resolveEffectiveEngine(engine, preferredDriver);
  const fallbackEngine = resolveEffectiveEngine(engine, fallbackDriver);

  if (preferredEngine && await isEngineAvailable(preferredEngine)) {
    return preferredEngine;
  }
  if (fallbackEngine && await isEngineAvailable(fallbackEngine)) {
    return fallbackEngine;
  }
  return preferredEngine ?? fallbackEngine;
}

function getConfiguredDriver(config: EngineConfig | null, engine?: string | null): EngineDriver | undefined {
  const normalizedEngine = String(engine || '').trim() as 'claude-code' | 'opencode' | 'codegenie' | EngineType | '';
  if (!normalizedEngine || !supportsDriverSelection(normalizedEngine)) {
    return undefined;
  }
  const mapped = config?.drivers?.[normalizedEngine as 'claude-code' | 'opencode' | 'codegenie'];
  return normalizeDriverSelection(normalizedEngine, mapped ?? config?.driver);
}

function resolveEngineTypeFromConfig(config: EngineConfig | null, requestedEngine?: string | null): EngineType | null {
  const requested = String(requestedEngine || '').trim() as EngineType | '';
  if (!requested) {
    return config?.engine || null;
  }

  return requested as EngineType;
}

/**
 * Get the configured engine type
 */
export async function getConfiguredEngine(): Promise<EngineType> {
  const config = await loadEngineConfig();
  const configured = resolveEngineTypeFromConfig(config, '');
  let resolved = configured;
  if (configured && supportsDriverSelection(configured)) {
    resolved = await selectPreferredEffectiveEngine(configured, getConfiguredDriver(config, configured));
  } else if (configured) {
    resolved = resolveEffectiveEngine(configured, getConfiguredDriver(config, configured)) ?? configured;
  }
  if (resolved) return resolved;

  throw new Error('默认引擎未配置，请先完成初始化设置');
}

export async function resolveRequestedEngineType(requestedEngine?: string | null): Promise<EngineType> {
  const config = await loadEngineConfig();
  const logicalRequested = getLogicalEngineId(requestedEngine) || requestedEngine;
  const requested = resolveEngineTypeFromConfig(config, logicalRequested);
  let resolved = requested;
  if (requested && supportsDriverSelection(requested)) {
    const driver = getConfiguredDriver(config, requested);
    resolved = await selectPreferredEffectiveEngine(requested, driver);
  } else if (requested) {
    resolved = resolveEffectiveEngine(requested, getConfiguredDriver(config, requested)) ?? requested;
  }
  if (resolved) return resolved;
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
  const requestedType = type || await getConfiguredEngine();
  const engineType = type && !supportsDriverSelection(type)
    ? type
    : await resolveRequestedEngineType(requestedType);
  const logicalEngineType = getLogicalEngineId(engineType) || engineType;
  const pooledSessionKey = sessionKey ? `${logicalEngineType}:${sessionKey}` : undefined;
  if (sessionKey) {
    const cached = enginePool.get(pooledSessionKey!);
    if (cached) {
      // Engine type changed — discard the old cached engine
      if (cached.engineType !== engineType) {
        if (typeof (cached.engine as any).cleanup === 'function') {
          (cached.engine as any).cleanup();
        }
        enginePool.delete(pooledSessionKey!);
      } else {
        cached.lastUsed = Date.now();
        return cached.engine;
      }
    }
  }
  const engine = await createEngine(engineType);
  if (engine && sessionKey) {
    enginePool.set(pooledSessionKey!, { engine, engineType, lastUsed: Date.now() });
  }
  return engine;
}

async function instantiateResolvedEngine(engineType: EngineType, requestedType?: EngineType): Promise<Engine | null> {
  switch (engineType) {
    case 'kiro-cli':
      const kiroEngine = new KiroCliEngineWrapper();
      const kiroAvailable = await kiroEngine.isAvailable();
      if (!kiroAvailable) {
        console.warn('[EngineFactory] Kiro CLI is not available');
        return null;
      }
      return kiroEngine;

    case 'claude-code':
      const ccEngine = new ClaudeCodeEngineWrapper();
      if (!(await ccEngine.isAvailable())) {
        console.warn('[EngineFactory] Claude Code SDK is not available, trying ACP fallback');
        return await instantiateResolvedEngine('claude-code-acp', requestedType || engineType);
      }
      return ccEngine;

    case 'claude-code-acp':
      const ccAcpEngine = new ClaudeCodeAcpEngineWrapper();
      if (!(await ccAcpEngine.isAvailable())) {
        console.warn('[EngineFactory] Claude Code ACP bridge is not available, trying SDK fallback');
        if ((requestedType || engineType) === 'claude-code-acp') {
          const fallback = new ClaudeCodeEngineWrapper();
          if (await fallback.isAvailable()) return fallback;
        }
        return null;
      }
      return ccAcpEngine;

    case 'codex':
      const codexEngine = new CodexEngineWrapper();
      const codexAvailable = await codexEngine.isAvailable();
      if (!codexAvailable) {
        console.warn('[EngineFactory] Codex is not available');
        return null;
      }
      return codexEngine;

    case 'cursor':
      const cursorEngine = new CursorEngineWrapper();
      const cursorAvailable = await cursorEngine.isAvailable();
      if (!cursorAvailable) {
        console.warn('[EngineFactory] Cursor CLI is not available');
        return null;
      }
      return cursorEngine;

    case 'cangjie-magic':
      const cjEngine = new CangjieMagicEngineWrapper();
      if (!(await cjEngine.isAvailable())) {
        console.warn('[EngineFactory] CangjieMagic is not available');
        return null;
      }
      return cjEngine;

    case 'opencode':
      const ocEngine = new OpenCodeEngineWrapper();
      if (!(await ocEngine.isAvailable())) {
        console.warn('[EngineFactory] OpenCode stdio is not available, trying SDK fallback');
        return await instantiateResolvedEngine('opencode-sdk', requestedType || engineType);
      }
      return ocEngine;

    case 'opencode-sdk':
      const ocSdkEngine = new OpenCodeSdkEngineWrapper();
      if (!(await ocSdkEngine.isAvailable())) {
        console.warn('[EngineFactory] OpenCode (SDK) is not available, trying stdio fallback');
        if ((requestedType || engineType) === 'opencode-sdk') {
          const fallback = new OpenCodeEngineWrapper();
          if (await fallback.isAvailable()) return fallback;
        }
        return null;
      }
      return ocSdkEngine;

    case 'nga':
      const ngaEngine = new NgaEngineWrapper();
      if (!(await ngaEngine.isAvailable())) {
        console.warn('[EngineFactory] NGA (nga) is not available');
        return null;
      }
      return ngaEngine;

    case 'codegenie':
      const codegenieEngine = new CodegenieEngineWrapper();
      if (!(await codegenieEngine.isAvailable())) {
        console.warn('[EngineFactory] CodeGenie stdio is not available, trying SDK fallback');
        return await instantiateResolvedEngine('codegenie-sdk', requestedType || engineType);
      }
      return codegenieEngine;

    case 'codegenie-sdk':
      const codegenieSdkEngine = new CodegenieSdkEngineWrapper();
      if (!(await codegenieSdkEngine.isAvailable())) {
        console.warn('[EngineFactory] CodeGenie SDK is not available, trying stdio fallback');
        if ((requestedType || engineType) === 'codegenie-sdk') {
          const fallback = new CodegenieEngineWrapper();
          if (await fallback.isAvailable()) return fallback;
        }
        return null;
      }
      return codegenieSdkEngine;

    case 'trae-cli':
      const traeEngine = new TraeCliEngineWrapper();
      if (!(await traeEngine.isAvailable())) {
        console.warn('[EngineFactory] Trae CLI is not available');
        return null;
      }
      return traeEngine;

    default:
      console.warn(`Unknown engine type: ${engineType}`);
      return null;
  }
}

export async function createEngineForDriver(engine: EngineType, driver?: EngineDriver): Promise<Engine | null> {
  const resolved = resolveEffectiveEngine(engine, driver);
  if (!resolved) return null;
  return await instantiateResolvedEngine(resolved, resolved);
}

/**
 * Create an engine instance based on type
 */
export async function createEngine(type?: EngineType): Promise<Engine | null> {
  const requestedType = type || await getConfiguredEngine();
  const engineType = type && !supportsDriverSelection(type)
    ? type
    : await resolveRequestedEngineType(requestedType);
  return await instantiateResolvedEngine(engineType, type);
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

    case 'claude-code-acp':
      const ccAcpCheck = new ClaudeCodeAcpEngineWrapper();
      return await ccAcpCheck.isAvailable();

    case 'cangjie-magic':
      const cjCheck = new CangjieMagicEngineWrapper();
      return await cjCheck.isAvailable();

    case 'opencode':
      const ocCheck = new OpenCodeEngineWrapper();
      return await ocCheck.isAvailable();

    case 'opencode-sdk':
      const ocSdkCheck = new OpenCodeSdkEngineWrapper();
      return await ocSdkCheck.isAvailable();

    case 'nga':
      const ngaCheck = new NgaEngineWrapper();
      return await ngaCheck.isAvailable();

    case 'codegenie':
      const codegenieCheck = new CodegenieEngineWrapper();
      return await codegenieCheck.isAvailable();

    case 'codegenie-sdk':
      const codegenieSdkCheck = new CodegenieSdkEngineWrapper();
      return await codegenieSdkCheck.isAvailable();

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

export async function getEngineAvailabilityReport(type: EngineType | string): Promise<EngineAvailabilityReport> {
  const engine = String(type || '').trim();

  if (engine === 'claude-code') {
    const sdk = await new ClaudeCodeEngineWrapper().isAvailable();
    const stdio = await new ClaudeCodeAcpEngineWrapper().isAvailable();
    return {
      engine,
      available: sdk || stdio,
      drivers: { sdk, stdio },
    };
  }

  if (engine === 'opencode') {
    const stdio = await new OpenCodeEngineWrapper().isAvailable();
    const sdk = await new OpenCodeSdkEngineWrapper().isAvailable();
    return {
      engine,
      available: sdk || stdio,
      drivers: { sdk, stdio },
    };
  }

  if (engine === 'codegenie') {
    const stdio = await new CodegenieEngineWrapper().isAvailable();
    const sdk = await new CodegenieSdkEngineWrapper().isAvailable();
    return {
      engine,
      available: sdk || stdio,
      drivers: { sdk, stdio },
    };
  }

  return {
    engine,
    available: await isEngineAvailable(engine as EngineType),
  };
}
