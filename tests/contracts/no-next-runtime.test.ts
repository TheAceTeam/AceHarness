import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

const projectRoot = resolve(__dirname, '../..');

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  files?: string[];
};

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(resolve(projectRoot, relativePath), 'utf8')) as T;
}

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(fullPath));
      continue;
    }
    if (/\.(ts|tsx|js|jsx|mts|mjs|cts|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function findNextImports(source: string): string[] {
  const hits = new Set<string>();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"](next(?:\/[^'"]*)?)['"]/g,
    /\bexport\s+(?:type\s+)?[^'"]+\s+from\s+['"](next(?:\/[^'"]*)?)['"]/g,
    /\bimport\s*\(\s*['"](next(?:\/[^'"]*)?)['"]\s*\)/g,
    /\brequire\s*\(\s*['"](next(?:\/[^'"]*)?)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      hits.add(match[1]);
    }
  }

  return [...hits];
}

describe('no Next runtime contract', () => {
  test('package manifest does not depend on Next runtime or Next lint config', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const dependencyNames = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ]);

    expect(dependencyNames.has('next'), 'package.json must not depend on next').toBe(false);
    expect(dependencyNames.has('eslint-config-next'), 'package.json must not depend on eslint-config-next').toBe(false);
  });

  test('published files do not include the preRuntime Next custom server entry', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const files = new Set(packageJson.files ?? []);

    expect(files.has('server.js'), 'package.json files must not publish server.js').toBe(false);
  });

  test('tsconfig no longer enables the Next plugin or .next generated type includes', async () => {
    const tsconfig = await readJson<{
      compilerOptions?: { plugins?: Array<{ name?: string }> };
      include?: string[];
    }>('tsconfig.json');

    const pluginNames = (tsconfig.compilerOptions?.plugins ?? []).map((plugin) => plugin.name);
    expect(pluginNames, 'tsconfig plugins must not include next').not.toContain('next');

    const nextIncludes = (tsconfig.include ?? []).filter((entry) => entry.includes('.next'));
    expect(nextIncludes, 'tsconfig include must not reference .next generated types').toEqual([]);
  });

  test('CLI does not retain the ACE_preRuntime_NEXT fallback path', async () => {
    const cliSource = await readFile(resolve(projectRoot, 'src/cli.ts'), 'utf8');

    expect(cliSource, 'src/cli.ts must not branch on ACE_preRuntime_NEXT').not.toContain('ACE_preRuntime_NEXT');
    expect(cliSource, 'src/cli.ts must not require the preRuntime server.js entry').not.toMatch(/require\(['"]\.\.\/server\.js['"]\)/);
  });

  test('source files do not import next or next/* modules', async () => {
    const files = await listSourceFiles(resolve(projectRoot, 'src'));
    const offenders: string[] = [];

    for (const file of files) {
      const imports = findNextImports(await readFile(file, 'utf8'));
      if (imports.length > 0) {
        offenders.push(`${relative(projectRoot, file).replace(/\\/g, '/')}: ${imports.join(', ')}`);
      }
    }

    expect(offenders, 'source files must not import next or next/* modules').toEqual([]);
  });

  test('preRuntime Next app directory has been removed', () => {
    expect(existsSync(resolve(projectRoot, 'src/app')), 'src/app must not remain after the Start migration').toBe(false);
  });

  test('Start server routes do not load API handlers from the preRuntime app api tree', async () => {
    const files = [
      ...await listSourceFiles(resolve(projectRoot, 'src/routes')),
      ...await listSourceFiles(resolve(projectRoot, 'src/server')),
    ];
    const offenders: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (source.includes('@/app/api/') || source.includes('/src/app/api/')) {
        offenders.push(relative(projectRoot, file).replace(/\\/g, '/'));
      }
    }

    expect(offenders, 'Start routes/server code must use src/server/api-routes instead of src/app/api').toEqual([]);
  });

  test('Start page routes do not import page components from the preRuntime app tree', async () => {
    const files = await listSourceFiles(resolve(projectRoot, 'src/routes'));
    const offenders: string[] = [];
    const preRuntimePageImport = /from\s+['"]@\/app\/[^'"]*\/page['"]/;

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (preRuntimePageImport.test(source)) {
        offenders.push(relative(projectRoot, file).replace(/\\/g, '/'));
      }
    }

    expect(offenders, 'Start page routes must import src/client/pages entries instead of src/app pages').toEqual([]);
  });
});
