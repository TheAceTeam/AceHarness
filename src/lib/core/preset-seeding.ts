import { randomUUID } from 'crypto';
import { cp, lstat, mkdir, rename, rm } from 'fs/promises';
import { dirname, resolve } from 'path';

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Copy bundled templates into a runtime directory exactly once.
 *
 * An existing target is entirely user-owned: missing entries are not restored
 * and existing entries are never overwritten. A same-parent temporary directory
 * keeps first-time publication atomic.
 */
export async function seedBundledDirectoryOnce(sourceDir: string, targetDir: string): Promise<void> {
  const source = resolve(sourceDir);
  const target = resolve(targetDir);
  if (await pathExists(target)) return;

  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const temporary = `${target}.seed-${process.pid}-${randomUUID()}`;

  try {
    if (await pathExists(source)) {
      await cp(source, temporary, { recursive: true, force: false, errorOnExist: true, dereference: true });
    } else {
      await mkdir(temporary, { recursive: true });
    }

    try {
      await rename(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') {
        throw error;
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
