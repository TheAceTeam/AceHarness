export type EngineType =
  | 'claude-code'
  | 'claude-code-acp'
  | 'kiro-cli'
  | 'codex'
  | 'cursor'
  | 'opencode'
  | 'opencode-sdk'
  | 'nga'
  | 'nga-sdk'
  | 'codegenie'
  | 'codegenie-sdk'
  | 'trae-cli'
  | 'magic-cli';

export type EngineDriver = 'stdio' | 'sdk';

const DRIVER_CAPABLE_ENGINES = new Set<EngineType | 'claude-code' | 'opencode' | 'nga' | 'codegenie'>([
  'claude-code',
  'opencode',
  'nga',
  'codegenie',
]);

const DEFAULT_DRIVER_BY_ENGINE: Partial<
  Record<EngineType | 'claude-code' | 'opencode' | 'nga' | 'codegenie', EngineDriver>
> = {
  'claude-code': 'sdk',
  opencode: 'sdk',
  nga: 'stdio',
  codegenie: 'stdio',
};

const EFFECTIVE_TO_LOGICAL_ENGINE: Partial<Record<EngineType, EngineType>> = {
  'claude-code-acp': 'claude-code',
  'opencode-sdk': 'opencode',
  'nga-sdk': 'nga',
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

  if (normalizedEngine === 'nga') {
    return normalizedDriver === 'sdk' ? 'nga-sdk' : 'nga';
  }

  if (normalizedEngine === 'codegenie') {
    return normalizedDriver === 'sdk' ? 'codegenie-sdk' : 'codegenie';
  }

  return normalizedEngine;
}
