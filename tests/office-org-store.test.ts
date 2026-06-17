import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { describe, expect, test, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { withTempDir } from './helpers/module-helpers';

function agent(input: Record<string, any>) {
  return {
    name: input.name,
    team: input.team || 'blue',
    roleType: 'normal',
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

describe('office org store', () => {
  test('keeps org drafts out of Agent YAML until the draft is applied', async () => {
    await withTempDir('aceharness-office-org-', async (dir) => {
      const agentsDir = path.join(dir, 'agents');
      const dataDir = path.join(dir, 'data');
      await mkdir(agentsDir, { recursive: true });
      await mkdir(dataDir, { recursive: true });
      await writeAgent(agentsDir, {
        name: 'ceo-founder',
        team: 'black-gold',
        title: '总裁',
        category: '总裁',
        capabilities: ['方向和决策'],
      });
      await writeAgent(agentsDir, {
        name: 'app-engineer',
        title: '工程负责人',
        category: '开发',
        capabilities: ['代码实现'],
      });

      vi.resetModules();
      vi.doMock('@/lib/run/runtime-configs', () => ({
        getRuntimeAgentsDirPath: async () => agentsDir,
        getRuntimeAgentConfigPath: async (name: string) => path.join(agentsDir, `${name}.yaml`),
      }));
      vi.doMock('@/lib/core/app-paths', () => ({
        getWorkspaceDataFile: (...segments: string[]) => path.join(dataDir, ...segments),
      }));

      const {
        applyOfficeOrgDraft,
        createOfficeOrgDraft,
        getCurrentOfficeOrg,
        listOfficeOrgVersions,
        restoreOfficeOrgVersion,
        updateOfficeOrgDraft,
      } = await import('@/lib/office/org-store');
      const { createOfficeOrgClarification } = await import('@/lib/office/org-clarifier');

      const clarification = createOfficeOrgClarification({ requirement: '做一个 App', availableAgentCount: 2 });
      expect(clarification.type).toBe('office_org_clarification');
      expect(clarification.questions.map((question) => question.id)).toEqual(
        expect.arrayContaining(['deliverable', 'team_size', 'user_role', 'agent_policy'])
      );

      const draft = await createOfficeOrgDraft({
        requirement: '做一个 App',
        mode: 'manual',
        nodes: [
          {
            id: 'ceo',
            title: 'CEO / Founder',
            zone: 'core',
            reportsTo: null,
            agentName: 'ceo-founder',
            responsibilities: ['方向和优先级'],
          },
          {
            id: 'engineering',
            title: 'Engineering Lead',
            zone: 'engineering',
            agentName: 'app-engineer',
            responsibilities: ['实现和交付'],
          },
        ],
      });

      const engineerBefore = parse(await readFile(path.join(agentsDir, 'app-engineer.yaml'), 'utf-8'));
      expect(engineerBefore.workspaceProfile).toBeUndefined();

      const updated = await updateOfficeOrgDraft(draft.id, {
        nodes: draft.nodes.map((node) => (
          node.id === 'engineering'
            ? { ...node, title: 'App Engineering Lead', evidence: ['用户手动确认'] }
            : node
        )),
      });
      expect(updated.nodes.find((node) => node.id === 'engineering')?.title).toBe('App Engineering Lead');

      const engineerAfterDraftUpdate = parse(await readFile(path.join(agentsDir, 'app-engineer.yaml'), 'utf-8'));
      expect(engineerAfterDraftUpdate.workspaceProfile).toBeUndefined();

      const applied = await applyOfficeOrgDraft({ draftId: draft.id });
      expect(applied.teamState.activeAgentNames).toEqual(['ceo-founder', 'app-engineer']);
      expect(applied.org.status).toBe('current');
      expect(applied.org.revision).toBe(1);

      const engineerAfterApply = parse(await readFile(path.join(agentsDir, 'app-engineer.yaml'), 'utf-8'));
      expect(engineerAfterApply.workspaceProfile).toMatchObject({
        officeRole: 'App Engineering Lead',
        residency: { office: true, defaultDirectRoom: true },
        roomPresence: { autoShowInOffice: true },
        visual: { zone: 'engineering', order: 2 },
      });

      const current = await getCurrentOfficeOrg();
      const versions = await listOfficeOrgVersions();
      expect(current?.id).toBe(draft.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].id).toBe(draft.id);

      const restored = await restoreOfficeOrgVersion(draft.id);
      expect(restored.org.id).not.toBe(draft.id);
      expect(restored.org.revision).toBe(2);
      expect(restored.org.generationTrace.restoredFromVersionId).toBe(draft.id);
      expect(restored.teamState.activeAgentNames).toEqual(['ceo-founder', 'app-engineer']);
      expect(await listOfficeOrgVersions()).toHaveLength(2);
    });
  });
});
