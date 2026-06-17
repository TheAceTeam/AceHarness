export function normalizeEngineNamespacedSlashCommand(
  message: string,
  engine: string | undefined,
): { prompt: string; rawPrompt: boolean } {
  const text = String(message || '').trim();
  const match = text.match(/^\/([A-Za-z][A-Za-z0-9_-]*):([A-Za-z][A-Za-z0-9_.:-]*)(?:\s+([\s\S]*))?$/);
  if (!match?.[1] || !match?.[2]) return { prompt: text, rawPrompt: false };

  const namespace = match[1].toLowerCase();
  const activeEngine = String(engine || '').trim().toLowerCase();
  const logicalEngine = activeEngine
    .replace(/-sdk$/, '')
    .replace(/-acp$/, '');
  const validNamespaces = new Set<string>([activeEngine, logicalEngine]);
  if (logicalEngine === 'nga') validNamespaces.add('codeagent');
  if (!validNamespaces.has(namespace)) return { prompt: text, rawPrompt: false };

  const args = match[3] ? ` ${match[3].trim()}` : '';
  return { prompt: `/${match[2]}${args}`, rawPrompt: true };
}

export function parseEngineNamespacedSlashCommand(message: string): {
  namespace: string;
  command: string;
  arguments: string;
} | null {
  const text = String(message || '').trim();
  const match = text.match(/^\/([A-Za-z][A-Za-z0-9_-]*):([A-Za-z][A-Za-z0-9_.:-]*)(?:\s+([\s\S]*))?$/);
  if (!match?.[1] || !match?.[2]) return null;
  return {
    namespace: match[1].toLowerCase(),
    command: match[2],
    arguments: match[3]?.trim() || '',
  };
}
