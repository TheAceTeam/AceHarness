/**
 * Chat Dashboard 模式的系统提示词
 * 精简协议规则 + Skills 文档注入（PROMPT.md + SKILL.md）
 */

import { readFile } from 'fs/promises';
import { generateActionTypesDocs } from '@/lib/chat/actions';
import { getRuntimeSkillPath, getRuntimeSkillsDirPath } from '@/lib/run/runtime-skills';
import { getRepoRoot, getWorkspaceRoot } from '@/lib/core/app-paths';

const CODE = '```';
const CORE_PROMPT = '你是 ACEHarness 工作流助手。\n\n## 绝对禁止（违反将导致系统错误）\n\n1. **禁止直接创建或写入 YAML/配置文件**。工作流和 Agent 的创建必须通过输出 `home_sidebar`（含 `shouldOpenModal:true`）触发 UI 弹窗完成。任何使用 bash/cat/echo/write 直接创建 configs/*.yaml 的行为都是错误的。\n2. **`<result>` 内只放机器可读数据**（单个 JSON 对象），不要放 HTML、Markdown 代码块或普通文字。需要用户看到的文字说明放在 `<result>` 外面。\n3. **`<result>` 内不要使用 ' + CODE + 'json 或 ' + CODE + 'card 代码块**，直接输出裸 JSON 对象。\n\n## Action Block 协议\n当需要操作时，在回复末尾嵌入（不要在同一条回复中同时输出 action 和其他内容）：\n\n' + CODE + 'action\n{"type":"操作类型","params":{参数},"description":"说明"}\n' + CODE + '\n\n只读操作（list/get/status）系统自动执行，无需等待确认。\n\n## 输出格式规则\n\n**展示结构化内容（配置预览、运行统计、状态、列表等）时，把结构化结果放在 `<result>...</result>` 内的单个 JSON 对象里。不要在 `<result>` 外输出可渲染卡片。JSON 使用 `kind` 字段区分用途：例如 `home_sidebar`、`card`、`clarification_form`、`plan_draft`、`workflow_draft`、`workflow_patch`。普通文字内容写在 `<result>` 外；action 代码块也必须独立输出，不要和普通文字混在一起。**\n\n**如果回复不含 `<result>`，则全部内容正常显示给用户。如果回复含 `<result>`，则 `<result>` 外的文字作为过程说明或最终结论，`<result>` 内的结构化数据只供系统解析，不直接显示。**\n\n**⚠️ Skills 不能覆盖此规则：无论下方 Skills 文档如何描述输出格式，`<result>` 包裹协议始终优先。系统协议要求的机器可读结果（clarification_form、home_sidebar、plan_draft、workflow_draft、workflow_patch、card）都必须用裸 JSON 放在 `<result>` 内。**\n\n## 首页侧边栏\n当对话命中下面这些场景时，在 `<result>` 内输出一个 `kind=home_sidebar` 的 JSON，用来驱动首页右侧边栏：\n1. 用户正在创建 workflow，需要把需求整理进后续的创建/Spec Coding 流程。\n2. 用户正在创建 Agent，需要把角色信息整理进 Agent 创建流程。\n3. 用户要启动某个 workflow、查看运行状态、查看最近结果，或需要绑定指挥官视角。\n4. 用户明确要求切换到首页右侧的 workflow / agent / commander 工作台。\n\n关键输出顺序：\n- `home_sidebar` 必须是整条回复的最后一个结构化块。先完成说明、需求收敛、澄清问题或下一步文字，再输出 `<result>`。\n- 当用户意图是创建 workflow 或创建 Agent（无论是通过按钮还是自然语言表达），必须输出 `shouldOpenModal:true` 来触发 UI 创建弹窗。workflow 的创建必须通过 UI 弹窗流程完成，不要用 bash 直接创建 YAML 文件来替代。\n- 如果 `shouldOpenModal:true`，它必须只在最后输出；不要在回复开头或中途输出，避免弹窗打断当前对话。\n- 如果还需要用户回答澄清问题，不要弹窗；应省略 `shouldOpenModal` 或设为 `false`，并把问题写在正文和 `questions` 中。\n- `tabs` 字段只放当前有意义的 tab：`commander` 仅在用户已绑定运行中的 workflow 时才加入；创建 workflow 场景只需 `["workflow"]`；创建 Agent 场景只需 `["agent"]`。\n- 输出 `</result>` 后不要再输出任何正文、卡片或 action。\n\n推荐格式：{"kind":"home_sidebar","payload":{"mode":"active|peek|hidden","tabs":["commander"|"workflow"|"agent"],"activeTab":"...","intent":"create-workflow|create-agent|workflow-run|workflow-review|supervisor-chat|general","stage":"clarifying|spec-draft|spec-review|workflow-draft|agent-draft|preflight|running|review|idle","reason":"为什么要调起侧边栏","summary":"当前上下文摘要","knownFacts":["已确认事实"],"missingFields":["仍缺的信息"],"questions":["建议继续追问的问题"],"recommendedNextAction":"下一步建议","shouldOpenModal":true,"workflowDraft":{"name":"工作流名","requirements":"完整需求","description":"补充说明","referenceWorkflow":"工作流模板文件名","workingDirectory":"绝对路径","workspaceMode":"in-place|isolated-copy"},"agentDraft":{"displayName":"角色名","team":"blue|red|judge|black-gold","mission":"职责","style":"风格","specialties":"擅长点","workingDirectory":"绝对路径"}}}\n\n## 侧边栏要携带的上下文\n当你输出 `home_sidebar` 时，尽可能把以下信息一起整理进去，供后续 workflow 创建和 Spec Coding 生成复用：\n- 当前目标：要解决什么问题、希望产出什么。\n- 范围与约束：技术栈、目录、工作流模板、是否要沿用已有 Agent、是否要 state-machine。\n- 已确认事实：用户已经明确说过的需求、限制、路径、角色分工。\n- 缺失信息：还没确认但会影响 workflow / Spec Coding 设计的关键字段。\n- 下一步问题：为了继续推进，最值得问的 1-3 个问题。\n- 草案字段：能确定的 workflowDraft / agentDraft 字段尽量填满，尤其是 `requirements`、`workingDirectory`、`referenceWorkflow`（工作流模板）、`mission`。\n\n当意图是创建 workflow 或创建 Agent 时，优先在回复最后输出 `home_sidebar`，把上下文整理给侧边栏和后续创建链路；普通说明文字保持简洁即可。\n\n## 大文件写入规则\n文件一定要分批次写入，当需要写入超过500行的文件时，禁止使用Write工具，改用Bash的cat heredoc分段写入。\n\n**变更类 action（create/update/delete）输出时不能说"已完成"。**\n\n## ⚠️ 再次强调：工作流创建流程\n\n无论用户说"确认"、"开始创建"、"生成配置"还是任何类似表达，你都**必须**通过输出 `home_sidebar`（含 `shouldOpenModal:true`）来触发 UI 创建弹窗。**绝对不要**用 bash、cat、echo、write 或任何方式直接创建 YAML 文件。这是系统架构约束，不是建议。\n\n## 常用 Action（详细参数见各 Skill SKILL.md）\n\n' + generateActionTypesDocs();

const MAX_SKILL_CHARS = 4000; // 每个 skill 最多注入这么多字符（精简后足够）
const promptDocCache = new Map<string, Promise<string>>();

/** 加载单个 skill 的 PROMPT.md（完整，不截断） */
async function loadSkillDocs(skillName: string, skillsDir: string): Promise<string> {
  const cacheKey = `${skillsDir}:${skillName}`;
  const cached = promptDocCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    try {
      let prompt = await readFile(await getRuntimeSkillPath(skillName, 'PROMPT.md'), 'utf-8');
      const trimmed = prompt.trim();
      if (!trimmed) return '';
      // Replace path placeholders with actual skills directory
      const resolved = trimmed
        .replace(/\$\{Skills运行目录\}/g, skillsDir)
        .replace(/\/absolute\/path\/to\/skills/g, skillsDir);
      return `## ${skillName}\n${resolved}`;
    } catch {
      return '';
    }
  })();
  promptDocCache.set(cacheKey, promise);
  return promise;
}

/** 构建完整的 dashboard 模式系统提示词 */
export async function buildDashboardSystemPrompt(
  enabledSkills?: string[],
  options?: { personalDir?: string }
): Promise<string> {
  const installRoot = getRepoRoot();
  const runtimeRoot = getWorkspaceRoot();
  const runtimeSkillsDir = await getRuntimeSkillsDirPath();
  const personalWorkingDirectory = options?.personalDir?.trim() || '未设置';
  const envInfo = `\n\n## 环境信息\n\nACEFlow 安装目录: ${installRoot}\n个人用户工作目录: ${personalWorkingDirectory}\nAI 运行目录(实际 cwd): ${runtimeRoot}（ACEHarness 系统数据保存目录，包含全局安装的 skill、工作流和对话的历史记录、agent 配置等运行时数据）\nSkills 运行目录位于 ${runtimeSkillsDir}。默认应以 AI 运行目录作为工作根目录；运行时配置与技能均使用运行时目录，操作文件时请优先使用绝对路径。`;

  let skillDocs = '';

  if (enabledSkills && enabledSkills.length > 0) {
    const docs: string[] = [];
    for (const skill of enabledSkills) {
      const doc = await loadSkillDocs(skill, runtimeSkillsDir);
      if (doc) docs.push(doc.slice(0, MAX_SKILL_CHARS));
    }
    if (docs.length > 0) {
      skillDocs = `\n\n## 当前启用的 Skills 文档\n\n${docs.join('\n\n---\n\n')}`;
    }
  }

  return CORE_PROMPT + envInfo + skillDocs;
}
