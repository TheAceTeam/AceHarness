import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { describe, expect, test, vi } from 'vitest';
import { stringify } from 'yaml';
import { withTempDir } from './helpers/module-helpers';

function agent(input: Record<string, any>) {
  return {
    name: input.name,
    team: input.team || 'blue',
    roleType: 'normal',
    title: input.title || input.name,
    engineModels: {},
    activeEngine: '',
    capabilities: input.capabilities || ['协作'],
    systemPrompt: input.systemPrompt || `你是 ${input.name}。`,
    workspaceProfile: input.workspaceProfile,
  };
}

async function writeAgent(agentsDir: string, input: Record<string, any>) {
  await writeFile(path.join(agentsDir, `${input.name}.yaml`), stringify(agent(input)), 'utf-8');
}

describe('collaboration room store', () => {
  test('preserves room metadata when normalizing chatroom room state', async () => {
    const { ensureChatroomRoomState } = await import('@/lib/agora/chatroom-state');
    const room = ensureChatroomRoomState({
      roomId: 'room-1',
      spaceType: 'office',
      roomType: 'direct',
      topic: '',
      selectedAgents: ['alice'],
      messages: [],
      rounds: [],
    });

    expect(room).toMatchObject({
      roomId: 'room-1',
      spaceType: 'office',
      roomType: 'direct',
    });
  });

  test('creates direct rooms and turns them into meeting rooms when participants are added', async () => {
    await withTempDir('aceharness-collaboration-rooms-', async (dir) => {
      const dataDir = path.join(dir, 'data');
      const agentsDir = path.join(dir, 'agents');
      await mkdir(dataDir, { recursive: true });
      await mkdir(agentsDir, { recursive: true });
      await writeAgent(agentsDir, {
        name: 'alice',
        title: 'Alice',
        workspaceProfile: {
          nickname: '小艾',
          officeRole: 'Product Lead',
        },
      });
      await writeAgent(agentsDir, {
        name: 'bob',
        title: 'Bob',
        workspaceProfile: {
          nickname: '小鲍',
        },
      });

      vi.resetModules();
      vi.doMock('@/lib/core/app-paths', () => ({
        getWorkspaceDataFile: (...segments: string[]) => path.join(dataDir, ...segments),
        getWorkspaceRoot: () => dir,
      }));
      vi.doMock('@/lib/run/runtime-configs', () => ({
        getRuntimeAgentConfigPath: async (name: string) => path.join(agentsDir, `${name}.yaml`),
      }));

      const {
        addRoomParticipants,
        finishCollaborationRoom,
        getOrCreateDirectRoom,
        listCollaborationRooms,
      } = await import('@/lib/collaboration/rooms');
      const { ensureCollaborationRoomChatSession, syncCollaborationRoomChatSession } = await import('@/lib/collaboration/session-adapter');

      const first = await getOrCreateDirectRoom({ agentName: 'alice', spaceType: 'office' });
      const second = await getOrCreateDirectRoom({ agentName: 'alice', spaceType: 'office' });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.room.id).toBe(first.room.id);
      expect(first.room).toMatchObject({
        spaceType: 'office',
        roomType: 'direct',
        participantAgentNames: ['alice'],
      });
      expect(first.room.agentSnapshots.alice.displayName).toBe('小艾');

      const initialSessionResult = await ensureCollaborationRoomChatSession({ roomId: first.room.id });
      expect(initialSessionResult.session.sessionWorkbenchState?.collaborationRoom).toMatchObject({
        roomId: first.room.id,
        spaceType: 'office',
        roomType: 'direct',
        selectedAgents: ['alice'],
      });

      const expanded = await addRoomParticipants({ roomId: first.room.id, agentNames: ['bob'] });
      expect(expanded.roomType).toBe('meeting');
      expect(expanded.participantAgentNames).toEqual(['alice', 'bob']);
      expect(expanded.agentSnapshots.bob.displayName).toBe('小鲍');
      const syncedSession = await syncCollaborationRoomChatSession(expanded);
      expect(syncedSession?.id).toBe(initialSessionResult.session.id);
      expect(syncedSession?.sessionWorkbenchState?.collaborationRoom).toMatchObject({
        roomId: first.room.id,
        spaceType: 'office',
        roomType: 'meeting',
        selectedAgents: ['alice', 'bob'],
      });

      const activeMeetingRooms = await listCollaborationRooms({ spaceType: 'office', roomType: 'meeting', status: 'active' });
      expect(activeMeetingRooms.map((room) => room.id)).toEqual([first.room.id]);

      const sessionResult = await ensureCollaborationRoomChatSession({ roomId: first.room.id });
      const repeatedSessionResult = await ensureCollaborationRoomChatSession({ roomId: first.room.id });
      expect(sessionResult.created).toBe(false);
      expect(repeatedSessionResult.created).toBe(false);
      expect(repeatedSessionResult.session.id).toBe(sessionResult.session.id);
      expect(sessionResult.session.sessionWorkbenchState?.collaborationRoom).toMatchObject({
        roomId: first.room.id,
        spaceType: 'office',
        roomType: 'meeting',
        selectedAgents: ['alice', 'bob'],
      });
      expect(sessionResult.session.sessionWorkbenchState?.collaborationRoom?.chatroom?.participants).toEqual(['alice', 'bob']);

      const archived = await finishCollaborationRoom(first.room.id);
      expect(archived.status).toBe('archived');
      expect(await listCollaborationRooms({ status: 'active' })).toEqual([]);
    });
  });

  test('does not fall back to legacy role memory for a collaboration participant', async () => {
    await withTempDir('aceharness-collaboration-memory-', async (dir) => {
      const dataDir = path.join(dir, 'data');
      const agentsDir = path.join(dir, 'agents');
      await mkdir(dataDir, { recursive: true });
      await mkdir(agentsDir, { recursive: true });
      await writeAgent(agentsDir, {
        name: 'alice',
        title: 'Alice',
        workspaceProfile: {
          memory: { baseBudget: 200 },
        },
      });

      vi.resetModules();
      vi.doMock('@/lib/core/app-paths', () => ({
        getWorkspaceDataFile: (...segments: string[]) => path.join(dataDir, ...segments),
      }));
      vi.doMock('@/lib/run/runtime-configs', () => ({
        getRuntimeAgentConfigPath: async (name: string) => path.join(agentsDir, `${name}.yaml`),
      }));

      const { saveSystemSettings } = await import('@/lib/config/system-settings');
      const { replaceMemoryEntries } = await import('@/lib/workflow/memory-store');
      const { getOrCreateDirectRoom } = await import('@/lib/collaboration/rooms');
      const { ensureCollaborationRoomChatSession } = await import('@/lib/collaboration/session-adapter');
      const { resolveCollaborationParticipantMemoryContext } = await import('@/lib/collaboration/memory-context');

      await saveSystemSettings({ agentMemory: { runtimeEnabled: true, persistMode: 'review' } });
      await replaceMemoryEntries({
        scope: 'role',
        key: 'alice',
        entries: [{
          kind: 'base',
          title: '偏好',
          content: 'Alice 喜欢先给出结论。',
          source: 'test',
        }],
      });

      const { room } = await getOrCreateDirectRoom({ agentName: 'alice', spaceType: 'office' });
      await ensureCollaborationRoomChatSession({ roomId: room.id });
      const context = await resolveCollaborationParticipantMemoryContext({
        roomId: room.id,
        agentName: 'alice',
        ownerUserId: 'test-user',
      });

      expect(context.promptBlock).not.toContain('Alice 喜欢先给出结论');
      await expect(resolveCollaborationParticipantMemoryContext({
        roomId: room.id,
        agentName: 'missing',
        ownerUserId: 'test-user',
      })).rejects.toThrow('The requested Agent is not a collaboration room participant');
    });
  });
});
