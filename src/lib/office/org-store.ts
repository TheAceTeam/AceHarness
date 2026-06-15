import { mkdir, readFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { dirname } from 'path';
import { z } from 'zod';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { applyOfficeTeamPlan, type OfficeTeamProfileAssignment, type OfficeTeamState } from '@/lib/office/team-store';
import { generateOfficeTeamPlan, type OfficeTeamPlan, type OfficeZone } from '@/lib/office/team-planner';

const officeOrgStatusSchema = z.enum(['draft', 'current', 'archived']);
const officeOrgGenerationModeSchema = z.enum(['ai', 'manual', 'heuristic']);

const officeOrgNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  zone: z.string().optional(),
  reportsTo: z.string().nullable().optional(),
  responsibilities: z.array(z.string()).default([]),
  agentName: z.string().optional(),
  candidateAgentNames: z.array(z.string()).default([]),
  vacancy: z.boolean().default(false),
  evidence: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  locked: z.boolean().optional(),
});

const officeOrgEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(['reports_to', 'collaborates_with']).default('reports_to'),
});

const officeOrgGapSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  zone: z.string().optional(),
  severity: z.enum(['info', 'warning', 'critical']).default('warning'),
});

const officeOrgRecordSchema = z.object({
  id: z.string(),
  status: officeOrgStatusSchema.default('draft'),
  revision: z.number().int().min(0).default(0),
  requirement: z.string().default(''),
  nodes: z.array(officeOrgNodeSchema).default([]),
  edges: z.array(officeOrgEdgeSchema).default([]),
  gaps: z.array(officeOrgGapSchema).default([]),
  generationTrace: z.object({
    mode: officeOrgGenerationModeSchema.default('manual'),
    sourcePlanId: z.string().optional(),
    restoredFromVersionId: z.string().optional(),
    clarificationAnswers: z.record(z.string(), z.unknown()).default({}),
    model: z.string().optional(),
    createdAt: z.number(),
  }),
  createdAt: z.number(),
  updatedAt: z.number(),
  appliedAt: z.number().optional(),
});

const officeOrgStoreSchema = z.object({
  version: z.literal(1).default(1),
  currentOrgId: z.string().optional(),
  drafts: z.array(officeOrgRecordSchema).default([]),
  versions: z.array(officeOrgRecordSchema).default([]),
});

export type OfficeOrgNode = z.infer<typeof officeOrgNodeSchema>;
export type OfficeOrgEdge = z.infer<typeof officeOrgEdgeSchema>;
export type OfficeOrgGap = z.infer<typeof officeOrgGapSchema>;
export type OfficeOrgRecord = z.infer<typeof officeOrgRecordSchema>;

interface OfficeOrgStore {
  version: 1;
  currentOrgId?: string;
  drafts: OfficeOrgRecord[];
  versions: OfficeOrgRecord[];
}

const ZONE_TITLES: Record<string, string> = {
  core: 'CEO / Founder',
  product: 'Product Lead',
  design: 'Design Lead',
  engineering: 'Engineering Lead',
  growth: 'Growth Lead',
  operations: 'Operations Lead',
  quality: 'Quality Lead',
  decision: 'Decision Lead',
  knowledge: 'Knowledge Lead',
  generalist: 'Generalist',
};

function storePath(): string {
  return getWorkspaceDataFile('office', 'org-store.json');
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function nodeIdFor(zone: string, agentName?: string): string {
  const base = `${zone}-${agentName || createId('vacancy')}`
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return base || createId('node');
}

function zoneTitle(zone: string): string {
  return ZONE_TITLES[zone] || zone || 'Team Member';
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

async function readOrgStore(): Promise<OfficeOrgStore> {
  const parsed = officeOrgStoreSchema.safeParse(await readJsonFile<unknown>(storePath()));
  return parsed.success ? parsed.data : { version: 1, drafts: [], versions: [] };
}

async function saveOrgStore(store: OfficeOrgStore): Promise<void> {
  const filePath = storePath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

function cloneOrg(org: OfficeOrgRecord): OfficeOrgRecord {
  return {
    ...org,
    nodes: org.nodes.map((node) => ({ ...node, responsibilities: [...node.responsibilities], candidateAgentNames: [...node.candidateAgentNames], evidence: [...node.evidence], risks: [...node.risks] })),
    edges: org.edges.map((edge) => ({ ...edge })),
    gaps: org.gaps.map((gap) => ({ ...gap })),
    generationTrace: {
      ...org.generationTrace,
      clarificationAnswers: { ...org.generationTrace.clarificationAnswers },
    },
  };
}

function unique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function normalizeNode(input: Partial<OfficeOrgNode>, fallbackId?: string): OfficeOrgNode {
  const agentName = normalizeText(input.agentName) || undefined;
  const zone = normalizeText(input.zone) || undefined;
  const vacancy = input.vacancy ?? !agentName;
  return {
    id: normalizeText(input.id) || fallbackId || nodeIdFor(zone || 'generalist', agentName),
    title: normalizeText(input.title) || zoneTitle(zone || 'generalist'),
    zone,
    reportsTo: input.reportsTo === null ? null : normalizeText(input.reportsTo) || undefined,
    responsibilities: unique(input.responsibilities || []),
    agentName,
    candidateAgentNames: unique(input.candidateAgentNames || (agentName ? [agentName] : [])),
    vacancy,
    evidence: unique(input.evidence || []),
    risks: unique(input.risks || []),
    locked: input.locked,
  };
}

function ensureOrgEdges(nodes: OfficeOrgNode[], edges?: OfficeOrgEdge[]): OfficeOrgEdge[] {
  if (edges?.length) {
    return edges
      .map((edge) => ({
        from: normalizeText(edge.from),
        to: normalizeText(edge.to),
        kind: edge.kind || 'reports_to' as const,
      }))
      .filter((edge) => edge.from && edge.to && edge.from !== edge.to);
  }

  const root = nodes.find((node) => node.zone === 'core') || nodes[0];
  if (!root) return [];
  return nodes
    .filter((node) => node.id !== root.id)
    .map((node) => ({
      from: root.id,
      to: node.id,
      kind: 'reports_to' as const,
    }));
}

function applyReportsToFromEdges(nodes: OfficeOrgNode[], edges: OfficeOrgEdge[]): OfficeOrgNode[] {
  const reportsTo = new Map(edges.filter((edge) => edge.kind === 'reports_to').map((edge) => [edge.to, edge.from]));
  return nodes.map((node) => ({
    ...node,
    reportsTo: node.reportsTo === null ? null : node.reportsTo || reportsTo.get(node.id) || null,
  }));
}

function nodesFromPlan(plan: OfficeTeamPlan): OfficeOrgNode[] {
  const nodes = plan.members.map((member, index) => {
    const zone = member.zone || 'generalist';
    return normalizeNode({
      id: nodeIdFor(zone, member.agentName),
      title: zoneTitle(zone),
      zone,
      reportsTo: zone === 'core' ? null : undefined,
      responsibilities: [
        `${zoneTitle(zone)}：围绕当前目标承担对应职责`,
      ],
      agentName: member.agentName,
      candidateAgentNames: [member.agentName],
      vacancy: false,
      evidence: member.matchReasons.length ? member.matchReasons : [`匹配 ${zoneTitle(zone)}`],
      risks: [],
    }, `node-${index + 1}`);
  });

  const existingZones = new Set(nodes.map((node) => node.zone));
  for (const zone of plan.missingZones) {
    if (!zone || existingZones.has(zone)) continue;
    nodes.push(normalizeNode({
      id: `vacancy-${zone}`,
      title: zoneTitle(zone),
      zone,
      responsibilities: [`补齐 ${zoneTitle(zone)} 职责`],
      vacancy: true,
      candidateAgentNames: [],
      risks: [`当前没有匹配 ${zoneTitle(zone)} 的可用 Agent`],
    }));
  }

  return nodes;
}

function gapsFromPlan(plan: OfficeTeamPlan): OfficeOrgGap[] {
  return plan.missingZones.map((zone) => ({
    id: `gap-${zone}`,
    title: `${zoneTitle(zone)} 空缺`,
    description: `当前目标缺少 ${zoneTitle(zone)} 角色的可用 Agent。`,
    zone,
    severity: 'warning' as const,
  }));
}

export async function createOfficeOrgDraft(input: {
  requirement?: string;
  plan?: OfficeTeamPlan;
  nodes?: Array<Partial<OfficeOrgNode>>;
  edges?: OfficeOrgEdge[];
  gaps?: OfficeOrgGap[];
  mode?: 'manual' | 'heuristic' | 'ai';
  clarificationAnswers?: Record<string, unknown>;
  model?: string;
}): Promise<OfficeOrgRecord> {
  const requirement = normalizeText(input.requirement || input.plan?.requirement);
  let sourcePlan = input.plan;
  if (!input.nodes?.length && !sourcePlan) {
    if (!requirement) throw new Error('请先输入目标');
    sourcePlan = await generateOfficeTeamPlan({ requirement });
  }

  const now = Date.now();
  const rawNodes = input.nodes?.length
    ? input.nodes.map((node, index) => normalizeNode(node, `node-${index + 1}`))
    : sourcePlan
      ? nodesFromPlan(sourcePlan)
      : [];
  if (!rawNodes.length) throw new Error('组织草案至少需要一个岗位');

  const edges = ensureOrgEdges(rawNodes, input.edges);
  const nodes = applyReportsToFromEdges(rawNodes, edges);
  const draft: OfficeOrgRecord = {
    id: createId('org'),
    status: 'draft',
    revision: 0,
    requirement,
    nodes,
    edges,
    gaps: input.gaps || (sourcePlan ? gapsFromPlan(sourcePlan) : []),
    generationTrace: {
      mode: input.mode || (sourcePlan ? 'heuristic' : 'manual'),
      sourcePlanId: sourcePlan?.id,
      clarificationAnswers: input.clarificationAnswers || {},
      model: input.model,
      createdAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };

  const store = await readOrgStore();
  store.drafts.unshift(draft);
  await saveOrgStore(store);
  return cloneOrg(draft);
}

export async function updateOfficeOrgDraft(id: string, patch: {
  requirement?: string;
  nodes?: Array<Partial<OfficeOrgNode>>;
  edges?: OfficeOrgEdge[];
  gaps?: OfficeOrgGap[];
  clarificationAnswers?: Record<string, unknown>;
}): Promise<OfficeOrgRecord> {
  const store = await readOrgStore();
  const index = store.drafts.findIndex((draft) => draft.id === id);
  if (index < 0) throw new Error('组织草案不存在');
  const current = store.drafts[index];
  if (current.status !== 'draft') throw new Error('只能修改草案状态的组织配置');

  const rawNodes = patch.nodes
    ? patch.nodes.map((node, nodeIndex) => normalizeNode(node, `node-${nodeIndex + 1}`))
    : current.nodes;
  const edges = patch.edges ? ensureOrgEdges(rawNodes, patch.edges) : current.edges;
  const nodes = patch.nodes || patch.edges ? applyReportsToFromEdges(rawNodes, edges) : rawNodes;
  const next: OfficeOrgRecord = {
    ...current,
    requirement: patch.requirement === undefined ? current.requirement : normalizeText(patch.requirement),
    nodes,
    edges,
    gaps: patch.gaps || current.gaps,
    generationTrace: {
      ...current.generationTrace,
      clarificationAnswers: patch.clarificationAnswers || current.generationTrace.clarificationAnswers,
    },
    updatedAt: Date.now(),
  };

  store.drafts[index] = next;
  await saveOrgStore(store);
  return cloneOrg(next);
}

function assignmentsFromOrg(org: OfficeOrgRecord): OfficeTeamProfileAssignment[] {
  return org.nodes
    .filter((node) => !node.vacancy && node.agentName)
    .map((node, index) => ({
      agentName: node.agentName as string,
      officeRole: node.title,
      zone: node.zone,
      order: index + 1,
    }));
}

export async function applyOfficeOrgDraft(input: {
  draftId?: string;
  org?: OfficeOrgRecord;
}): Promise<{ org: OfficeOrgRecord; teamState: OfficeTeamState }> {
  const store = await readOrgStore();
  const draftIndex = input.draftId
    ? store.drafts.findIndex((draft) => draft.id === input.draftId)
    : -1;
  const source = input.org || (draftIndex >= 0 ? store.drafts[draftIndex] : null);
  if (!source) throw new Error('组织草案不存在');

  const assignments = assignmentsFromOrg(source);
  if (!assignments.length) throw new Error('组织草案没有可应用的 Agent');

  const teamState = await applyOfficeTeamPlan({
    requirement: source.requirement,
    agentNames: assignments.map((assignment) => assignment.agentName),
    assignments,
  });

  const now = Date.now();
  const nextRevision = Math.max(0, ...store.versions.map((item) => item.revision || 0)) + 1;
  const currentOrg: OfficeOrgRecord = {
    ...source,
    status: 'current',
    revision: nextRevision,
    updatedAt: now,
    appliedAt: now,
  };

  store.drafts = store.drafts.map((draft) => {
    if (draft.id === currentOrg.id) return currentOrg;
    if (draft.status === 'current') return { ...draft, status: 'archived' as const, updatedAt: now };
    return draft;
  });
  if (draftIndex < 0) store.drafts.unshift(currentOrg);
  store.currentOrgId = currentOrg.id;
  store.versions.unshift(currentOrg);
  await saveOrgStore(store);

  return { org: cloneOrg(currentOrg), teamState };
}

export async function getCurrentOfficeOrg(): Promise<OfficeOrgRecord | null> {
  const store = await readOrgStore();
  const current = store.currentOrgId
    ? store.drafts.find((draft) => draft.id === store.currentOrgId)
    : store.drafts.find((draft) => draft.status === 'current');
  return current ? cloneOrg(current) : null;
}

export async function listOfficeOrgVersions(): Promise<OfficeOrgRecord[]> {
  const store = await readOrgStore();
  return store.versions
    .slice()
    .sort((a, b) => (b.appliedAt || b.updatedAt) - (a.appliedAt || a.updatedAt))
    .map(cloneOrg);
}

export async function getOfficeOrgDraft(id: string): Promise<OfficeOrgRecord | null> {
  const store = await readOrgStore();
  const draft = store.drafts.find((item) => item.id === id);
  return draft ? cloneOrg(draft) : null;
}

export async function restoreOfficeOrgVersion(versionId: string): Promise<{ org: OfficeOrgRecord; teamState: OfficeTeamState }> {
  const store = await readOrgStore();
  const source = store.versions.find((version) => version.id === versionId || String(version.revision) === versionId);
  if (!source) throw new Error('组织版本不存在');

  const now = Date.now();
  const restored: OfficeOrgRecord = {
    ...source,
    id: createId('org'),
    status: 'draft',
    revision: 0,
    generationTrace: {
      ...source.generationTrace,
      mode: 'manual',
      restoredFromVersionId: source.id,
      createdAt: now,
    },
    createdAt: now,
    updatedAt: now,
    appliedAt: undefined,
  };

  return applyOfficeOrgDraft({ org: restored });
}

export function getOfficeOrgZoneTitle(zone: OfficeZone | string): string {
  return zoneTitle(zone);
}
