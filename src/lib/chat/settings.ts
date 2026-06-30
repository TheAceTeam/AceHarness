/**
 * Chat 技能设置持久化 - 存储到 data/chat-settings.yaml
 * 自动发现 skills/xxx/SKILL.md，从 frontmatter 提取元数据
 */

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import { parse, stringify } from 'yaml';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { loadMcpRegistry } from '@/lib/mcp/registry';
import { getRuntimeSkillsDirPath } from '@/lib/run/runtime-skills';
import { normalizeSkillSource, normalizeStringArray, validateSkillFrontmatter } from '@/lib/skill/frontmatter';
import type { CapabilitySkillsConfig } from '@/lib/core/schemas';

const SETTINGS_PATH = getWorkspaceDataFile('chat-settings.yaml');
const CACHE_TTL_MS = 5_000;

let skillsCache: { value: SkillInfo[]; expiresAt: number } | null = null;
let settingsCache: { value: ChatSettings; expiresAt: number } | null = null;

export function invalidateChatSettingsCache(): void {
  skillsCache = null;
  settingsCache = null;
}

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
  mcpServers: Record<string, boolean>;
  workingDirectory?: string;
  capabilitySkills?: CapabilitySkillsConfig;
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

async function discoverSkillsUncached(): Promise<SkillInfo[]> {
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

/** 扫描 skills/xxx/SKILL.md，发现所有技能并提取元数据 */
export async function discoverSkills(): Promise<SkillInfo[]> {
  const now = Date.now();
  if (skillsCache && skillsCache.expiresAt > now) {
    return skillsCache.value;
  }
  const value = await discoverSkillsUncached();
  skillsCache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export async function loadChatSettings(): Promise<ChatSettings> {
  const now = Date.now();
  if (settingsCache && settingsCache.expiresAt > now) {
    return settingsCache.value;
  }

  const discovered = await discoverSkills();
  const discoveredNames = new Set(discovered.map((skill) => skill.name));
  const defaults: Record<string, boolean> = {};
  const DEFAULT_ENABLED = ['aceharness-chat-card'];
  for (const s of discovered) defaults[s.name] = DEFAULT_ENABLED.includes(s.name);
  const discoveredMcpServers = await loadMcpRegistry();
  const discoveredMcpNames = new Set(discoveredMcpServers.map((server) => server.name));
  const defaultMcpServers: Record<string, boolean> = {};
  for (const server of discoveredMcpServers) defaultMcpServers[server.name] = false;

  let value: ChatSettings;
  try {
    const content = await readFile(SETTINGS_PATH, 'utf-8');
    const parsed = parse(content);
    const persistedSkills: Record<string, boolean> = Object.fromEntries(
      Object.entries(parsed?.skills || {}).filter(
        ([name, enabled]) => discoveredNames.has(name) && typeof enabled === 'boolean'
      )
    ) as Record<string, boolean>;
    const persistedMcpServers: Record<string, boolean> = Object.fromEntries(
      Object.entries(parsed?.mcpServers || {}).filter(
        ([name, enabled]) => discoveredMcpNames.has(name) && typeof enabled === 'boolean'
      )
    ) as Record<string, boolean>;
    value = {
      skills: { ...defaults, ...persistedSkills },
      mcpServers: { ...defaultMcpServers, ...persistedMcpServers },
      workingDirectory: parsed?.workingDirectory,
      capabilitySkills: parsed?.capabilitySkills && typeof parsed.capabilitySkills === 'object'
        ? parsed.capabilitySkills
        : undefined,
    };
  } catch {
    value = { skills: defaults, mcpServers: defaultMcpServers };
  }

  settingsCache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export async function saveChatSettings(settings: ChatSettings): Promise<void> {
  await mkdir(dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, stringify(settings), 'utf-8');
  invalidateChatSettingsCache();
}
