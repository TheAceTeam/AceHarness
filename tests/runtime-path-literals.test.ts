import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const projectRoot = resolve(__dirname, '..');

describe('runtime path literals', () => {
  test('does not use legacy ACEHarness homes in product runtime paths', async () => {
    const files = [
      'src/lib/engines/opencode-command-files.ts',
      'src/lib/rag/store.ts',
      'src/components/chat/ChatPageContent.tsx',
      'src/lib/core/app-paths.ts',
      'scripts/start-tanstack-start.mjs',
      'scripts/sync-default-model-catalog.mjs',
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const content = await readFile(resolve(projectRoot, file), 'utf8');
      if (content.includes("'.aceharness")) offenders.push(`${file}: .aceharness`);
      if (content.includes('process.env.ACE_INSTALL_ROOT')) offenders.push(`${file}: ACE_INSTALL_ROOT`);
      if (content.includes('process.env.ACE_HOME')) offenders.push(`${file}: ACE_HOME`);
      if (content.includes('process.env.ACE_HOST')) offenders.push(`${file}: ACE_HOST`);
      if (content.includes('process.env.ACE_PORT')) offenders.push(`${file}: ACE_PORT`);
    }
    expect(offenders).toEqual([]);
  });
});
