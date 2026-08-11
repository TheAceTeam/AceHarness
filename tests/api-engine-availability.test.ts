import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeRequest, responseJson } from './helpers/route-helpers';
import { withIsolatedAceHome } from './helpers/module-helpers';

describe('/api/engine/availability', () => {
  afterEach(() => {
    vi.resetModules();
  });

  test.each([
    ['nga', 'ACEH_NGA_COMMAND', 'ngagent'],
    ['codeagent', 'ACEH_CODEAGENT_COMMAND', 'codeagent'],
    ['codegenie', 'ACEH_CODEGENIE_COMMAND', 'codegenie'],
  ])('resolves the configured %s command before probing', async (engine, overrideKey, fixtureName) => {
    await withIsolatedAceHome(async (aceHome) => {
      const commandPath = path.join(aceHome, 'configured command with spaces', process.platform === 'win32' ? `${fixtureName}.cmd` : fixtureName);
      await mkdir(path.dirname(commandPath), { recursive: true });
      const commandSource = process.platform === 'win32'
        ? '@echo off\r\necho configured-agent-test\r\nexit /b 0\r\n'
        : '#!/bin/sh\necho configured-agent-test\nexit 0\n';
      await writeFile(commandPath, commandSource, 'utf8');
      if (process.platform !== 'win32') await chmod(commandPath, 0o755);

      const previousCommand = process.env[overrideKey];
      process.env[overrideKey] = commandPath;
      try {
        const route = await import('@/server/api-routes/engine/availability/route');
        const response = await route.GET(makeRequest(`/api/engine/availability?engine=${engine}&refresh=1`));
        const json = await responseJson(response);

        expect(response.status).toBe(200);
        expect(json).toMatchObject({
          engine,
          available: true,
          diagnostics: {
            status: 'available',
          },
        });
      } finally {
        if (previousCommand === undefined) delete process.env[overrideKey];
        else process.env[overrideKey] = previousCommand;
      }
    });
  });
});
