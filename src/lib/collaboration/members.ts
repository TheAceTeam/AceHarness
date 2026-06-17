import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import { roleConfigSchema, type RoleConfig } from '@/lib/core/schemas';
import { getRuntimeAgentsDirPath } from '@/lib/run/runtime-configs';

export type CollaborationSpaceType = 'meeting-room' | 'office';

export interface CollaborationMember {
  agentName: string;
  displayName: string;
  nickname?: string;
  officeRole?: string;
  participantKind: 'resident' | 'recommended';
  defaultDirectRoom: boolean;
  visual: {
    accent?: string;
    deskVariant?: string;
    desk?: string;
    zone?: string;
    column?: number;
    row?: number;
    order: number;
  };
  motion: {
    activity?: 'typing' | 'walking' | 'talking' | 'thinking' | 'reviewing' | 'presenting';
    speed?: number;
  };
  agent: RoleConfig & { _file?: string };
}

function normalizeSpaceType(value: unknown): CollaborationSpaceType {
  return value === 'office' ? 'office' : 'meeting-room';
}

function getProfileDisplayName(agent: RoleConfig): string {
  return (
    agent.workspaceProfile?.nickname
    || agent.workspaceProfile?.displayName
    || agent.title
    || agent.name
  ).trim();
}

function getDefaultOfficeRole(agent: RoleConfig): string | undefined {
  return agent.workspaceProfile?.officeRole
    || agent.category
    || agent.tags?.[0]
    || undefined;
}

function getDefaultOrder(agent: RoleConfig): number {
  const raw = agent.workspaceProfile?.visual?.order;
  return Number.isFinite(raw) ? Number(raw) : 999;
}

function shouldIncludeAgent(agent: RoleConfig, spaceType: CollaborationSpaceType): boolean {
  const residency = agent.workspaceProfile?.residency;
  const presence = agent.workspaceProfile?.roomPresence;
  if (spaceType === 'office') {
    return Boolean(residency?.office || presence?.autoShowInOffice);
  }
  return Boolean(residency?.meetingRoom || presence?.recommendForMeetingRoom);
}

function getParticipantKind(agent: RoleConfig, spaceType: CollaborationSpaceType): CollaborationMember['participantKind'] {
  const residency = agent.workspaceProfile?.residency;
  if (spaceType === 'office') return residency?.office ? 'resident' : 'recommended';
  return residency?.meetingRoom ? 'resident' : 'recommended';
}

export async function listCollaborationMembers(input?: {
  spaceType?: CollaborationSpaceType | string;
}): Promise<CollaborationMember[]> {
  const spaceType = normalizeSpaceType(input?.spaceType);
  const agentsDir = await getRuntimeAgentsDirPath();
  const files = (await readdir(agentsDir)).filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'));
  const members: CollaborationMember[] = [];

  for (const file of files) {
    try {
      const parsed = parse(await readFile(resolve(agentsDir, file), 'utf-8'));
      const result = roleConfigSchema.safeParse(parsed);
      if (!result.success) continue;
      const agent = { ...result.data, _file: file };
      if (!shouldIncludeAgent(agent, spaceType)) continue;
      members.push({
        agentName: agent.name,
        displayName: getProfileDisplayName(agent),
        nickname: agent.workspaceProfile?.nickname || undefined,
        officeRole: getDefaultOfficeRole(agent),
        participantKind: getParticipantKind(agent, spaceType),
        defaultDirectRoom: agent.workspaceProfile?.residency?.defaultDirectRoom !== false,
        visual: {
          accent: agent.workspaceProfile?.visual?.accent,
          deskVariant: agent.workspaceProfile?.visual?.deskVariant,
          desk: agent.workspaceProfile?.visual?.desk,
          zone: agent.workspaceProfile?.visual?.zone,
          column: agent.workspaceProfile?.visual?.column,
          row: agent.workspaceProfile?.visual?.row,
          order: getDefaultOrder(agent),
        },
        motion: {
          activity: agent.workspaceProfile?.motion?.activity,
          speed: agent.workspaceProfile?.motion?.speed,
        },
        agent,
      });
    } catch {
      // Ignore malformed Agent YAML files; the Agent management page remains the repair surface.
    }
  }

  return members.sort((a, b) => {
    if (a.visual.order !== b.visual.order) return a.visual.order - b.visual.order;
    return a.displayName.localeCompare(b.displayName, 'zh-Hans-CN');
  });
}
