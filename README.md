<div align="center">

# ACE Harness (Agent Centric Engineering Harness)

[English](https://gitcode.com/Cangjie-SIG/ACEHarness/blob/main/README.en.md) | 中文

<picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/logo.png">
    <img src="https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/logo.png" alt="ACEHarness" width="300">
</picture>

***仓颉团队出品***

***企业级 AI Multi-Agent 智能协作系统 -- 状态机驱动 / Supervisor 智能路由 / 对抗式迭代 / 对话式创建***

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-Apache--2.0%20with%20Runtime%20Library%20Exception-blue.svg)

Your team of AIs, collaborating to get work done.

ACEHarness 是一个面向工程任务的本地 AI Multi-Agent 协作平台。它把「对话式创建」「状态机工作流」「红蓝对抗式评审」「Supervisor 路由」「运行记录与成本追踪」组合在一起，让复杂研发任务可以被拆解、执行、回退、审查和复盘。

<picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/features-overview.svg">
    <img src="https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/features-overview.svg" alt="ACEHarness">
</picture>


</div>

---

## 目录

- [快速开始](#快速开始)
- [核心机制](#核心机制)
- [系统架构](#系统架构)
- [产品界面](#产品界面)
- [工作流案例](#工作流案例)
- [配置与引擎](#配置与引擎)
- [文档](#文档)
- [开发参考](#开发参考)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

---

## 快速开始

### 前置条件

- Node.js `>= 20` / npm `>= 9`：运行 Next.js 服务与 npm CLI 包
- AI 执行引擎：`claude-code`、`kiro-cli`、`opencode`、`cursor-cli`、`codex`、`trae-cli`、`Cangjie Magic` 等至少一种
- `ANTHROPIC_API_KEY`：默认对话和工作流执行所需，见 `.env.example`

### 安装与运行

快速开始：

```bash
npm install -g @cangjielang/aceharness

ace --help
ace
# ✔ 请选择语言 › 中文
# [ACE] 欢迎使用。首次启动将初始化本地运行配置。
# ...
# [ACE] 正在启动服务：http://127.0.0.1:3000
# [ACEHarness] Server ready on http://0.0.0.0:3000
# [ACE] 请在浏览器中打开 http://127.0.0.1:3000
```

首次访问会进入初始化流程：创建管理员、选择语言、配置默认工作目录和可用 AI 引擎。后续团队成员可通过注册页申请账号，由管理员审核后使用。进入控制台后，可通过 Onboarding 查看完整使用路径和模块引导。

如果您是开发者：

```bash
git clone https://gitcode.com/Cangjie-SIG/ACEHarness.git && cd ACEHarness

# 安装依赖
npm install

# 本地调试：npm run dev 会先构建 CLI，再启动开发服务
ACE_HOST=0.0.0.0 ACE_PORT=3000 npm run dev

# Windows PowerShell:
# $env:ACE_HOST="0.0.0.0"
# $env:ACE_PORT="3000"
# npm run dev

# 生产模式：首次启动或代码更新后先构建
npm run build
ACE_HOST=0.0.0.0 ACE_PORT=3000 npm start
```

启动后访问 `http://127.0.0.1:3000`。如果使用 PowerShell 运行生产模式，同样先设置 `$env:ACE_HOST` 和 `$env:ACE_PORT`，再执行 `npm start`。

---

## 核心机制

### 1. 状态机工作流引擎 -- 不只是线性流水线

传统 AI 工作流只能"从头跑到尾"。ACEHarness 引入**有限状态机**模型，每个状态可以根据 Agent 输出的结构化判决（verdict）动态决定下一步走向：

![状态机工作流执行视图](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/hero-state-machine.png)

- **条件跳转**：Agent 输出 `{"verdict": "fail"}` 时自动回退到上游状态重新分析
- **最大转移次数保护**：防止死循环（如 `maxTransitions: 50`）
- **状态级上下文**：每个状态维护独立上下文，跨状态共享全局信息
- **崩溃恢复**：服务重启后自动检测中断的运行，支持断点续跑

在实际运行记录中可以看到，修复一个编译器 ICE 问题时工作流在"根因定位"和"方案设计"之间**自动回退了 3 次**，直到定位到真正的根因后才继续推进 -- 这就是状态机模式的价值。

### 2. Spec Coding -- 从需求到任务的可追踪闭环

Spec Coding 用于把一句需求先整理成正式计划制品，再驱动工作流执行。它通常包含 `requirements.md`、`design.md`、`tasks.md` 等文档，并在创建工作流时把工作流步骤和 Spec 任务建立绑定关系。

这条链路解决的是"AI 一边跑一边改计划，最后说不清做了什么"的问题：

- **创建阶段先绑定**：AI 生成工作流草案时会收到结构化 Spec 任务上下文，并输出每个步骤对应的 `specTaskBinding.taskIds`
- **系统维护状态**：任务开始、完成、失败、重启后的状态由运行系统维护，不依赖普通 Agent 在文本里自觉勾选
- **运行态总览**：工作台总览可以按 Spec 任务展示主任务和子任务状态，帮助用户看懂当前工作流推进到哪里
- **修订闭环**：Supervisor 修订、用户修订工作流或导入 Spec 后，系统会重新校验步骤和任务绑定，确保两者仍能对应
- **持久化模式**：启用持久化 Spec 后，运行态的计划修订和任务进度会同步写入仓库 delta 目录；不会默认从持久化文件反向覆盖运行态，除非用户显式导入

适合场景：大型缺陷修复、跨模块重构、API 设计与实现、需要审查计划和执行证据的研发任务。

### 3. Supervisor 智能路由 -- 让 AI 决定找谁干活

**核心问题**：传统多 Agent 工作流中，Agent 按固定顺序执行、被动接收前序产出。信息不足时只能猜测，产出质量差再由人工 iterate -- 本质是 Agent「不知道自己不知道什么」，也「没有办法主动问别人」。

**架构设计**：ACEHarness 内置 Supervisor-Lite 架构，将协作拆成三层职责分离：

- **Agent** 只声明「我缺什么」（`[NEED_INFO]` 协议），不需要知道团队里有谁
- **Supervisor** 只做路由（关键词匹配 → 轻量 LLM → fallback 用户），不参与业务内容
- **WorkflowManager** 只管状态流转和持久化，不做路由决策

路由分两层：关键词命中则零成本直达，不命中才调轻量模型做语义匹配，再不行就降级给用户。整个过程嵌在一个 Plan 循环中（可配轮次上限），Agent 在信息充分后才正式执行。

**价值**：

- **Agent 无感知**：prompt 中不注入 Agent 列表，Agent 只专注领域工作，路由完全交给 Supervisor
- **成本趋零**：大部分路由走关键词匹配，单次 LLM 路由约 $0.001，远低于信息不足导致的重跑成本
- **信息流打破线性**：分析员可以在执行中直接咨询编码实现者，不必等到对方的步骤执行完
- **渐进式零侵入**：步骤上加一行 `enablePlanLoop: true` 即启用，不加则执行路径完全不变；三级 fallback 保证流程永远不卡死

工作台中的 Supervisor 视图可以回放每一轮决策过程，清晰展示"为什么选了这条路"。

### 4. 对抗式迭代 -- Red Team vs Blue Team

每个工作流阶段可配置三种角色：

| 角色 | 职责 | 示例 Agent |
|------|------|-----------|
| **Defender** (红队) | 守住方案、实现功能、补齐证据 | architect, developer, fix-hunter, ... |
| **Attacker** (蓝队) | 主动攻击方案、审查质量、发现缺陷 | fix-breaker, design-breaker, stress-tester, ... |
| **Judge** (裁判) | 仲裁双方，输出判决 | fix-judge, code-judge, design-judge, ... |

Judge 输出结构化判决，系统据此自动决定"通过"或"继续迭代"：

```json
{ "verdict": "fail", "remaining_issues": 3, "summary": "边界条件未覆盖" }
```

内置多类专业 Agent，覆盖架构设计、代码实现、测试验证、安全审计、文档编写等角色。部分 Agent 还配备了 Review Panel（会审模式），由多个子 Agent 从不同维度并行评审。

### 5. 人工检查点 -- Human-in-the-Loop

在关键决策节点设置人工审批门：

- 方案设计完成后，人工确认是否开始编码
- 代码修复后，人工决定是否继续迭代或接受结果
- 支持**反馈注入**：在迭代过程中随时向 Agent 注入额外指令
- 支持**强制跳转**：不满意当前路径时，直接跳转到任意状态

### 6. 自动化分析 -- 不只是跑任务，还能分析结果

系统不只是"按顺序调 Agent"，而是在执行过程中进行智能分析：

- **回归测试判定**：自动识别哪些测试需要跑（O0/O1/O2 不同优化级别），而不是盲目全量回归
- **回退路径分析**：流转图中实时展示回退次数、热点状态，帮助定位工作流瓶颈
- **成本追踪**：每个步骤记录 Token 用量和费用，支持成本优化决策
- **Prompt 分析**：对历史运行的 Prompt 进行质量评估和优化建议

### 7. 对话式创建工作流 -- 说一句话就能建

首页的对话界面不只是聊天，它内置多类动作指令，覆盖工作流全生命周期：

- "帮我创建一个修复 Issue #3116 的工作流" -- AI 会引导你选择模式、配置 Agent、设置迭代策略
- "把 fix-hunter 的模型换成 opus" -- 直接修改 Agent 配置
- "启动 oh-cangjiedev-sm 工作流" -- 一键启动
- "帮我提交一个 PR，标题是..." -- 集成 GitCode 操作

对话中的操作按风险等级分类：安全操作自动执行，变更操作需确认，破坏性操作需二次确认。

---

## 系统架构

![系统架构 SVG 配图](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/system-architecture.svg)

注：
- 实时通信使用 SSE 推送执行状态到前端
- 数据持久化采用 `runs/{runId}/` 目录存储状态、输出和流式内容

## 产品界面

![产品界面总览](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/product-interface-overview.svg)

常用界面截图： [对话页](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/chat.png) · [仪表盘](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/dashboard.png) · [工作台设计视图](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/workbench-design.png) · [工作台历史视图](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/workbench-history.png) · [工作流管理](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/workflows.png)

## 工作流案例

![工作流案例总览](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/workflow-cases-overview.svg)

查看四个案例的根因路径、执行数据与交付结果：[工作流案例文档](https://gitcode.com/Cangjie-SIG/ACEHarness/blob/main/docs/workflow-cases.md)。

## 配置与引擎

### 环境变量 (`.env.local`)

复制 `.env.example` 为 `.env.local` 后填入真实值。下表只列出示例文件中已有的应用变量。

| 变量 | 说明 | 必填 |
|------|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 | 是 |
| `ANTHROPIC_BASE_URL` | 自定义 API 地址（代理/自建网关） | 否 |
| `ANTHROPIC_TIMEOUT` | Claude CLI 相关请求超时时间（毫秒） | 否 |
| `OPENAI_API_KEY` | OpenAI API 密钥 | 否 |
| `OPENAI_BASE_URL` | OpenAI 兼容 API 地址 | 否 |
| `NEXT_PUBLIC_API_BASE` | 前后端分离时的后端地址 | 否 |

`server.js` 还支持以下运行时变量，可在 shell、进程管理器或启动脚本中设置：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ACE_HOST` | 服务监听地址 | `127.0.0.1` |
| `ACE_PORT` | ACEHarness 服务端口 | `3000` |
| `PORT` | 通用服务端口，优先级高于 `ACE_PORT` | 未设置 |

### 执行引擎 (`.engine.json`)

```json
{ "engine": "claude-code" }
```

支持 `claude-code`、`kiro-cli`、`opencode`、`cursor-cli`、`codex`、`trae-cli`、`Cangjie Magic` 等引擎：

子进程会继承 `process.env`，无需额外配置。切换引擎只需在引擎页面切换可用的 cli 工具即可。

---

## 文档

- [工作流案例](https://gitcode.com/Cangjie-SIG/ACEHarness/blob/main/docs/workflow-cases.md)：四个真实/复盘案例的完整细节
- [ACP Code Agent 集成检查清单](https://gitcode.com/Cangjie-SIG/ACEHarness/blob/main/docs/acp-code-agent-integration-checklist.md)：ACP Code Agent 接入与验证参考

---

## 开发参考

### 项目结构

| 路径 | 说明 |
|------|------|
| `bin/` | npm CLI 入口，`ace` 命令会加载构建后的 `dist/cli.js` |
| `server.js` | 自定义 Next.js 启动器，负责加载 `.env*`、启动 HTTP 服务和 Notebook 协作 WebSocket |
| `src/app/` | Next.js App Router 页面与 API 路由 |
| `src/components/` | 工作台、对话、Notebook、工作区等前端组件 |
| `src/lib/` | 工作流引擎、Spec Coding、认证、运行记录、调度、模型和工作区等核心逻辑 |
| `configs/` | 工作流配置与内置 Agent/角色配置 |
| `skills/` | 随包分发的 Skills |
| `messages/` | 中英文界面文案 |
| `public/` | README 和前端使用的图片资源 |
| `tests/` | Vitest 测试用例 |

### 常用命令

命令来源：`package.json`。

```bash
npm run dev              # 本地开发，先构建 CLI，再以 dev 模式启动服务
npm run build            # 构建 CLI 和 Next.js 应用
npm start                # 启动生产构建
npm test                 # 运行 Vitest 测试
npm run test:components  # 使用 jsdom 环境运行组件测试
npm run lint             # 运行 Next.js lint
npm run check:engines    # 检测本机可用 AI 执行引擎
npm run clean            # 清理 dist、.next、dist-build
npm run publish:beta     # 构建并以 beta tag 发布 npm 包
```

CLI 命令来源：`src/cli.ts`。

```bash
ace                # 启动 ACEHarness
ace start          # 启动 ACEHarness
ace reset --force  # 重置本地 ACE 配置
ace --help         # 查看帮助
```

### 测试与质量

测试框架为 Vitest，配置位于 `vitest.config.ts`，默认匹配 `tests/**/*.test.ts` 和 `tests/**/*.test.tsx`。

```bash
npm test
npm run test:components
npm run lint
```

### 技术栈

| 类别 | 技术 |
|------|------|
| 应用框架 | Next.js 16.1、React 18.2、TypeScript 5 |
| UI 与交互 | Tailwind CSS 3.4、Shadcn/ui、Radix UI、Base UI、Framer Motion、Vaul |
| 编辑与协作 | Tiptap 3、Yjs、y-websocket、Monaco Editor |
| 工作流与配置 | Zod 4、YAML、node-cron、tar-stream、unzipper、yazl |
| 可视化 | ReactFlow 11、Recharts 3、Mermaid 11 |
| 表单与拖拽 | React Hook Form 7、@dnd-kit |
| Markdown 与文档 | react-markdown、remark-gfm、rehype-raw、react-syntax-highlighter、KaTeX |
| AI SDK 与执行后端 | Anthropic Claude Agent SDK、OpenAI Codex SDK、`claude-code` / `codex` / `opencode` 等 CLI 引擎 |
| 测试 | Vitest 4、Testing Library、jsdom |
| 国际化与主题 | next-intl 4、next-themes |

### 文档维护

当以下内容变化时，请同步更新本 README：

- `package.json` scripts、`bin`、`files` 或发布流程变化
- `.env.example` 中的环境变量变化
- `src/app/` 页面入口、API 分类或主要用户流程变化
- `src/lib/` 中工作流、Spec Coding、引擎、认证、Notebook 等核心机制变化
- `configs/`、`skills/` 或内置 Agent 能力变化
- 发布版本、许可证或仓库地址变化

---

## 贡献指南

当前仓库在 README 中保留简化贡献流程；如果后续新增独立 `CONTRIBUTING.md`，这里应改为链接正式贡献指南。

```bash
# Fork → 创建分支 → 提交 → PR
git checkout -b feature/your-feature
git commit -m "feat: add new feature"
git push origin feature/your-feature
```

Commit 规范遵循 [Conventional Commits](https://www.conventionalcommits.org/)：`feat` / `fix` / `docs` / `perf` / `refactor` / `test` / `chore`

---

## 许可证

ACEHarness 使用 Apache-2.0 with Runtime Library Exception，详见 [LICENSE](https://gitcode.com/Cangjie-SIG/ACEHarness/blob/main/LICENSE)。
