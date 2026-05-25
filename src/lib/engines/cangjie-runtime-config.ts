import { dirname, isAbsolute } from 'path';
import {
  getDynamicLibraryExtension,
  isNativeAddonAvailable,
  isNativeLibraryAvailable,
  readLibraryBuildInfo,
  resolveLibraryArtifactPath,
  resolveNativeTarget,
  type NativeDiagnostic,
  type NativeLibraryBuildInfo,
  type NativeLibrarySpec,
} from '@cangjielang/napi-cj';
import { getInstallPath } from '@/lib/core/app-paths';
import { getLogicalEngineId, type EngineDriver, type EngineType } from './engine-selection';

export type EngineRuntime = 'js' | 'cangjie' | 'auto';

export interface CangjieRuntimeLibraryConfig {
  name?: string;
  path?: string;
  initJson?: string;
}

export interface CangjieRuntimeConfig {
  enabled?: boolean;
  fallbackToJs?: boolean;
  library?: CangjieRuntimeLibraryConfig;
  engines?: Partial<Record<string, EngineRuntime>>;
}

export interface EngineRuntimeConfig {
  engineRuntime?: EngineRuntime;
  cangjieRuntime?: CangjieRuntimeConfig;
}

export interface CangjieRuntimeAvailability {
  available: boolean;
  target: string;
  addonAvailable: boolean;
  libraryAvailable: boolean;
  libraryPath: string;
  buildInfo: NativeLibraryBuildInfo | null;
  diagnostic?: NativeDiagnostic;
}

const DEFAULT_CANGJIE_ENGINE_LIBRARY_NAME = 'aceharness_cj_engine';

export function normalizeEngineRuntime(value?: string | null): EngineRuntime | undefined {
  if (value === 'js' || value === 'cangjie' || value === 'auto') return value;
  return undefined;
}

export function resolveEngineRuntimeMode(
  config: EngineRuntimeConfig | null | undefined,
  engine?: string | null,
): EngineRuntime {
  if (config?.cangjieRuntime?.enabled === false) return 'js';
  const logicalEngine = getLogicalEngineId(engine) || String(engine || '').trim();
  const perEngineRuntime = normalizeEngineRuntime(
    logicalEngine ? config?.cangjieRuntime?.engines?.[logicalEngine] : undefined
  );
  return perEngineRuntime || normalizeEngineRuntime(config?.engineRuntime) || 'auto';
}

export function shouldFallbackToJs(config: EngineRuntimeConfig | null | undefined): boolean {
  return config?.cangjieRuntime?.fallbackToJs !== false;
}

export function inferDriverForEffectiveEngine(engineType: EngineType): EngineDriver | undefined {
  if (engineType === 'claude-code-acp' || engineType === 'opencode' || engineType === 'nga' || engineType === 'codegenie') {
    return 'stdio';
  }
  if (
    engineType === 'claude-code' ||
    engineType === 'opencode-sdk' ||
    engineType === 'nga-sdk' ||
    engineType === 'codegenie-sdk'
  ) {
    return 'sdk';
  }
  return undefined;
}

export function resolveDefaultCangjieEngineLibraryPath(target = resolveNativeTarget()): string {
  return resolveLibraryArtifactPath({
    root: getInstallPath('native', 'aceharness-cj-engine'),
    name: DEFAULT_CANGJIE_ENGINE_LIBRARY_NAME,
    target,
  });
}

export function resolveCangjieEngineLibrarySpec(
  config?: CangjieRuntimeConfig | null,
  target = resolveNativeTarget(),
): NativeLibrarySpec {
  const configuredPath = config?.library?.path?.trim();
  const rawPath = configuredPath && !configuredPath.includes('<target>')
    ? configuredPath
    : configuredPath
      ? configuredPath.replace('<target>', target)
      : resolveDefaultCangjieEngineLibraryPath(target);
  const path = isAbsolute(rawPath) ? rawPath : getInstallPath(rawPath);
  return {
    name: config?.library?.name || 'aceharness-cj-engine',
    path,
    initJson: config?.library?.initJson,
  };
}

export function getCangjieEngineRuntimeAvailability(
  config?: CangjieRuntimeConfig | null,
): CangjieRuntimeAvailability {
  const target = resolveNativeTarget();
  const addonAvailable = isNativeAddonAvailable(target);
  const librarySpec = resolveCangjieEngineLibrarySpec(config, target);
  const libraryAvailable = isNativeLibraryAvailable(librarySpec.path);
  const buildInfo = libraryAvailable ? readLibraryBuildInfo(librarySpec.path) : null;
  const available = addonAvailable && libraryAvailable;
  return {
    available,
    target,
    addonAvailable,
    libraryAvailable,
    libraryPath: librarySpec.path,
    buildInfo,
    diagnostic: available ? undefined : {
      code: 'CANGJIE_ENGINE_RUNTIME_UNAVAILABLE',
      message: `Cangjie engine runtime is unavailable for ${target}`,
      target,
      libraryPath: librarySpec.path,
    },
  };
}

export function getCangjieEngineArtifactDirectory(config?: CangjieRuntimeConfig | null): string {
  return dirname(resolveCangjieEngineLibrarySpec(config).path);
}
