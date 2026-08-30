import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  adaptDeepseekHarnessEnvironment,
  launchDeepseekHarness,
  resolveDeepseekHarnessCliEntry,
} from '../runtime/deepseek-harness-launcher.mjs';

describe('DeepSeek Harness ACP launcher', () => {
  test('resolves the OpenMa ACP CLI shipped by the installed package', () => {
    expect(resolveDeepseekHarnessCliEntry()).toMatch(/[\\/]@openma[\\/]deepseek-harness-acp[\\/]dist[\\/]bin\.js$/);
  });

  test('imports the ACP entry with ACPX argv unchanged', async () => {
    const originalArgv = process.argv;
    const forwardedArgv = ['node', '/tmp/aceharness-dsh'];
    let observedArgv: string[] | undefined;
    let observedSpecifier = '';
    process.argv = forwardedArgv;

    try {
      await launchDeepseekHarness({
        env: { DSH_HOME: '/tmp/acpx-deepseek-home' },
        resolveEntry: () => '/tmp/node_modules/@openma/deepseek-harness-acp/dist/bin.js',
        importEntry: async (specifier: string) => {
          observedSpecifier = specifier;
          observedArgv = [...process.argv];
        },
      });
    } finally {
      process.argv = originalArgv;
    }

    expect(observedSpecifier).toBe('file:///tmp/node_modules/@openma/deepseek-harness-acp/dist/bin.js');
    expect(observedArgv).toEqual(forwardedArgv);
  });

  test('maps legacy ACEHarness route values to the OpenMa DSH contract', () => {
    const env: NodeJS.ProcessEnv = {
      DSH_HOME: '/tmp/acpx-deepseek-home',
      ACEH_DEEPSEEK_PROVIDER: 'boft-deepseek',
      ACEH_DEEPSEEK_MODEL: 'boft-deepseek/deepseek-v4-flash',
      ACEH_DEEPSEEK_PERMISSION_MODE: 'workspace-write',
      ACEH_DEEPSEEK_SESSION_ROOT: '/tmp/deepseek-sessions',
    };

    adaptDeepseekHarnessEnvironment(env);

    expect(env).toMatchObject({
      DSH_HOME: '/tmp/acpx-deepseek-home',
      DSH_PROVIDER: 'boft-deepseek',
      DSH_MODEL: 'deepseek-v4-flash',
      DSH_PERMISSION_MODE: 'workspace-write',
      DSH_SESSION_ROOT: '/tmp/deepseek-sessions',
    });
  });

  test('keeps explicit OpenMa DSH variables ahead of legacy ACEHarness values', () => {
    const env: NodeJS.ProcessEnv = {
      DSH_HOME: '/tmp/acpx-deepseek-home',
      DSH_PROVIDER: 'explicit-route',
      DSH_MODEL: 'explicit-model',
      DSH_PERMISSION_MODE: 'danger-full-access',
      DSH_SESSION_ROOT: '/tmp/explicit-sessions',
      ACEH_DEEPSEEK_PROVIDER: 'legacy-route',
      ACEH_DEEPSEEK_MODEL: 'legacy-route/legacy-model',
      ACEH_DEEPSEEK_PERMISSION_MODE: 'workspace-write',
      ACEH_DEEPSEEK_SESSION_ROOT: '/tmp/legacy-sessions',
    };

    adaptDeepseekHarnessEnvironment(env);

    expect(env).toMatchObject({
      DSH_PROVIDER: 'explicit-route',
      DSH_MODEL: 'explicit-model',
      DSH_PERMISSION_MODE: 'danger-full-access',
      DSH_SESSION_ROOT: '/tmp/explicit-sessions',
    });
  });

  test('does not contain package-manager or gateway startup logic', async () => {
    const [launcher, bin] = await Promise.all([
      readFile(resolve(process.cwd(), 'runtime/deepseek-harness-launcher.mjs'), 'utf8'),
      readFile(resolve(process.cwd(), 'bin/deepseek-harness.mjs'), 'utf8'),
    ]);
    expect(launcher).not.toContain('child_process');
    expect(launcher).not.toContain('dsh-acp-gateway');
    expect(bin).not.toContain('dsh-acp-gateway');
    expect(bin).not.toContain('ACEH_DEEPSEEK_GATEWAY_CHILD');
  });
});
