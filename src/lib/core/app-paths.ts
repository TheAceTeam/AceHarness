import { homedir } from 'os';
import path, { dirname, join, resolve } from 'path';
import { INSTALL_ROOT_ENV, RUNTIME_DIR_NAME, RUNTIME_HOME_ENV } from '@/lib/core/product-identity';

export type AppDirectoryKind = 'config' | 'data' | 'cache' | 'logs' | 'workspace';

export function resolveInstallRootFromEnvironment(env: NodeJS.ProcessEnv, fallbackCwd: string): string {
  const envInstallRoot = env[INSTALL_ROOT_ENV]?.trim();
  if (envInstallRoot) return resolve(envInstallRoot);

  return resolve(fallbackCwd);
}

const INSTALL_ROOT = resolveInstallRootFromEnvironment(process.env, process.cwd());

export function resolveRuntimeRootFromEnvironment(input: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
}): string {
  const pathApi = input.platform === 'win32' ? path.win32 : path.posix;
  const configuredHome = input.env[RUNTIME_HOME_ENV]?.trim();
  if (configuredHome) {
    if (configuredHome === '~' || configuredHome.startsWith('~/') || configuredHome.startsWith('~\\')) {
      const suffix = configuredHome.slice(1).replace(/^[/\\]+/, '');
      return pathApi.resolve(input.home, suffix);
    }
    if (!pathApi.isAbsolute(configuredHome)) {
      throw new Error(`${RUNTIME_HOME_ENV} must be an absolute path or start with ~/`);
    }
    return pathApi.resolve(configuredHome);
  }

  if (input.platform === 'win32') {
    const appData = input.env.APPDATA?.trim();
    if (appData) return pathApi.resolve(appData, 'CSIHarness');
  }

  const xdgDataHome = input.env.XDG_DATA_HOME?.trim();
  if (xdgDataHome) return pathApi.resolve(xdgDataHome, 'csiharness');

  return pathApi.resolve(input.home, RUNTIME_DIR_NAME);
}

function resolveRuntimeRoot(): string {
  return resolveRuntimeRootFromEnvironment({
    env: process.env,
    platform: process.platform,
    home: homedir(),
  });
}

export function getWorkspaceRoot(): string {
  return resolveRuntimeRoot();
}

export function getRepoRoot(): string {
  return INSTALL_ROOT;
}

export function getInstallPath(...segments: string[]): string {
  return join(INSTALL_ROOT, ...segments);
}

export function getInstallConfigsDir(): string {
  return join(INSTALL_ROOT, 'configs');
}

export function getInstallConfigPath(...segments: string[]): string {
  return join(getInstallConfigsDir(), ...segments);
}

export function getWorkspaceDirectory(kind: AppDirectoryKind): string {
  switch (kind) {
    case 'workspace':
      return getWorkspaceRoot();
    case 'config':
      return join(getWorkspaceRoot(), 'config');
    case 'data':
      return join(getWorkspaceRoot(), 'data');
    case 'cache':
      return join(getWorkspaceRoot(), 'cache');
    case 'logs':
    default:
      return join(getWorkspaceRoot(), 'logs');
  }
}

export function getWorkspaceConfigFile(name: string): string {
  return join(getWorkspaceDirectory('config'), name);
}

export function getWorkspaceDataFile(...segments: string[]): string {
  return join(getWorkspaceDirectory('data'), ...segments);
}

export function getWorkspaceLogFile(...segments: string[]): string {
  return join(getWorkspaceDirectory('logs'), ...segments);
}

export function getWorkspaceCacheFile(...segments: string[]): string {
  return join(getWorkspaceDirectory('cache'), ...segments);
}

export function getWorkspacePath(...segments: string[]): string {
  return join(getWorkspaceDirectory('workspace'), ...segments);
}

export function getEngineConfigPath(): string {
  return join(getWorkspaceRoot(), '.engine.json');
}

export function getWorkspaceDataDir(): string {
  return getWorkspaceDirectory('data');
}

export function getWorkspaceRunsDir(): string {
  return join(getWorkspaceRoot(), 'runs');
}

export function getWorkspaceConfigsDir(): string {
  return join(getWorkspaceRoot(), 'configs');
}

export function getWorkspaceConfigPath(...segments: string[]): string {
  return join(getWorkspaceConfigsDir(), ...segments);
}

export function getWorkspaceAgentsDir(): string {
  return getWorkspaceConfigPath('agents');
}

export function getWorkspaceSkillsDir(): string {
  return join(getWorkspaceRoot(), 'skills');
}

export function getWorkspaceSkillPath(...segments: string[]): string {
  return join(getWorkspaceSkillsDir(), ...segments);
}

export function getWorkspaceNotebookRoot(): string {
  return getWorkspaceDataFile('notebook');
}

export function getRuntimeDirForFile(filePath: string): string {
  return dirname(filePath);
}
