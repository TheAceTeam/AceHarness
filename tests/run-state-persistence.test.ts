import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';

async function loadPersistence() {
  vi.resetModules();
  return import('@/lib/run-state-persistence');
}

function minimalRunState(overrides: Record<string, any> = {}) {
  return {
    runId: `run-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    configFile: 'test-workflow.yaml',
    status: 'running' as const,
    startTime: new Date().toISOString(),
    endTime: null,
    currentPhase: 'Phase 1',
    currentStep: 'Step 1',
    completedSteps: [],
    failedSteps: [],
    stepLogs: [],
    agents: [],
    iterationStates: {},
    processes: [],
    ...overrides,
  };
}

describe('run-state-persistence', () => {
  test('saveRunState and loadRunState round-trip preserves all fields', async () => {
    await withIsolatedAceHome(async () => {
      const { saveRunState, loadRunState } = await loadPersistence();

      const state = minimalRunState({
        status: 'running',
        currentPhase: 'Analysis',
        currentStep: 'Deep Dive',
        completedSteps: ['setup', 'init'],
        failedSteps: ['risky-step'],
        agents: [{
          name: 'developer',
          team: 'core',
          model: 'opus',
          status: 'running',
          completedTasks: 3,
          tokenUsage: { inputTokens: 1000, outputTokens: 500 },
          costUsd: 0.15,
          sessionId: 'sess-123',
          iterationCount: 2,
          summary: 'Working on implementation',
        }],
        mode: 'state-machine' as const,
        currentState: 'Root Cause Analysis',
        transitionCount: 5,
        maxTransitions: 30,
        stateHistory: [{
          from: 'Initial',
          to: 'Root Cause Analysis',
          reason: 'Starting analysis',
          issues: [],
          timestamp: new Date().toISOString(),
        }],
      });

      await saveRunState(state);

      const loaded = await loadRunState(state.runId);
      expect(loaded).not.toBeNull();
      expect(loaded!.runId).toBe(state.runId);
      expect(loaded!.configFile).toBe('test-workflow.yaml');
      expect(loaded!.status).toBe('running');
      expect(loaded!.currentPhase).toBe('Analysis');
      expect(loaded!.currentStep).toBe('Deep Dive');
      expect(loaded!.completedSteps).toEqual(['setup', 'init']);
      expect(loaded!.failedSteps).toEqual(['risky-step']);
      expect(loaded!.agents).toHaveLength(1);
      expect(loaded!.agents[0].name).toBe('developer');
      expect(loaded!.agents[0].tokenUsage.inputTokens).toBe(1000);
      expect(loaded!.mode).toBe('state-machine');
      expect(loaded!.currentState).toBe('Root Cause Analysis');
      expect(loaded!.transitionCount).toBe(5);
      expect(loaded!.stateHistory).toHaveLength(1);
    });
  });

  test('loadRunState returns null for nonexistent run', async () => {
    await withIsolatedAceHome(async () => {
      const { loadRunState } = await loadPersistence();
      expect(await loadRunState('nonexistent-run-id')).toBeNull();
    });
  });

  test('saveRunState creates directory and file on first save', async () => {
    await withIsolatedAceHome(async () => {
      const { saveRunState, loadRunState } = await loadPersistence();

      const state = minimalRunState({ status: 'preparing' });
      await saveRunState(state);

      const loaded = await loadRunState(state.runId);
      expect(loaded).not.toBeNull();
      expect(loaded!.status).toBe('preparing');
    });
  });

  test('saveProcessOutput writes output file and loadStepOutputs reads it back', async () => {
    await withIsolatedAceHome(async () => {
      const { saveRunState, saveProcessOutput, loadStepOutputs } = await loadPersistence();
      const state = minimalRunState();
      await saveRunState(state);

      const outputContent = '# Step Output\n\nThis is the agent output with **markdown**.';
      const filepath = await saveProcessOutput(state.runId, 'Design Step', outputContent);
      expect(filepath).toContain('Design_Step.md');

      const outputs = await loadStepOutputs(state.runId);
      expect(outputs['Design Step']).toBeUndefined(); // sanitized name
      expect(outputs['Design_Step']).toBe(outputContent);
    });
  });

  test('saveProcessOutput sanitizes unsafe characters in step names', async () => {
    await withIsolatedAceHome(async () => {
      const { saveRunState, saveProcessOutput, loadStepOutputs } = await loadPersistence();
      const state = minimalRunState();
      await saveRunState(state);

      await saveProcessOutput(state.runId, 'Step/With:Special*Chars', 'output content');

      const outputs = await loadStepOutputs(state.runId);
      const keys = Object.keys(outputs);
      expect(keys).toHaveLength(1);
      expect(keys[0]).not.toContain('/');
      expect(keys[0]).not.toContain(':');
      expect(keys[0]).not.toContain('*');
      expect(outputs[keys[0]]).toBe('output content');
    });
  });

  test('loadStepOutputs returns empty object for run with no outputs', async () => {
    await withIsolatedAceHome(async () => {
      const { saveRunState, loadStepOutputs } = await loadPersistence();
      const state = minimalRunState();
      await saveRunState(state);

      expect(await loadStepOutputs(state.runId)).toEqual({});
    });
  });

  test('listOutputFiles returns file metadata including size', async () => {
    await withIsolatedAceHome(async () => {
      const { saveRunState, saveProcessOutput, listOutputFiles } = await loadPersistence();
      const state = minimalRunState();
      await saveRunState(state);

      await saveProcessOutput(state.runId, 'Step A', 'Short output');
      await saveProcessOutput(state.runId, 'Step B', 'Much longer output content with more text to verify size difference');

      const files = await listOutputFiles(state.runId);
      expect(files).toHaveLength(2);
      const names = files.map((f) => f.stepName).sort();
      expect(names).toEqual(['Step_A', 'Step_B']);
      for (const file of files) {
        expect(file.size).toBeGreaterThan(0);
        expect(file.filename).toMatch(/\.(md|txt)$/);
      }
    });
  });

  test('listOutputFiles returns empty array for run with no outputs directory', async () => {
    await withIsolatedAceHome(async () => {
      const { listOutputFiles } = await loadPersistence();
      expect(await listOutputFiles('nonexistent-run')).toEqual([]);
    });
  });

  test('saveStreamContent and loadStreamContent round-trip', async () => {
    await withIsolatedAceHome(async () => {
      const { saveRunState, saveStreamContent, loadStreamContent } = await loadPersistence();
      const state = minimalRunState();
      await saveRunState(state);

      const streamContent = 'Agent is thinking...\n\nHere is the partial output...';
      await saveStreamContent(state.runId, 'Build Step', streamContent);

      const loaded = await loadStreamContent(state.runId, 'Build Step');
      expect(loaded).toBe(streamContent);
    });
  });

  test('loadStreamContent returns null for nonexistent stream', async () => {
    await withIsolatedAceHome(async () => {
      const { loadStreamContent } = await loadPersistence();
      expect(await loadStreamContent('nonexistent-run', 'missing-step')).toBeNull();
    });
  });

  test('appendFeedbackToStream appends human feedback with chunk separator', async () => {
    await withIsolatedAceHome(async () => {
      const { saveRunState, saveStreamContent, loadStreamContent, STREAM_CHUNK_SEPARATOR, appendFeedbackToStream } = await loadPersistence();
      const state = minimalRunState();
      await saveRunState(state);

      // Write initial stream content
      await saveStreamContent(state.runId, 'Test Step', 'Initial agent output');

      // Append feedback
      await appendFeedbackToStream(state.runId, 'Test Step', 'Please focus on edge cases');

      const content = await loadStreamContent(state.runId, 'Test Step');
      expect(content).not.toBeNull();
      expect(content!).toContain('Initial agent output');
      expect(content!).toContain(STREAM_CHUNK_SEPARATOR);
      expect(content!).toContain('<!-- human-feedback:');
      expect(content!).toContain('Please focus on edge cases');
    });
  });

  test('appendFeedbackToStream creates file if it does not exist', async () => {
    await withIsolatedAceHome(async () => {
      const { saveRunState, loadStreamContent, appendFeedbackToStream } = await loadPersistence();
      const state = minimalRunState();
      await saveRunState(state);

      // Append without writing initial content first
      await appendFeedbackToStream(state.runId, 'New Step', 'First feedback');

      const content = await loadStreamContent(state.runId, 'New Step');
      expect(content).not.toBeNull();
      expect(content!).toContain('First feedback');
      expect(content!).toContain('<!-- human-feedback:');
    });
  });

  test('STREAM_CHUNK_SEPARATOR is a well-defined delimiter', async () => {
    const { STREAM_CHUNK_SEPARATOR } = await loadPersistence();
    expect(typeof STREAM_CHUNK_SEPARATOR).toBe('string');
    expect(STREAM_CHUNK_SEPARATOR.length).toBeGreaterThan(0);
    // Should contain an HTML comment for easy parsing
    expect(STREAM_CHUNK_SEPARATOR).toContain('<!--');
    expect(STREAM_CHUNK_SEPARATOR).toContain('-->');
  });

  test('findRunningRuns returns only runs with status "running"', async () => {
    await withIsolatedAceHome(async () => {
      const { saveRunState, findRunningRuns } = await loadPersistence();

      const running1 = minimalRunState({ status: 'running' });
      const running2 = minimalRunState({ status: 'running' });
      const completed = minimalRunState({ status: 'completed' });
      const failed = minimalRunState({ status: 'failed' });

      await saveRunState(running1);
      await saveRunState(running2);
      await saveRunState(completed);
      await saveRunState(failed);

      const running = await findRunningRuns();
      expect(running).toHaveLength(2);
      const ids = running.map((r) => r.runId);
      expect(ids).toContain(running1.runId);
      expect(ids).toContain(running2.runId);
      expect(ids).not.toContain(completed.runId);
      expect(ids).not.toContain(failed.runId);
    });
  });

  test('findRunningRuns returns empty array when no runs directory exists', async () => {
    await withIsolatedAceHome(async () => {
      const { findRunningRuns } = await loadPersistence();
      expect(await findRunningRuns()).toEqual([]);
    });
  });

  test('run state with specCoding preserves specCoding data through save-load cycle', async () => {
    await withIsolatedAceHome(async () => {
      const { saveRunState, loadRunState } = await loadPersistence();

      const state = minimalRunState({
        runSpecCoding: {
          id: 'spec-1',
          version: 2,
          status: 'in-progress',
          title: 'Run Spec',
          workflowName: 'Test',
          summary: 'Spec for this run',
          goals: ['Goal 1'],
          nonGoals: [],
          constraints: [],
          requirements: [],
          phases: [{ id: 'p1', title: 'Phase 1', objective: 'Do stuff', ownerAgents: ['dev'], status: 'in-progress' }],
          assignments: [],
          checkpoints: [],
          tasks: [],
          progress: { overallStatus: 'in-progress', completedPhaseIds: [], summary: '' },
          revisions: [],
          artifacts: { requirements: '# Req', design: '# Design', tasks: '# Tasks' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      await saveRunState(state);
      const loaded = await loadRunState(state.runId);

      expect(loaded!.runSpecCoding).not.toBeNull();
      expect(loaded!.runSpecCoding!.id).toBe('spec-1');
      expect(loaded!.runSpecCoding!.version).toBe(2);
      expect(loaded!.runSpecCoding!.phases).toHaveLength(1);
      expect(loaded!.runSpecCoding!.artifacts.requirements).toBe('# Req');
    });
  });

  test('isProcessAlive returns false for nonexistent PID', async () => {
    const { isProcessAlive } = await loadPersistence();
    // Use a very large PID that definitely doesn't exist
    expect(isProcessAlive(2_147_483_647)).toBe(false);
    // Current process should be alive
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test('multiple outputs per run are independently persisted', async () => {
    await withIsolatedAceHome(async () => {
      const { saveRunState, saveProcessOutput, loadStepOutputs } = await loadPersistence();
      const state = minimalRunState();
      await saveRunState(state);

      await saveProcessOutput(state.runId, 'Step 1', 'Output from step 1');
      await saveProcessOutput(state.runId, 'Step 2', 'Output from step 2');
      await saveProcessOutput(state.runId, 'Step 3', 'Output from step 3');

      const outputs = await loadStepOutputs(state.runId);
      expect(Object.keys(outputs)).toHaveLength(3);
      expect(outputs['Step_1']).toBe('Output from step 1');
      expect(outputs['Step_2']).toBe('Output from step 2');
      expect(outputs['Step_3']).toBe('Output from step 3');
    });
  });
});
