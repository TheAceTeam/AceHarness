import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import unzipper from 'unzipper';
import { PUT } from '@/app/api/skills/route';
import {
  getRuntimeSkillsDirPath,
  getSkillsTempPath,
} from '@/lib/run/runtime-skills';
import { withTempDir } from './helpers/module-helpers';
import { makeRequest } from './helpers/route-helpers';

vi.mock('@/lib/run/runtime-skills', () => ({
  getInstallSkillsDirPath: vi.fn(() => path.join('__test__', 'install', 'skills')),
  getRuntimeSkillsDirPath: vi.fn(),
  getSkillsTempPath: vi.fn(),
  syncInstalledSkillsToRuntime: vi.fn(),
}));

const MINIMAL_SKILL = (name: string, description: string) =>
  `---
name: ${name}
description: ${description}
---

# ${name}
`;

async function listZipEntryPaths(buffer: Buffer): Promise<string[]> {
  const paths: string[] = [];
  const parser = unzipper.Parse();
  parser.on('entry', (entry: { path: string; autodrain: () => void }) => {
    paths.push(entry.path.split(path.sep).join('/'));
    entry.autodrain();
  });
  Readable.from(buffer).pipe(parser);
  await finished(parser);
  return paths.sort();
}

describe('PUT /api/skills (export zip)', () => {
  beforeEach(() => {
    vi.mocked(getRuntimeSkillsDirPath).mockReset();
    vi.mocked(getSkillsTempPath).mockReset();
  });

  test('returns 400 when no skills selected', async () => {
    const res = await PUT(
      makeRequest('/api/skills', { method: 'PUT', json: { skills: [] } })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('导出');
  });

  test('returns 404 when a skill directory is missing', async () => {
    await withTempDir('skills-export-api-', async (base) => {
      const skillsDir = path.join(base, 'skills');
      const cacheSkills = path.join(base, 'cache', 'skills');
      await mkdir(path.join(skillsDir, 'only-one'), { recursive: true });
      await writeFile(
        path.join(skillsDir, 'only-one', 'SKILL.md'),
        MINIMAL_SKILL('only-one', 'exists')
      );

      vi.mocked(getRuntimeSkillsDirPath).mockResolvedValue(skillsDir);
      vi.mocked(getSkillsTempPath).mockImplementation((...segs: string[]) =>
        path.join(cacheSkills, ...segs)
      );

      const res = await PUT(
        makeRequest('/api/skills', {
          method: 'PUT',
          json: { skills: ['only-one', 'missing-skill'] },
        })
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain('missing-skill');
    });
  });

  test('returns a zip containing selected skill trees (yazl, no system zip)', async () => {
    await withTempDir('skills-export-api-', async (base) => {
      const skillsDir = path.join(base, 'skills');
      const cacheSkills = path.join(base, 'cache', 'skills');

      await mkdir(path.join(skillsDir, 'alpha', 'nested'), { recursive: true });
      await writeFile(
        path.join(skillsDir, 'alpha', 'SKILL.md'),
        MINIMAL_SKILL('alpha', 'Alpha skill')
      );
      await writeFile(
        path.join(skillsDir, 'alpha', 'nested', 'note.txt'),
        'nested file'
      );

      await mkdir(path.join(skillsDir, 'beta'), { recursive: true });
      await writeFile(
        path.join(skillsDir, 'beta', 'SKILL.md'),
        MINIMAL_SKILL('beta', 'Beta skill')
      );

      vi.mocked(getRuntimeSkillsDirPath).mockResolvedValue(skillsDir);
      vi.mocked(getSkillsTempPath).mockImplementation((...segs: string[]) =>
        path.join(cacheSkills, ...segs)
      );

      const res = await PUT(
        makeRequest('/api/skills', {
          method: 'PUT',
          json: { skills: ['alpha', 'beta'] },
        })
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/zip');
      expect(res.headers.get('content-disposition')).toContain(
        'skills-export.zip'
      );

      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.length).toBeGreaterThan(50);

      const entries = await listZipEntryPaths(buf);
      expect(entries).toEqual(
        [
          'alpha/SKILL.md',
          'alpha/nested/note.txt',
          'beta/SKILL.md',
        ].sort()
      );
    });
  });
});
