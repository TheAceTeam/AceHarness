import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { resolveNativeTarget } from './resolve-addon';
import type { NativeLibraryBuildInfo } from './types';

export function getDynamicLibraryExtension(platform = process.platform): string {
  if (platform === 'win32') return '.dll';
  if (platform === 'darwin') return '.dylib';
  return '.so';
}

export function normalizeNativeLibraryPath(path: string): string {
  return resolve(path);
}

export function resolveLibraryArtifactPath(options: {
  root: string;
  name: string;
  target?: string;
  platform?: NodeJS.Platform;
}): string {
  const target = options.target || resolveNativeTarget(options.platform);
  const extension = getDynamicLibraryExtension(options.platform);
  const fileName = options.platform === 'win32' ? `${options.name}${extension}` : `lib${options.name}${extension}`;
  return join(resolve(options.root), 'artifacts', target, fileName);
}

export function isNativeLibraryAvailable(path: string): boolean {
  return existsSync(normalizeNativeLibraryPath(path));
}

export function readLibraryBuildInfo(path: string): NativeLibraryBuildInfo | null {
  const buildInfoPath = join(dirname(normalizeNativeLibraryPath(path)), 'build-info.json');
  if (!existsSync(buildInfoPath)) return null;
  try {
    return JSON.parse(readFileSync(buildInfoPath, 'utf8')) as NativeLibraryBuildInfo;
  } catch {
    return null;
  }
}
