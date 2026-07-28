import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let fileSymlinkCapability: Promise<boolean> | undefined;

export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function withIsolatedAceHome<T>(fn: (aceHome: string) => Promise<T>): Promise<T> {
  return withTempDir('aceharness-test-home-', async (baseDir) => {
    const runtimeDirName = process.platform === 'win32' ? 'ACEHarness' : 'aceharness';
    const aceHome = path.join(baseDir, runtimeDirName);
    await mkdir(aceHome, { recursive: true });
    const previousAceHome = process.env.ACE_HOME;
    const previousAppData = process.env.APPDATA;
    const previousXdgDataHome = process.env.XDG_DATA_HOME;
    const previousWorkflowEventStore = process.env.ACE_WORKFLOW_EVENT_STORE;
    process.env.ACE_HOME = aceHome;
    process.env.APPDATA = baseDir;
    process.env.XDG_DATA_HOME = baseDir;
    process.env.ACE_WORKFLOW_EVENT_STORE = 'jsonl';
    try {
      return await fn(aceHome);
    } finally {
      try {
        const { resetWorkflowEventStoreForTests } = await import('@/lib/workflow/event-store');
        resetWorkflowEventStoreForTests();
      } catch {}
      if (previousAceHome === undefined) delete process.env.ACE_HOME;
      else process.env.ACE_HOME = previousAceHome;
      if (previousAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = previousAppData;
      if (previousXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousXdgDataHome;
      if (previousWorkflowEventStore === undefined) delete process.env.ACE_WORKFLOW_EVENT_STORE;
      else process.env.ACE_WORKFLOW_EVENT_STORE = previousWorkflowEventStore;
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

export async function canCreateFileSymlink(): Promise<boolean> {
  fileSymlinkCapability ??= withTempDir('aceharness-test-symlink-', async (base) => {
    const target = path.join(base, 'target.txt');
    const link = path.join(base, 'link.txt');
    await writeFile(target, 'ok');
    try {
      await symlink(target, link, process.platform === 'win32' ? 'file' : undefined);
      return true;
    } catch (error: any) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'UNKNOWN') {
        return false;
      }
      throw error;
    }
  });

  return fileSymlinkCapability;
}

export async function createFileSymlink(target: string, linkPath: string): Promise<void> {
  await symlink(target, linkPath, process.platform === 'win32' ? 'file' : undefined);
}

export async function createDirectorySymlink(target: string, linkPath: string): Promise<void> {
  await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : undefined);
}
