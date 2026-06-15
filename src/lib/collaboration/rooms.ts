import { mkdir, readFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { dirname } from 'path';
import { parse } from 'yaml';
import { z } from 'zod';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { roleConfigSchema, type RoleConfig } from '@/lib/core/schemas';
import { getRuntimeAgentConfigPath } from '@/lib/run/runtime-configs';
import type { CollaborationSpaceType } from '@/lib/collaboration/members';

export type CollaborationRoomType = 'direct' | 'meeting';
export type CollaborationRoomStatus = 'active' | 'archived';

const collaborationSpaceTypeSchema = z.enum(['meeting-room', 'office']);
const collaborationRoomTypeSchema = z.enum(['direct', 'meeting']);
const collaborationRoomStatusSchema = z.enum(['active', 'archived']);

const collaborationRoomAgentSnapshotSchema = z.object({
  agentName: z.string(),
  displayName: z.string(),
  title: z.string().optional(),
  team: z.string().optional(),
  officeRole: z.string().optional(),
  avatar: z.any().optional(),
});

const collaborationRoomRecordSchema = z.object({
  version: z.literal(1).default(1),
  id: z.string(),
  spaceType: collaborationSpaceTypeSchema.default('meeting-room'),
  roomType: collaborationRoomTypeSchema.default('meeting'),
  topic: z.string().default(''),
  participantAgentNames: z.array(z.string()).default([]),
  agentSnapshots: z.record(z.string(), collaborationRoomAgentSnapshotSchema).default({}),
  status: collaborationRoomStatusSchema.default('active'),
  sessionId: z.string().optional(),
  createdBy: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastMessageAt: z.number().optional(),
});

const collaborationRoomStoreSchema = z.object({
  version: z.literal(1).default(1),
  rooms: z.array(collaborationRoomRecordSchema).default([]),
});

export type CollaborationRoomAgentSnapshot = z.infer<typeof collaborationRoomAgentSnapshotSchema>;
export type CollaborationRoomRecord = z.infer<typeof collaborationRoomRecordSchema>;

interface CollaborationRoomStore {
  version: 1;
  rooms: CollaborationRoomRecord[];
}

function roomsPath(): string {
  return getWorkspaceDataFile('collaboration', 'rooms.json');
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function normalizeAgentName(value: unknown): string {
  return String(value || '').trim();
}

function uniqueAgentNames(values: unknown[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    const name = normalizeAgentName(value);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function normalizeCollaborationSpaceType(value: unknown): CollaborationSpaceType {
  return value === 'office' ? 'office' : 'meeting-room';
}

function normalizeRoomType(value: unknown): CollaborationRoomType {
  return value === 'direct' ? 'direct' : 'meeting';
}

function normalizeRoomStatus(value: unknown): CollaborationRoomStatus | undefined {
  if (value === 'active' || value === 'archived') return value;
  return undefined;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

async function readRoomsStore(): Promise<CollaborationRoomStore> {
  const parsed = collaborationRoomStoreSchema.safeParse(await readJsonFile<unknown>(roomsPath()));
  return parsed.success ? parsed.data : { version: 1, rooms: [] };
}

async function saveRoomsStore(store: CollaborationRoomStore): Promise<void> {
  const filePath = roomsPath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

function getAgentDisplayName(agent: RoleConfig): string {
  return (
    agent.workspaceProfile?.nickname
    || agent.workspaceProfile?.displayName
    || agent.title
    || agent.name
  ).trim();
}

async function readAgentSnapshot(agentName: string): Promise<CollaborationRoomAgentSnapshot> {
  try {
    const filepath = await getRuntimeAgentConfigPath(agentName);
    const parsed = parse(await readFile(filepath, 'utf-8'));
    const result = roleConfigSchema.safeParse(parsed);
    if (result.success) {
      const agent = result.data;
      return {
        agentName,
        displayName: getAgentDisplayName(agent),
        title: agent.title,
        team: agent.team,
        officeRole: agent.workspaceProfile?.officeRole,
        avatar: agent.avatar,
      };
    }
  } catch {
    // Rooms should remain creatable even if an Agent was removed or is temporarily invalid.
  }

  return {
    agentName,
    displayName: agentName,
  };
}

async function buildAgentSnapshots(agentNames: string[]): Promise<Record<string, CollaborationRoomAgentSnapshot>> {
  const entries = await Promise.all(agentNames.map(async (agentName) => [agentName, await readAgentSnapshot(agentName)] as const));
  return Object.fromEntries(entries);
}

async function mergeAgentSnapshots(
  current: Record<string, CollaborationRoomAgentSnapshot> | undefined,
  agentNames: string[]
): Promise<Record<string, CollaborationRoomAgentSnapshot>> {
  const next = { ...(current || {}) };
  const missing = agentNames.filter((agentName) => !next[agentName]);
  Object.assign(next, await buildAgentSnapshots(missing));
  return next;
}

function cloneRoom(room: CollaborationRoomRecord): CollaborationRoomRecord {
  return {
    ...room,
    participantAgentNames: [...room.participantAgentNames],
    agentSnapshots: { ...room.agentSnapshots },
  };
}

export async function createDirectRoom(input: {
  agentName: string;
  spaceType?: CollaborationSpaceType | string;
  topic?: string;
  createdBy?: string;
  sessionId?: string;
}): Promise<CollaborationRoomRecord> {
  const agentName = normalizeAgentName(input.agentName);
  if (!agentName) throw new Error('缺少 Agent 名称');

  const now = Date.now();
  const room: CollaborationRoomRecord = {
    version: 1,
    id: createId('room'),
    spaceType: normalizeCollaborationSpaceType(input.spaceType),
    roomType: 'direct',
    topic: String(input.topic || ''),
    participantAgentNames: [agentName],
    agentSnapshots: await buildAgentSnapshots([agentName]),
    status: 'active',
    sessionId: input.sessionId,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };

  const store = await readRoomsStore();
  store.rooms.unshift(room);
  await saveRoomsStore(store);
  return cloneRoom(room);
}

export async function getOrCreateDirectRoom(input: {
  agentName: string;
  spaceType?: CollaborationSpaceType | string;
  topic?: string;
  createdBy?: string;
  sessionId?: string;
}): Promise<{ room: CollaborationRoomRecord; created: boolean }> {
  const agentName = normalizeAgentName(input.agentName);
  if (!agentName) throw new Error('缺少 Agent 名称');

  const spaceType = normalizeCollaborationSpaceType(input.spaceType);
  const store = await readRoomsStore();
  const existing = store.rooms.find((room) => (
    room.status === 'active'
    && room.spaceType === spaceType
    && room.roomType === 'direct'
    && room.participantAgentNames.length === 1
    && room.participantAgentNames[0] === agentName
  ));

  if (existing) return { room: cloneRoom(existing), created: false };
  return { room: await createDirectRoom({ ...input, agentName, spaceType }), created: true };
}

export async function getCollaborationRoom(roomId: string): Promise<CollaborationRoomRecord | null> {
  const store = await readRoomsStore();
  const room = store.rooms.find((item) => item.id === roomId);
  return room ? cloneRoom(room) : null;
}

export async function listCollaborationRooms(input?: {
  spaceType?: CollaborationSpaceType | string;
  roomType?: CollaborationRoomType | string;
  status?: CollaborationRoomStatus | string;
}): Promise<CollaborationRoomRecord[]> {
  const store = await readRoomsStore();
  const spaceType = input?.spaceType ? normalizeCollaborationSpaceType(input.spaceType) : undefined;
  const roomType = input?.roomType ? normalizeRoomType(input.roomType) : undefined;
  const status = normalizeRoomStatus(input?.status);

  return store.rooms
    .filter((room) => !spaceType || room.spaceType === spaceType)
    .filter((room) => !roomType || room.roomType === roomType)
    .filter((room) => !status || room.status === status)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(cloneRoom);
}

export async function addRoomParticipants(input: {
  roomId: string;
  agentNames: string[];
}): Promise<CollaborationRoomRecord> {
  const agentNames = uniqueAgentNames(input.agentNames);
  if (!input.roomId) throw new Error('缺少房间 ID');
  if (!agentNames.length) throw new Error('缺少要加入的 Agent');

  const store = await readRoomsStore();
  const index = store.rooms.findIndex((room) => room.id === input.roomId);
  if (index < 0) throw new Error('房间不存在');

  const current = store.rooms[index];
  if (current.status === 'archived') throw new Error('房间已结束');

  const participants = uniqueAgentNames([...current.participantAgentNames, ...agentNames]);
  const next: CollaborationRoomRecord = {
    ...current,
    participantAgentNames: participants,
    agentSnapshots: await mergeAgentSnapshots(current.agentSnapshots, participants),
    roomType: participants.length > 1 ? 'meeting' : current.roomType,
    updatedAt: Date.now(),
  };

  store.rooms[index] = next;
  await saveRoomsStore(store);
  return cloneRoom(next);
}

export async function finishCollaborationRoom(roomId: string): Promise<CollaborationRoomRecord> {
  if (!roomId) throw new Error('缺少房间 ID');

  const store = await readRoomsStore();
  const index = store.rooms.findIndex((room) => room.id === roomId);
  if (index < 0) throw new Error('房间不存在');

  const next: CollaborationRoomRecord = {
    ...store.rooms[index],
    status: 'archived',
    updatedAt: Date.now(),
  };
  store.rooms[index] = next;
  await saveRoomsStore(store);
  return cloneRoom(next);
}

export async function attachCollaborationRoomSession(input: {
  roomId: string;
  sessionId: string;
}): Promise<CollaborationRoomRecord> {
  const roomId = String(input.roomId || '').trim();
  const sessionId = String(input.sessionId || '').trim();
  if (!roomId) throw new Error('缺少房间 ID');
  if (!sessionId) throw new Error('缺少会话 ID');

  const store = await readRoomsStore();
  const index = store.rooms.findIndex((room) => room.id === roomId);
  if (index < 0) throw new Error('房间不存在');

  const next: CollaborationRoomRecord = {
    ...store.rooms[index],
    sessionId,
    updatedAt: Date.now(),
  };
  store.rooms[index] = next;
  await saveRoomsStore(store);
  return cloneRoom(next);
}
