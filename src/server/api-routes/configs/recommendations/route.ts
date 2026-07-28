import { readFile, readdir } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import { requireAuth } from '@/lib/auth/middleware';
import { getRuntimeAgentsDirPath, getRuntimeConfigsDirPath } from '@/lib/run/runtime-configs';
import { findRelevantWorkflowExperiences } from '@/lib/workflow/experience-store';
import { listAgentRelationships } from '@/lib/agent/relationship-store';
import { DEFAULT_SUPERVISOR_NAME } from '@/lib/core/default-supervisor';
import { buildRecommendedAgents } from '@/lib/config/recommendations';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

function normalizeConfigFilename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error('无效工作流文件名');
  }
  return normalized;
}

function getWorkflowMode(config: any): 'phase-based' | 'state-machine' {
  if (config?.workflow?.mode === 'state-machine') return 'state-machine';
  if (Array.isArray(config?.workflow?.states) && !Array.isArray(config?.workflow?.phases)) return 'state-machine';
  return 'phase-based';
}

function normalizeRequestedWorkflowMode(mode?: string): 'phase-based' | 'state-machine' {
  return mode === 'state-machine' || mode === 'ai-guided' ? 'state-machine' : 'phase-based';
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

type AvailableAgentPool = {
  allNames: Set<string>;
  stepNames: Set<string>;
  supervisorNames: Set<string>;
};

function isSupervisorAgentConfig(name: string, config: any): boolean {
  const normalizedName = name.trim().toLowerCase();
  return config?.roleType === 'supervisor'
    || normalizedName === 'supervisor'
    || normalizedName === DEFAULT_SUPERVISOR_NAME.toLowerCase();
}

async function listAvailableAgents(): Promise<AvailableAgentPool> {
  const pool: AvailableAgentPool = {
    allNames: new Set<string>(),
    stepNames: new Set<string>(),
    supervisorNames: new Set<string>(),
  };

  try {
    const agentsDir = await getRuntimeAgentsDirPath();
    const files = await readdir(agentsDir);
    const yamlFiles = files.filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'));

    for (const file of yamlFiles) {
      try {
        const raw = await readFile(resolve(agentsDir, file), 'utf-8');
        const config = parse(raw);
        const fileName = file.replace(/\.(yaml|yml)$/i, '');
        const name = typeof config?.name === 'string' && config.name.trim() ? config.name.trim() : fileName;
        if (!name) continue;
        pool.allNames.add(name);
        if (isSupervisorAgentConfig(name, config)) pool.supervisorNames.add(name);
        else pool.stepNames.add(name);
      } catch {
        // ignore malformed agent config
      }
    }

    return pool;
  } catch {
    return pool;
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

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const workflowName = String(body?.workflowName || '').trim();
    const requirements = String(body?.requirements || '').trim();
    const workingDirectory = String(body?.workingDirectory || '').trim();
    const referenceWorkflow = String(body?.referenceWorkflow || '').trim();
    const workflowMode = normalizeRequestedWorkflowMode(String(body?.workflowMode || '').trim());
    const useHistoricalExperience = body?.useHistoricalExperience !== false;

    const explicitReferenceWorkflow = referenceWorkflow || undefined;

    const relatedExperiences = useHistoricalExperience
      ? await findRelevantWorkflowExperiences({
          workflowName: workflowName || undefined,
          requirements: requirements || undefined,
          projectRoot: workingDirectory || undefined,
          configFile: referenceWorkflow || undefined,
          limit: 4,
        }).catch(() => [])
      : [];

    let inferredReferenceWorkflow: string | undefined;
    let referenceConfig: any | null = null;
    if (explicitReferenceWorkflow) {
      const explicitConfig = await loadReferenceWorkflowConfig(explicitReferenceWorkflow);
      if (explicitConfig && getWorkflowMode(explicitConfig) === workflowMode) {
        inferredReferenceWorkflow = explicitReferenceWorkflow;
        referenceConfig = explicitConfig;
      }
    } else if (useHistoricalExperience) {
      for (const entry of relatedExperiences) {
        const candidate = typeof entry.configFile === 'string' ? entry.configFile.trim() : '';
        if (!candidate) continue;
        const candidateConfig = await loadReferenceWorkflowConfig(candidate);
        if (candidateConfig && getWorkflowMode(candidateConfig) === workflowMode) {
          inferredReferenceWorkflow = candidate;
          referenceConfig = candidateConfig;
          break;
        }
      }
    }
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
    const recommendedAgents = availableAgents.allNames.size > 0 && availableAgents.stepNames.size === 0
      ? []
      : buildRecommendedAgents({
          availableAgents: availableAgents.stepNames,
          referenceAgents,
          relationshipHints,
        });
    const recommendedSupervisorAgent = (() => {
      const supervisorAgent = collectReferenceSupervisorAgent(referenceConfig);
      if (supervisorAgent && (availableAgents.allNames.size === 0 || availableAgents.supervisorNames.has(supervisorAgent))) {
        return supervisorAgent;
      }
      return availableAgents.supervisorNames.has(DEFAULT_SUPERVISOR_NAME) || availableAgents.allNames.size === 0
        ? DEFAULT_SUPERVISOR_NAME
        : undefined;
    })();

    return jsonOk({
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
          mode: getWorkflowMode(referenceConfig),
          agents: referenceAgents,
          supervisorAgent: collectReferenceSupervisorAgent(referenceConfig),
          source: explicitReferenceWorkflow ? 'manual' : 'recommended-experience',
          autoApply: !explicitReferenceWorkflow,
        } : null,
        recommendedAgents,
        recommendedSupervisorAgent,
        availableStepAgents: [...availableAgents.stepNames],
        availableSupervisorAgents: [...availableAgents.supervisorNames],
        relationshipHints: relationshipHints.slice(0, 8),
      },
    });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '获取编排推荐失败', 500);
  }
}
