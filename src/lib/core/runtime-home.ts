import { existsSync } from 'fs';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import { NPM_PACKAGE_NAME, PRODUCT_NAME, RUNTIME_MARKER_FILE } from '@/lib/core/product-identity';

export const RUNTIME_MARKER = Object.freeze({
  schemaVersion: 1,
  product: PRODUCT_NAME,
  packageName: NPM_PACKAGE_NAME,
});

type RuntimeHomeOptions = {
  runtimeRoot?: string;
  knownAceRoots?: string[];
};

function isInsideOrEqual(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function knownAceRoots(): string[] {
  const home = homedir();
  const roots = [path.resolve(home, '.aceharness')];
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) roots.push(path.resolve(xdg, 'aceharness'));
  const appData = process.env.APPDATA?.trim();
  if (appData) roots.push(path.resolve(appData, 'ACEHarness'));
  return roots;
}

function validateMarker(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const marker = value as Record<string, unknown>;
  return marker.schemaVersion === RUNTIME_MARKER.schemaVersion
    && marker.product === RUNTIME_MARKER.product
    && marker.packageName === RUNTIME_MARKER.packageName;
}

async function readMarker(root: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(root, RUNTIME_MARKER_FILE), 'utf8'));
  } catch {
    return null;
  }
}

export async function ensureRuntimeHomeInitialized(options: RuntimeHomeOptions = {}): Promise<string> {
  const root = path.resolve(options.runtimeRoot || getWorkspaceRoot());
  const filesystemRoot = path.parse(root).root;
  if (root === filesystemRoot || root === path.resolve(homedir())) {
    throw new Error(`Unsafe CSIHarness runtime root: ${root}`);
  }

  const canonicalRoot = await canonicalizeCandidate(root);
  for (const legacy of options.knownAceRoots ?? knownAceRoots()) {
    const resolvedLegacy = path.resolve(legacy);
    const canonicalLegacy = await canonicalizeCandidate(resolvedLegacy);
    if (
      isInsideOrEqual(resolvedLegacy, root)
      || isInsideOrEqual(canonicalLegacy, canonicalRoot)
    ) {
      throw new Error(`CSIHarness runtime root cannot use an ACEHarness directory: ${root}`);
    }
  }

  if (!existsSync(root)) {
    await mkdir(root, { recursive: true });
  } else if (!(await lstat(root)).isDirectory()) {
    throw new Error(`CSIHarness runtime root is not a directory: ${root}`);
  }

  const entries = await readdir(root);
  const markerPath = path.join(root, RUNTIME_MARKER_FILE);
  if (entries.includes(RUNTIME_MARKER_FILE)) {
    if (!validateMarker(await readMarker(root))) {
      throw new Error(`Invalid CSIHarness runtime marker: ${markerPath}`);
    }
    return root;
  }

  if (entries.length > 0) {
    throw new Error(`Refusing to use a non-empty directory without a CSIHarness runtime marker: ${root}`);
  }

  await writeFile(markerPath, `${JSON.stringify(RUNTIME_MARKER, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return root;
}

async function nearestExistingAncestor(candidate: string): Promise<string> {
  let current = candidate;
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

async function canonicalizeCandidate(candidate: string): Promise<string> {
  const resolvedCandidate = path.resolve(candidate);
  const existingAncestor = await nearestExistingAncestor(resolvedCandidate);
  const canonicalAncestor = await realpath(existingAncestor);
  return path.resolve(canonicalAncestor, path.relative(existingAncestor, resolvedCandidate));
}

export async function assertSafeRuntimeTargets(runtimeRoot: string, targets: string[]): Promise<string[]> {
  const root = path.resolve(runtimeRoot);
  if (!validateMarker(await readMarker(root))) {
    throw new Error(`Invalid CSIHarness runtime marker: ${root}`);
  }
  const canonicalRoot = await realpath(root);
  const resolvedTargets: string[] = [];

  for (const rawTarget of targets) {
    const target = path.resolve(rawTarget);
    if (target === root) {
      throw new Error('Refusing to delete the CSIHarness runtime root itself.');
    }
    if (!isInsideOrEqual(root, target)) {
      throw new Error(`Reset target is outside the CSIHarness runtime root: ${target}`);
    }
    const existingAncestor = await nearestExistingAncestor(target);
    const canonicalAncestor = await realpath(existingAncestor);
    if (!isInsideOrEqual(canonicalRoot, canonicalAncestor)) {
      throw new Error(`Reset target escapes outside the CSIHarness runtime root: ${target}`);
    }
    resolvedTargets.push(target);
  }

  return resolvedTargets;
}
