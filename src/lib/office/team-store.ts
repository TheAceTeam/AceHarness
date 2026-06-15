import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { agentWorkspaceProfileSchema, roleConfigSchema } from '@/lib/core/schemas';
import { getRuntimeAgentConfigPath } from '@/lib/run/runtime-configs';
import { generateOfficeTeamPlan, inferOfficeZone, type OfficeTeamPlan } from '@/lib/office/team-planner';

const officeTeamStateSchema = z.object({
  version: z.literal(1),
  requirement: z.string(),
  planId: z.string().optional(),
  activeAgentNames: z.array(z.string()).default([]),
  appliedAt: z.number(),
  updatedAt: z.number(),
});

export type OfficeTeamState = z.infer<typeof officeTeamStateSchema>;

export interface OfficeTeamProfileAssignment {
  agentName: string;
  displayName?: string;
  officeRole?: string;
  zone?: string;
  order?: number;
}

function statePath(): string {
  return getWorkspaceDataFile('office', 'team-state.json');
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export async function getCurrentOfficeTeam(): Promise<OfficeTeamState | null> {
  const parsed = officeTeamStateSchema.safeParse(await readJsonFile<unknown>(statePath()));
  return parsed.success ? parsed.data : null;
}

async function saveCurrentOfficeTeam(state: OfficeTeamState): Promise<OfficeTeamState> {
  const filePath = statePath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
  return state;
}

async function updateAgentOfficeProfile(
  agentName: string,
  active: boolean,
  order: number,
  assignment?: OfficeTeamProfileAssignment
): Promise<void> {
  const filepath = await getRuntimeAgentConfigPath(agentName);
  const current = parse(await readFile(filepath, 'utf-8'));
  const agentResult = roleConfigSchema.safeParse(current);
  if (!agentResult.success) {
    throw new Error(`Agent ${agentName} 配置不可用`);
  }
  const agent = agentResult.data;
  const currentProfile = agent.workspaceProfile || {};
  const zone = assignment?.zone || currentProfile.visual?.zone || inferOfficeZone(agent);
  const nextProfile = {
    ...currentProfile,
    displayName: currentProfile.displayName || assignment?.displayName || agent.title || agent.name,
    nickname: currentProfile.nickname || currentProfile.displayName || agent.title || agent.name,
    officeRole: assignment?.officeRole || currentProfile.officeRole || zone,
    residency: {
      ...(currentProfile.residency || {}),
      office: active,
      defaultDirectRoom: currentProfile.residency?.defaultDirectRoom ?? true,
    },
    roomPresence: {
      ...(currentProfile.roomPresence || {}),
      autoShowInOffice: active,
      recommendForMeetingRoom: currentProfile.roomPresence?.recommendForMeetingRoom ?? true,
    },
    visual: {
      ...(currentProfile.visual || {}),
      zone,
      order: assignment?.order ?? currentProfile.visual?.order ?? order,
    },
    motion: {
      ...(currentProfile.motion || {}),
      activity: currentProfile.motion?.activity || (zone === 'core' ? 'presenting' : zone === 'product' ? 'thinking' : zone === 'design' ? 'talking' : zone === 'quality' || zone === 'decision' ? 'reviewing' : 'typing'),
      speed: currentProfile.motion?.speed || 1,
    },
    memory: currentProfile.memory,
  };
  const profileResult = agentWorkspaceProfileSchema.safeParse(nextProfile);
  if (!profileResult.success) throw new Error(`Agent ${agentName} 协作空间配置不可用`);
  await writeFile(filepath, stringify({ ...current, workspaceProfile: profileResult.data }), 'utf-8');
}

export async function applyOfficeTeamPlan(input: {
  plan?: OfficeTeamPlan;
  requirement?: string;
  agentNames?: string[];
  assignments?: OfficeTeamProfileAssignment[];
}): Promise<OfficeTeamState> {
  const plan = input.plan || await generateOfficeTeamPlan({
    requirement: input.requirement || '',
    maxMembers: input.agentNames?.length || undefined,
  });
  const selectedNames = input.agentNames?.length
    ? input.agentNames
    : input.assignments?.length
      ? input.assignments.map((assignment) => assignment.agentName)
      : plan.members.map((member) => member.agentName);
  if (!selectedNames.length) throw new Error('没有可加入办公室的成员');

  const previous = await getCurrentOfficeTeam();
  const selectedSet = new Set(selectedNames);
  const previousNames = previous?.activeAgentNames || [];
  const toUpdate = [...new Set([...selectedNames, ...previousNames])];
  const assignmentMap = new Map((input.assignments || []).map((assignment) => [assignment.agentName, assignment]));

  await Promise.all(toUpdate.map((agentName, index) => {
    const selectedIndex = selectedNames.indexOf(agentName);
    const order = selectedIndex >= 0 ? selectedIndex + 1 : index + 1;
    return updateAgentOfficeProfile(agentName, selectedSet.has(agentName), order, assignmentMap.get(agentName));
  }));

  return saveCurrentOfficeTeam({
    version: 1,
    requirement: plan.requirement,
    planId: plan.id,
    activeAgentNames: selectedNames,
    appliedAt: Date.now(),
    updatedAt: Date.now(),
  });
}
