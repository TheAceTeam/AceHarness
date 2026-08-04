import { describe, expect, test } from 'vitest';
import { buildEnvObject, mergeEnvVars, type EnvVar } from '@/lib/core/env-manager';
import { mergeConfiguredEnv } from '@/lib/core/configured-env';

describe('configured environment precedence', () => {
  test('personal usable values win while blank or disabled personal rows fall back to system values', () => {
    const systemVars: EnvVar[] = [
      { key: 'SHARED_TOKEN', value: 'system', enabled: true },
      { key: 'SYSTEM_ONLY', value: 'system-only', enabled: true },
    ];
    const userVars: EnvVar[] = [
      { key: 'SHARED_TOKEN', value: 'personal', enabled: true },
      { key: 'SYSTEM_ONLY', value: '', enabled: true },
      { key: 'EMPTY_ONLY', value: '', enabled: false },
    ];

    expect(buildEnvObject(mergeEnvVars(systemVars, userVars))).toEqual({
      SHARED_TOKEN: 'personal',
      SYSTEM_ONLY: 'system-only',
    });
  });

  test('configured values override the host without allowing empty or undefined values to erase it', () => {
    const merged = mergeConfiguredEnv(
      {
        SHARED_TOKEN: 'host',
        HOST_ONLY: 'host-only',
        EMPTY_CONFIG: 'host-value',
      },
      {
        SHARED_TOKEN: 'system',
        PERSONAL_ONLY: 'personal',
        EMPTY_CONFIG: '',
        UNDEFINED_CONFIG: undefined,
      },
      {
        HOST_ONLY: undefined,
        EMPTY_CONFIG: '',
        NULL_CONFIG: null,
      },
    );

    expect(merged).toMatchObject({
      SHARED_TOKEN: 'system',
      PERSONAL_ONLY: 'personal',
      HOST_ONLY: 'host-only',
      EMPTY_CONFIG: 'host-value',
    });
    expect(merged.UNDEFINED_CONFIG).toBeUndefined();
    expect(merged.NULL_CONFIG).toBeUndefined();
  });
});
