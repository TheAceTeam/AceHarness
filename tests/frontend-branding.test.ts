import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const projectRoot = resolve(__dirname, '..');
const scanRoots = [
  'messages',
  'src/client/pages',
  'src/routes',
  'src/components',
  'src/contexts',
  'src/hooks',
  'src/lib/agent',
  'src/lib/ai',
  'src/lib/chat',
  'src/lib/core/instrumentation-nodejs.ts',
  'src/lib/core/creator-validation.ts',
  'src/lib/core/default-supervisor.ts',
  'src/lib/models',
  'src/lib/notify',
  'src/lib/rag',
  'src/server/api-routes/channels/integrations/[id]/test-send/route.ts',
  'src/server/api-routes/channels/wechat-official/qrcode-image/route.ts',
  'src/server/api-routes/workflow/spec-merge/route.ts',
  'src/lib/channel/providers.ts',
  'src/lib/channel/wechat/official-client.ts',
  'src/lib/channel/wechat/official-service.ts',
  'src/lib/runtime/database-capabilities.ts',
  'src/lib/state-machine/workflow-manager.ts',
  'src/lib/workflow/git-baseline.ts',
  'src/plugins',
  'src/cli.ts',
  'src/start.ts',
  'scripts/start-tanstack-start.mjs',
  'public',
];
const sourceExtensions = new Set(['.ts', '.tsx', '.mjs', '.json', '.svg']);
const oldBrandPattern = /\bACEHarness\b|\bAceHarness\b|\bACE Harness\b|\bACEHARNESS\b|\bACE Service\b/g;
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

  test('user-facing command examples do not advertise the removed ace binary', async () => {
    const commandSources = [
      'src/client/pages/EnginesPage.tsx',
      'src/components/models/ModelDiagnosticsWorkbench.tsx',
    ];
    const offenders: string[] = [];
    for (const file of commandSources) {
      const content = await readFile(resolve(projectRoot, file), 'utf8');
      if (/<code>ace(?:\s|<)/.test(content)) offenders.push(`${file}: code`);
      if (/\$\s+ace(?:\s|$)/m.test(content)) offenders.push(`${file}: terminal`);
    }
    expect(offenders).toEqual([]);
  });
});
