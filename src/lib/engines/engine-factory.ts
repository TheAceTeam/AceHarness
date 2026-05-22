/**
 * Engine Factory
 *
 * Creates and manages different AI engine instances
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { getEngineConfigPath } from '@/lib/core/app-paths';
import { loadSystemSettings } from '@/lib/config/system-settings';
import type { Engine } from './engine-interface';
import { KiroCliEngineWrapper } from './kiro-cli-wrapper';
import { OpenCodeEngineWrapper } from './opencode-wrapper';
import { OpenCodeSdkEngineWrapper } from './opencode-sdk-wrapper';
import { CodexEngineWrapper } from './codex-wrapper';
import { CursorEngineWrapper } from './cursor-wrapper';
import { ClaudeCodeEngineWrapper } from './claude-code-wrapper';
import { ClaudeCodeAcpEngineWrapper } from './claude-code-acp-wrapper';
import { TraeCliEngineWrapper } from './trae-cli-wrapper';
import { NgaEngineWrapper } from './nga-wrapper';
import { NgaSdkEngineWrapper } from './nga-sdk-wrapper';
import { CodegenieEngineWrapper } from './codegenie-wrapper';
import { CodegenieSdkEngineWrapper } from './codegenie-sdk-wrapper';
import { MagicCliEngineWrapper } from './magic-cli-wrapper';
import {
  getDefaultDriver,
  getLogicalEngineId,
  normalizeDriverSelection,
  resolveEffectiveEngine,
  supportsDriverSelection,
} from './engine-selection';
import type { EngineDriver, EngineType } from './engine-selection';

export {
  getDefaultDriver,
  getLogicalEngineId,
  normalizeDriverSelection,
  resolveEffectiveEngine,
  supportsDriverSelection,
};
export type { EngineDriver, EngineType } from './engine-selection';

interface EngineConfig {
  engine: EngineType;
  driver?: EngineDriver;
  drivers?: Partial<Record<'claude-code' | 'opencode' | 'nga' | 'codegenie', EngineDriver>>;
  updatedAt?: string;
}

export interface EngineAvailabilityReport {
  engine: string;
  available: boolean;
  drivers?: Partial<Record<EngineDriver, boolean>>;
}

interface AvailabilityCacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_ENGINE_AVAILABILITY_TTL_MS = 30 * 60 * 1000;
const ENGINE_AVAILABILITY_TTL_MIN_MS = 60 * 1000;
const ENGINE_AVAILABILITY_TTL_MAX_MS = 24 * 60 * 60 * 1000;
const ENGINE_AVAILABILITY_TTL_SETTINGS_CACHE_MS = 5 * 1000;

const engineAvailabilityCache = new Map<string, AvailabilityCacheEntry<boolean>>();
const engineAvailabilityInflight = new Map<string, Promise<boolean>>();
const engineAvailabilityReportCache = new Map<string, AvailabilityCacheEntry<EngineAvailabilityReport>>();
const engineAvailabilityReportInflight = new Map<string, Promise<EngineAvailabilityReport>>();
let cachedEngineAvailabilityTtlMs = DEFAULT_ENGINE_AVAILABILITY_TTL_MS;
let cachedEngineAvailabilityTtlLoadedAt = 0;
let engineAvailabilityTtlPromise: Promise<number> | null = null;

function readCacheValue<T>(cache: Map<string, AvailabilityCacheEntry<T>>, key: string): T | null {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

function writeCacheValue<T>(cache: Map<string, AvailabilityCacheEntry<T>>, key: string, value: T): T {
  cache.set(key, {
    value,
    expiresAt: Date.now() + cachedEngineAvailabilityTtlMs,
  });
  return value;
}

function normalizeEngineAvailabilityTtlMs(input?: number | null): number {
  const numeric = Number(input);
  if (!Number.isFinite(numeric)) return DEFAULT_ENGINE_AVAILABILITY_TTL_MS;
  return Math.max(ENGINE_AVAILABILITY_TTL_MIN_MS, Math.min(ENGINE_AVAILABILITY_TTL_MAX_MS, Math.round(numeric)));
}

export async function getEngineAvailabilityCacheTtlMs(forceRefresh = false): Promise<number> {
  const now = Date.now();
  if (!forceRefresh && now - cachedEngineAvailabilityTtlLoadedAt < ENGINE_AVAILABILITY_TTL_SETTINGS_CACHE_MS) {
    return cachedEngineAvailabilityTtlMs;
  }
  if (!forceRefresh && engineAvailabilityTtlPromise) {
    return engineAvailabilityTtlPromise;
  }

  const loadPromise = loadSystemSettings()
    .then((settings) => {
      cachedEngineAvailabilityTtlMs = normalizeEngineAvailabilityTtlMs(
        Number(settings.engineAvailabilityCacheMinutes || 30) * 60 * 1000
      );
      cachedEngineAvailabilityTtlLoadedAt = Date.now();
      return cachedEngineAvailabilityTtlMs;
    })
    .catch(() => {
      cachedEngineAvailabilityTtlMs = DEFAULT_ENGINE_AVAILABILITY_TTL_MS;
      cachedEngineAvailabilityTtlLoadedAt = Date.now();
      return cachedEngineAvailabilityTtlMs;
    })
    .finally(() => {
      engineAvailabilityTtlPromise = null;
    });
  engineAvailabilityTtlPromise = loadPromise;
  return loadPromise;
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
    return explicitEngine;
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
  const normalizedEngine = String(engine || '').trim() as 'claude-code' | 'opencode' | 'nga' | 'codegenie' | EngineType | '';
  if (!normalizedEngine || !supportsDriverSelection(normalizedEngine)) {
    return undefined;
  }
  const mapped = config?.drivers?.[normalizedEngine as 'claude-code' | 'opencode' | 'nga' | 'codegenie'];
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
        console.warn('[EngineFactory] NGA stdio is not available, trying SDK fallback');
        return await instantiateResolvedEngine('nga-sdk', requestedType || engineType);
      }
      return ngaEngine;

    case 'nga-sdk':
      const ngaSdkEngine = new NgaSdkEngineWrapper();
      if (!(await ngaSdkEngine.isAvailable())) {
        console.warn('[EngineFactory] NGA SDK is not available, trying stdio fallback');
        if ((requestedType || engineType) === 'nga-sdk') {
          const fallback = new NgaEngineWrapper();
          if (await fallback.isAvailable()) return fallback;
        }
        return null;
      }
      return ngaSdkEngine;

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

    case 'magic-cli':
      const magicEngine = new MagicCliEngineWrapper();
      if (!(await magicEngine.isAvailable())) {
        console.warn('[EngineFactory] Magic CLI is not available, falling back to Claude Code');
        return null;
      }
      return magicEngine;

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
async function probeEngineAvailability(type: EngineType): Promise<boolean> {
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

    case 'opencode':
      const ocCheck = new OpenCodeEngineWrapper();
      return await ocCheck.isAvailable();

    case 'opencode-sdk':
      const ocSdkCheck = new OpenCodeSdkEngineWrapper();
      return await ocSdkCheck.isAvailable();

    case 'nga':
      const ngaCheck = new NgaEngineWrapper();
      return await ngaCheck.isAvailable();

    case 'nga-sdk':
      const ngaSdkCheck = new NgaSdkEngineWrapper();
      return await ngaSdkCheck.isAvailable();

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

    case 'magic-cli':
      const magicCheck = new MagicCliEngineWrapper();
      return await magicCheck.isAvailable();

    default:
      return false;
  }
}

export async function isEngineAvailable(
  type: EngineType,
  options?: { forceRefresh?: boolean }
): Promise<boolean> {
  await getEngineAvailabilityCacheTtlMs(options?.forceRefresh);
  const cacheKey = String(type || '').trim();
  if (!options?.forceRefresh) {
    const cached = readCacheValue(engineAvailabilityCache, cacheKey);
    if (cached !== null) return cached;
    const inflight = engineAvailabilityInflight.get(cacheKey);
    if (inflight) return inflight;
  } else {
    engineAvailabilityCache.delete(cacheKey);
    engineAvailabilityInflight.delete(cacheKey);
  }

  const probePromise = probeEngineAvailability(type)
    .then((value) => writeCacheValue(engineAvailabilityCache, cacheKey, value))
    .finally(() => {
      engineAvailabilityInflight.delete(cacheKey);
    });
  engineAvailabilityInflight.set(cacheKey, probePromise);
  return probePromise;
}

async function probeEngineAvailabilityReport(type: EngineType | string): Promise<EngineAvailabilityReport> {
  const engine = String(type || '').trim();

  if (engine === 'claude-code') {
    const [sdk, stdio] = await Promise.all([
      isEngineAvailable('claude-code', { forceRefresh: true }),
      isEngineAvailable('claude-code-acp', { forceRefresh: true }),
    ]);
    return {
      engine,
      available: sdk || stdio,
      drivers: { sdk, stdio },
    };
  }

  if (engine === 'opencode') {
    const [stdio, sdk] = await Promise.all([
      isEngineAvailable('opencode', { forceRefresh: true }),
      isEngineAvailable('opencode-sdk', { forceRefresh: true }),
    ]);
    return {
      engine,
      available: sdk || stdio,
      drivers: { sdk, stdio },
    };
  }

  if (engine === 'nga') {
    const stdio = await new NgaEngineWrapper().isAvailable();
    const sdk = await new NgaSdkEngineWrapper().isAvailable();
    return {
      engine,
      available: sdk || stdio,
      drivers: { sdk, stdio },
    };
  }

  if (engine === 'codegenie') {
    const [stdio, sdk] = await Promise.all([
      isEngineAvailable('codegenie', { forceRefresh: true }),
      isEngineAvailable('codegenie-sdk', { forceRefresh: true }),
    ]);
    return {
      engine,
      available: sdk || stdio,
      drivers: { sdk, stdio },
    };
  }

  return {
    engine,
    available: await isEngineAvailable(engine as EngineType, { forceRefresh: true }),
  };
}

export async function getEngineAvailabilityReport(
  type: EngineType | string,
  options?: { forceRefresh?: boolean }
): Promise<EngineAvailabilityReport> {
  await getEngineAvailabilityCacheTtlMs(options?.forceRefresh);
  const engine = String(type || '').trim();
  if (!options?.forceRefresh) {
    const cached = readCacheValue(engineAvailabilityReportCache, engine);
    if (cached) return cached;
    const inflight = engineAvailabilityReportInflight.get(engine);
    if (inflight) return inflight;
  } else {
    engineAvailabilityReportCache.delete(engine);
    engineAvailabilityReportInflight.delete(engine);
  }

  const reportPromise = probeEngineAvailabilityReport(engine)
    .then((report) => {
      writeCacheValue(engineAvailabilityReportCache, engine, report);
      writeCacheValue(engineAvailabilityCache, engine, report.available);
      if (report.drivers?.sdk !== undefined) {
        const sdkEngine = resolveEffectiveEngine(engine, 'sdk');
        if (sdkEngine) writeCacheValue(engineAvailabilityCache, sdkEngine, Boolean(report.drivers.sdk));
      }
      if (report.drivers?.stdio !== undefined) {
        const stdioEngine = resolveEffectiveEngine(engine, 'stdio');
        if (stdioEngine) writeCacheValue(engineAvailabilityCache, stdioEngine, Boolean(report.drivers.stdio));
      }
      return report;
    })
    .finally(() => {
      engineAvailabilityReportInflight.delete(engine);
    });
  engineAvailabilityReportInflight.set(engine, reportPromise);
  return reportPromise;
}
