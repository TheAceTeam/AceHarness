import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';

interface PhaseConfig {
  workflow: {
    name: string;
    phases: Array<{
      name: string;
      checkpoint?: { name: string };
      steps: Array<{ name: string; agent: string; task: string }>;
    }>;
  };
  context: {
    projectRoot: string;
    workspaceMode: string;
    requirements: string;
  };
}

function buildPhaseConfig(projectRoot: string): PhaseConfig {
  return {
    workflow: {
      name: 'Store Test Workflow',
      phases: [
        {
          name: 'Design',
          checkpoint: { name: 'Design review' },
          steps: [
            { name: 'Plan', agent: 'architect', task: 'Design the implementation approach' },
          ],
        },
        {
          name: 'Implement',
          steps: [
            { name: 'Code', agent: 'developer', task: 'Implement the change' },
            { name: 'Verify', agent: 'tester', task: 'Verify the implementation' },
          ],
        },
      ],
    },
    context: {
      projectRoot,
      workspaceMode: 'in-place',
      requirements: 'Test requirements for store tests',
    },
  };
}

async function loadStore() {
  vi.resetModules();
  return import('@/lib/spec-coding-store');
}

describe('spec-coding-store', () => {
  test('buildSpecCodingFromWorkflowConfig generates phases, assignments, and artifacts from phase-based config', async () => {
    await withIsolatedAceHome(async () => {
      const { buildSpecCodingFromWorkflowConfig } = await loadStore();
      const config = buildPhaseConfig('/test/workspace');

      const doc = buildSpecCodingFromWorkflowConfig({
        workflowName: 'Store Test Workflow',
        description: 'Testing store functions',
        requirements: 'Must pass all tests',
        filename: 'store-test.yaml',
        workspaceMode: 'in-place',
        workingDirectory: '/test/workspace',
        config,
      });

      expect(doc.status).toBe('draft');
      expect(doc.version).toBe(1);
      expect(doc.workflowName).toBe('Store Test Workflow');
      expect(doc.phases).toHaveLength(2);
      expect(doc.phases[0].title).toBe('Design');
      expect(doc.phases[1].title).toBe('Implement');
      expect(doc.phases[1].ownerAgents).toContain('developer');
      expect(doc.phases[1].ownerAgents).toContain('tester');

      expect(doc.assignments.map((a) => a.agent).sort()).toEqual(['architect', 'developer', 'tester']);
      expect(doc.checkpoints).toHaveLength(1);
      expect(doc.checkpoints[0].title).toBe('Design review');

      expect(doc.artifacts.requirements).toContain('Store Test Workflow');
      expect(doc.artifacts.design).toContain('设计文档');
      expect(doc.artifacts.tasks).toContain('Design');
      expect(doc.artifacts.tasks).toContain('Implement');

      expect(doc.revisions).toHaveLength(1);
      expect(doc.linkedConfigFilename).toBe('store-test.yaml');
    });
  });

  test('buildSpecCodingFromWorkflowConfig generates correct structure for state-machine config', async () => {
    await withIsolatedAceHome(async () => {
      const { buildSpecCodingFromWorkflowConfig } = await loadStore();

      const doc = buildSpecCodingFromWorkflowConfig({
        workflowName: 'SM Workflow',
        filename: 'sm.yaml',
        workspaceMode: 'isolated-copy',
        workingDirectory: '/tmp/sm',
        config: {
          workflow: {
            name: 'SM Workflow',
            mode: 'state-machine',
            states: [
              { name: 'Analyze', steps: [{ agent: 'analyst', task: 'Analyze requirements' }] },
              { name: 'Build', steps: [{ agent: 'developer', task: 'Build the feature' }] },
              { name: 'Test', steps: [{ agent: 'tester', task: 'Test the feature' }] },
            ],
          },
        },
      });

      expect(doc.phases).toHaveLength(3);
      expect(doc.phases[0].title).toBe('Analyze');
      expect(doc.phases[1].title).toBe('Build');
      expect(doc.phases[2].title).toBe('Test');
      expect(doc.artifacts.requirements).toContain('状态机');
    });
  });

  test('buildCreationSession produces a complete session with specCoding, config summary, and artifact snapshots', async () => {
    await withIsolatedAceHome(async () => {
      const { buildCreationSession } = await loadStore();
      const config = buildPhaseConfig('/test/workspace');

      const session = buildCreationSession({
        chatSessionId: 'chat-123',
        createdBy: 'user-1',
        filename: 'session-test.yaml',
        workflowName: 'Store Test Workflow',
        mode: 'phase-based',
        workingDirectory: '/test/workspace',
        workspaceMode: 'in-place',
        description: 'Test session creation',
        requirements: 'Test requirements',
        config,
      });

      expect(session.id).toBeTruthy();
      expect(session.chatSessionId).toBe('chat-123');
      expect(session.createdBy).toBe('user-1');
      expect(session.status).toBe('config-generated');
      expect(session.workflowName).toBe('Store Test Workflow');
      expect(session.specCoding.status).toBe('draft');
      expect(session.specCoding.phases).toHaveLength(2);
      expect(session.generatedConfigSummary.mode).toBe('phase-based');
      expect(session.generatedConfigSummary.phaseCount).toBe(2);
      expect(session.generatedConfigSummary.agentNames).toContain('architect');
      expect(session.generatedConfigSummary.agentNames).toContain('developer');
      expect(session.workflowDraftSummary.nodes).toHaveLength(2);
      expect(session.artifactSnapshots).toHaveLength(1);
      expect(session.artifactSnapshots[0].artifacts.requirements).toContain('Test requirements');
    });
  });

  test('creation session save-load round-trip preserves all fields', async () => {
    await withIsolatedAceHome(async () => {
      const { buildCreationSession, saveCreationSession, loadCreationSession } = await loadStore();
      const config = buildPhaseConfig('/test/workspace');

      const session = buildCreationSession({
        chatSessionId: 'chat-rt',
        createdBy: 'user-rt',
        filename: 'roundtrip.yaml',
        workflowName: 'Roundtrip Workflow',
        mode: 'phase-based',
        workingDirectory: '/test/workspace',
        workspaceMode: 'in-place',
        description: 'Roundtrip test',
        config,
      });

      await saveCreationSession(session);

      const loaded = await loadCreationSession(session.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(session.id);
      expect(loaded!.chatSessionId).toBe('chat-rt');
      expect(loaded!.createdBy).toBe('user-rt');
      expect(loaded!.workflowName).toBe('Roundtrip Workflow');
      expect(loaded!.specCoding.status).toBe('draft');
      expect(loaded!.specCoding.phases).toHaveLength(2);
      expect(loaded!.artifactSnapshots).toHaveLength(1);
    });
  });

  test('loadCreationSession returns null for nonexistent session', async () => {
    await withIsolatedAceHome(async () => {
      const { loadCreationSession } = await loadStore();
      expect(await loadCreationSession('nonexistent-id')).toBeNull();
    });
  });

  test('listCreationSessions filters by chatSessionId and createdBy', async () => {
    await withIsolatedAceHome(async () => {
      const { buildCreationSession, saveCreationSession, listCreationSessions } = await loadStore();
      const config = buildPhaseConfig('/test/workspace');

      const s1 = buildCreationSession({ chatSessionId: 'chat-A', createdBy: 'user-1', filename: 'a1.yaml', workflowName: 'A1', mode: 'phase-based', workingDirectory: '/tmp', workspaceMode: 'in-place', config });
      const s2 = buildCreationSession({ chatSessionId: 'chat-A', createdBy: 'user-2', filename: 'a2.yaml', workflowName: 'A2', mode: 'phase-based', workingDirectory: '/tmp', workspaceMode: 'in-place', config });
      const s3 = buildCreationSession({ chatSessionId: 'chat-B', createdBy: 'user-1', filename: 'b1.yaml', workflowName: 'B1', mode: 'phase-based', workingDirectory: '/tmp', workspaceMode: 'in-place', config });

      await saveCreationSession(s1);
      await saveCreationSession(s2);
      await saveCreationSession(s3);

      // No filter: all sessions
      const all = await listCreationSessions();
      expect(all).toHaveLength(3);

      // Filter by chatSessionId
      const chatA = await listCreationSessions({ chatSessionId: 'chat-A' });
      expect(chatA).toHaveLength(2);
      expect(chatA.every((s) => s.chatSessionId === 'chat-A')).toBe(true);

      // Filter by createdBy
      const user1 = await listCreationSessions({ createdBy: 'user-1' });
      expect(user1).toHaveLength(2);
      expect(user1.every((s) => s.createdBy === 'user-1')).toBe(true);

      // Filter by both
      const specific = await listCreationSessions({ chatSessionId: 'chat-A', createdBy: 'user-1' });
      expect(specific).toHaveLength(1);
      expect(specific[0].workflowName).toBe('A1');
    });
  });

  test('updateCreationSession merges patch and syncs artifact snapshots', async () => {
    await withIsolatedAceHome(async () => {
      const { buildCreationSession, saveCreationSession, updateCreationSession, loadCreationSession } = await loadStore();
      const config = buildPhaseConfig('/test/workspace');

      const session = buildCreationSession({
        filename: 'update-test.yaml',
        workflowName: 'Update Workflow',
        mode: 'phase-based',
        workingDirectory: '/tmp',
        workspaceMode: 'in-place',
        config,
      });
      await saveCreationSession(session);

      const updated = await updateCreationSession(session.id, {
        specCoding: {
          ...session.specCoding,
          version: 2,
          status: 'confirmed',
          summary: 'Confirmed after review',
        },
      });

      expect(updated).not.toBeNull();
      expect(updated!.specCoding.version).toBe(2);
      expect(updated!.specCoding.status).toBe('confirmed');
      expect(updated!.artifactSnapshots.length).toBeGreaterThanOrEqual(2);

      // Verify persistence
      const reloaded = await loadCreationSession(session.id);
      expect(reloaded!.specCoding.version).toBe(2);
      expect(reloaded!.specCoding.status).toBe('confirmed');
    });
  });

  test('updateCreationSession returns null for nonexistent session', async () => {
    await withIsolatedAceHome(async () => {
      const { updateCreationSession } = await loadStore();
      expect(await updateCreationSession('missing-id', { description: 'nope' })).toBeNull();
    });
  });

  test('appendSpecCodingRevision increments version and appends revision', async () => {
    await withIsolatedAceHome(async () => {
      const { buildSpecCodingFromWorkflowConfig, appendSpecCodingRevision } = await loadStore();
      const config = buildPhaseConfig('/test/workspace');

      let doc = buildSpecCodingFromWorkflowConfig({
        workflowName: 'Revision Test',
        filename: 'rev.yaml',
        workspaceMode: 'in-place',
        workingDirectory: '/tmp',
        config,
      });
      expect(doc.version).toBe(1);
      expect(doc.revisions).toHaveLength(1);

      doc = appendSpecCodingRevision(doc, {
        summary: 'Second revision after design review',
        createdBy: 'reviewer-1',
        status: 'confirmed',
      });

      expect(doc.version).toBe(2);
      expect(doc.status).toBe('confirmed');
      expect(doc.revisions).toHaveLength(2);
      expect(doc.revisions[1].summary).toBe('Second revision after design review');
      expect(doc.revisions[1].createdBy).toBe('reviewer-1');
      expect(doc.revisions[1].version).toBe(2);

      doc = appendSpecCodingRevision(doc, {
        summary: 'Third revision',
        progressSummary: 'All phases complete',
      });

      expect(doc.version).toBe(3);
      expect(doc.revisions).toHaveLength(3);
      expect(doc.progress.summary).toBe('All phases complete');
    });
  });

  test('cloneSpecCodingForRun creates a deep copy with independent id and run context', async () => {
    await withIsolatedAceHome(async () => {
      const { buildSpecCodingFromWorkflowConfig, cloneSpecCodingForRun } = await loadStore();
      const config = buildPhaseConfig('/test/workspace');

      const original = buildSpecCodingFromWorkflowConfig({
        workflowName: 'Clone Test',
        filename: 'clone.yaml',
        workspaceMode: 'in-place',
        workingDirectory: '/tmp',
        config,
      });

      const cloned = cloneSpecCodingForRun(original, {
        runId: 'run-42',
        filename: 'clone-run42.yaml',
      });

      expect(cloned.id).not.toBe(original.id);
      expect(cloned.linkedConfigFilename).toBe('clone-run42.yaml');
      expect(cloned.artifacts.requirements).toBe(original.artifacts.requirements);
      expect(cloned.phases).toEqual(original.phases);

      // Mutating clone should not affect original
      cloned.phases[0].title = 'Modified';
      expect(original.phases[0].title).not.toBe('Modified');
    });
  });

  test('updateSpecCodingTaskStatuses updates matching tasks and syncs markdown checkboxes', async () => {
    await withIsolatedAceHome(async () => {
      const { buildSpecCodingFromWorkflowConfig, updateSpecCodingTaskStatuses } = await loadStore();
      const config = buildPhaseConfig('/test/workspace');

      const doc = buildSpecCodingFromWorkflowConfig({
        workflowName: 'Task Update Test',
        filename: 'tasks.yaml',
        workspaceMode: 'in-place',
        workingDirectory: '/tmp',
        config,
      });

      // The generated tasks artifact should contain checkbox items
      expect(doc.artifacts.tasks).toContain('- [ ]');

      // Find task IDs from the parsed tasks
      const normalized = buildSpecCodingFromWorkflowConfig({
        workflowName: 'Task Update Test',
        filename: 'tasks.yaml',
        workspaceMode: 'in-place',
        workingDirectory: '/tmp',
        config,
      });

      if (normalized.tasks.length > 0) {
        const updated = updateSpecCodingTaskStatuses(normalized, {
          updates: [{ id: normalized.tasks[0].id, status: 'completed', validation: 'Passed review' }],
          updatedBy: 'supervisor',
        });

        expect(updated.tasks[0].status).toBe('completed');
        expect(updated.tasks[0].validation).toBe('Passed review');

        // Markdown should reflect the updated status
        expect(updated.artifacts.tasks).toContain('[x]');
      }
    });
  });

  test('rebuildSpecCodingPreservingArtifacts merges rebuilt structure with existing artifacts', async () => {
    await withIsolatedAceHome(async () => {
      const { buildSpecCodingFromWorkflowConfig, rebuildSpecCodingPreservingArtifacts } = await loadStore();
      const config = buildPhaseConfig('/test/workspace');

      const existing = buildSpecCodingFromWorkflowConfig({
        workflowName: 'Rebuild Test',
        filename: 'rebuild.yaml',
        workspaceMode: 'in-place',
        workingDirectory: '/tmp',
        config,
      });

      // Simulate user having customized the requirements artifact
      const customized = {
        ...existing,
        artifacts: {
          ...existing.artifacts,
          requirements: 'Customized requirements that user spent time on',
        },
        summary: 'Customized summary',
        goals: ['Custom goal 1', 'Custom goal 2'],
      };

      const rebuilt = rebuildSpecCodingPreservingArtifacts({
        existing: customized,
        workflowName: 'Rebuild Test',
        filename: 'rebuild.yaml',
        workspaceMode: 'in-place',
        workingDirectory: '/tmp',
        config,
        status: 'confirmed',
      });

      // Preserved from existing
      expect(rebuilt.artifacts.requirements).toBe('Customized requirements that user spent time on');
      expect(rebuilt.summary).toBe('Customized summary');
      expect(rebuilt.goals).toEqual(['Custom goal 1', 'Custom goal 2']);
      expect(rebuilt.status).toBe('confirmed');

      // Rebuilt from config
      expect(rebuilt.phases).toHaveLength(2);
      expect(rebuilt.assignments.length).toBeGreaterThan(0);
    });
  });
});
