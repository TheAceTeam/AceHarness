import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { describe, expect, test, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { withTempDir } from './helpers/module-helpers';

function agent(input: Record<string, any>) {
  return {
    name: input.name,
    team: input.team || 'blue',
    roleType: input.roleType || 'normal',
    title: input.title || input.name,
    engineModels: {},
    activeEngine: '',
    capabilities: input.capabilities || ['协作'],
    systemPrompt: input.systemPrompt || `你是 ${input.name}。`,
    category: input.category,
    tags: input.tags || [],
    skills: input.skills || [],
    workspaceProfile: input.workspaceProfile,
  };
}

async function writeAgent(agentsDir: string, input: Record<string, any>) {
  await writeFile(path.join(agentsDir, `${input.name}.yaml`), stringify(agent(input)), 'utf-8');
}

describe('office team planning', () => {
  test('generates a team plan from runtime Agent YAML instead of hardcoded members', async () => {
    await withTempDir('aceharness-office-team-plan-', async (dir) => {
      const agentsDir = path.join(dir, 'agents');
      await mkdir(agentsDir, { recursive: true });
      await writeAgent(agentsDir, {
        name: 'ceo_founder',
        title: '总裁',
        team: 'black-gold',
        category: '总裁',
        capabilities: ['方向和决策'],
      });
      await writeAgent(agentsDir, {
        name: 'product-manager',
        category: '产品',
        capabilities: ['需求分析', '用户价值'],
      });
      await writeAgent(agentsDir, {
        name: 'developer',
        category: '开发',
        capabilities: ['代码实现'],
      });
      await writeAgent(agentsDir, {
        name: 'code-judge',
        team: 'judge',
        category: '裁定',
        capabilities: ['评审裁定'],
      });

      vi.resetModules();
      vi.doMock('@/lib/run/runtime-configs', () => ({
        getRuntimeAgentsDirPath: async () => agentsDir,
      }));

      const { generateOfficeTeamPlan } = await import('@/lib/office/team-planner');
      const plan = await generateOfficeTeamPlan({ requirement: '做一个 App，需要产品、开发和评审', maxMembers: 4 });

      expect(plan.availableAgentCount).toBe(4);
      expect(plan.members.map((member) => member.agentName)).toEqual(
        expect.arrayContaining(['ceo_founder', 'product-manager', 'developer', 'code-judge'])
      );
      expect(plan.members.map((member) => member.zone)).toEqual(
        expect.arrayContaining(['core', 'product', 'engineering', 'decision'])
      );
    });
  });

  test('applying a team updates office profile without dropping unrelated Agent fields', async () => {
    await withTempDir('aceharness-office-team-apply-', async (dir) => {
      const agentsDir = path.join(dir, 'agents');
      const dataDir = path.join(dir, 'data');
      await mkdir(agentsDir, { recursive: true });
      await mkdir(dataDir, { recursive: true });
      await writeAgent(agentsDir, {
        name: 'compiler_architect',
        category: '架构',
        capabilities: ['架构设计'],
        skills: ['read-code'],
        workspaceProfile: {
          nickname: '老周',
          visual: { zone: 'design' },
        },
      });
      await writeAgent(agentsDir, {
        name: 'tester',
        category: '测试',
        capabilities: ['质量验证'],
        skills: ['run-tests'],
      });

      vi.resetModules();
      vi.doMock('@/lib/run/runtime-configs', () => ({
        getRuntimeAgentsDirPath: async () => agentsDir,
        getRuntimeAgentConfigPath: async (name: string) => path.join(agentsDir, `${name}.yaml`),
      }));
      vi.doMock('@/lib/core/app-paths', () => ({
        getWorkspaceDataFile: (...segments: string[]) => path.join(dataDir, ...segments),
      }));

      const { generateOfficeTeamPlan } = await import('@/lib/office/team-planner');
      const { applyOfficeTeamPlan, getCurrentOfficeTeam } = await import('@/lib/office/team-store');
      const plan = await generateOfficeTeamPlan({ requirement: '需要架构和测试一起做质量方案', maxMembers: 2 });
      const state = await applyOfficeTeamPlan({ plan, agentNames: ['compiler_architect'] });

      expect(state.activeAgentNames).toEqual(['compiler_architect']);
      expect(await getCurrentOfficeTeam()).toMatchObject({
        requirement: plan.requirement,
        activeAgentNames: ['compiler_architect'],
      });

      const saved = parse(await readFile(path.join(agentsDir, 'compiler_architect.yaml'), 'utf-8'));
      expect(saved.name).toBe('compiler_architect');
      expect(saved.skills).toEqual(['read-code']);
      expect(saved.workspaceProfile).toMatchObject({
        nickname: '老周',
        residency: { office: true, defaultDirectRoom: true },
        roomPresence: { autoShowInOffice: true },
        visual: { zone: 'design' },
      });
    });
  });
});
