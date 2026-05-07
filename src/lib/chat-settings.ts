/**
 * Chat 技能设置持久化 - 存储到 data/chat-settings.yaml
 * 自动发现 skills/xxx/SKILL.md，从 frontmatter 提取元数据
 */

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import { parse, stringify } from 'yaml';
import { getWorkspaceDataFile } from '@/lib/app-paths';
import { getRuntimeSkillsDirPath } from '@/lib/runtime-skills';
import { normalizeSkillSource, normalizeStringArray, validateSkillFrontmatter } from '@/lib/skill-frontmatter';

const SETTINGS_PATH = getWorkspaceDataFile('chat-settings.yaml');

export interface SkillInfo {
  name: string;        // 目录名，如 power-gitcode
  label: string;       // 显示名，从 SKILL.md # 标题提取
  description: string; // 简介
  enabled: boolean;
  source?: string;     // 来源: 'cangjie' | 'anthropics'
  tags?: string[];     // 标签
}

export interface ChatSettings {
  skills: Record<string, boolean>;
  workingDirectory?: string;
}

/** 从 SKILL.md 提取标题和描述（body 部分，frontmatter 之后） */
function parseSkillMdBody(content: string): { label: string; description: string } {
  // Strip frontmatter
  let body = content;
  if (content.startsWith('---')) {
    const endIdx = content.indexOf('---', 3);
    if (endIdx > 0) body = content.substring(endIdx + 3).trim();
  }
  const lines = body.split('\n');
  let label = '';
  let description = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!label && trimmed.startsWith('# ')) {
      label = trimmed.slice(2).trim();
      continue;
    }
    if (label && !description && trimmed && !trimmed.startsWith('#')) {
      description = trimmed;
      break;
    }
  }
  return { label, description };
}

/** 扫描 skills/xxx/SKILL.md，发现所有技能并提取元数据 */
export async function discoverSkills(): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];
  try {
    const skillsDir = await getRuntimeSkillsDirPath();
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      try {
        const content = await readFile(resolve(skillsDir, name, 'SKILL.md'), 'utf-8');
        const validation = validateSkillFrontmatter(content);
        if (!validation.ok) continue;
        const fm = validation.frontmatter;

        const body = parseSkillMdBody(content);
        const label = body.label || fm.name;
        // Prefer Chinese description
        const description = fm.descriptionZH || fm.description || body.description || '';

        skills.push({
          name,
          label,
          description,
          enabled: true,
          source: normalizeSkillSource(fm.source),
          tags: normalizeStringArray(fm.tags),
        });
      } catch { /* no SKILL.md */ }
    }
  } catch { /* skills dir doesn't exist */ }
  return skills;
}

export async function loadChatSettings(): Promise<ChatSettings> {
  const discovered = await discoverSkills();
  const discoveredNames = new Set(discovered.map((skill) => skill.name));
  const defaults: Record<string, boolean> = {};
  const DEFAULT_ENABLED = ['aceharness-chat-card'];
  for (const s of discovered) defaults[s.name] = DEFAULT_ENABLED.includes(s.name);

  try {
    const content = await readFile(SETTINGS_PATH, 'utf-8');
    const parsed = parse(content);
    const persistedSkills: Record<string, boolean> = Object.fromEntries(
      Object.entries(parsed?.skills || {}).filter(
        ([name, enabled]) => discoveredNames.has(name) && typeof enabled === 'boolean'
      )
    ) as Record<string, boolean>;
    return { skills: { ...defaults, ...persistedSkills }, workingDirectory: parsed?.workingDirectory };
  } catch {
    return { skills: defaults };
  }
}

export async function saveChatSettings(settings: ChatSettings): Promise<void> {
  await mkdir(dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, stringify(settings), 'utf-8');
}
