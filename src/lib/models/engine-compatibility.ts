import { getLogicalEngineId } from '@/lib/engines/engine-selection';

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
      uniqueStrings(engines).map((engine) => getLogicalEngineId(engine) || engine),
    ),
  );
}

export function modelEnginesSupportEngine(
  engines: unknown,
  engine?: string | null,
): boolean {
  const logicalEngine = getLogicalEngineId(engine) || String(engine || '').trim();
  if (!logicalEngine) return true;

  const modelEngines = normalizeModelEngineIds(engines);
  if (modelEngines.length === 0) return true;
  return modelEngines.includes(logicalEngine);
}
