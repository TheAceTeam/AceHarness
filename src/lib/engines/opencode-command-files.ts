import { promises as fs } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import { buildConfiguredProcessEnvSync } from '@/lib/core/configured-env';
import type { OpenCodeDiscoveredCommand } from './opencode-http-adapter';

type DiscoverCommandFileOptions = {
  workingDirectory?: string;
  env?: Partial<NodeJS.ProcessEnv>;
  homeDir?: string;
  platform?: NodeJS.Platform;
  runtimeRoot?: string;
  userId?: string;
};

type Frontmatter = {
  name?: unknown;
  description?: unknown;
};

const COMMAND_DIR_NAMES = ['command', 'commands'] as const;

function normalizeNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniquePaths(paths: string[], platform: NodeJS.Platform): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of paths) {
    const resolved = path.resolve(item);
    const key = platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

async function findNearestAncestorWithChild(start: string, childName: string): Promise<string | null> {
  let current = path.resolve(start);
  while (true) {
    try {
      await fs.access(path.join(current, childName));
      return current;
    } catch {
      // Keep walking upward until a root is reached.
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function resolveOpenCodeGlobalConfigDirectories(options: DiscoverCommandFileOptions = {}): string[] {
  const env = options.env ?? buildConfiguredProcessEnvSync(
    undefined,
    process.env,
    options.userId ? { userId: options.userId } : undefined,
  );
  const home = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  const candidates = [
    normalizeNonEmptyString(env.OPENCODE_CONFIG_DIR),
    normalizeNonEmptyString(env.XDG_CONFIG_HOME) ? path.join(normalizeNonEmptyString(env.XDG_CONFIG_HOME), 'opencode') : '',
    home ? path.join(home, '.config', 'opencode') : '',
    platform === 'win32' && normalizeNonEmptyString(env.APPDATA)
      ? path.join(normalizeNonEmptyString(env.APPDATA), 'opencode')
      : '',
  ].filter(Boolean);

  return uniquePaths(candidates, platform);
}

export function resolveAceHarnessOpenCodeConfigDirectories(options: DiscoverCommandFileOptions = {}): string[] {
  const home = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  const runtimeRoot = normalizeNonEmptyString(options.runtimeRoot ?? getWorkspaceRoot());
  const candidates = [
    runtimeRoot ? path.join(runtimeRoot, '.opencode') : '',
    home ? path.join(home, '.aceharness', '.opencode') : '',
  ].filter(Boolean);
  return uniquePaths(candidates, platform);
}

export async function resolveOpenCodeProjectConfigDirectories(options: DiscoverCommandFileOptions = {}): Promise<string[]> {
  const home = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  const candidates: string[] = [];
  const workingDirectory = normalizeNonEmptyString(options.workingDirectory);
  if (workingDirectory) {
    const start = path.resolve(workingDirectory);
    const stop = await findNearestAncestorWithChild(start, '.git');
    let current = start;
    while (true) {
      candidates.push(path.join(current, '.opencode'));
      if (stop && current === stop) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  if (home) candidates.push(path.join(home, '.opencode'));
  return uniquePaths(candidates, platform);
}

function commandNameFromPath(configDir: string, filePath: string): string {
  const relative = path.relative(configDir, filePath).split(path.sep).join('/');
  const withoutPrefix = relative.replace(/^commands?\//, '');
  return withoutPrefix.replace(/\.md$/i, '').replace(/^\/+/, '').trim();
}

function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match?.[1]) return {};
  try {
    const parsed = parseYaml(match[1]);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Frontmatter
      : {};
  } catch {
    return {};
  }
}

async function scanCommandDirectory(configDir: string, dir: string): Promise<OpenCodeDiscoveredCommand[]> {
  let entries: Array<import('fs').Dirent>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const commands: OpenCodeDiscoveredCommand[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      commands.push(...await scanCommandDirectory(configDir, entryPath));
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;

    let frontmatter: Frontmatter = {};
    try {
      frontmatter = parseFrontmatter(await fs.readFile(entryPath, 'utf8'));
    } catch {
      // Ignore unreadable command files; discovery is only a fallback.
    }

    const fallbackName = commandNameFromPath(configDir, entryPath);
    const name = normalizeNonEmptyString(frontmatter.name).replace(/^\/+/, '') || fallbackName;
    if (!name) continue;
    commands.push({
      name,
      description: normalizeNonEmptyString(frontmatter.description),
      source: 'command-file',
    });
  }

  return commands;
}

export async function discoverOpenCodeCommandFileFallback(
  options: DiscoverCommandFileOptions = {},
): Promise<OpenCodeDiscoveredCommand[]> {
  const platform = options.platform ?? process.platform;
  const configDirs = [
    ...await resolveOpenCodeProjectConfigDirectories({ ...options, platform }),
    ...resolveAceHarnessOpenCodeConfigDirectories({ ...options, platform }),
    ...resolveOpenCodeGlobalConfigDirectories({ ...options, platform }),
  ];

  const commands: OpenCodeDiscoveredCommand[] = [];
  for (const configDir of uniquePaths(configDirs, platform)) {
    for (const dirname of COMMAND_DIR_NAMES) {
      commands.push(...await scanCommandDirectory(configDir, path.join(configDir, dirname)));
    }
  }

  return commands;
}

export function mergeOpenCodeCommandLists(
  primary: OpenCodeDiscoveredCommand[],
  fallback: OpenCodeDiscoveredCommand[],
): OpenCodeDiscoveredCommand[] {
  const seen = new Set<string>();
  const merged: OpenCodeDiscoveredCommand[] = [];
  for (const command of [...primary, ...fallback]) {
    const name = normalizeNonEmptyString(command.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      ...command,
      name,
      description: normalizeNonEmptyString(command.description),
    });
  }
  return merged;
}

export async function mergeOpenCodeCommandsWithFileFallback(
  commands: OpenCodeDiscoveredCommand[],
  options: DiscoverCommandFileOptions = {},
): Promise<OpenCodeDiscoveredCommand[]> {
  const fallback = await discoverOpenCodeCommandFileFallback(options);
  return mergeOpenCodeCommandLists(commands, fallback);
}
