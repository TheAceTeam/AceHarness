import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { withTempDir } from './helpers/module-helpers';
import type { SpecCodingDocument } from '@/lib/schemas';

async function loadSpecPersistence() {
  return import('@/lib/spec-persistence');
}

function minimalSpecCoding(overrides: Partial<SpecCodingDocument> = {}): SpecCodingDocument {
  return {
    id: 'test-spec',
    version: 1,
    status: 'draft',
    title: 'Test Spec',
    workflowName: 'Test Workflow',
    summary: 'Test summary',
    goals: ['Goal 1'],
    nonGoals: [],
    constraints: [],
    requirements: [],
    phases: [],
    assignments: [],
    checkpoints: [],
    tasks: [],
    progress: { overallStatus: 'pending', completedPhaseIds: [], summary: '' },
    revisions: [],
    artifacts: { requirements: 'Requirements content', design: 'Design content', tasks: 'Tasks content' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('spec-persistence', () => {
  test('getSpecRootDir resolves relative, absolute, and default specRoot correctly', async () => {
    const { getSpecRootDir } = await loadSpecPersistence();
    const workspace = '/workspace/project';

    expect(getSpecRootDir(workspace)).toBe(resolve(workspace, '.spec'));
    expect(getSpecRootDir(workspace, '.custom-spec')).toBe(resolve(workspace, '.custom-spec'));
    expect(getSpecRootDir(workspace, '/absolute/path')).toBe('/absolute/path');
  });

  test('deltaDirName escapes unsafe characters while preserving CJK and safe characters', async () => {
    const { deltaDirName } = await loadSpecPersistence();

    expect(deltaDirName('My Workflow', 'run-123')).toBe('My_Workflow-run-123');
    expect(deltaDirName('工作流', 'run-456')).toBe('工作流-run-456');
    expect(deltaDirName('a/b:c*d', 'run-1')).toBe('a_b_c_d-run-1');
  });

  test('master spec write-read round-trip preserves content and metadata', async () => {
    await withTempDir('spec-master-', async (tmpDir) => {
      const { writeMasterSpec, readMasterSpec, hasPersistedSpec, ensureSpecDirStructure } = await loadSpecPersistence();
      const specRootDir = resolve(tmpDir, '.spec');

      expect(hasPersistedSpec(specRootDir)).toBe(false);
      expect(await readMasterSpec(specRootDir)).toBeNull();

      await ensureSpecDirStructure(specRootDir);
      expect(existsSync(resolve(specRootDir, 'specs'))).toBe(true);

      const spec = minimalSpecCoding({
        version: 3,
        artifacts: { requirements: '# Master Spec\n\nAll requirements here.', design: '', tasks: '' },
        revisions: [
          { id: 'r1', version: 1, summary: 'Created', createdAt: '2026-01-01T00:00:00Z' },
          { id: 'r2', version: 2, summary: 'Updated', createdAt: '2026-01-02T00:00:00Z', createdBy: 'user-1' },
        ],
      });
      await writeMasterSpec(specRootDir, spec);

      expect(hasPersistedSpec(specRootDir)).toBe(true);

      const specMd = await readFile(resolve(specRootDir, 'spec.md'), 'utf-8');
      expect(specMd).toContain('# Master Spec');
      expect(specMd).toContain('All requirements here.');

      const loaded = await readMasterSpec(specRootDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(3);
      expect(loaded!.status).toBe('confirmed');
      expect(loaded!.artifacts.requirements).toContain('# Master Spec');
      expect(loaded!.revisions).toHaveLength(2);
      expect(loaded!.revisions[1].createdBy).toBe('user-1');
      expect(loaded!.persistMode).toBe('repository');
    });
  });

  test('master spec with empty requirements falls back to summary or placeholder', async () => {
    await withTempDir('spec-test-', async (tmpDir) => {
      const { writeMasterSpec, readMasterSpec } = await loadSpecPersistence();
      const specRootDir = resolve(tmpDir, '.spec');

      const spec = minimalSpecCoding({
        artifacts: { requirements: '', design: '', tasks: '' },
        summary: 'Fallback summary used as spec content',
      });
      await writeMasterSpec(specRootDir, spec);

      const specMd = await readFile(resolve(specRootDir, 'spec.md'), 'utf-8');
      expect(specMd).toContain('Fallback summary used as spec content');

      const loaded = await readMasterSpec(specRootDir);
      expect(loaded!.artifacts.requirements).toContain('Fallback summary');
    });
  });

  test('delta spec write-read round-trip creates correct directory structure', async () => {
    await withTempDir('spec-test-', async (tmpDir) => {
      const { writeDeltaSpec, readDeltaSpec } = await loadSpecPersistence();
      const specRootDir = resolve(tmpDir, '.spec');

      const spec = minimalSpecCoding({
        version: 2,
        artifacts: {
          requirements: '## Delta Requirements\n\nNew requirements.',
          design: '## Delta Design\n\nNew design.',
          tasks: '- [ ] 1. New task',
        },
        revisions: [{ id: 'r1', version: 1, summary: 'Initial', createdAt: '2026-01-01T00:00:00Z' }],
      });

      await writeDeltaSpec(specRootDir, 'MyWorkflow', 'run-abc', spec);

      const deltaDir = resolve(specRootDir, 'specs', 'MyWorkflow-run-abc');
      expect(existsSync(resolve(deltaDir, 'requirements.md'))).toBe(true);
      expect(existsSync(resolve(deltaDir, 'design.md'))).toBe(true);
      expect(existsSync(resolve(deltaDir, 'tasks.md'))).toBe(true);
      expect(existsSync(resolve(deltaDir, 'spec.meta.yaml'))).toBe(true);

      const loaded = await readDeltaSpec(specRootDir, 'MyWorkflow', 'run-abc');
      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(2);
      expect(loaded!.status).toBe('in-progress');
      expect(loaded!.workflowName).toBe('MyWorkflow');
      expect(loaded!.artifacts.requirements).toContain('Delta Requirements');
      expect(loaded!.artifacts.design).toContain('Delta Design');
      expect(loaded!.artifacts.tasks).toContain('New task');
    });
  });

  test('readDeltaSpec returns null for nonexistent delta directory', async () => {
    await withTempDir('spec-test-', async (tmpDir) => {
      const { readDeltaSpec } = await loadSpecPersistence();
      expect(await readDeltaSpec(tmpDir, 'Nonexistent', 'run-000')).toBeNull();
    });
  });

  test('checklist round-trip preserves checked and unchecked items', async () => {
    await withTempDir('spec-test-', async (tmpDir) => {
      const { writeChecklist, readChecklist } = await loadSpecPersistence();

      const questions = [
        { id: 'q-1', text: 'Is the design approved?', answered: true },
        { id: 'q-2', text: 'Are tests passing?', answered: false },
        { id: 'q-3', text: 'Is documentation complete?', answered: false },
      ];

      await writeChecklist(tmpDir, questions);

      const content = await readFile(resolve(tmpDir, 'checklist.md'), 'utf-8');
      expect(content).toContain('- [x] Is the design approved?');
      expect(content).toContain('- [ ] Are tests passing?');
      expect(content).toContain('- [ ] Is documentation complete?');

      const loaded = await readChecklist(tmpDir);
      expect(loaded).toHaveLength(3);
      expect(loaded[0].answered).toBe(true);
      expect(loaded[1].answered).toBe(false);
      expect(loaded[2].text).toBe('Is documentation complete?');
    });
  });

  test('readChecklist returns empty array for missing checklist file', async () => {
    await withTempDir('spec-test-', async (tmpDir) => {
      const { readChecklist } = await loadSpecPersistence();
      expect(await readChecklist(tmpDir)).toEqual([]);
    });
  });

  test('listDeltaDirs returns sorted directory names', async () => {
    await withTempDir('spec-test-', async (tmpDir) => {
      const { listDeltaDirs, ensureSpecDirStructure } = await loadSpecPersistence();
      const specRootDir = resolve(tmpDir, '.spec');
      await ensureSpecDirStructure(specRootDir);

      expect(await listDeltaDirs(specRootDir)).toEqual([]);

      const specsDir = resolve(specRootDir, 'specs');
      await mkdir(resolve(specsDir, 'workflow-B-run-2'), { recursive: true });
      await mkdir(resolve(specsDir, 'workflow-A-run-1'), { recursive: true });
      await mkdir(resolve(specsDir, 'workflow-A-run-3'), { recursive: true });
      // Create a file (not directory) to verify it's filtered out
      await writeFile(resolve(specsDir, 'not-a-dir.txt'), '');

      const dirs = await listDeltaDirs(specRootDir);
      expect(dirs).toEqual(['workflow-A-run-1', 'workflow-A-run-3', 'workflow-B-run-2']);
    });
  });

  test('appendPersistedSpecRevision increments version and appends revision entry', async () => {
    await withTempDir('spec-test-', async (tmpDir) => {
      const { writeSpecMetadata, readSpecMetadata, appendPersistedSpecRevision } = await loadSpecPersistence();
      const metaPath = resolve(tmpDir, 'spec.meta.yaml');

      await writeSpecMetadata(metaPath, {
        version: 2,
        revisions: [
          { id: 'r1', version: 1, summary: 'Initial', createdAt: '2026-01-01T00:00:00Z' },
          { id: 'r2', version: 2, summary: 'Second', createdAt: '2026-01-02T00:00:00Z' },
        ],
      });

      const result = await appendPersistedSpecRevision(tmpDir, {
        summary: 'Third revision with details',
        createdBy: 'user-42',
      });

      expect(result.version).toBe(3);
      expect(result.revisions).toHaveLength(3);
      expect(result.revisions[2].summary).toBe('Third revision with details');
      expect(result.revisions[2].createdBy).toBe('user-42');
      expect(result.revisions[2].version).toBe(3);

      // Verify persistence by reading back
      const reloaded = await readSpecMetadata(metaPath);
      expect(reloaded.version).toBe(3);
      expect(reloaded.revisions).toHaveLength(3);
    });
  });

  test('appendPersistedSpecRevision handles empty summary fallback', async () => {
    await withTempDir('spec-test-', async (tmpDir) => {
      const { appendPersistedSpecRevision } = await loadSpecPersistence();

      // First append on a fresh directory: initial metadata has version 1, append increments to 2
      const result = await appendPersistedSpecRevision(tmpDir, { summary: '   ' });
      expect(result.version).toBe(2);
      expect(result.revisions).toHaveLength(1);
      expect(result.revisions[0].summary).toBe('SpecCoding 已更新');
    });
  });

  test('classifyPersistedSpecFile correctly distinguishes master, delta, and invalid files', async () => {
    await withTempDir('spec-test-', async (tmpDir) => {
      const { classifyPersistedSpecFile } = await loadSpecPersistence();

      // Master spec
      const master = classifyPersistedSpecFile(tmpDir, '.spec/spec.md');
      expect(master).not.toBeNull();
      expect(master!.kind).toBe('master');
      expect(master!.artifact).toBe('spec');

      // Delta requirement
      const deltaReq = classifyPersistedSpecFile(tmpDir, '.spec/specs/MyWorkflow-run-abc/requirements.md');
      expect(deltaReq).not.toBeNull();
      expect(deltaReq!.kind).toBe('delta');
      expect(deltaReq!.artifact).toBe('requirements');
      expect(deltaReq!.workflowName).toBe('MyWorkflow');
      expect(deltaReq!.runId).toBe('run-abc');

      // Delta design
      const deltaDesign = classifyPersistedSpecFile(tmpDir, '.spec/specs/WF-run-1/design.md');
      expect(deltaDesign!.kind).toBe('delta');
      expect(deltaDesign!.artifact).toBe('design');

      // Delta tasks
      const deltaTasks = classifyPersistedSpecFile(tmpDir, '.spec/specs/WF-run-1/tasks.md');
      expect(deltaTasks!.kind).toBe('delta');
      expect(deltaTasks!.artifact).toBe('tasks');

      // Invalid: outside spec root
      expect(classifyPersistedSpecFile(tmpDir, '../escape/spec.md')).toBeNull();

      // Invalid: wrong filename in delta
      expect(classifyPersistedSpecFile(tmpDir, '.spec/specs/WF-run-1/invalid.md')).toBeNull();

      // Invalid: wrong depth
      expect(classifyPersistedSpecFile(tmpDir, '.spec/specs/invalid.md')).toBeNull();
    });
  });

  test('buildStructuralMergedMasterSpec merges delta sections into master', async () => {
    await withTempDir('spec-test-', async (tmpDir) => {
      const { writeMasterSpec, writeDeltaSpec, buildStructuralMergedMasterSpec, applyMergedMasterSpec } = await loadSpecPersistence();
      const specRootDir = resolve(tmpDir, '.spec');

      // Write master spec with H3 subheadings so the merge works at the right level
      const masterSpec = minimalSpecCoding({
        version: 1,
        artifacts: {
          requirements: [
            '# Requirements',
            '',
            '## Functional',
            '',
            '### Login',
            '',
            'User must be able to log in.',
            '',
            '### Dashboard',
            '',
            'User sees a dashboard after login.',
            '',
            '## Non-Functional',
            '',
            'Performance requirements.',
          ].join('\n'),
          design: '',
          tasks: '',
        },
      });
      await writeMasterSpec(specRootDir, masterSpec);

      // Write delta spec: updates existing H3 section, adds new H3, adds new H2
      const deltaSpec = minimalSpecCoding({
        version: 1,
        artifacts: {
          requirements: [
            '## Functional',
            '',
            '### Login',
            '',
            'User must be able to log in with MFA support.',
            '',
            '### Settings',
            '',
            'User can configure preferences.',
            '',
            '## Security',
            '',
            'New security requirements from delta.',
          ].join('\n'),
          design: [
            '## Architecture',
            '',
            'New architecture design from delta.',
          ].join('\n'),
          tasks: '- [ ] 1. Delta task',
        },
      });
      await writeDeltaSpec(specRootDir, 'MergeWorkflow', 'run-merge-1', deltaSpec);

      const merged = await buildStructuralMergedMasterSpec(specRootDir, 'MergeWorkflow', 'run-merge-1');
      expect(merged).not.toBeNull();
      // Existing H3 sections are merged (delta overwrites matching H3 title)
      expect(merged!).toContain('User must be able to log in with MFA support.');
      expect(merged!).not.toContain('User must be able to log in.\n');
      // Unchanged H3 section preserved
      expect(merged!).toContain('### Dashboard');
      expect(merged!).toContain('User sees a dashboard after login.');
      // New H3 from delta added
      expect(merged!).toContain('### Settings');
      expect(merged!).toContain('User can configure preferences.');
      // Unchanged H2 preserved
      expect(merged!).toContain('## Non-Functional');
      expect(merged!).toContain('Performance requirements.');
      // New H2 from delta added
      expect(merged!).toContain('## Security');
      expect(merged!).toContain('New security requirements from delta.');
      // New H2 from delta design added
      expect(merged!).toContain('## Architecture');
      expect(merged!).toContain('New architecture design from delta.');

      // Apply merged spec and verify persistence
      await applyMergedMasterSpec(specRootDir, merged!, 'Applied merge', 'test-user');

      const reloaded = await readFile(resolve(specRootDir, 'spec.md'), 'utf-8');
      expect(reloaded).toContain('MFA support');
      expect(reloaded).toContain('## Security');
    });
  });

  test('buildStructuralMergedMasterSpec returns null for nonexistent delta', async () => {
    await withTempDir('spec-test-', async (tmpDir) => {
      const { buildStructuralMergedMasterSpec } = await loadSpecPersistence();
      expect(await buildStructuralMergedMasterSpec(tmpDir, 'Missing', 'run-000')).toBeNull();
    });
  });

  test('readSpecMetadata and writeSpecMetadata round-trip with normalization', async () => {
    await withTempDir('spec-test-', async (tmpDir) => {
      const { readSpecMetadata, writeSpecMetadata } = await loadSpecPersistence();
      const metaPath = resolve(tmpDir, 'test.meta.yaml');

      // Write metadata
      await writeSpecMetadata(metaPath, {
        version: 5,
        revisions: [
          { id: 'r1', version: 1, summary: 'First', createdAt: '2026-01-01T00:00:00Z' },
        ],
        updatedAt: '2026-01-15T00:00:00Z',
      });

      // Read back
      const loaded = await readSpecMetadata(metaPath);
      expect(loaded.version).toBe(5);
      expect(loaded.revisions).toHaveLength(1);
      expect(loaded.updatedAt).toBe('2026-01-15T00:00:00Z');

      // Read nonexistent returns defaults
      const missing = await readSpecMetadata(resolve(tmpDir, 'nonexistent.yaml'));
      expect(missing.version).toBe(1);
      expect(missing.revisions).toEqual([]);
    });
  });
});
