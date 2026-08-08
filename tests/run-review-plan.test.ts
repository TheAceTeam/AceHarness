import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';

function role(name = 'worker') {
  return {
    name,
    team: 'blue',
    engineModels: {},
    activeEngine: '',
    capabilities: ['work'],
    systemPrompt: 'work',
  };
}

function stateMachineConfig(name: string, options: { child?: string; adversarial?: boolean; locked?: boolean } = {}) {
  const workSteps: any[] = options.adversarial
    ? [
        { name: 'Implement', agent: 'worker', task: 'Implement', role: 'defender', agentInstanceId: `${name}-d` },
        { name: 'Attack', agent: 'worker', task: 'Attack', role: 'attacker', agentInstanceId: `${name}-a` },
        { name: 'Judge', agent: 'worker', task: 'Judge', role: 'judge', agentInstanceId: `${name}-j` },
      ]
    : [{ name: 'Implement', agent: 'worker', task: 'Implement' }];
  if (options.child) workSteps.unshift({ name: 'Run child', type: 'subworkflow', workflow: options.child });
  return {
    workflow: {
      name,
      mode: 'state-machine',
      states: [
        {
          id: `${name}-work`,
          name: 'Work',
          isInitial: true,
          isFinal: false,
          reviewPolicy: {
            mode: options.adversarial ? 'adversarial' : 'standard',
            source: options.locked ? 'user' : 'ai',
            locked: Boolean(options.locked),
            confidence: 'high',
            riskSignals: [],
            rationale: 'baseline',
          },
          steps: workSteps,
          transitions: [{ to: 'Done', condition: { verdict: 'pass' } }],
        },
        {
          id: `${name}-done`,
          name: 'Done',
          isInitial: false,
          isFinal: true,
          steps: [],
          transitions: [],
        },
      ],
      supervisor: { enabled: true, agent: 'default-supervisor' },
    },
    roles: [role()],
    context: { projectRoot: '{project_root}' },
  };
}

function lightweightConfig(name = 'lightweight') {
  return {
    workflow: {
      name,
      mode: 'state-machine',
      profile: 'lightweight',
      lightweight: {},
      states: [{
        name: '执行',
        isInitial: true,
        isFinal: true,
        steps: [{
          name: '执行任务',
          agent: 'worker',
          task: '完成本次任务',
          skills: ['aceharness-tasklist'],
        }],
        transitions: [],
      }],
    },
    roles: [role()],
    context: { projectRoot: 'C:/workspace' },
  };
}

async function setup(aceHome: string) {
  const configsDir = path.join(aceHome, 'configs');
  await mkdir(configsDir, { recursive: true });
  await writeFile(path.join(configsDir, 'root.yaml'), stringify(stateMachineConfig('root', { child: 'child.yaml', adversarial: true })), 'utf-8');
  await writeFile(path.join(configsDir, 'child.yaml'), stringify(stateMachineConfig('child')), 'utf-8');
}

describe('run-level review plans', () => {
  test('disabled performs no AI evaluation, covers children, and leaves source YAML unchanged', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await setup(aceHome);
      vi.resetModules();
      const { createRunReviewPlanArtifact } = await import('@/lib/workflow/run-review-plan');
      const sourceBefore = await readFile(path.join(aceHome, 'configs', 'root.yaml'), 'utf-8');
      const evaluator = vi.fn(async () => { throw new Error('must not be called'); });
      const artifact = await createRunReviewPlanArtifact({
        rootConfigFile: 'root.yaml',
        intent: 'disabled',
        initialContexts: { globalContext: 'run A' },
        evaluator,
      });

      expect(evaluator).not.toHaveBeenCalled();
      expect(artifact.plan.states).toHaveLength(2);
      expect(artifact.plan.states.every((state) => state.effectiveMode === 'standard')).toBe(true);
      for (const content of Object.values(artifact.effectiveConfigContents)) {
        const effective = parse(content) as any;
        const roles = effective.workflow.states.flatMap((state: any) => state.steps.map((step: any) => step.role));
        expect(roles).not.toContain('attacker');
        expect(roles).not.toContain('judge');
      }
      expect(await readFile(path.join(aceHome, 'configs', 'root.yaml'), 'utf-8')).toBe(sourceBefore);
    });
  });

  test('on-demand batches unlocked states once and applies user overrides only to the run projection', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await setup(aceHome);
      vi.resetModules();
      const { applyRunReviewPlanOverrides, createRunReviewPlanArtifact } = await import('@/lib/workflow/run-review-plan');
      const evaluator = vi.fn(async (candidates: any[]) => Object.fromEntries(candidates.map((candidate) => [
        `${candidate.configFile}::${candidate.stateId}`,
        { kind: 'state' as const, configFile: candidate.configFile, stateId: candidate.stateId, mode: 'adversarial' as const, confidence: 'high' as const, riskSignals: ['high impact'], rationale: 'independent challenge helps' },
      ])));
      const artifact = await createRunReviewPlanArtifact({
        rootConfigFile: 'root.yaml',
        intent: 'on-demand',
        initialContexts: { taskInput: { description: 'risky change' } },
        evaluator,
      });

      expect(evaluator).toHaveBeenCalledTimes(1);
      expect(evaluator.mock.calls[0][0]).toHaveLength(2);
      const child = artifact.plan.states.find((state) => state.configFile === 'child.yaml')!;
      const overridden = await applyRunReviewPlanOverrides({
        artifact,
        overrides: [{ configFile: child.configFile, stateId: child.stateId, mode: 'standard' }],
      });
      expect(overridden.plan.states.find((state) => state.configFile === 'child.yaml')).toMatchObject({
        effectiveMode: 'standard',
        source: 'user',
        locked: true,
      });
      expect(parse(await readFile(path.join(aceHome, 'configs', 'child.yaml'), 'utf-8')).workflow.states[0].reviewPolicy.mode).toBe('standard');
    });
  });

  test('surfaces normalization instance bindings in the run plan operations', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      const config = stateMachineConfig('root', { adversarial: true });
      for (const step of config.workflow.states[0].steps) {
        delete step.agentInstanceId;
      }
      await writeFile(path.join(configsDir, 'root.yaml'), stringify(config), 'utf-8');
      vi.resetModules();
      const { createRunReviewPlanArtifact } = await import('@/lib/workflow/run-review-plan');
      const artifact = await createRunReviewPlanArtifact({
        rootConfigFile: 'root.yaml',
        intent: 'on-demand',
        evaluator: vi.fn(async () => ({
          'root.yaml::root-work': {
            kind: 'state' as const,
            configFile: 'root.yaml',
            stateId: 'root-work',
            mode: 'adversarial' as const,
            confidence: 'high' as const,
            riskSignals: [],
            rationale: 'keep the configured adversarial review',
          },
        })),
      });

      const plannedState = artifact.plan.states.find((state) => state.configFile === 'root.yaml')!;
      expect(plannedState.operations).toEqual([
        expect.objectContaining({ op: 'retag', stepName: 'Implement' }),
        expect.objectContaining({ op: 'retag', stepName: 'Attack' }),
        expect.objectContaining({ op: 'retag', stepName: 'Judge' }),
      ]);
    });
  });

  test('lightweight disabled remains byte-identical and does not invoke the evaluator', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      const original = stringify(lightweightConfig());
      await writeFile(path.join(configsDir, 'lightweight.yaml'), original, 'utf-8');
      vi.resetModules();
      const { createRunReviewPlanArtifact } = await import('@/lib/workflow/run-review-plan');
      const evaluator = vi.fn();
      const artifact = await createRunReviewPlanArtifact({
        rootConfigFile: 'lightweight.yaml',
        intent: 'disabled',
        evaluator,
      });

      expect(evaluator).not.toHaveBeenCalled();
      expect(artifact.plan.workflows[0]).toMatchObject({
        baseKind: 'lightweight',
        effectiveKind: 'lightweight',
        requiresAdversarial: false,
        source: 'global',
      });
      expect(artifact.effectiveConfigContents['lightweight.yaml']).toBe(original);
    });
  });

  test('lightweight on-demand derives an ordinary state-machine snapshot without modifying YAML', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      const original = stringify(lightweightConfig());
      await writeFile(path.join(configsDir, 'lightweight.yaml'), original, 'utf-8');
      vi.resetModules();
      const { createRunReviewPlanArtifact } = await import('@/lib/workflow/run-review-plan');
      const evaluator = vi.fn(async (candidates: any[]) => ({
        'lightweight.yaml::lightweight': {
          kind: 'lightweight' as const,
          configFile: 'lightweight.yaml',
          requiresAdversarial: true,
          confidence: 'high' as const,
          riskSignals: ['irreversible change'],
          rationale: 'independent challenge required',
        },
      }));
      const artifact = await createRunReviewPlanArtifact({
        rootConfigFile: 'lightweight.yaml',
        intent: 'on-demand',
        evaluator,
      });

      expect(evaluator).toHaveBeenCalledTimes(1);
      expect(evaluator.mock.calls[0][0]).toEqual([expect.objectContaining({ kind: 'lightweight' })]);
      expect(artifact.plan.workflows[0]).toMatchObject({
        baseKind: 'lightweight',
        effectiveKind: 'state-machine',
        requiresAdversarial: true,
      });
      const effective = parse(artifact.effectiveConfigContents['lightweight.yaml']) as any;
      expect(effective.workflow.profile).toBeUndefined();
      expect(effective.workflow.lightweight).toBeUndefined();
      expect(effective.workflow.supervisor).toBeUndefined();
      expect(effective.workflow.states).toHaveLength(2);
      expect(effective.workflow.states[0].steps.map((step: any) => step.role)).toEqual(['defender', 'attacker', 'judge']);
      expect(effective.workflow.states[0].steps[0].skills || []).not.toContain('aceharness-tasklist');
      expect(artifact.plan.workflows[0].operations).toContainEqual(expect.objectContaining({
        op: 'retag',
        stepName: '执行任务',
        reason: expect.stringContaining('aceharness-tasklist'),
      }));
      expect(effective.workflow.states[1]).toMatchObject({ name: '完成', isFinal: true });
      const { stateMachineWorkflowSchema } = await import('@/lib/core/schemas');
      expect(stateMachineWorkflowSchema.safeParse(effective).success).toBe(true);
      expect(await readFile(path.join(configsDir, 'lightweight.yaml'), 'utf-8')).toBe(original);
    });
  });

  test('falls back to explicit manual choices when the on-demand evaluator fails', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await setup(aceHome);
      vi.resetModules();
      const { applyRunReviewPlanOverrides, createRunReviewPlanArtifact } = await import('@/lib/workflow/run-review-plan');
      const artifact = await createRunReviewPlanArtifact({
        rootConfigFile: 'root.yaml',
        intent: 'on-demand',
        evaluator: vi.fn().mockRejectedValue(new Error('planner unavailable')),
      });

      expect(artifact.plan).toMatchObject({ blocked: true, evaluationError: 'planner unavailable' });
      expect(artifact.plan.states.every((state) => state.manualSelectionRequired)).toBe(true);
      const partiallyResolved = await applyRunReviewPlanOverrides({
        artifact,
        overrides: [{
          configFile: artifact.plan.states[0].configFile,
          stateId: artifact.plan.states[0].stateId,
          mode: 'standard',
        }],
      });
      expect(partiallyResolved.plan.blocked).toBe(true);

      const resolved = await applyRunReviewPlanOverrides({
        artifact,
        overrides: artifact.plan.states.map((state) => ({
          configFile: state.configFile,
          stateId: state.stateId,
          mode: 'standard' as const,
        })),
      });
      expect(resolved.plan.blocked).toBe(false);
      expect(resolved.plan.states.every((state) => !state.manualSelectionRequired)).toBe(true);
      expect(resolved.plan.evaluationError).toBe('planner unavailable');
      expect(resolved.plan.warnings.join('\n')).not.toContain('planner unavailable');
    });
  });

  test('allows a failed lightweight AI evaluation to be manually derived as an adversarial state machine', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      const original = stringify(lightweightConfig());
      await writeFile(path.join(configsDir, 'lightweight.yaml'), original, 'utf-8');
      vi.resetModules();
      const { applyRunReviewPlanOverrides, createRunReviewPlanArtifact } = await import('@/lib/workflow/run-review-plan');
      const artifact = await createRunReviewPlanArtifact({
        rootConfigFile: 'lightweight.yaml',
        intent: 'on-demand',
        evaluator: vi.fn().mockRejectedValue(new Error('planner unavailable')),
      });

      expect(artifact.plan.workflows[0]).toMatchObject({
        blocked: true,
        manualSelectionRequired: true,
        effectiveKind: 'lightweight',
      });

      const resolved = await applyRunReviewPlanOverrides({
        artifact,
        overrides: [{
          kind: 'lightweight',
          configFile: artifact.plan.workflows[0].configFile,
          requiresAdversarial: true,
        }],
      });

      expect(resolved.plan.blocked).toBe(false);
      expect(resolved.plan.workflows[0]).toMatchObject({
        blocked: false,
        manualSelectionRequired: false,
        effectiveKind: 'state-machine',
        requiresAdversarial: true,
        source: 'user',
      });
      const effective = parse(resolved.effectiveConfigContents['lightweight.yaml']) as any;
      expect(effective.workflow.states[0].steps.map((step: any) => step.role)).toEqual(['defender', 'attacker', 'judge']);
      expect(await readFile(path.join(configsDir, 'lightweight.yaml'), 'utf-8')).toBe(original);
    });
  });

  test('keeps an explicit user override on standard even when the AI suggestion had low confidence', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      await writeFile(path.join(configsDir, 'root.yaml'), stringify(stateMachineConfig('root')), 'utf-8');
      vi.resetModules();
      const { applyRunReviewPlanOverrides, createRunReviewPlanArtifact } = await import('@/lib/workflow/run-review-plan');
      const evaluator = vi.fn(async (candidates: any[]) => Object.fromEntries(candidates.map((candidate) => [
        `${candidate.configFile}::${candidate.stateId}`,
        { kind: 'state' as const, configFile: candidate.configFile, stateId: candidate.stateId, mode: 'adversarial' as const, confidence: 'low' as const, riskSignals: [], rationale: 'unsure' },
      ])));
      const artifact = await createRunReviewPlanArtifact({
        rootConfigFile: 'root.yaml',
        intent: 'on-demand',
        evaluator,
      });
      const overridden = await applyRunReviewPlanOverrides({
        artifact,
        overrides: [{ configFile: 'root.yaml', stateId: 'root-work', mode: 'standard' }],
      });

      expect(overridden.plan.states[0]).toMatchObject({ effectiveMode: 'standard', source: 'user' });
      const effective = parse(overridden.effectiveConfigContents['root.yaml']) as any;
      const work = effective.workflow.states.find((state: any) => state.name === 'Work');
      // The projection must match what the plan reported back to the user.
      expect(work.reviewPolicy.mode).toBe('standard');
      expect(work.steps.map((step: any) => step.role)).not.toContain('attacker');
    });
  });

  test('evaluates config-locked states so on-demand stays a real choice, and lets a user override the lock', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      await writeFile(path.join(configsDir, 'locked.yaml'), stringify(stateMachineConfig('locked', { locked: true })), 'utf-8');
      vi.resetModules();
      const { applyRunReviewPlanOverrides, createRunReviewPlanArtifact } = await import('@/lib/workflow/run-review-plan');
      const evaluator = vi.fn(async (candidates: any[]) => Object.fromEntries(candidates.map((candidate) => [
        `${candidate.configFile}::${candidate.stateId}`,
        { kind: 'state' as const, configFile: candidate.configFile, stateId: candidate.stateId, mode: 'adversarial' as const, confidence: 'high' as const, riskSignals: ['risky'], rationale: 'needs challenge' },
      ])));
      const artifact = await createRunReviewPlanArtifact({
        rootConfigFile: 'locked.yaml',
        intent: 'on-demand',
        evaluator,
      });

      expect(evaluator.mock.calls[0][0]).toHaveLength(1);
      // The lock still decides, but the AI read is visible instead of hidden.
      expect(artifact.plan.states[0]).toMatchObject({
        effectiveMode: 'standard',
        suggestedMode: 'adversarial',
        source: 'config-lock',
        configLocked: true,
      });
      expect(artifact.plan.states[0].suggestion?.mode).toBe('adversarial');

      const overridden = await applyRunReviewPlanOverrides({
        artifact,
        overrides: [{ configFile: 'locked.yaml', stateId: 'locked-work', mode: 'adversarial' }],
      });
      expect(overridden.plan.states[0]).toMatchObject({ effectiveMode: 'adversarial', source: 'user' });
    });
  });

  test('warns when the run-level disabled intent overrides a locked adversarial state', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      await writeFile(
        path.join(configsDir, 'locked.yaml'),
        stringify(stateMachineConfig('locked', { adversarial: true, locked: true })),
        'utf-8',
      );
      vi.resetModules();
      const { createRunReviewPlanArtifact } = await import('@/lib/workflow/run-review-plan');
      const artifact = await createRunReviewPlanArtifact({
        rootConfigFile: 'locked.yaml',
        intent: 'disabled',
        evaluator: vi.fn(async () => ({})),
      });

      expect(artifact.plan.states[0].effectiveMode).toBe('standard');
      expect(artifact.plan.states[0].warnings.join('\n')).toContain('配置中锁定的对抗模式已被本次运行的全局意愿覆盖');
      expect(artifact.plan.warnings.join('\n')).toContain('配置中锁定的对抗模式已被本次运行的全局意愿覆盖');
      // The plan-level list is the per-state warning prefixed with the state name.
      // The start dialog relies on that exact shape to drop warnings its cards
      // already render, so pin the format here rather than in the UI.
      const state = artifact.plan.states[0];
      for (const warning of state.warnings) {
        expect(artifact.plan.warnings).toContain(`${state.stateName}: ${warning}`);
      }
    });
  });

  test('rejects stale plans when contexts or a reachable config changes', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await setup(aceHome);
      vi.resetModules();
      const { createRunReviewPlanArtifact, validateRunReviewPlanArtifact } = await import('@/lib/workflow/run-review-plan');
      const artifact = await createRunReviewPlanArtifact({
        rootConfigFile: 'root.yaml',
        intent: 'disabled',
        initialContexts: { globalContext: 'original' },
      });
      await expect(validateRunReviewPlanArtifact({
        artifact,
        initialContexts: { globalContext: 'changed' },
      })).rejects.toThrow(/上下文已变化/);

      await writeFile(path.join(aceHome, 'configs', 'child.yaml'), `${await readFile(path.join(aceHome, 'configs', 'child.yaml'), 'utf-8')}\n# changed`, 'utf-8');
      await expect(validateRunReviewPlanArtifact({
        artifact,
        initialContexts: { globalContext: 'original' },
      })).rejects.toThrow(/配置已变化/);
    });
  });
});
