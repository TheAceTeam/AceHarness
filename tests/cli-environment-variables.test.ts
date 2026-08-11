import { describe, expect, test } from 'vitest';
import { getCliEnvironmentGroupId, getCliEnvironmentVariable } from '@/lib/core/cli-environment-variables';

describe('CLI environment variable catalog', () => {
  test('publishes every ACP executable override in the other CLI group', () => {
    for (const key of ['ACEH_NGA_COMMAND', 'ACEH_CODEAGENT_COMMAND', 'ACEH_CODEGENIE_COMMAND']) {
      expect(getCliEnvironmentGroupId(key)).toBe('other-cli');
      expect(getCliEnvironmentVariable(key)).toMatchObject({
        key,
        label: expect.stringContaining('ACP'),
      });
    }
  });
});
