import { existsSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createRuntimeDatabaseGrant,
  expandDatabaseCapabilitySkillNames,
  expandCapabilitySkillNames,
  resolveWorkspaceSqliteDatabase,
} from '@/lib/runtime/database-capabilities';
import {
  createRuntimeSqliteDatabase,
  execRuntimeSqlite,
  queryRuntimeSqlite,
  RuntimeSqliteError,
  validateExecSql,
  validateQuerySql,
} from '@/lib/runtime/sqlite-capability';

let tempDirs: string[] = [];
let aceHome = '';
let originalAceHome: string | undefined;

async function tempWorkspace() {
  const dir = await mkdtemp(path.join(tmpdir(), 'ace-runtime-db-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(async () => {
  originalAceHome = process.env.ACE_HOME;
  aceHome = await tempWorkspace();
  process.env.ACE_HOME = aceHome;
});

afterEach(async () => {
  if (originalAceHome === undefined) {
    delete process.env.ACE_HOME;
  } else {
    process.env.ACE_HOME = originalAceHome;
  }
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
  aceHome = '';
});

describe('runtime database capabilities', () => {
  test('expands enabled capability skills into context skills', () => {
    expect(expandCapabilitySkillNames(['demo'], {
      rag: { enabled: true },
      sqlite: { enabled: true, databases: [] },
    })).toEqual(['demo', 'aceharness-rag', 'aceharness-sqlite']);
  });

  test('agent-level rag knowledge bases enable rag skill and grant', async () => {
    const workspaceRoot = await tempWorkspace();
    expect(expandDatabaseCapabilitySkillNames({
      skills: [],
      agentRagKnowledgeBases: ['default'],
    })).toEqual(['aceharness-rag']);
    const grant = await createRuntimeDatabaseGrant({
      workspaceRoot,
      skills: [],
      agentRagKnowledgeBases: ['default'],
    });
    expect(grant?.rag?.enabled).toBe(true);
    expect(grant?.rag?.knowledgeBases).toEqual(['default']);
    expect(existsSync(path.join(aceHome, 'data', 'runtime-grants', `${grant!.token}.json`))).toBe(true);
  });

  test('rejects sqlite paths outside workspace', async () => {
    const workspaceRoot = await tempWorkspace();
    expect(() => resolveWorkspaceSqliteDatabase({
      workspaceRoot,
      name: 'bad',
      relativePath: '../bad.sqlite',
    })).toThrow('SQLITE_PATH_ESCAPE');
  });

  test('rejects unsafe sqlite statements', () => {
    expect(() => validateQuerySql('DELETE FROM items')).toThrow(RuntimeSqliteError);
    expect(() => validateExecSql('ATTACH DATABASE ? AS other')).toThrow(RuntimeSqliteError);
    expect(() => validateExecSql('VACUUM INTO "x.db"')).toThrow(RuntimeSqliteError);
  });

  test('creates, writes, and queries a granted workspace sqlite database', async () => {
    const workspaceRoot = await tempWorkspace();
    const grant = await createRuntimeDatabaseGrant({
      workspaceRoot,
      runId: 'run-db-test',
      skills: [],
      capabilitySkills: {
        sqlite: {
          enabled: true,
          databases: [{
            name: 'workflow-cache',
            path: '.aceharness/db/workflow-cache.sqlite',
            allowCreate: true,
            allowDelete: true,
            readOnly: false,
          }],
        },
      },
    });
    expect(grant).not.toBeNull();
    await createRuntimeSqliteDatabase(grant!, 'workflow-cache');
    await execRuntimeSqlite(grant!, {
      database: 'workflow-cache',
      sql: 'CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, value TEXT NOT NULL)',
    });
    await execRuntimeSqlite(grant!, {
      database: 'workflow-cache',
      sql: 'INSERT OR REPLACE INTO items(id, value) VALUES(?, ?)',
      params: ['item-1', 'value-1'],
    });
    const result = await queryRuntimeSqlite(grant!, {
      database: 'workflow-cache',
      sql: 'SELECT value FROM items WHERE id = ?',
      params: ['item-1'],
    });
    expect(result.rows).toEqual([{ value: 'value-1' }]);
  });
});
