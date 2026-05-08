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

![ACEHarness 产品总览](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/readme.png)

<p><strong>核心能力亮点</strong></p>
<p>从产品全景进入日常工作流，下面六个模块构成 ACEHarness 的工程任务闭环。</p>

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
- AI 执行引擎：`claude-code`、`kiro-cli`、`opencode`、`nga`、`codegenie`、`cursor`、`codex`、`trae-cli`、`cangjie-magic` 等至少一种
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

![核心机制总览](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/core-mechanisms-overview.svg)

ACEHarness 的核心不是把多个 Agent 串起来跑一遍，而是把工程任务拆成可计划、可回退、可审查、可恢复、可复盘的闭环：

- **创建与计划**：从首页对话或手动表单创建工作流，Spec Coding 将需求整理成 `requirements.md`、`design.md`、`tasks.md`，并在创建阶段绑定步骤与任务。
- **运行与协作**：状态机根据结构化判决决定继续、回退或进入人工检查点；Supervisor 在 Agent 缺信息时负责路由补上下文。
- **审查与恢复**：Defender 红队、Attacker 蓝队和 Judge 形成对抗式评审；失败、重启或人工介入后仍可基于运行记录恢复。
- **观测与沉淀**：工作台展示流式输出、状态图、日志、成本和 Prompt 分析，产物可进入 Workspace、Notebook、Skills 或持久化 Spec。

---

## 系统架构

![系统架构 SVG 配图](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/system-architecture.svg)

注：
- 实时通信使用 SSE 推送执行状态到前端
- 数据持久化采用 `runs/{runId}/` 目录存储状态、输出和流式内容

## 产品界面

![产品界面总览](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/product-interface-overview.svg)

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

支持的执行引擎包括 `claude-code`、`kiro-cli`、`opencode`、`nga`、`codegenie`、`cursor`（Cursor CLI）、`codex`、`trae-cli`、`cangjie-magic`（CangjieMagic）。

子进程会继承 `process.env`，无需额外配置。切换引擎只需在引擎页面选择本机可用的 CLI 工具即可。

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
| AI SDK 与执行后端 | Anthropic Claude Agent SDK、OpenAI Codex SDK、`claude-code` / `kiro-cli` / `opencode` / `nga` / `codegenie` / `cursor` / `codex` / `trae-cli` / `cangjie-magic` |
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
