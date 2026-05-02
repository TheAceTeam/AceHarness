import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function withIsolatedAceHome<T>(fn: (aceHome: string) => Promise<T>): Promise<T> {
  return withTempDir('aceharness-test-home-', async (aceHome) => {
    const previousAceHome = process.env.ACE_HOME;
    process.env.ACE_HOME = aceHome;
    try {
      return await fn(aceHome);
    } finally {
      if (previousAceHome === undefined) delete process.env.ACE_HOME;
      else process.env.ACE_HOME = previousAceHome;
    }
  });
}

export async function withTempWorkspace<T>(
  fn: (paths: { base: string; workspace: string }) => Promise<T>
): Promise<T> {
  return withTempDir('aceharness-test-workspace-', async (base) => {
    const workspace = path.join(base, 'workspace');
    await mkdir(workspace, { recursive: true });
    return fn({ base, workspace });
  });
}
