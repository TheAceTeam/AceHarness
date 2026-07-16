import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  resolveInstallRootFromEnvironment,
  resolveRuntimeRootFromEnvironment,
} from '@/lib/core/app-paths';

describe('CSIHarness app path isolation', () => {
  test('uses CSIHARNESS_HOME and ignores ACE_HOME', () => {
    expect(resolveRuntimeRootFromEnvironment({
      env: { CSIHARNESS_HOME: '/tmp/csi-home', ACE_HOME: '/tmp/ace-home' },
      platform: 'linux',
      home: '/Users/demo',
    })).toBe(path.resolve('/tmp/csi-home'));

    expect(resolveRuntimeRootFromEnvironment({
      env: { ACE_HOME: '/tmp/ace-home' },
      platform: 'linux',
      home: '/Users/demo',
    })).toBe(path.resolve('/Users/demo/.csiharness'));
  });

  test('supports platform defaults and XDG without legacy directory names', () => {
    expect(resolveRuntimeRootFromEnvironment({
      env: { XDG_DATA_HOME: '/var/data' },
      platform: 'linux',
      home: '/Users/demo',
    })).toBe(path.resolve('/var/data/csiharness'));

    expect(resolveRuntimeRootFromEnvironment({
      env: { APPDATA: 'C:\\Users\\demo\\AppData\\Roaming' },
      platform: 'win32',
      home: 'C:\\Users\\demo',
    })).toBe(path.win32.resolve('C:\\Users\\demo\\AppData\\Roaming', 'CSIHarness'));
  });

  test('expands tilde homes and rejects relative runtime roots', () => {
    expect(resolveRuntimeRootFromEnvironment({
      env: { CSIHARNESS_HOME: '~/custom-csi' },
      platform: 'darwin',
      home: '/Users/demo',
    })).toBe(path.resolve('/Users/demo/custom-csi'));

    expect(() => resolveRuntimeRootFromEnvironment({
      env: { CSIHARNESS_HOME: 'relative/csi' },
      platform: 'linux',
      home: '/Users/demo',
    })).toThrow(/CSIHARNESS_HOME.*absolute/i);
  });

  test('uses only the CSIHARNESS install root variable', () => {
    expect(resolveInstallRootFromEnvironment({
      CSIHARNESS_INSTALL_ROOT: '/opt/csiharness',
      ACE_INSTALL_ROOT: '/opt/aceharness',
    }, '/workspace')).toBe(path.resolve('/opt/csiharness'));

    expect(resolveInstallRootFromEnvironment({
      ACE_INSTALL_ROOT: '/opt/aceharness',
    }, '/workspace')).toBe(path.resolve('/workspace'));
  });
});
