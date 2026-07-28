import { describe, expect, test } from 'vitest';
import { normalizeDashboardSearch } from '@/routes/dashboard';
import { normalizeEnginesSearch } from '@/routes/engines';
import { normalizeKnowledgeLibrarySearch } from '@/routes/knowledge.library';
import { normalizeModelsSearch } from '@/routes/models';
import { normalizeNotebookSearch } from '@/routes/notebook';

describe('typed route search normalizers', () => {
  test('normalizes model tabs', () => {
    expect(normalizeModelsSearch({ tab: 'probe' })).toEqual({ tab: 'probe' });
    expect(normalizeModelsSearch({ tab: 'diagnostics' })).toEqual({ tab: 'diagnostics' });
    expect(normalizeModelsSearch({ tab: 'unknown' })).toEqual({ tab: 'catalog' });
  });

  test('normalizes engine selection without accepting arbitrary values', () => {
    expect(normalizeEnginesSearch({ engine: 'opencode' })).toEqual({ engine: 'opencode' });
    expect(normalizeEnginesSearch({ engine: 'not-a-known-engine' })).toEqual({ engine: undefined });
    expect(normalizeEnginesSearch({ engine: 'engine with spaces' })).toEqual({ engine: undefined });
  });

  test('normalizes knowledge library selection', () => {
    expect(normalizeKnowledgeLibrarySearch({ kb: 'default', document: 'source-1' })).toEqual({
      kb: 'default',
      document: 'source-1',
    });
    expect(normalizeKnowledgeLibrarySearch({ kb: '  ', document: 42 })).toEqual({
      kb: undefined,
      document: undefined,
    });
  });

  test('normalizes notebook selection', () => {
    expect(normalizeNotebookSearch({
      notebook: '1',
      notebookScope: 'personal',
      notebookFile: 'notes/today.cj.md',
      notebookShare: 'share-token',
      notebookPermission: 'read',
      returnTo: '/knowledge',
    })).toEqual({
      notebook: '1',
      notebookScope: 'personal',
      notebookFile: 'notes/today.cj.md',
      notebookShare: 'share-token',
      notebookPermission: 'read',
      returnTo: '/knowledge',
    });
    expect(normalizeNotebookSearch({ notebookScope: 'team', notebookPermission: 'admin' })).toEqual({
      notebook: undefined,
      notebookScope: 'global',
      notebookFile: undefined,
      notebookShare: undefined,
      notebookPermission: 'write',
      returnTo: undefined,
    });
  });

  test('normalizes dashboard dock URL state', () => {
    expect(normalizeDashboardSearch({ panel: 'skills' })).toEqual({
      panel: 'skills',
      route: undefined,
    });
    expect(normalizeDashboardSearch({ panel: 'skills', route: '/knowledge/library?kb=default' })).toEqual({
      panel: undefined,
      route: '/knowledge/library?kb=default',
    });
    expect(normalizeDashboardSearch({ route: '/workbench/sample.yaml?mode=design' })).toEqual({
      panel: undefined,
      route: '/workbench/sample.yaml?mode=design',
    });
    expect(normalizeDashboardSearch({ route: '/dashboard?panel=skills' })).toEqual({
      panel: undefined,
      route: undefined,
    });
    expect(normalizeDashboardSearch({ route: 'https://example.test/workflows' })).toEqual({
      panel: undefined,
      route: undefined,
    });
  });
});
