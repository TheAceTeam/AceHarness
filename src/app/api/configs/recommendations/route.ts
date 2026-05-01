import { NextRequest, NextResponse } from 'next/server';
import { readFile, readdir } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import { requireAuth } from '@/lib/auth-middleware';
import { getRuntimeAgentsDirPath, getRuntimeConfigsDirPath } from '@/lib/runtime-configs';
import { findRelevantWorkflowExperiences } from '@/lib/workflow-experience-store';
import { listAgentRelationships } from '@/lib/agent-relationship-store';
import { DEFAULT_SUPERVISOR_NAME } from '@/lib/default-supervisor';
import { buildRecommendedAgents } from '@/lib/config-recommendations';

function normalizeConfigFilename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error('无效工作流文件名');
  }
  return normalized;
}

async function loadReferenceWorkflowConfig(filename: string): Promise<any | null> {
  try {
    const referencePath = resolve(await getRuntimeConfigsDirPath(), normalizeConfigFilename(filename));
    const raw = await readFile(referencePath, 'utf-8');
    return parse(raw);
  } catch {
    return null;
  }
}

async function listAvailableAgents(): Promise<Set<string>> {
  try {
    const agentsDir = await getRuntimeAgentsDirPath();
    const files = await readdir(agentsDir);
    const yamlFiles = files.filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'));
    const names = new Set<string>();

    for (const file of yamlFiles) {
      try {
        const raw = await readFile(resolve(agentsDir, file), 'utf-8');
        const config = parse(raw);
        const name = typeof config?.name === 'string' ? config.name.trim() : '';
        if (name) names.add(name);
      } catch {
        // ignore malformed agent config
      }
    }

    return names;
  } catch {
    return new Set<string>();
  }
}

function collectWorkflowAgents(referenceConfig: any): string[] {
  const names = new Set<string>();
  const phases = Array.isArray(referenceConfig?.workflow?.phases) ? referenceConfig.workflow.phases : [];
  const states = Array.isArray(referenceConfig?.workflow?.states) ? referenceConfig.workflow.states : [];

  for (const phase of phases) {
    for (const step of phase?.steps || []) {
      if (typeof step?.agent === 'string' && step.agent.trim()) names.add(step.agent.trim());
    }
  }
  for (const state of states) {
    for (const step of state?.steps || []) {
      if (typeof step?.agent === 'string' && step.agent.trim()) names.add(step.agent.trim());
    }
  }

  return Array.from(names);
}

function collectReferenceSupervisorAgent(referenceConfig: any): string | undefined {
  const agent = referenceConfig?.workflow?.supervisor?.agent;
  return typeof agent === 'string' && agent.trim() ? agent.trim() : undefined;
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const workflowName = String(body?.workflowName || '').trim();
    const requirements = String(body?.requirements || '').trim();
    const workingDirectory = String(body?.workingDirectory || '').trim();
    const referenceWorkflow = String(body?.referenceWorkflow || '').trim();

    const explicitReferenceWorkflow = referenceWorkflow || undefined;

    const relatedExperiences = await findRelevantWorkflowExperiences({
      workflowName: workflowName || undefined,
      requirements: requirements || undefined,
      projectRoot: workingDirectory || undefined,
      configFile: referenceWorkflow || undefined,
      limit: 4,
    }).catch(() => []);

    const inferredReferenceWorkflow = explicitReferenceWorkflow
      ? explicitReferenceWorkflow
      : relatedExperiences
          .map((entry) => entry.configFile)
          .find((filename) => typeof filename === 'string' && filename.trim().length > 0);

    const referenceConfig = inferredReferenceWorkflow
      ? await loadReferenceWorkflowConfig(inferredReferenceWorkflow)
      : null;
    const availableAgents = await listAvailableAgents();

    const referenceAgents = referenceConfig ? collectWorkflowAgents(referenceConfig).slice(0, 8) : [];
    const relationshipHints = (await Promise.all(
      referenceAgents.map(async (agentName) => {
        const relations = await listAgentRelationships(agentName, 4).catch(() => []);
        return relations
          .filter((item) => referenceAgents.includes(item.counterpart))
          .slice(0, 2)
          .map((item) => ({
            agent: agentName,
            counterpart: item.counterpart,
            synergyScore: item.synergyScore,
            strengths: item.strengths.slice(0, 2),
            lastConfigFile: item.lastConfigFile,
          }));
      })
    )).flat();
    const recommendedAgents = buildRecommendedAgents({
      availableAgents,
      referenceAgents,
      relationshipHints,
    });
    const recommendedSupervisorAgent = (() => {
      const supervisorAgent = collectReferenceSupervisorAgent(referenceConfig);
      if (supervisorAgent && (availableAgents.size === 0 || availableAgents.has(supervisorAgent))) {
        return supervisorAgent;
      }
      return availableAgents.has(DEFAULT_SUPERVISOR_NAME) || availableAgents.size === 0
        ? DEFAULT_SUPERVISOR_NAME
        : undefined;
    })();

    return NextResponse.json({
      recommendations: {
        experiences: relatedExperiences.map((entry) => ({
          runId: entry.runId,
          workflowName: entry.workflowName,
          configFile: entry.configFile,
          summary: entry.summary,
          experience: entry.experience.slice(0, 2),
          nextFocus: entry.nextFocus.slice(0, 1),
        })),
        referenceWorkflow: inferredReferenceWorkflow && referenceConfig ? {
          filename: inferredReferenceWorkflow,
          name: referenceConfig?.workflow?.name,
          description: referenceConfig?.workflow?.description,
          mode: referenceConfig?.workflow?.mode === 'state-machine' ? 'state-machine' : 'phase-based',
          agents: referenceAgents,
          supervisorAgent: collectReferenceSupervisorAgent(referenceConfig),
          source: explicitReferenceWorkflow ? 'manual' : 'recommended-experience',
          autoApply: !explicitReferenceWorkflow,
        } : null,
        recommendedAgents,
        recommendedSupervisorAgent,
        relationshipHints: relationshipHints.slice(0, 8),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '获取编排推荐失败' },
      { status: 500 }
    );
  }
}
