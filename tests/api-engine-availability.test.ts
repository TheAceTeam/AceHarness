import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeRequest, responseJson } from './helpers/route-helpers';
import { withIsolatedAceHome } from './helpers/module-helpers';

describe('/api/engine/availability', () => {
  afterEach(() => {
    vi.resetModules();
  });

  test('resolves the configured CodeGenie command before probing on Windows', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const commandPath = path.join(aceHome, process.platform === 'win32' ? 'codegenie.cmd' : 'codegenie');
      const commandSource = process.platform === 'win32'
        ? '@echo off\r\necho codegenie-test\r\nexit /b 0\r\n'
        : '#!/bin/sh\necho codegenie-test\nexit 0\n';
      await writeFile(commandPath, commandSource, 'utf8');
      if (process.platform !== 'win32') await chmod(commandPath, 0o755);

      const previousCommand = process.env.ACEH_CODEGENIE_COMMAND;
      process.env.ACEH_CODEGENIE_COMMAND = commandPath;
      try {
        const route = await import('@/server/api-routes/engine/availability/route');
        const response = await route.GET(makeRequest('/api/engine/availability?engine=codegenie&refresh=1'));
        const json = await responseJson(response);

        expect(response.status).toBe(200);
        expect(json).toMatchObject({
          engine: 'codegenie',
          available: true,
          diagnostics: {
            status: 'available',
          },
        });
      } finally {
        if (previousCommand === undefined) delete process.env.ACEH_CODEGENIE_COMMAND;
        else process.env.ACEH_CODEGENIE_COMMAND = previousCommand;
      }
    });
  });
});
