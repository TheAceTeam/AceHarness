export function isOpenCodeSlashCommandPrompt(prompt: string | undefined): boolean {
  const text = String(prompt || '').trimStart();
  if (!text.startsWith('/')) return false;

  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() || '';
  return /^\/[A-Za-z][A-Za-z0-9_.:-]*(?:\s|$)/.test(firstLine);
}

export function buildOpenCodeRawCommandPrompt(prompt: string): string {
  return String(prompt || '').trimStart();
}

export function parseOpenCodeSlashCommand(prompt: string | undefined): { command: string; arguments: string } | null {
  const text = buildOpenCodeRawCommandPrompt(String(prompt || ''));
  const match = text.match(/^\/([A-Za-z][A-Za-z0-9_.:-]*)(?:\s+([\s\S]*))?$/);
  if (!match?.[1]) return null;
  return {
    command: match[1],
    arguments: match[2] || '',
  };
}
