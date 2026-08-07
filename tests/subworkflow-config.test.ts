import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';

async function loadSubworkflowConfig() {
  vi.resetModules();
  return import('@/lib/workflow/subworkflow-config');
}

function stateMachineConfig(name: string, step: any = { name: 'Do work', agent: 'developer', task: 'Do work' }) {
  return {
    workflow: {
      name,
      mode: 'state-machine',
      states: [
        {
          name: 'Start',
          isInitial: true,
          isFinal: false,
          steps: [step],
          transitions: [
            { to: 'Done', condition: { verdict: 'pass' } },
            { to: 'Done', condition: { verdict: 'conditional_pass' } },
            { to: 'Done', condition: { verdict: 'fail' } },
          ],
        },
        {
          name: 'Done',
          isInitial: false,
          isFinal: true,
          steps: [{ name: 'Finish', agent: 'developer', task: 'Finish' }],
          transitions: [],
        },
      ],
      supervisor: { enabled: true, agent: 'default-supervisor' },
    },
    context: { projectRoot: '{project_root}' },
  };
}

describe('subworkflow config dependencies', () => {
  test('resolves child dependencies and writes a run snapshot manifest', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      await writeFile(path.join(configsDir, 'parent.yaml'), stringify(stateMachineConfig('Parent', {
        name: 'Run child',
        type: 'subworkflow',
        workflow: 'child.yaml',
      })), 'utf-8');
      await writeFile(path.join(configsDir, 'child.yaml'), stringify(stateMachineConfig('Child')), 'utf-8');

      const { createWorkflowConfigSnapshot } = await loadSubworkflowConfig();
      const graph = await createWorkflowConfigSnapshot({
        rootConfigFile: 'parent.yaml',
        runId: 'run-subworkflow-snapshot',
      });

      expect(graph.root).toBe('parent.yaml');
      expect(graph.configs.map((item) => item.file).sort()).toEqual(['child.yaml', 'parent.yaml']);
      expect(graph.configs.find((item) => item.file === 'child.yaml')?.referencedBy).toEqual(['parent.yaml']);

      const manifestPath = path.join(aceHome, 'runs', 'run-subworkflow-snapshot', 'configs', 'manifest.json');
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
      expect(manifest.configs).toHaveLength(2);
      expect(parse(await readFile(path.join(aceHome, 'runs', 'run-subworkflow-snapshot', 'configs', 'child.yaml'), 'utf-8')).workflow.name).toBe('Child');
    });
  });

  test('normalizes legacy Spec metadata out of a lightweight run snapshot', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      const legacyConfig: any = {
        workflow: {
          name: 'Legacy lightweight',
          mode: 'state-machine',
          profile: 'lightweight',
          lightweight: {},
          supervisor: { enabled: true, agent: 'default-supervisor' },
          states: [{
            name: 'Execute',
            isInitial: true,
            isFinal: true,
            steps: [{ name: 'Run tasklist', agent: 'developer', task: 'Complete the tasklist' }],
            transitions: [],
          }],
        },
        context: { projectRoot: '{project_root}' },
      };
      legacyConfig.workflow.states[0].steps[0].specTaskBinding = {
        taskId: 'T1.1',
        taskIds: ['T1.1'],
      };
      await writeFile(path.join(configsDir, 'lightweight.yaml'), stringify(legacyConfig), 'utf-8');

      const { createWorkflowConfigSnapshot, readWorkflowConfigSnapshot } = await loadSubworkflowConfig();
      await createWorkflowConfigSnapshot({
        rootConfigFile: 'lightweight.yaml',
        runId: 'run-lightweight-snapshot',
      });

      const snapshot = await readWorkflowConfigSnapshot({
        rootRunId: 'run-lightweight-snapshot',
        configFile: 'lightweight.yaml',
      });
      const normalized = parse(snapshot.content) as any;
      expect(normalized.workflow.supervisor).toBeUndefined();
      expect(normalized.workflow.states[0].steps[0].specTaskBinding).toBeUndefined();
      expect(normalized.workflow.states[0].steps[0].skills).toContain('aceharness-tasklist');

      const original = parse(await readFile(path.join(configsDir, 'lightweight.yaml'), 'utf-8')) as any;
      expect(original.workflow.states[0].steps[0].specTaskBinding?.taskId).toBe('T1.1');
    });
  });

  test('writes authoritative content overrides into the immutable snapshot without changing source files', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      const original = stringify(stateMachineConfig('Original'));
      const effective = stringify(stateMachineConfig('Effective'));
      await writeFile(path.join(configsDir, 'root.yaml'), original, 'utf-8');

      const { createWorkflowConfigSnapshot } = await loadSubworkflowConfig();
      const graph = await createWorkflowConfigSnapshot({
        rootConfigFile: 'root.yaml',
        runId: 'run-effective-snapshot',
        contentOverrides: { 'root.yaml': effective },
      });

      expect(parse(await readFile(path.join(aceHome, 'runs', 'run-effective-snapshot', 'configs', 'root.yaml'), 'utf-8')).workflow.name).toBe('Effective');
      expect(await readFile(path.join(configsDir, 'root.yaml'), 'utf-8')).toBe(original);
      expect(graph.configs[0].sha256).not.toBe('');
    });
  });

  test('rejects recursive subworkflow dependency graphs', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      await writeFile(path.join(configsDir, 'a.yaml'), stringify(stateMachineConfig('A', {
        name: 'Run B',
        type: 'subworkflow',
        workflow: 'b.yaml',
      })), 'utf-8');
      await writeFile(path.join(configsDir, 'b.yaml'), stringify(stateMachineConfig('B', {
        name: 'Run A',
        type: 'subworkflow',
        workflow: 'a.yaml',
      })), 'utf-8');

      const { resolveWorkflowConfigDependencyGraph } = await loadSubworkflowConfig();

      await expect(resolveWorkflowConfigDependencyGraph('a.yaml')).rejects.toThrow('检测到子工作流循环');
    });
  });

  test('validates inline configs against referenced child workflow files', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      await writeFile(path.join(configsDir, 'child.yaml'), stringify(stateMachineConfig('Child')), 'utf-8');

      const { assertSubworkflowDependenciesForConfig } = await loadSubworkflowConfig();

      await expect(assertSubworkflowDependenciesForConfig(stateMachineConfig('Inline Parent', {
        name: 'Run child',
        type: 'subworkflow',
        workflow: 'child.yaml',
      }))).resolves.toBeUndefined();
      await expect(assertSubworkflowDependenciesForConfig(stateMachineConfig('Inline Parent', {
        name: 'Run missing child',
        type: 'subworkflow',
        workflow: 'missing.yaml',
      }))).rejects.toThrow('找不到子工作流配置');
    });
  });

  test('rejects unsafe subworkflow references', async () => {
    const { normalizeWorkflowConfigRef } = await loadSubworkflowConfig();

    expect(() => normalizeWorkflowConfigRef('../outside.yaml')).toThrow('不能越过');
    expect(() => normalizeWorkflowConfigRef('C:\\tmp\\child.yaml')).toThrow('相对路径');
  });

  test('enforces dependency graph and snapshot byte limits', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      await writeFile(path.join(configsDir, 'parent.yaml'), stringify(stateMachineConfig('Parent', {
        name: 'Run child',
        type: 'subworkflow',
        workflow: 'child.yaml',
      })), 'utf-8');
      await writeFile(path.join(configsDir, 'child.yaml'), stringify(stateMachineConfig('Child')), 'utf-8');

      const { resolveWorkflowConfigDependencyGraph } = await loadSubworkflowConfig();

      await expect(resolveWorkflowConfigDependencyGraph('parent.yaml', { maxGraphSize: 1 }))
        .rejects.toThrow('最大配置数量 1');
      await expect(resolveWorkflowConfigDependencyGraph('parent.yaml', { maxSnapshotBytes: 10 }))
        .rejects.toThrow('快照总大小超过上限');
    });
  });

  test('rejects tampered snapshot manifest hashes before reading child config', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      await writeFile(path.join(configsDir, 'parent.yaml'), stringify(stateMachineConfig('Parent', {
        name: 'Run child',
        type: 'subworkflow',
        workflow: 'child.yaml',
      })), 'utf-8');
      await writeFile(path.join(configsDir, 'child.yaml'), stringify(stateMachineConfig('Child')), 'utf-8');

      const { createWorkflowConfigSnapshot, readWorkflowConfigSnapshot } = await loadSubworkflowConfig();
      await createWorkflowConfigSnapshot({
        rootConfigFile: 'parent.yaml',
        runId: 'run-tampered-manifest',
      });
      const manifestPath = path.join(aceHome, 'runs', 'run-tampered-manifest', 'configs', 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
      manifest.configs[0].sha256 = 'bad-hash';
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

      await expect(readWorkflowConfigSnapshot({
        rootRunId: 'run-tampered-manifest',
        configFile: 'child.yaml',
      })).rejects.toThrow('manifest 校验失败');
    });
  });
});
