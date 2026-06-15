import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { resolveAgentMemoryContext, resolveAgentRoleMemory, type AgentMemorySnapshot } from '@/lib/agent/memory-resolver';
import { roleConfigSchema } from '@/lib/core/schemas';
import { getCollaborationRoom, type CollaborationRoomRecord } from '@/lib/collaboration/rooms';
import { getRuntimeAgentConfigPath } from '@/lib/run/runtime-configs';

export interface CollaborationParticipantMemoryContext {
  roomId: string;
  agentName: string;
  participantAgentNames: string[];
  sessionId?: string;
  promptBlock: string;
  roleMemory: AgentMemorySnapshot;
}

async function resolveRoleMemoryBudget(agentName: string): Promise<number | undefined> {
  try {
    const filepath = await getRuntimeAgentConfigPath(agentName);
    const parsed = parse(await readFile(filepath, 'utf-8'));
    const result = roleConfigSchema.safeParse(parsed);
    return result.success ? result.data.workspaceProfile?.memory?.baseBudget : undefined;
  } catch {
    return undefined;
  }
}

function assertRoomParticipant(room: CollaborationRoomRecord, agentName: string): void {
  if (room.participantAgentNames.includes(agentName)) return;
  throw new Error('该 Agent 不在协作房间中');
}

export async function resolveCollaborationParticipantMemoryContext(input: {
  roomId: string;
  agentName: string;
  workingDirectory?: string;
}): Promise<CollaborationParticipantMemoryContext> {
  const roomId = String(input.roomId || '').trim();
  const agentName = String(input.agentName || '').trim();
  if (!roomId) throw new Error('缺少房间 ID');
  if (!agentName) throw new Error('缺少 Agent 名称');

  const room = await getCollaborationRoom(roomId);
  if (!room) throw new Error('房间不存在');
  assertRoomParticipant(room, agentName);

  const maxRoleMemoryChars = await resolveRoleMemoryBudget(agentName);
  const roleMemory = await resolveAgentRoleMemory({
    agentName,
    maxChars: maxRoleMemoryChars,
  });
  const promptBlock = await resolveAgentMemoryContext({
    agentName,
    mode: 'standalone-chat',
    workingDirectory: input.workingDirectory,
    sessionId: room.sessionId || room.id,
    maxRoleMemoryChars,
  });

  return {
    roomId: room.id,
    agentName,
    participantAgentNames: [...room.participantAgentNames],
    sessionId: room.sessionId,
    promptBlock,
    roleMemory,
  };
}
