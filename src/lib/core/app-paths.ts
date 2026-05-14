import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

export type AppDirectoryKind = 'config' | 'data' | 'cache' | 'logs' | 'workspace';

function resolveInstallRoot(): string {
  const envInstallRoot = process.env.ACE_INSTALL_ROOT?.trim();
  if (envInstallRoot) return resolve(envInstallRoot);

  return resolve(process.cwd());
}

const INSTALL_ROOT = resolveInstallRoot();

function resolveRuntimeRoot(): string {
  const aceHome = process.env.ACE_HOME?.trim();
  if (aceHome) return resolve(aceHome);

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim();
    if (appData) return resolve(appData, 'ACEHarness');
  }

  const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
  if (xdgDataHome) return resolve(xdgDataHome, 'aceharness');

  return resolve(homedir(), '.aceharness');
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
