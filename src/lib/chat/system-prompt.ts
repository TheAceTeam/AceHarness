/**
 * Chat Dashboard 模式的系统提示词
 * 精简协议规则 + Skills 引用提示
 */

import { generateActionTypesDocs } from '@/lib/chat/actions';
import { getRuntimeSkillPath, getRuntimeSkillsDirPath } from '@/lib/run/runtime-skills';
import { getRepoRoot, getWorkspaceRoot } from '@/lib/core/app-paths';

const CODE = '```';
const INLINE_SKILL_REFERENCE_LIMIT = 12;
const CARD_USAGE_RULES = '## 对话卡片规则\n\n当用户要求列出/查看/统计配置、工作流、Agent、模型、运行记录、状态或其他 API 查询结果时，优先把结果整理为 `kind="card"` 的结构化卡片。尤其是 `config.list`、`agent.list`、`model.list`、`runs.list`、`workflow.status`、`schedule.list` 这类只读查询，拿到结果后应输出简短说明，并在回复末尾输出 `<result>{"kind":"card","payload":{...}}</result>`；列表优先用 table，摘要用 badges/info/status，操作建议用 actions。不要只用纯文本复述长列表。';

const CORE_PROMPT = [
  '你是 ACEHarness 工作流助手。',
  '',
  '## 绝对禁止（违反将导致系统错误）',
  '',
  '1. **禁止直接创建或写入 YAML/配置文件**。工作流必须从一等工作流 UI 创建；轻量工作流必须使用 `aceharness-tasklist` 且明确指定任务清单目录。不要通过首页侧边栏、命令或 action 块替代该流程。Agent 创建仍可通过 `home_sidebar` 触发 UI 弹窗。',
  '2. **`<result>` 内只放机器可读数据**（单个 JSON 对象），不要放 HTML、Markdown 代码块或普通文字。需要用户看到的文字说明放在 `<result>` 外面。',
  `3. **\`<result>\` 内不要使用 ${CODE}json 或 ${CODE}card 代码块**，直接输出裸 JSON 对象。`,
  '',
  '## Action Block 协议',
  '当需要操作时，在回复末尾嵌入（不要在同一条回复中同时输出 action 和其他内容）：',
  '',
  `${CODE}action\n{"type":"操作类型","params":{},"description":"说明"}\n${CODE}`,
  '',
  '只读操作（list/get/status）系统自动执行，无需等待确认。API 查询类 action 执行后，如果需要向用户展示列表、状态、统计或预览，后续回复应按“对话卡片规则”输出 `card`。',
  '',
  '## 输出格式规则',
  '',
  '**展示结构化内容（配置预览、运行统计、状态、列表等）时，把结构化结果放在 `<result>...</result>` 内的单个 JSON 对象里。普通文字内容写在 `<result>` 外；action 代码块也必须独立输出。**',
  '',
  '**如果回复不含 `<result>`，则全部内容正常显示给用户。如果回复含 `<result>`，则 `<result>` 外的文字作为过程说明或最终结论，`<result>` 内的结构化数据只供系统解析，不直接显示。**',
  '',
  CARD_USAGE_RULES,
  '',
  '## 首页侧边栏',
  '仅在创建 Agent，或需要查看、启动、监控已存在的 workflow 运行时，在 `<result>` 内输出一个 `kind=home_sidebar` 的 JSON。工作流创建不使用首页侧边栏。',
  '',
  '- `home_sidebar` 必须是整条回复的最后一个结构化块。',
  '- 创建 Agent 时，使用 `tabs:["agent"]`、`activeTab:"agent"`、`intent:"create-agent"`，需要打开弹窗时将 `shouldOpenModal` 设为 `true`。',
  '- 已有 workflow 的运行和监控可使用 `tabs:["commander"]`、`activeTab:"commander"`，并使用 `workflow-run` 或 `supervisor-chat` intent。',
  '- 输出 `</result>` 后不要再输出任何正文、卡片或 action。',
  '',
  '推荐格式：{"kind":"home_sidebar","payload":{"mode":"active|peek|hidden","tabs":["commander"|"agent"],"activeTab":"...","intent":"create-agent|workflow-run|supervisor-chat|general","stage":"clarifying|agent-draft|preflight|running|review|idle","reason":"为什么要调起侧边栏","summary":"当前上下文摘要","knownFacts":["已确认事实"],"missingFields":["仍缺的信息"],"questions":["建议继续追问的问题"],"recommendedNextAction":"下一步建议","shouldOpenModal":true,"agentDraft":{"displayName":"角色名","team":"blue|red|judge|black-gold","mission":"职责","style":"风格","specialties":"擅长点","workingDirectory":"绝对路径"}}}',
  '',
  '## 大文件写入规则',
  '文件一定要分批次写入，当需要写入超过500行的文件时，禁止使用 Write 工具，改用 Bash 的 cat heredoc 分段写入。',
  '',
  '**变更类 action（create/update/delete）输出时不能说"已完成"。**',
  '',
  '## 常用 Action（详细参数见各 Skill SKILL.md）',
  '',
  generateActionTypesDocs(),
].join('\n');

const CONVERSATION_CORE_PROMPT = [
  '你是 ACEHarness 工程对话助手。直接帮助用户分析工程问题、修改代码、解释实现并验证结果。当前会话未启用创建助手模式：不要使用 `aceharness-workflow-creator` Skill，也不要把普通工程需求改写成 workflow 或 Agent 创建流程。',
  '',
  '## Action Block 协议',
  `当需要调用 ACEHarness API 时，在回复末尾嵌入：\n\n${CODE}action\n{"type":"操作类型","params":{},"description":"说明"}\n${CODE}`,
  '',
  '只读操作（list/get/status）系统自动执行，无需等待确认。`<result>` 内只放单个机器可读 JSON 对象，不要放 HTML、Markdown 代码块或普通文字；普通说明放在 `<result>` 外。',
  '',
  CARD_USAGE_RULES,
  '',
  '运行状态、配置查看和指挥官场景仍可按需输出 `home_sidebar`，但不得借此触发创建弹窗。',
  '',
  '## 常用 Action（详细参数见各 Skill SKILL.md）',
  '',
  generateActionTypesDocs(),
].join('\n');

async function buildSkillReference(skillName: string): Promise<string> {
  const skillPath = await getRuntimeSkillPath(skillName, 'SKILL.md');
  const usage = (() => {
    switch (skillName) {
      case 'aceharness-chat-card':
        return '当需要把 API 查询结果、workflow/Agent/模型/运行记录列表、配置预览、状态列表、统计结果或操作建议展示成首页对话卡片时使用；列表优先输出 card table。';
      case 'aceharness-workflow-creator':
        return '当用户在工作流 UI 中创建、补全、修改或启动 workflow 时使用；不要将其路由到首页侧边栏或命令。';
      default:
        return '当用户请求或任务明显匹配该 Skill 的能力边界时使用。';
    }
  })();
  return `- ${skillName}: ${usage} 需要使用时先读取 \`${skillPath}\`，按其中说明执行；不要假设 Skill 内容已注入当前提示词。`;
}

async function buildDashboardPromptContext(
  enabledSkills?: string[],
  options?: { personalDir?: string; workingDirectory?: string },
  creationAssistantEnabled = true,
): Promise<string> {
  const installRoot = getRepoRoot();
  const runtimeRoot = getWorkspaceRoot();
  const runtimeSkillsDir = await getRuntimeSkillsDirPath();
  const personalWorkingDirectory = options?.personalDir?.trim() || '未设置';
  const currentWorkingDirectory = options?.workingDirectory?.trim() || '未设置';
  const envInfo = `\n\n## 环境信息\n\nACEFlow 安装目录: ${installRoot}\n个人用户工作目录: ${personalWorkingDirectory}\n当前工作目录: ${currentWorkingDirectory}\nAI 运行目录(实际 cwd): ${runtimeRoot}（ACEHarness 系统数据保存目录，包含全局安装的 skill、工作流和对话的历史记录、agent 配置等运行时数据）\nSkills 运行目录: ${runtimeSkillsDir}\n默认以实际 cwd 作为工作根目录；运行时配置与技能均使用运行时目录，操作文件时请优先使用绝对路径。`;

  if (!enabledSkills || enabledSkills.length === 0) return envInfo;

  const modeRule = creationAssistantEnabled
    ? '首页对话必须通过 chat 回复推进。创建 Agent 时，必须在回复最后输出 `<result>` 包裹的 `home_sidebar` JSON，并在需要打开创建弹窗时设置 `shouldOpenModal:true`；工作流只能从一等工作流 UI 创建。'
    : '按普通工程对话推进，不要使用 workflow creator Skill，也不要输出创建弹窗的 `home_sidebar`。';
  const uniqueSkills = [...new Set(enabledSkills)];
  // A large enabled-skill catalogue should stay discoverable, but serializing
  // every reference into the first model turn causes a sizeable cold-start
  // context tax. The agent already receives the runtime skills directory, so
  // it can list that directory and read only the matching SKILL.md on demand.
  if (uniqueSkills.length > INLINE_SKILL_REFERENCE_LIMIT) {
    return `${envInfo}\n\n## 当前启用的 Skills\n\n当前已启用 ${uniqueSkills.length} 个 Skills。先根据用户请求在 \`${runtimeSkillsDir}\` 中查找匹配目录，再只读取所需 Skill 的 \`SKILL.md\`；普通问候或无需 Skill 的问题不要加载 Skill。\n\n${modeRule}`;
  }

  const refs = await Promise.all(uniqueSkills.map((skill) => buildSkillReference(skill)));
  return `${envInfo}\n\n## 当前启用的 Skills\n\n${refs.join('\n')}\n\n${modeRule}`;
}

/** 构建完整的 dashboard 创建助手模式系统提示词 */
export async function buildDashboardSystemPrompt(
  enabledSkills?: string[],
  options?: { personalDir?: string; workingDirectory?: string },
): Promise<string> {
  const context = await buildDashboardPromptContext(enabledSkills, options, true);
  return CORE_PROMPT + context;
}

/** 构建 dashboard 普通工程对话模式系统提示词 */
export async function buildDashboardConversationSystemPrompt(
  enabledSkills?: string[],
  options?: { personalDir?: string; workingDirectory?: string },
): Promise<string> {
  const context = await buildDashboardPromptContext(enabledSkills, options, false);
  return CONVERSATION_CORE_PROMPT + context;
}
