import { resolve } from 'path';
import { access } from 'fs/promises';
import { describe, expect, test } from 'vitest';

import { getWorkflowPreflightPlan, runWorkflowPreflight } from '@/lib/workflow/preflight';

describe('workflow preflight planning', () => {
  test('uses only explicit workflow-level commands and never future step preCommands', async () => {
    const personalDir = resolve('C:/workspace/configs');
    const plan = await getWorkflowPreflightPlan('root.yaml', personalDir, undefined, {
      configContents: {
        'root.yaml': `
context:
  projectRoot: ../root-project
  preflight:
    commands: [git status --porcelain]
workflow:
  mode: state-machine
  states:
    - name: context
      steps:
        - name: snapshot
          preCommands: [git rev-parse HEAD > .aceharness-evidence/local-before.txt]
    - name: future-history-rewrite
      steps:
        - name: rewrite
          preCommands: [git update-ref refs/backup/aceharness-before-history-rewrite HEAD]
`,
        'child.yaml': `
context:
  projectRoot: ../child-project
  preflight:
    commands: [git diff --check]
workflow:
  mode: state-machine
  states:
    - name: child
      steps:
        - name: build-later
          preCommands: [npm run build]
`,
      },
    });

    expect(plan.commands).toEqual([
      expect.objectContaining({ command: 'git status --porcelain', configFile: 'root.yaml', cwd: resolve(personalDir, '../root-project') }),
      expect.objectContaining({ command: 'git diff --check', configFile: 'child.yaml', cwd: resolve(personalDir, '../child-project') }),
    ]);
    expect(plan.commands.map((item) => item.command)).not.toContain('git update-ref refs/backup/aceharness-before-history-rewrite HEAD');
    expect(plan.commands.some((item) => item.command.includes('.aceharness-evidence'))).toBe(false);
    expect(plan.commands).not.toContainEqual(expect.objectContaining({ command: 'npm run build' }));
  });

  test('allows a non-Git Issue-first root to start with an empty preflight contract', async () => {
    const plan = await getWorkflowPreflightPlan('issue-first.yaml', resolve('/tmp/not-a-repository'), undefined, {
      configContent: `
context:
  projectRoot: .
  workspaceMode: isolated-copy
workflow:
  mode: state-machine
  states:
    - name: context
      steps:
        - name: clone-or-isolate-later
          preCommands: [git status --porcelain > .aceharness-evidence/dirty-before.txt]
`,
    });

    expect(plan.commands).toEqual([]);
    const result = await runWorkflowPreflight('issue-first.yaml', resolve('/tmp/not-a-repository'), undefined, {
      configContent: `context: { projectRoot: ., workspaceMode: isolated-copy }\nworkflow: { mode: state-machine, states: [] }`,
    });
    expect(result).toMatchObject({ ok: true, checks: [], failedCount: 0, warningCount: 0 });
  });

  test('filters write-capable commands before execution while preserving safe explicit checks', async () => {
    const marker = `/tmp/aceharness-preflight-must-not-run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const configContent = `
context:
  preflight:
    commands:
      - true
      - git update-ref refs/backup/aceharness-before-history-rewrite HEAD
      - touch ${marker}
workflow:
  mode: state-machine
  states: []
`;
    const plan = await getWorkflowPreflightPlan('safe.yaml', resolve('/tmp/project'), undefined, { configContent });
    expect(plan.commands.map((item) => item.command)).toEqual(['true']);
    expect(plan.rejectedCommands).toEqual([
      expect.objectContaining({ command: 'git update-ref refs/backup/aceharness-before-history-rewrite HEAD' }),
      expect.objectContaining({ command: `touch ${marker}` }),
    ]);

    const result = await runWorkflowPreflight('safe.yaml', resolve('/tmp/project'), undefined, { configContent });
    expect(result.checks).toHaveLength(1);
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
