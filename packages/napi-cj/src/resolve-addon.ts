import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NativeAddonBuildInfo } from './types';

export function resolveNativeTarget(platform = process.platform, arch = process.arch): string {
  if (platform === 'win32' && arch === 'x64') return 'win32-x64-msvc';
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64';
  if (platform === 'linux' && arch === 'x64') return 'linux-x64-gnu';
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64-gnu';
  return `${platform}-${arch}`;
}

export function getPackageRoot(): string {
  return resolve(__dirname, '..');
}

export function resolveAddonDirectory(target = resolveNativeTarget()): string {
  return join(getPackageRoot(), 'native', target);
}

export function resolveAddonPath(target = resolveNativeTarget()): string {
  return join(resolveAddonDirectory(target), 'napi_cj.node');
}

export function isNativeAddonAvailable(target = resolveNativeTarget()): boolean {
  return existsSync(resolveAddonPath(target));
}

export function readAddonBuildInfo(target = resolveNativeTarget()): NativeAddonBuildInfo | null {
  const buildInfoPath = join(resolveAddonDirectory(target), 'build-info.json');
  if (!existsSync(buildInfoPath)) return null;
  try {
    return JSON.parse(readFileSync(buildInfoPath, 'utf8')) as NativeAddonBuildInfo;
  } catch {
    return null;
  }
}
