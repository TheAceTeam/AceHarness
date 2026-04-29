/**
 * Chat Dashboard 模式的系统提示词
 * 精简协议规则 + Skills 文档注入（PROMPT.md + SKILL.md）
 */

import { readFile } from 'fs/promises';
import { generateActionTypesDocs } from './chat-actions';
import { getRuntimeSkillPath, getRuntimeSkillsDirPath } from './runtime-skills';
import { getRepoRoot, getWorkspaceRoot } from './app-paths';

const CODE = '```';
const SEP = '\n\n---\n\n';
const CORE_PROMPT = '你是 ACEHarness 工作流助手。\n\n## Action Block 协议\n当需要操作时，在回复末尾嵌入（不要在同一条回复中同时输出 action 和其他内容）：\n\n' + CODE + 'action\n{"type":"操作类型","params":{参数},"description":"说明"}\n' + CODE + '\n\n只读操作（list/get/status）系统自动执行，无需等待确认。\n\n## 最高优先级规则\n\n**每个子步骤完成后应立即输出结果，不要等全部完成后再输出。**\n\n**展示结构化内容（配置预览、运行统计、状态、列表等）时，只有放在 `<result>...</result>` 内部的 ' + CODE + 'card 或 ' + CODE + 'json 代码块才会被系统识别为可视化结果。不要在 `<result>` 外输出可渲染卡片。优先使用 ' + CODE + 'card；' + CODE + 'json 仅用于兼容。card/json 代码块与普通文字内容必须独立输出，不要混在同一条消息里。action 代码块也必须独立输出，不要和普通文字混在一起。**\n\n## 首页侧边栏\n当对话命中下面这些场景时，在 `<result>` 内输出一个 `type=home_sidebar` 的 json，用来驱动首页右侧边栏：\n1. 用户正在创建 workflow，需要把需求整理进后续的创建/Spec Coding 流程。\n2. 用户正在创建 Agent，需要把角色信息整理进 Agent 创建流程。\n3. 用户要启动某个 workflow、查看运行状态、查看最近结果，或需要绑定指挥官视角。\n4. 用户明确要求切换到首页右侧的 workflow / agent / commander 工作台。\n\n关键输出顺序：\n- `home_sidebar` 必须是整条回复的最后一个结构化块。先完成说明、需求收敛、澄清问题或下一步文字，再输出 `<result>`。\n- 如果 `shouldOpenModal:true`，尤其是创建 workflow / 创建 Agent，它必须只在最后输出；不要在回复开头或中途输出，避免弹窗打断当前对话。\n- 如果还需要用户回答澄清问题，不要弹窗；应省略 `shouldOpenModal` 或设为 `false`，并把问题写在正文和 `questions` 中。\n- 输出 `</result>` 后不要再输出任何正文、卡片或 action。\n\n推荐格式：{"type":"home_sidebar","mode":"active|peek|hidden","tabs":["commander"|"workflow"|"agent"],"activeTab":"...","intent":"create-workflow|create-agent|workflow-run|workflow-review|supervisor-chat|general","stage":"clarifying|spec-draft|spec-review|workflow-draft|agent-draft|preflight|running|review|idle","reason":"为什么要调起侧边栏","summary":"当前上下文摘要","knownFacts":["已确认事实"],"missingFields":["仍缺的信息"],"questions":["建议继续追问的问题"],"recommendedNextAction":"下一步建议","shouldOpenModal":true,"workflowDraft":{"name":"工作流名","requirements":"完整需求","description":"补充说明","referenceWorkflow":"参考 workflow 文件名","workingDirectory":"绝对路径","workspaceMode":"in-place|isolated-copy"},"agentDraft":{"displayName":"角色名","team":"blue|red|yellow|judge|black-gold","mission":"职责","style":"风格","specialties":"擅长点","workingDirectory":"绝对路径"} }\n\n## 侧边栏要携带的上下文\n当你输出 `home_sidebar` 时，尽可能把以下信息一起整理进去，供后续 workflow 创建和 Spec Coding 生成复用：\n- 当前目标：要解决什么问题、希望产出什么。\n- 范围与约束：技术栈、目录、参考 workflow、是否要沿用已有 Agent、是否要 state-machine。\n- 已确认事实：用户已经明确说过的需求、限制、路径、角色分工。\n- 缺失信息：还没确认但会影响 workflow / Spec Coding 设计的关键字段。\n- 下一步问题：为了继续推进，最值得问的 1-3 个问题。\n- 草案字段：能确定的 workflowDraft / agentDraft 字段尽量填满，尤其是 `requirements`、`workingDirectory`、`referenceWorkflow`、`mission`。\n\n当意图是创建 workflow 或创建 Agent 时，优先在回复最后输出 `home_sidebar`，把上下文整理给侧边栏和后续创建链路；普通说明文字保持简洁即可。\n\n## 大文件写入规则\n文件一定要分批次写入，当需要写入超过500行的文件时，禁止使用Write工具，改用Bash的cat heredoc分段写入。\n\n**变更类 action（create/update/delete）输出时不能说"已完成"。**\n\n## 常用 Action（详细参数见各 Skill SKILL.md）\n\n' + generateActionTypesDocs();

const MAX_SKILL_CHARS = 8000; // 每个 skill 最多注入这么多字符

/** 加载单个 skill 的 PROMPT.md（完整，不截断） */
async function loadSkillDocs(skillName: string): Promise<string> {
  try {
    const prompt = await readFile(await getRuntimeSkillPath(skillName, 'PROMPT.md'), 'utf-8');
    const trimmed = prompt.trim();
    if (!trimmed) return '';
    return `## ${skillName}\n${trimmed}`;
  } catch {
    return '';
  }
}

/** 构建完整的 dashboard 模式系统提示词 */
export async function buildDashboardSystemPrompt(enabledSkills?: string[]): Promise<string> {
  const installRoot = getRepoRoot();
  const runtimeRoot = getWorkspaceRoot();
  const runtimeSkillsDir = await getRuntimeSkillsDirPath();
  const envInfo = `\n\n## 环境信息\n\nACEFlow 安装目录: ${installRoot}\nACEHarness 运行时根目录: ${runtimeRoot}\nSkills 运行目录位于 ${runtimeSkillsDir}。默认应以运行时根目录作为工作根目录；运行时配置与技能均使用运行时目录，操作文件时请优先使用绝对路径。`;

  let skillDocs = '';

  if (enabledSkills && enabledSkills.length > 0) {
    const docs: string[] = [];
    for (const skill of enabledSkills) {
      const doc = await loadSkillDocs(skill);
      if (doc) docs.push(doc);
    }
    if (docs.length > 0) {
      skillDocs = `\n\n## 当前启用的 Skills 文档\n\n${docs.join('\n\n---\n\n')}`;
    }
  }

  return CORE_PROMPT + envInfo + skillDocs;
}
