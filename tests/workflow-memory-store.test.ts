import { existsSync } from 'fs';
import path from 'path';
import { describe, expect, test, vi } from 'vitest';
import { withTempDir } from './helpers/module-helpers';

describe('workflow memory store', () => {
  test('stores layered memories in sqlite and supports replace append list and clear', async () => {
    await withTempDir('aceharness-memory-store-', async (dir) => {
      const dataDir = path.join(dir, 'data');
      vi.resetModules();
      vi.doMock('@/lib/core/app-paths', () => ({
        getWorkspaceDataFile: (...segments: string[]) => path.join(dataDir, ...segments),
      }));

      const {
        appendMemoryEntries,
        clearMemoryEntries,
        getMemoryBucket,
        listMemoryEntries,
        listScopeMemories,
        replaceMemoryEntries,
      } = await import('@/lib/workflow/memory-store');

      await replaceMemoryEntries({
        scope: 'role',
        key: 'planner',
        entries: [{
          id: 'role-planner-base',
          kind: 'base',
          title: '基础偏好',
          content: '先总结结论，再列风险。',
          source: 'test',
          agent: 'planner',
          tags: ['base', 'preference'],
        }],
      });

      await appendMemoryEntries([
        {
          scope: 'role',
          key: 'planner',
          kind: 'review',
          title: '复盘',
          content: '拆分任务时保留验收命令。',
          source: 'unit-test',
          agent: 'planner',
          tags: ['review'],
        },
        {
          scope: 'project',
          key: 'workspace-a',
          kind: 'experience',
          title: '项目经验',
          content: '本项目优先使用 TanStack Query 缓存。',
          source: 'unit-test',
          tags: ['project'],
        },
      ]);

      const roleEntries = await listMemoryEntries({ scope: 'role', key: 'planner', limit: 10 });
      expect(roleEntries.map((entry) => entry.title)).toEqual(['复盘', '基础偏好']);
      expect(roleEntries[0]).toMatchObject({
        scope: 'role',
        key: 'planner',
        kind: 'review',
        content: '拆分任务时保留验收命令。',
        tags: ['review'],
      });

      const bucket = await getMemoryBucket({ scope: 'role', key: 'planner' });
      expect(bucket.entries).toHaveLength(2);
      expect(bucket.updatedAt).toBeTruthy();

      const scopeBuckets = await listScopeMemories({ scope: 'project', limit: 5 });
      expect(scopeBuckets).toHaveLength(1);
      expect(scopeBuckets[0].key).toBe('workspace-a');
      expect(scopeBuckets[0].entries[0].content).toContain('TanStack Query');

      expect(existsSync(path.join(dataDir, 'memory', 'memory.sqlite'))).toBe(true);
      expect(existsSync(path.join(dataDir, 'memory-layers', 'role', 'planner.yaml'))).toBe(false);

      await clearMemoryEntries({ scope: 'role', key: 'planner' });
      await expect(listMemoryEntries({ scope: 'role', key: 'planner', limit: 10 })).resolves.toEqual([]);
    });
  });
});
