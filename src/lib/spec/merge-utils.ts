import { createHash } from 'crypto';

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function buildDeltaDigest(requirements: string, design: string, tasks: string): string {
  return [
    '--- requirements.md ---',
    requirements,
    '--- design.md ---',
    design,
    '--- tasks.md ---',
    tasks,
  ].join('\n');
}

export function stripCodeFence(output: string): string {
  const trimmed = output.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return (match ? match[1] : trimmed).trim() + '\n';
}

export function createUnifiedDiff(oldText: string, newText: string, oldName = 'spec.md', newName = 'spec.md (merged)'): string {
  if (oldText === newText) return '';

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const max = Math.max(oldLines.length, newLines.length);
  const lines = [`--- ${oldName}`, `+++ ${newName}`, '@@ -1 +1 @@'];

  for (let i = 0; i < max; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) {
      if (oldLine !== undefined) lines.push(` ${oldLine}`);
      continue;
    }
    if (oldLine !== undefined) lines.push(`-${oldLine}`);
    if (newLine !== undefined) lines.push(`+${newLine}`);
  }

  return lines.join('\n');
}
