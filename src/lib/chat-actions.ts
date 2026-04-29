/**
 * Chat Action Block 协议 - 类型定义 + 执行器
 */

import { configApi, agentApi, runsApi, workflowApi, scheduleApi } from './api';
import { getWorkspaceSkillPath } from './app-paths';
import {
  type HomeSidebarHint,
  shouldSuppressCardsForSidebarHint,
} from './home-sidebar-state';

// Action 类型枚举
export type ActionType =
  | 'config.list' | 'config.get' | 'config.validate' | 'config.create' | 'config.update' | 'config.delete'
  | 'agent.list' | 'agent.get' | 'agent.create' | 'agent.update' | 'agent.delete'
  | 'model.list'
  | 'workflow.start' | 'workflow.stop' | 'workflow.status'
  | 'runs.list' | 'runs.detail'
  | 'navigate'
  | 'skill.list'
  | 'prompt.analyze' | 'prompt.optimize'
  | 'wizard.workflow' | 'wizard.agent' | 'wizard.skill'
  // Schedule actions
  | 'schedule.list' | 'schedule.get' | 'schedule.create' | 'schedule.update'
  | 'schedule.delete' | 'schedule.trigger' | 'schedule.toggle';

// 风险等级
export type RiskLevel = 'safe' | 'mutating' | 'destructive';

// Action 元数据：描述 + 参数说明 + 分组
export interface ActionMeta {
  description: string;
  params: string;
  group: string;
  groupLabel: string;
  risk: RiskLevel;
}

/** Action 元数据注册表，用于动态生成提示词中的 action 列表 */
export const ACTION_REGISTRY: Record<ActionType, ActionMeta> = {
  // 配置管理
  'config.list':   { group: 'config', groupLabel: '配置管理（操作 configs/ 目录下的 YAML 文件）', risk: 'safe',        description: '列出所有工作流配置文件', params: '{}' },
  'config.get':    { group: 'config', groupLabel: '', risk: 'safe',        description: '读取某个配置文件的内容', params: '{ "filename": "xxx.yaml" }' },
  'config.validate': { group: 'config', groupLabel: '', risk: 'safe',      description: '校验工作流配置草案或已有配置文件', params: '{ "config": {完整配置对象} } 或 { "filename": "xxx.yaml" }' },
  'config.create': { group: 'config', groupLabel: '', risk: 'mutating',    description: '创建新的配置文件', params: '{ "filename": "xxx.yaml", "config": {完整配置对象} }' },
  'config.update': { group: 'config', groupLabel: '', risk: 'mutating',    description: '更新已有配置文件', params: '{ "filename": "xxx.yaml", "config": {完整配置对象} }' },
  'config.delete': { group: 'config', groupLabel: '', risk: 'destructive', description: '删除配置文件', params: '{ "filename": "xxx.yaml" }' },

  // Agent 管理
  'agent.list':   { group: 'agent', groupLabel: 'Agent 管理（操作 configs/agents/ 目录下的 YAML 文件）', risk: 'safe',        description: '列出所有 Agent 配置文件', params: '{}' },
  'agent.get':    { group: 'agent', groupLabel: '', risk: 'safe',        description: '读取某个 Agent 的配置', params: '{ "name": "agent-name" }' },
  'agent.create': { group: 'agent', groupLabel: '', risk: 'mutating',    description: '创建新的 Agent 配置文件', params: '{ "name": "agent-name", "agent": {完整Agent配置} }' },
  'agent.update': { group: 'agent', groupLabel: '', risk: 'mutating',    description: '更新已有 Agent 配置文件', params: '{ "name": "agent-name", "agent": {完整Agent配置} }' },
  'agent.delete': { group: 'agent', groupLabel: '', risk: 'destructive', description: '删除 Agent 配置文件', params: '{ "name": "agent-name" }' },

  // 模型
  'model.list': { group: 'model', groupLabel: '模型（读取 configs/models/models.yaml）', risk: 'safe', description: '列出可用模型', params: '{}' },

  // 工作流控制
  'workflow.start':  { group: 'workflow', groupLabel: '工作流控制（启动/停止基于配置文件的工作流运行）', risk: 'mutating', description: '启动工作流', params: '{ "configFile": "xxx.yaml" }' },
  'workflow.stop':   { group: 'workflow', groupLabel: '', risk: 'mutating', description: '停止当前工作流', params: '{}' },
  'workflow.status': { group: 'workflow', groupLabel: '', risk: 'safe',     description: '查看工作流运行状态', params: '{}' },

  // 运行记录
  'runs.list':   { group: 'runs', groupLabel: '运行记录（读取 runs/ 目录下的运行数据）', risk: 'safe', description: '查看运行记录', params: '{ "configFile": "xxx.yaml" }（可选，不传则列出所有配置的运行记录）' },
  'runs.detail': { group: 'runs', groupLabel: '', risk: 'safe', description: '查看运行详情', params: '{ "runId": "xxx" }' },

  // 导航
  'navigate': { group: 'navigate', groupLabel: '导航', risk: 'safe', description: '跳转页面', params: '{ "url": "/path" }\n  可用路径: /, /dashboard, /agents, /models, /workflows, /workbench/{configFile}, /schedules' },

  // 定时任务管理
  'schedule.list':    { group: 'schedule', groupLabel: '定时任务管理', risk: 'safe',        description: '列出所有定时任务', params: '{}' },
  'schedule.get':     { group: 'schedule', groupLabel: '', risk: 'safe',        description: '获取定时任务详情', params: '{ "id": "任务ID" }' },
  'schedule.create':  { group: 'schedule', groupLabel: '', risk: 'mutating',    description: '创建定时任务', params: '{ "name": "任务名称", "configFile": "xxx.yaml", "enabled": true, "mode": "simple|cron", "interval": {"value": 2, "unit": "hour|day|week"}, "fixedTime": {"hour": 0, "minute": 0, "weekday": 1}, "cronExpression": "0 */2 * * *" }' },
  'schedule.update':  { group: 'schedule', groupLabel: '', risk: 'mutating',    description: '更新定时任务', params: '{ "id": "任务ID", ...要更新的字段 }' },
  'schedule.delete':  { group: 'schedule', groupLabel: '', risk: 'destructive', description: '删除定时任务', params: '{ "id": "任务ID" }' },
  'schedule.trigger': { group: 'schedule', groupLabel: '', risk: 'mutating',    description: '立即触发一次定时任务', params: '{ "id": "任务ID" }' },
  'schedule.toggle':  { group: 'schedule', groupLabel: '', risk: 'mutating',    description: '启用/禁用定时任务', params: '{ "id": "任务ID" }' },

  // Skills 管理
  'skill.list': { group: 'skill', groupLabel: 'Skills 管理', risk: 'safe', description: '列出可用 Skills', params: '{}' },

  // 提示词优化
  'prompt.analyze':  { group: 'prompt', groupLabel: '提示词优化', risk: 'safe', description: '分析提示词效果', params: '{ "prompt": "提示词内容", "output": "输出内容(可选)" }' },
  'prompt.optimize': { group: 'prompt', groupLabel: '', risk: 'safe', description: '优化提示词', params: '{ "prompt": "原始提示词" }' },

  // 引导式创建向导
  'wizard.workflow': { group: 'wizard', groupLabel: '引导式创建向导', risk: 'safe', description: '工作流创建向导步骤', params: '{ "step": 步骤号, "title": "当前步骤标题", "hints": ["提示1","提示2"], "data": {已收集的数据} }' },
  'wizard.agent':    { group: 'wizard', groupLabel: '', risk: 'safe', description: 'Agent 创建向导步骤', params: '{ "step": 步骤号, "title": "当前步骤标题", "hints": ["提示1","提示2"], "data": {已收集的数据} }' },
  'wizard.skill':    { group: 'wizard', groupLabel: '', risk: 'safe', description: 'Skill 创建向导步骤', params: '{ "step": 步骤号, "title": "当前步骤标题", "hints": ["提示1","提示2"], "data": {已收集的数据} }' },
};

// 从 ACTION_REGISTRY 派生 RISK_MAP，避免重复维护
export const RISK_MAP: Record<ActionType, RiskLevel> = Object.fromEntries(
  Object.entries(ACTION_REGISTRY).map(([type, meta]) => [type, meta.risk])
) as Record<ActionType, RiskLevel>;

/** 从 ACTION_REGISTRY 动态生成精简的 action 类型列表（无 params 详情） */
export function generateActionTypesDocs(): string {
  const groups: Record<string, string[]> = {};
  const groupLabels: Record<string, string> = {
    config: '配置管理',
    agent: 'Agent 管理',
    model: '模型',
    workflow: '工作流控制',
    runs: '运行记录',
    navigate: '导航',
    schedule: '定时任务',
    skill: 'Skills 管理',
    prompt: '提示词优化',
    wizard: '创建向导',
  };

  for (const [type, meta] of Object.entries(ACTION_REGISTRY)) {
    if (!groups[meta.group]) groups[meta.group] = [];
    groups[meta.group].push(`\`${type}\``);
  }

  const lines: string[] = [];
  for (const [group, actions] of Object.entries(groups)) {
    const label = groupLabels[group] || group;
    lines.push(`**${label}**: ${actions.join(' | ')}`);
  }
  return lines.join('\n');
}

// Action Block 接口
export interface ActionBlock {
  type: ActionType;
  params: Record<string, any>;
  description: string;
}

// Action 执行状态
export type ActionStatus = 'pending' | 'auto_executing' | 'executing' | 'success' | 'error' | 'undone';

export interface ActionState {
  id: string;
  action: ActionBlock;
  status: ActionStatus;
  result?: any;
  error?: string;
  snapshot?: any; // 变更前快照，用于撤销
  timestamp: number;
}

// --- 解析 ---

/** Check if a parsed JSON object looks like a card */
function isCardLike(obj: any): boolean {
  return obj && typeof obj === 'object' && (
    (obj.header && typeof obj.header === 'object') ||
    (Array.isArray(obj.blocks) && obj.blocks.length > 0)
  );
}

/** Load full Material Icons list for validation (server-side only) */
const VALID_ICONS: Set<string> = (() => {
  if (typeof window !== 'undefined') {
    // Client-side: return minimal fallback (validation only runs server-side)
    return new Set(['help', 'info', 'check_circle', 'error', 'warning']);
  }
  try {
    const fs = require('fs');
    const jsonPath = getWorkspaceSkillPath('aceharness-chat-card', 'scripts', 'material-icons.json');
    const icons: string[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    return new Set(icons);
  } catch {
    return new Set(['help', 'info', 'check_circle', 'error', 'warning']);
  }
})();

const FALLBACK_ICON = 'help';

function validateIconName(name: string): string {
  if (!name || typeof name !== 'string') return FALLBACK_ICON;
  const clean = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (!clean) return FALLBACK_ICON;
  // On client side, VALID_ICONS is minimal — skip validation and trust the icon name
  if (typeof window !== 'undefined') return clean;
  return VALID_ICONS.has(clean) ? clean : FALLBACK_ICON;
}

function validateCard(card: any): any {
  if (!card) return card;
  try {
    const validated = JSON.parse(JSON.stringify(card));
    if (!Array.isArray(validated.blocks)) validated.blocks = [];
    if (validated.header?.icon) {
      validated.header.icon = validateIconName(validated.header.icon);
    }
    const validateBlocks = (blocks: any[]) => {
      if (!Array.isArray(blocks)) return;
      for (const block of blocks) {
        if (block.type === 'info' && Array.isArray(block.rows)) {
          for (const row of block.rows) {
            if (row.icon) row.icon = validateIconName(row.icon);
          }
        }
        if (block.type === 'list' && Array.isArray(block.items)) {
          for (const item of block.items) {
            if (item.icon) item.icon = validateIconName(item.icon);
          }
        }
        if (block.type === 'tabs' && Array.isArray(block.tabs)) {
          for (const tab of block.tabs) {
            validateBlocks(tab.blocks);
          }
        }
        if (block.type === 'collapse' && Array.isArray(block.blocks)) {
          validateBlocks(block.blocks);
        }
        if (block.type === 'actions' && Array.isArray(block.items)) {
          for (const item of block.items) {
            if (item.icon) item.icon = validateIconName(item.icon);
          }
        }
      }
    };
    if (validated.blocks) validateBlocks(validated.blocks);
    if (validated.actions?.items) {
      for (const item of validated.actions.items) {
        if (item.icon) item.icon = validateIconName(item.icon);
      }
    }
    return validated;
  } catch {
    return card;
  }
}

/**
 * Extract a balanced JSON object starting at position `start` in `str`.
 * Returns the JSON substring or null if not found.
 */
function extractBalancedJson(str: string, start: number): string | null {
  const openIdx = str.indexOf('{', start);
  if (openIdx === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIdx; i < str.length; i++) {
    const ch = str[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) return str.substring(openIdx, i + 1); }
  }
  return null;
}

function getResultSections(markdown: string): Array<{ start: number; end: number; contentStart: number; contentEnd: number; content: string }> {
  const sections: Array<{ start: number; end: number; contentStart: number; contentEnd: number; content: string }> = [];
  const resultRegex = /<result>([\s\S]*?)<\/result>/g;
  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(markdown)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const contentStart = start + '<result>'.length;
    const contentEnd = end - '</result>'.length;
    sections.push({
      start,
      end,
      contentStart,
      contentEnd,
      content: match[1],
    });
  }
  return sections;
}

function isHomeSidebarHintLike(obj: any): obj is HomeSidebarHint {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.type !== 'home_sidebar') return false;
  const validTabs = ['commander', 'workflow', 'agent'];
  const tabsValid = !obj.tabs || (Array.isArray(obj.tabs) && obj.tabs.every((tab: unknown) => typeof tab === 'string' && validTabs.includes(tab)));
  const activeValid = !obj.activeTab || validTabs.includes(obj.activeTab);
  const modeValid = !obj.mode || ['active', 'peek', 'hidden'].includes(obj.mode);
  const intentValid = !obj.intent || ['general', 'create-workflow', 'create-agent', 'workflow-run', 'workflow-review', 'supervisor-chat'].includes(obj.intent);
  const stageValid = !obj.stage || ['idle', 'clarifying', 'spec-draft', 'spec-review', 'workflow-draft', 'agent-draft', 'preflight', 'running', 'review'].includes(obj.stage);
  const workflowDraftValid = !obj.workflowDraft || (
    typeof obj.workflowDraft === 'object' &&
    ['name', 'requirements', 'description', 'referenceWorkflow', 'workingDirectory'].every((key) => obj.workflowDraft[key] === undefined || typeof obj.workflowDraft[key] === 'string') &&
    (obj.workflowDraft.workspaceMode === undefined || obj.workflowDraft.workspaceMode === 'isolated-copy' || obj.workflowDraft.workspaceMode === 'in-place')
  );
  const agentDraftValid = !obj.agentDraft || (
    typeof obj.agentDraft === 'object' &&
    ['displayName', 'team', 'mission', 'style', 'specialties', 'workingDirectory'].every((key) => obj.agentDraft[key] === undefined || typeof obj.agentDraft[key] === 'string')
  );
  const summaryValid = obj.summary === undefined || typeof obj.summary === 'string';
  const listOfStringsValid = (value: unknown) => value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
  const nextActionValid = obj.recommendedNextAction === undefined || typeof obj.recommendedNextAction === 'string';
  const shouldOpenModalValid = obj.shouldOpenModal === undefined || typeof obj.shouldOpenModal === 'boolean';
  return tabsValid
    && activeValid
    && modeValid
    && intentValid
    && stageValid
    && workflowDraftValid
    && agentDraftValid
    && summaryValid
    && listOfStringsValid(obj.knownFacts)
    && listOfStringsValid(obj.missingFields)
    && listOfStringsValid(obj.questions)
    && nextActionValid
    && shouldOpenModalValid;
}

/** 从 AI 回复 markdown 中提取 action blocks 和 card blocks */
export function parseActions(markdown: string): { text: string; actions: ActionBlock[]; cards: any[]; sidebarHints: HomeSidebarHint[] } {
  const actions: ActionBlock[] = [];
  const cards: any[] = [];
  const sidebarHints: HomeSidebarHint[] = [];
  const removals: [number, number][] = [];

  // First pass: only parse action blocks globally.
  // Card/json rendering is restricted to <result>...</result>.
  const codeBlockRegex = /```(action)\s*\n/g;
  let match;
  while ((match = codeBlockRegex.exec(markdown)) !== null) {
    const lang = match[1];
    const contentStart = match.index + match[0].length;

    // Use balanced brace matching to extract JSON
    const jsonStr = extractBalancedJson(markdown, contentStart);
    if (!jsonStr) continue;

    // The JSON starts at some offset from contentStart
    const jsonStartInContent = markdown.indexOf('{', contentStart);
    const jsonEnd = jsonStartInContent + jsonStr.length;

    // Find the closing ``` — must be on its own line after the JSON
    // Search from jsonEnd, skip whitespace/newlines
    let searchPos = jsonEnd;
    while (searchPos < markdown.length && (markdown[searchPos] === ' ' || markdown[searchPos] === '\n' || markdown[searchPos] === '\r')) {
      searchPos++;
    }
    // The closing ``` should be right here (or very close)
    const closingIdx = markdown.indexOf('```', searchPos);
    // Only accept if closing is within a reasonable distance (not a different code block)
    const blockEnd = (closingIdx !== -1 && closingIdx - jsonEnd < 10) ? closingIdx + 3 : jsonEnd;

    try {
      const parsed = JSON.parse(jsonStr);

      if (lang === 'action' && parsed.type && parsed.description) {
        actions.push({ type: parsed.type, params: parsed.params || {}, description: parsed.description });
        removals.push([match.index, blockEnd]);
        // Advance regex past this block to avoid re-matching nested ```
        codeBlockRegex.lastIndex = blockEnd;
        continue;
      }
    } catch {
      // not valid JSON, leave as-is
    }
  }

  const resultSections = getResultSections(markdown);
  for (const section of resultSections) {
    removals.push([section.start, section.contentStart]);
    removals.push([section.contentEnd, section.end]);

    const codeBlockRegex = /```(card|json)\s*\n/g;
    let match: RegExpExecArray | null;
    while ((match = codeBlockRegex.exec(section.content)) !== null) {
      const contentStart = match.index + match[0].length;
      const jsonStr = extractBalancedJson(section.content, contentStart);
      if (!jsonStr) {
        const fallbackClosingIdx = section.content.indexOf('```', contentStart);
        const fallbackLocalBlockEnd = fallbackClosingIdx !== -1 ? fallbackClosingIdx + 3 : contentStart;
        removals.push([
          section.contentStart + match.index,
          section.contentStart + fallbackLocalBlockEnd,
        ]);
        codeBlockRegex.lastIndex = fallbackLocalBlockEnd;
        continue;
      }

      const jsonStartInContent = section.content.indexOf('{', contentStart);
      const jsonEnd = jsonStartInContent + jsonStr.length;

      let searchPos = jsonEnd;
      while (
        searchPos < section.content.length &&
        (section.content[searchPos] === ' ' || section.content[searchPos] === '\n' || section.content[searchPos] === '\r')
      ) {
        searchPos++;
      }
      const closingIdx = section.content.indexOf('```', searchPos);
      const localBlockEnd = (closingIdx !== -1 && closingIdx - jsonEnd < 10) ? closingIdx + 3 : jsonEnd;

      try {
        const parsed = JSON.parse(jsonStr);
        if (isCardLike(parsed)) {
          cards.push(validateCard(parsed));
        } else if (isHomeSidebarHintLike(parsed)) {
          sidebarHints.push(parsed);
        }

        // Any card/json code block inside <result> is machine-readable output.
        // Non-visual JSON (for example workflow_draft/plan_draft) is consumed by
        // feature-specific code and must not leak into the visible markdown body.
        removals.push([
          section.contentStart + match.index,
          section.contentStart + localBlockEnd,
        ]);
        codeBlockRegex.lastIndex = localBlockEnd;
      } catch {
        // Malformed machine-readable JSON should be hidden from the markdown body;
        // the owning feature can surface a structured parse error instead.
        removals.push([
          section.contentStart + match.index,
          section.contentStart + localBlockEnd,
        ]);
        codeBlockRegex.lastIndex = localBlockEnd;
      }
    }
  }

  // Remove matched blocks from text (in reverse order to preserve indices)
  let text = markdown;
  for (const [start, end] of removals.sort((a, b) => b[0] - a[0])) {
    text = text.substring(0, start) + text.substring(end);
  }

  const effectiveCards = sidebarHints.some((hint) => shouldSuppressCardsForSidebarHint(hint)) ? [] : cards;

  return { text: text.trim(), actions, cards: effectiveCards, sidebarHints };
}

/** 判断 action 是否安全（自动执行） */
export function isSafeAction(action: ActionBlock): boolean {
  return RISK_MAP[action.type] === 'safe';
}

// --- 快照 ---

async function takeSnapshot(action: ActionBlock): Promise<any> {
  const { type, params } = action;
  try {
    if (type === 'config.update' || type === 'config.delete') {
      const data = await configApi.getConfig(params.filename);
      return { type: 'config', filename: params.filename, config: data.config, raw: data.raw };
    }
    if (type === 'agent.update' || type === 'agent.delete') {
      const data = await agentApi.getAgent(params.name);
      return { type: 'agent', name: params.name, agent: data.agent, raw: data.raw };
    }
  } catch {
    return null;
  }
  return null;
}

// --- 执行 ---

export async function executeAction(action: ActionBlock): Promise<{ result: any; snapshot?: any }> {
  const { type, params } = action;
  let snapshot: any = null;

  // Take snapshot before mutating actions
  if (RISK_MAP[type] === 'mutating' || RISK_MAP[type] === 'destructive') {
    snapshot = await takeSnapshot(action);
  }

  const result = await executeActionInner(type, params);
  return { result, snapshot };
}

async function executeActionInner(type: ActionType, params: Record<string, any>): Promise<any> {
  switch (type) {
    // Config
    case 'config.list':
      return configApi.listConfigs();
    case 'config.get':
      return configApi.getConfig(params.filename);
    case 'config.validate':
      return configApi.validateConfig({ config: params.config, filename: params.filename });
    case 'config.create':
      return configApi.saveConfig(params.filename, params.config);
    case 'config.update':
      return configApi.saveConfig(params.filename, params.config);
    case 'config.delete':
      return configApi.deleteConfig(params.filename);

    // Agent
    case 'agent.list':
      return agentApi.listAgents();
    case 'agent.get':
      return agentApi.getAgent(params.name);
    case 'agent.create':
      return agentApi.saveAgent(params.name, params.agent);
    case 'agent.update':
      return agentApi.saveAgent(params.name, params.agent);
    case 'agent.delete':
      return agentApi.deleteAgent(params.name);

    // Model
    case 'model.list': {
      const res = await fetch('/api/models');
      return res.json();
    }

    // Workflow
    case 'workflow.start':
      return workflowApi.start(params.configFile);
    case 'workflow.stop':
      return workflowApi.stop();
    case 'workflow.status':
      return workflowApi.getStatus();

    // Runs
    case 'runs.list':
      return params.configFile ? runsApi.listByConfig(params.configFile) : runsApi.listAll();
    case 'runs.detail':
      return runsApi.getRunDetail(params.runId);

    // Navigate
    case 'navigate':
      return { url: params.url };

    // Skills
    case 'skill.list': {
      const res = await fetch('/api/skills');
      const data = await res.json();
      // Filter by enabled skills if provided
      if (params.enabledSkills && Array.isArray(params.enabledSkills) && data.skills) {
        data.skills = data.skills.filter((s: any) => params.enabledSkills.includes(s.name));
      }
      return data;
    }

    // Prompt analysis
    case 'prompt.analyze':
    case 'prompt.optimize': {
      const res = await fetch('/api/prompt-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: params.prompt, output: params.output || '' }),
      });
      return res.json();
    }

    // Wizards - return structured step data for UI rendering
    case 'wizard.workflow':
      return { wizardType: 'workflow', step: params.step || 1, totalSteps: params.totalSteps || 6, data: params };
    case 'wizard.agent':
      return { wizardType: 'agent', step: params.step || 1, totalSteps: 3, data: params };
    case 'wizard.skill':
      return { wizardType: 'skill', step: params.step || 1, totalSteps: 3, data: params };

    // Schedule actions
    case 'schedule.list':
      return scheduleApi.list();
    case 'schedule.get':
      return scheduleApi.get(params.id);
    case 'schedule.create':
      return scheduleApi.create(params);
    case 'schedule.update':
      return scheduleApi.update(params.id, params);
    case 'schedule.delete':
      await scheduleApi.delete(params.id);
      return { success: true };
    case 'schedule.trigger':
      return scheduleApi.trigger(params.id);
    case 'schedule.toggle':
      return scheduleApi.toggle(params.id);

    default: {
      throw new Error(`Unknown action type: ${type}`);
    }
  }
}

// --- 撤销 ---

export async function undoAction(actionState: ActionState): Promise<any> {
  const { snapshot } = actionState;
  if (!snapshot) throw new Error('No snapshot available for undo');

  if (snapshot.type === 'config') {
    return configApi.saveConfig(snapshot.filename, snapshot.config);
  }
  if (snapshot.type === 'agent') {
    return agentApi.saveAgent(snapshot.name, snapshot.agent);
  }
  throw new Error('Cannot undo this action type');
}
