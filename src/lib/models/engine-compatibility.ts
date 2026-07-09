const LEGACY_ENGINE_ALIASES: Record<string, string> = {
  'claude-code': 'claude',
  'claude-code-acp': 'claude',
  'kiro-cli': 'kiro',
  'trae-cli': 'trae',
  'magic-cli': 'cangjie-magic',
  magic: 'cangjie-magic',
};

export function normalizeRuntimeEngineId(engine?: string | null): string {
  const value = String(engine || '').trim();
  if (!value) return '';
  return LEGACY_ENGINE_ALIASES[value] || value;
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeModelEngineIds(engines: unknown): string[] {
  return Array.from(
    new Set(
      uniqueStrings(engines).map((engine) => normalizeRuntimeEngineId(engine) || engine),
    ),
  );
}

export function modelEnginesSupportEngine(
  engines: unknown,
  engine?: string | null,
): boolean {
  const logicalEngine = normalizeRuntimeEngineId(engine) || String(engine || '').trim();
  if (!logicalEngine) return true;

  const modelEngines = normalizeModelEngineIds(engines);
  if (modelEngines.length === 0) return true;
  return modelEngines.includes(logicalEngine);
}
