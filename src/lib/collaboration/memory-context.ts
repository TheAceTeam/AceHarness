import { loadChatSession } from '@/lib/chat/persistence';
import {
  buildMemoryV2ConsumerManifest,
  readMemoryV2ConsumerDetail,
  type MemoryV2ConsumerIdentity,
  type MemoryV2ConsumerManifestResult,
} from '@/lib/memory-v2-cutover/consumer-context';
import { getCollaborationRoom, type CollaborationRoomRecord } from '@/lib/collaboration/rooms';

export interface CollaborationParticipantMemoryContext {
  roomId: string;
  agentName: string;
  participantAgentNames: string[];
  sessionId: string;
  runId?: string;
  workflowId?: string;
  promptBlock: string;
  manifest: MemoryV2ConsumerManifestResult['manifest'];
  memoryV2: MemoryV2ConsumerManifestResult['status'];
  skippedReason?: string;
}

type CollaborationMemoryIdentity = MemoryV2ConsumerIdentity & {
  room: CollaborationRoomRecord;
  sessionId: string;
  runId?: string;
  workflowId?: string;
};

function clean(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

function assertRoomParticipant(room: CollaborationRoomRecord, agentName: string): void {
  if (room.participantAgentNames.includes(agentName)) return;
  throw new Error('The requested Agent is not a collaboration room participant');
}

function assertRoomOwner(room: CollaborationRoomRecord, ownerUserId: string): void {
  if (!room.createdBy || room.createdBy === ownerUserId) return;
  throw new Error('The authenticated user does not own this collaboration room');
}

async function resolveCollaborationMemoryIdentity(input: {
  roomId: string;
  agentName: string;
  ownerUserId: string;
}): Promise<CollaborationMemoryIdentity> {
  const roomId = clean(input.roomId);
  const agentName = clean(input.agentName);
  const ownerUserId = clean(input.ownerUserId);
  if (!roomId) throw new Error('Missing collaboration room ID');
  if (!agentName) throw new Error('Missing collaboration Agent name');
  if (!ownerUserId) throw new Error('Missing authenticated user');

  const room = await getCollaborationRoom(roomId);
  if (!room) throw new Error('Collaboration room was not found');
  assertRoomOwner(room, ownerUserId);
  assertRoomParticipant(room, agentName);

  const sessionId = room.sessionId || room.id;
  const session = room.sessionId
    ? await loadChatSession(room.sessionId).catch(() => null)
    : null;
  if (session?.createdBy && session.createdBy !== ownerUserId) {
    throw new Error('The authenticated user does not own this collaboration session');
  }
  const workflowBinding = session?.workflowBinding;
  const runId = clean(workflowBinding?.runId);
  const workflowId = clean(workflowBinding?.configFile);

  return {
    room,
    ownerUserId,
    sessionId,
    runId,
    workflowId,
    agentId: agentName,
  };
}

export async function resolveCollaborationParticipantMemoryContext(input: {
  roomId: string;
  agentName: string;
  ownerUserId: string;
}): Promise<CollaborationParticipantMemoryContext> {
  const identity = await resolveCollaborationMemoryIdentity(input);
  const memoryV2 = await buildMemoryV2ConsumerManifest({
    ...identity,
    trigger: 'conversation-turn',
  });

  return {
    roomId: identity.room.id,
    agentName: identity.agentId || input.agentName,
    participantAgentNames: [...identity.room.participantAgentNames],
    sessionId: identity.sessionId,
    runId: identity.runId,
    workflowId: identity.workflowId,
    promptBlock: memoryV2.promptBlock,
    manifest: memoryV2.manifest,
    memoryV2: memoryV2.status,
    skippedReason: memoryV2.skippedReason,
  };
}

export async function readCollaborationParticipantMemoryDetail(input: {
  roomId: string;
  agentName: string;
  ownerUserId: string;
  memoryId: string;
  detailVersion: number;
  cursor?: string;
  maxChars?: number;
}): ReturnType<typeof readMemoryV2ConsumerDetail> {
  const identity = await resolveCollaborationMemoryIdentity(input);
  return readMemoryV2ConsumerDetail({
    ...identity,
    memoryId: input.memoryId,
    detailVersion: input.detailVersion,
    cursor: input.cursor,
    maxChars: input.maxChars,
  });
}
