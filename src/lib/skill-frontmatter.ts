import { parse } from 'yaml';

export type SkillFrontmatterValidation =
  | { ok: true; frontmatter: Record<string, any> }
  | { ok: false; error: string };

/** Parse and validate YAML frontmatter from SKILL.md content. */
export function validateSkillFrontmatter(content: string): SkillFrontmatterValidation {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return { ok: false, error: 'SKILL.md 必须以 YAML frontmatter 开头，并使用独立的 --- 分隔' };
  }

  let frontmatter: any;
  try {
    frontmatter = parse(match[1]);
  } catch (error) {
    const message = (error as Error).message.split('\n')[0];
    return { ok: false, error: `SKILL.md frontmatter YAML 解析失败：${message}` };
  }

  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    return { ok: false, error: 'SKILL.md frontmatter 必须是 YAML 对象' };
  }
  if (typeof frontmatter.name !== 'string' || !frontmatter.name.trim()) {
    return { ok: false, error: 'SKILL.md frontmatter 缺少必填字段 name' };
  }
  if (typeof frontmatter.description !== 'string' || !frontmatter.description.trim()) {
    return { ok: false, error: 'SKILL.md frontmatter 缺少必填字段 description' };
  }
  if (frontmatter.tags !== undefined && !Array.isArray(frontmatter.tags)) {
    return { ok: false, error: 'SKILL.md frontmatter 字段 tags 必须是数组' };
  }
  if (frontmatter.source !== undefined && typeof frontmatter.source !== 'string') {
    return { ok: false, error: 'SKILL.md frontmatter 字段 source 必须是字符串' };
  }

  return { ok: true, frontmatter };
}

export function normalizeSkillSource(source: unknown): string {
  return typeof source === 'string' && source.trim() ? source.trim() : 'cangjie';
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}
