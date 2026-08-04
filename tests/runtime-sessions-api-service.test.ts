import { afterEach, describe, expect, test } from 'vitest';
import { openRuntimeSqliteDatabase, type RuntimeSqliteDatabase } from '@/lib/runtime-agent/sqlite/database';
import {
  createSqliteRuntimeSessionsApiService,
  type RuntimeSessionsApiService,
} from '@/server/runtime/runtime-sessions-api-service';

describe('RuntimeSessionsApiService', () => {
  let db: RuntimeSqliteDatabase | undefined;
  let service: RuntimeSessionsApiService | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    service = undefined;
  });

  test('surfaces a pre-creation orchestrator failure without waiting for the turn poll timeout', async () => {
    db = openRuntimeSqliteDatabase(':memory:');
    service = createSqliteRuntimeSessionsApiService({ db });

    await expect(service.createTurn({
      runtimeSessionId: 'missing-runtime-session',
      requestId: 'request-1',
      input: 'hello',
    })).rejects.toThrow('Runtime session not found: missing-runtime-session');
  });
});
