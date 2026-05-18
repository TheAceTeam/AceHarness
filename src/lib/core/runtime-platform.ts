export function getRuntimePlatform(): NodeJS.Platform {
  return process.platform;
}

export function isWindows(): boolean {
  return getRuntimePlatform() === 'win32';
}

export function isMacOS(): boolean {
  return getRuntimePlatform() === 'darwin';
}

export function isLinux(): boolean {
  return getRuntimePlatform() === 'linux';
}
