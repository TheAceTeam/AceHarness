import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const projectRoot = resolve(__dirname, '..');
const scanRoots = [
  'messages',
  'src/app',
  'src/components',
  'src/contexts',
  'src/hooks',
  'src/lib/agent',
  'src/lib/ai',
  'src/lib/chat',
  'src/lib/core/creator-validation.ts',
  'src/lib/core/default-supervisor.ts',
  'src/lib/models',
  'src/lib/notify',
  'src/lib/rag',
  'src/app/api/channels/integrations/[id]/test-send/route.ts',
  'src/lib/channel/providers.ts',
  'src/lib/channel/wechat/official-client.ts',
  'src/lib/engines/codex-wrapper.ts',
  'src/lib/runtime/database-capabilities.ts',
  'src/lib/state-machine/workflow-manager.ts',
  'src/lib/workflow/git-baseline.ts',
  'src/plugins',
  'public',
];
const sourceExtensions = new Set(['.ts', '.tsx', '.json', '.svg']);
const oldBrandPattern = /\bACEHarness\b|\bACE Harness\b|\bACEHARNESS\b|\bACE Service\b|\bACE\b/g;
const oldLowercaseVisibleBrandPattern = /^\s*aceharness\s*$/gim;

async function collectFrontendFiles(root: string): Promise<string[]> {
  const absoluteRoot = resolve(projectRoot, root);
  const rootStat = await stat(absoluteRoot);
  if (rootStat.isFile()) return [root];

  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(absoluteRoot, entry.name);
    const relPath = relative(projectRoot, absolutePath).replace(/\\/g, '/');
    if (relPath.startsWith('src/app/api/')) continue;
    if (entry.isDirectory()) {
      files.push(...await collectFrontendFiles(relPath));
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = entry.name.slice(entry.name.lastIndexOf('.'));
    if (sourceExtensions.has(extension)) files.push(relPath);
  }

  return files;
}

describe('frontend branding', () => {
  test('frontend user-facing sources use CSIHarness instead of the old product name', async () => {
    const files = (await Promise.all(scanRoots.map(collectFrontendFiles))).flat();
    const offenders: string[] = [];

    for (const file of files) {
      const content = await readFile(resolve(projectRoot, file), 'utf8');
      const matches = [...content.matchAll(oldBrandPattern)];
      for (const match of matches) {
        const line = content.slice(0, match.index).split(/\r?\n/).length;
        offenders.push(`${file}:${line}: ${match[0]}`);
      }
      const lowercaseVisibleMatches = [...content.matchAll(oldLowercaseVisibleBrandPattern)];
      for (const match of lowercaseVisibleMatches) {
        const line = content.slice(0, match.index).split(/\r?\n/).length;
        offenders.push(`${file}:${line}: ${match[0].trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
