import { existsSync } from 'node:fs';
import { lstat, mkdir, rm, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createDirectorySymlink, withIsolatedAceHome } from './helpers/module-helpers';

const BUNDLED_SKILL = 'aceharness-rag';

// 让某个具体路径上的 stat 抛出指定 errno，其余一律走真实实现。
const statFailure = vi.hoisted(() => ({ current: null as null | { path: string; code: string } }));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    stat: async (target: any, ...rest: any[]) => {
      const failure = statFailure.current;
      if (failure && path.resolve(String(target)) === path.resolve(failure.path)) {
        throw Object.assign(new Error(`mocked ${failure.code}`), { code: failure.code });
      }
      return (actual.stat as any)(target, ...rest);
    },
  };
});

/** 造悬空链接：先链到真实目录，再把目标删掉。 */
async function plantDanglingLink(aceHome: string, name: string): Promise<string> {
  const skillsDir = path.join(aceHome, 'skills');
  await mkdir(skillsDir, { recursive: true });
  const doomedTarget = path.join(aceHome, 'doomed-target');
  await mkdir(doomedTarget, { recursive: true });
  const linkPath = path.join(skillsDir, name);
  await createDirectorySymlink(doomedTarget, linkPath);
  await rm(doomedTarget, { recursive: true, force: true });
  return linkPath;
}

async function plantLiveLink(aceHome: string, name: string): Promise<string> {
  const skillsDir = path.join(aceHome, 'skills');
  await mkdir(skillsDir, { recursive: true });
  const liveTarget = path.join(aceHome, 'live-target');
  await mkdir(liveTarget, { recursive: true });
  const linkPath = path.join(skillsDir, name);
  await createDirectorySymlink(liveTarget, linkPath);
  return linkPath;
}

describe('bundled skills 播种遇到软链接残留', () => {
  test('悬空链接被清理，工作流启动不再被中止', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const linkPath = await plantDanglingLink(aceHome, BUNDLED_SKILL);

      // 前提：existsSync 跟随链接，因此对悬空链接返回 false ——
      // 原代码正是用它判断「这里是空的」，于是既不删也不跳过。
      expect(existsSync(linkPath)).toBe(false);

      const { ensureRuntimeSkillsSeeded } = await import('@/lib/run/runtime-skills');
      await expect(
        ensureRuntimeSkillsSeeded({ refreshBundledSkills: true }),
      ).resolves.toBeUndefined();

      expect(existsSync(path.join(linkPath, 'SKILL.md'))).toBe(true);
    });
  });

  test('悬空链接不影响其余 bundled skills 落地', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await plantDanglingLink(aceHome, BUNDLED_SKILL);

      const { ensureRuntimeSkillsSeeded } = await import('@/lib/run/runtime-skills');
      await ensureRuntimeSkillsSeeded({ refreshBundledSkills: true });

      const installed = await readdir(path.join(aceHome, 'skills'));
      expect(installed.length).toBeGreaterThan(1);
      expect(installed).toContain(BUNDLED_SKILL);
    });
  });

  test('有效软链接不被误删', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const linkPath = await plantLiveLink(aceHome, 'my-own-skill');

      const { ensureRuntimeSkillsSeeded } = await import('@/lib/run/runtime-skills');
      await ensureRuntimeSkillsSeeded({ refreshBundledSkills: true });

      expect(existsSync(linkPath)).toBe(true);
      expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
    });
  });

  // 评审意见 3：目录在升级后变成普通文件时，链接目标同样无法解析。
  // POSIX 上 stat 报 ENOTDIR，Windows 上同一场景报 ENOENT —— 两边都必须清理。
  test('链接目标路径穿过普通文件时同样被清理', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const skillsDir = path.join(aceHome, 'skills');
      await mkdir(skillsDir, { recursive: true });
      // 升级后 target-file 从目录变成了普通文件
      const targetFile = path.join(aceHome, 'target-file');
      await writeFile(targetFile, 'i am a regular file now\n');
      const linkPath = path.join(skillsDir, BUNDLED_SKILL);
      await createDirectorySymlink(path.join(targetFile, 'child'), linkPath);

      expect(existsSync(linkPath)).toBe(false);

      const { ensureRuntimeSkillsSeeded } = await import('@/lib/run/runtime-skills');
      await expect(
        ensureRuntimeSkillsSeeded({ refreshBundledSkills: true }),
      ).resolves.toBeUndefined();

      expect(existsSync(path.join(linkPath, 'SKILL.md'))).toBe(true);
    });
  });

  // 同一场景的平台无关版本：直接固定 ENOTDIR，确保非 Windows 上也走清理分支。
  test('stat 报 ENOTDIR 时清理链接并正常拷贝', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const linkPath = await plantLiveLink(aceHome, BUNDLED_SKILL);
      statFailure.current = { path: linkPath, code: 'ENOTDIR' };
      try {
        const { ensureRuntimeSkillsSeeded } = await import('@/lib/run/runtime-skills');
        await expect(
          ensureRuntimeSkillsSeeded({ refreshBundledSkills: true }),
        ).resolves.toBeUndefined();

        expect((await lstat(linkPath)).isSymbolicLink()).toBe(false);
        expect(existsSync(path.join(linkPath, 'SKILL.md'))).toBe(true);
      } finally {
        statFailure.current = null;
      }
    });
  });

  // 评审意见 1：只有确认目标不存在才该删。权限/IO 错误若被当成「目标没了」，
  // 会把用户一个有效的链接删掉 —— 那是不可恢复的数据损失。
  test.each(['EACCES', 'EPERM', 'EBUSY'])(
    'stat 报 %s 时不删链接，错误原样上抛',
    async (code) => {
      await withIsolatedAceHome(async (aceHome) => {
        const linkPath = await plantLiveLink(aceHome, BUNDLED_SKILL);
        statFailure.current = { path: linkPath, code };
        try {
          const { ensureRuntimeSkillsSeeded } = await import('@/lib/run/runtime-skills');
          await expect(
            ensureRuntimeSkillsSeeded({ refreshBundledSkills: true }),
          ).rejects.toMatchObject({ code });

          // 关键断言：链接必须还在
          expect(existsSync(linkPath)).toBe(true);
          expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
        } finally {
          statFailure.current = null;
        }
      });
    },
  );
});
