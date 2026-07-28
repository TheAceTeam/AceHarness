import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { withTempDir } from './helpers/module-helpers';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/core/app-paths');
});

describe('CSI runtime config overlay', () => {
  test('preserves edited CSI configs, honors tombstones, and adds newly bundled configs', async () => {
    await withTempDir('csi-runtime-configs-', async (base) => {
      const installConfigs = path.join(base, 'install-configs');
      const runtimeConfigs = path.join(base, 'runtime-configs');
      await mkdir(path.join(installConfigs, 'agents'), { recursive: true });
      await mkdir(path.join(runtimeConfigs, 'agents'), { recursive: true });

      await writeFile(path.join(installConfigs, 'agents', 'csi-edited.yaml'), 'name: bundled\n');
      await writeFile(path.join(installConfigs, 'agents', 'csi-deleted.yaml'), 'name: deleted\n');
      await writeFile(path.join(installConfigs, 'agents', 'upstream-new.yaml'), 'name: upstream-new\n');
      await writeFile(path.join(runtimeConfigs, 'agents', 'csi-edited.yaml'), 'name: user-edited\n');
      vi.doMock('@/lib/core/app-paths', () => ({
        getInstallConfigPath: (...segments: string[]) => path.join(installConfigs, ...segments),
        getInstallConfigsDir: () => installConfigs,
        getWorkspaceAgentsDir: () => path.join(runtimeConfigs, 'agents'),
        getWorkspaceConfigPath: (...segments: string[]) => path.join(runtimeConfigs, ...segments),
        getWorkspaceConfigsDir: () => runtimeConfigs,
      }));

      const { ensureRuntimeConfigsSeeded, markConfigDeleted } = await import('@/lib/run/runtime-configs');
      await markConfigDeleted(runtimeConfigs, 'agents\\csi-deleted.yaml');
      await ensureRuntimeConfigsSeeded();

      await expect(readFile(path.join(runtimeConfigs, 'agents', 'csi-edited.yaml'), 'utf8'))
        .resolves.toBe('name: user-edited\n');
      await expect(readFile(path.join(runtimeConfigs, 'agents', 'upstream-new.yaml'), 'utf8'))
        .resolves.toBe('name: upstream-new\n');
      await expect(readFile(path.join(runtimeConfigs, 'agents', 'csi-deleted.yaml'), 'utf8'))
        .rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  test('ships parseable CSI presets whose workflow agents and agent skills all exist', async () => {
    const projectRoot = path.resolve(__dirname, '..');
    const agentsDir = path.join(projectRoot, 'configs', 'agents');
    const skillsDir = path.join(projectRoot, 'skills');
    const workflowPath = path.join(
      projectRoot,
      'configs',
      'workflows',
      'workflow-requirement-to-code-v1.yaml',
    );

    const agentFiles = (await readdir(agentsDir)).filter((name) => name.startsWith('csi-') && name.endsWith('.yaml'));
    const agents = new Map<string, any>();
    for (const file of agentFiles) {
      const parsed = parse(await readFile(path.join(agentsDir, file), 'utf8'));
      expect(parsed.name).toBe(file.replace(/\.yaml$/, ''));
      agents.set(parsed.name, parsed);
    }

    const workflow = parse(await readFile(workflowPath, 'utf8'));
    const referencedAgents = workflow.workflow.states.flatMap((state: any) =>
      (state.steps || []).map((step: any) => step.agent),
    );
    for (const agentName of referencedAgents) {
      expect(agents.has(agentName), `missing CSI agent ${agentName}`).toBe(true);
    }

    for (const [agentName, agent] of agents) {
      for (const skillName of agent.skills || []) {
        await expect(readFile(path.join(skillsDir, skillName, 'SKILL.md'), 'utf8'), `${agentName} -> ${skillName}`)
          .resolves.toMatch(/^---|^#/);
      }
    }
  });
});
