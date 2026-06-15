import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import { roleConfigSchema, type RoleConfig } from '@/lib/core/schemas';
import { getRuntimeAgentsDirPath } from '@/lib/run/runtime-configs';

export type OfficeZone =
  | 'core'
  | 'product'
  | 'design'
  | 'engineering'
  | 'growth'
  | 'operations'
  | 'quality'
  | 'decision'
  | 'knowledge'
  | 'generalist';

export interface OfficeTeamPlanMember {
  agentName: string;
  displayName: string;
  zone: OfficeZone;
  officeRole: string;
  score: number;
  matchReasons: string[];
  agent: RoleConfig & { _file?: string };
}

export interface OfficeTeamPlan {
  id: string;
  requirement: string;
  generatedAt: number;
  members: OfficeTeamPlanMember[];
  missingZones: OfficeZone[];
  availableAgentCount: number;
}

const REQUIRED_ZONES: OfficeZone[] = ['core', 'product', 'design', 'engineering', 'quality', 'decision'];

const CATEGORY_ZONE: Record<string, OfficeZone> = {
  总裁: 'core',
  产品: 'product',
  设计: 'design',
  架构: 'design',
  编码: 'engineering',
  开发: 'engineering',
  增长: 'growth',
  运营: 'operations',
  性能: 'quality',
  测试: 'quality',
  裁定: 'decision',
  审查: 'decision',
  审计: 'decision',
  文档: 'knowledge',
  文案: 'knowledge',
};

const ZONE_KEYWORDS: Record<OfficeZone, RegExp[]> = {
  core: [/ceo/i, /founder/i, /supervisor/i, /总裁|创始|负责人|协调|决策/],
  product: [/product/i, /产品|需求|用户|路线图|价值/],
  design: [/design/i, /architect/i, /设计|交互|视觉|体验|架构|方案/],
  engineering: [/develop/i, /code/i, /fix/i, /工程|开发|代码|实现|构建/],
  growth: [/growth/i, /增长|市场|获客|转化|内容/],
  operations: [/ops/i, /operation/i, /运营|流程|自动化|效率/],
  quality: [/test/i, /hunter/i, /breaker/i, /performance/i, /测试|质量|性能|验证|风险/],
  decision: [/judge/i, /review/i, /auditor/i, /裁定|评审|审查|判断/],
  knowledge: [/doc/i, /writer/i, /copy/i, /文档|知识|说明|总结|文案/],
  generalist: [/general/i, /通才|综合|助手/],
};

function normalizeRequirement(requirement: string): string {
  return requirement.trim().replace(/\s+/g, ' ');
}

function normalizeAgentName(value: unknown): string {
  return String(value || '').trim();
}

function normalizeCandidateAgentNames(values: unknown): Set<string> | null {
  if (!Array.isArray(values)) return null;
  const names = values.map(normalizeAgentName).filter(Boolean);
  return names.length ? new Set(names) : null;
}

function displayName(agent: RoleConfig): string {
  return (
    agent.workspaceProfile?.nickname
    || agent.workspaceProfile?.displayName
    || agent.title
    || agent.name
  ).trim();
}

export function inferOfficeZone(agent: RoleConfig): OfficeZone {
  const explicit = agent.workspaceProfile?.visual?.zone;
  if (explicit && explicit in ZONE_KEYWORDS) return explicit as OfficeZone;
  if (agent.category && CATEGORY_ZONE[agent.category]) return CATEGORY_ZONE[agent.category];
  const text = [
    agent.name,
    agent.title,
    agent.category,
    ...(agent.tags || []),
    ...(agent.specialtyTags || []),
    ...(agent.capabilities || []),
    agent.description,
  ].filter(Boolean).join(' ');
  for (const zone of REQUIRED_ZONES.concat(['growth', 'operations', 'knowledge', 'generalist'] as OfficeZone[])) {
    if (ZONE_KEYWORDS[zone].some((pattern) => pattern.test(text))) return zone;
  }
  return 'generalist';
}

async function listRuntimeAgents(): Promise<Array<RoleConfig & { _file?: string }>> {
  const agentsDir = await getRuntimeAgentsDirPath();
  const files = (await readdir(agentsDir)).filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'));
  const agents: Array<RoleConfig & { _file?: string }> = [];
  for (const file of files) {
    try {
      const parsed = parse(await readFile(resolve(agentsDir, file), 'utf-8'));
      const result = roleConfigSchema.safeParse(parsed);
      if (result.success) agents.push({ ...result.data, _file: file });
    } catch {
      // Malformed agents stay visible in Agent management, but are ignored by team planning.
    }
  }
  return agents;
}

function scoreAgent(agent: RoleConfig, requirement: string): { score: number; reasons: string[] } {
  const zone = inferOfficeZone(agent);
  const text = [
    agent.name,
    agent.title,
    agent.category,
    ...(agent.tags || []),
    ...(agent.specialtyTags || []),
    ...(agent.capabilities || []),
    ...(agent.skills || []),
    agent.description,
  ].filter(Boolean).join(' ').toLowerCase();
  const query = requirement.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  for (const token of query.split(/[\s,，。；;、/\\|]+/).filter((item) => item.length >= 2)) {
    if (text.includes(token)) {
      score += 4;
      if (reasons.length < 4) reasons.push(token);
    }
  }

  for (const pattern of ZONE_KEYWORDS[zone]) {
    if (pattern.test(requirement)) {
      score += zone === 'core' ? 2 : 8;
      reasons.push(zone);
      break;
    }
  }

  if (agent.workspaceProfile?.residency?.office) score += 2;
  if (agent.workspaceProfile?.roomPresence?.autoShowInOffice) score += 1;
  if (zone === 'core') score += 3;
  if (zone === 'generalist') score += 1;
  return { score, reasons: [...new Set(reasons)].slice(0, 4) };
}

function memberFromAgent(agent: RoleConfig & { _file?: string }, requirement: string): OfficeTeamPlanMember {
  const zone = inferOfficeZone(agent);
  const scored = scoreAgent(agent, requirement);
  return {
    agentName: agent.name,
    displayName: displayName(agent),
    zone,
    officeRole: agent.workspaceProfile?.officeRole || zone,
    score: scored.score,
    matchReasons: scored.reasons,
    agent,
  };
}

export async function generateOfficeTeamPlan(input: {
  requirement: string;
  maxMembers?: number;
  minMembers?: number;
  candidateAgentNames?: string[];
}): Promise<OfficeTeamPlan> {
  const requirement = normalizeRequirement(input.requirement);
  if (!requirement) {
    throw new Error('请先输入目标');
  }

  const maxMembers = Math.min(Math.max(input.maxMembers ?? 6, 1), 12);
  const minMembers = Math.min(Math.max(input.minMembers ?? 4, 1), maxMembers);
  const candidateNameSet = normalizeCandidateAgentNames(input.candidateAgentNames);
  const runtimeAgents = await listRuntimeAgents();
  const scopedAgents = candidateNameSet
    ? runtimeAgents.filter((agent) => candidateNameSet.has(agent.name))
    : runtimeAgents;
  const candidates = scopedAgents.map((agent) => memberFromAgent(agent, requirement));
  if (candidateNameSet && candidates.length === 0) {
    throw new Error('筛选范围内没有可用于组建团队的 Agent');
  }
  const selected = new Map<string, OfficeTeamPlanMember>();

  for (const zone of REQUIRED_ZONES) {
    const best = candidates
      .filter((member) => member.zone === zone)
      .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'))[0];
    if (best) selected.set(best.agentName, best);
  }

  for (const member of [...candidates].sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'))) {
    if (selected.size >= maxMembers) break;
    selected.set(member.agentName, member);
  }

  const members = [...selected.values()]
    .sort((a, b) => {
      const orderA = a.agent.workspaceProfile?.visual?.order ?? 999;
      const orderB = b.agent.workspaceProfile?.visual?.order ?? 999;
      return orderA - orderB || b.score - a.score || a.displayName.localeCompare(b.displayName, 'zh-Hans-CN');
    })
    .slice(0, Math.max(minMembers, Math.min(maxMembers, selected.size)));

  const selectedZones = new Set(members.map((member) => member.zone));
  return {
    id: `office-plan-${Date.now().toString(36)}`,
    requirement,
    generatedAt: Date.now(),
    members,
    missingZones: REQUIRED_ZONES.filter((zone) => !selectedZones.has(zone)),
    availableAgentCount: candidates.length,
  };
}
