import { resolve } from 'path';
import { describe, expect, test } from 'vitest';

import { getWorkflowPreflightPlan } from '@/lib/workflow/preflight';

describe('workflow preflight planning', () => {
  test('includes root and subworkflow commands from the exact effective snapshot graph', async () => {
    const personalDir = resolve('C:/workspace/configs');
    const plan = await getWorkflowPreflightPlan('root.yaml', personalDir, undefined, {
      configContents: {
        'root.yaml': `
context:
  projectRoot: ../root-project
workflow:
  mode: state-machine
  states:
    - name: root
      steps:
        - name: root-check
          preCommands: [npm run lint]
`,
        'child.yaml': `
context:
  projectRoot: ../child-project
workflow:
  mode: state-machine
  states:
    - name: child
      steps:
        - name: child-check
          preCommands: [npm run test]
`,
      },
    });

    expect(plan.commands).toEqual([
      expect.objectContaining({ command: 'npm run lint', configFile: 'root.yaml', cwd: resolve(personalDir, '../root-project') }),
      expect.objectContaining({ command: 'npm run test', configFile: 'child.yaml', cwd: resolve(personalDir, '../child-project') }),
    ]);
  });

  test('deduplicates the same command only when it runs in the same directory', async () => {
    const personalDir = resolve('C:/workspace/configs');
    const sharedContent = `
context:
  projectRoot: ../project
workflow:
  mode: state-machine
  states:
    - name: check
      steps:
        - name: lint
          preCommands: [npm run lint]
`;
    const plan = await getWorkflowPreflightPlan('root.yaml', personalDir, undefined, {
      configContents: { 'root.yaml': sharedContent, 'child.yaml': sharedContent },
    });

    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0]).toMatchObject({ command: 'npm run lint', configFile: 'root.yaml' });
  });
});
