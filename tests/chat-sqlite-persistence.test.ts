import { mkdtemp, mkdir, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function importPersistence(dataDir: string) {
  vi.resetModules();
  delete (globalThis as any).__chatSessionDb;
  vi.doMock('@/lib/core/app-paths', () => ({
    getWorkspaceDataFile: (...segments: string[]) => join(dataDir, ...segments),
  }));
  return import('@/lib/chat/persistence');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('chat SQLite persistence', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'ace-chat-sqlite-'));
  });

  it('stores new chat sessions in SQLite instead of JSON files', async () => {
    const persistence = await importPersistence(dataDir);
    await persistence.saveChatSession({
      id: 'session-1',
      title: 'SQLite session',
      model: 'test-model',
      engine: 'test-engine',
      createdAt: 100,
      updatedAt: 200,
      createdBy: 'user-1',
      visibility: 'public',
      messages: [
        { id: 'm1', role: 'user', content: 'hello', timestamp: 100 },
        { id: 'm2', role: 'assistant', content: 'world', timestamp: 200 },
      ],
    });

    expect(await exists(join(dataDir, 'chat-sessions.sqlite'))).toBe(true);
    expect(await exists(join(dataDir, 'chat-sessions', 'session-1.json'))).toBe(false);

    const loaded = await persistence.loadChatSession('session-1');
    expect(loaded?.title).toBe('SQLite session');
    expect(loaded?.messages).toHaveLength(2);

    const summaries = await persistence.listChatSessions();
    expect(summaries).toMatchObject([
      {
        id: 'session-1',
        title: 'SQLite session',
        messageCount: 2,
        createdBy: 'user-1',
      },
    ]);
  });

  it('keeps legacy JSON sessions readable when no SQLite row exists', async () => {
    const legacyDir = join(dataDir, 'chat-sessions');
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, 'legacy-1.json'), JSON.stringify({
      id: 'legacy-1',
      title: 'Legacy session',
      model: 'legacy-model',
      createdAt: 10,
      updatedAt: 20,
      messages: [
        { id: 'm1', role: 'user', content: 'old hello', timestamp: 10 },
      ],
    }), 'utf-8');

    const persistence = await importPersistence(dataDir);
    const loaded = await persistence.loadChatSession('legacy-1');
    expect(loaded?.title).toBe('Legacy session');

    const summaries = await persistence.listChatSessions();
    expect(summaries.some((session) => session.id === 'legacy-1')).toBe(true);
  });
});
