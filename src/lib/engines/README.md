# AI Engines

ACEHarness 支持多种 AI 引擎后端，可以根据需求选择不同的引擎。

## 统一流格式

`src/lib/engines` 下的各个 wrapper 现在不再直接往 UI 拼各自的 markdown 片段，而是统一输出一种内部格式：`ace-process block`。

每个 block 都长这样：

```html
<ace-process>{"kind":"tool-call","toolName":"read","title":"📖 读取文件","filePath":"README.md","body":""}</ace-process>
```

这层格式的目标很简单：

- 不同引擎的工具事件先归一，再交给聊天 UI 渲染
- 把 provider 特有事件和 UI 表现解耦
- 让 Codex、Cursor、Claude、OpenCode、Kiro、Trae 这些 wrapper 共用同一套展示协议

### 支持的 block kind

- `reasoning`
- `tool-call`
- `tool-result`
- `subtask-start`
- `subtask-result`

### 当前 ace-process JSON 格式

所有 wrapper 最终都应该输出：

```html
<ace-process>{...json...}</ace-process>
```

公共字段：

```json
{
  "kind": "reasoning | tool-call | tool-result | subtask-start | subtask-result",
  "body": "可选。给 UI 的补充正文字符串"
}
```

#### 1. `reasoning`

最小格式：

```json
{
  "kind": "reasoning",
  "body": "Need to inspect the wrapper output."
}
```

语义：

- 只表示思考/推理流
- 不再使用 `<think>...</think>`

#### 2. `tool-call`

最小格式：

```json
{
  "kind": "tool-call",
  "toolName": "read",
  "title": "📖 读取文件",
  "body": ""
}
```

完整字段：

```json
{
  "kind": "tool-call",
  "toolName": "read | grep | glob | ls | bash | cmd | powershell | write | edit | multiedit | patch | task | todo | todowrite | webfetch | websearch",
  "title": "UI 标题",
  "toolId": "可选。provider/tool call id",
  "command": "可选。命令行字符串",
  "filePath": "可选。文件路径",
  "content": "可选。写入或展示内容",
  "oldString": "可选。编辑前内容",
  "newString": "可选。编辑后内容",
  "pattern": "可选。grep/glob 模式",
  "path": "可选。ls/glob/grep 目标路径",
  "url": "可选。webfetch URL",
  "query": "可选。websearch 查询词",
  "todos": [
    {
      "content": "任务内容",
      "status": "pending | in_progress | completed"
    }
  ],
  "input": "可选。无法映射到标准字段时保留原始结构",
  "body": "可选。补充正文"
}
```

常见例子：

```json
{
  "kind": "tool-call",
  "toolName": "bash",
  "title": "💻 执行命令",
  "command": "git diff --stat",
  "body": ""
}
```

```json
{
  "kind": "tool-call",
  "toolName": "read",
  "title": "📖 读取文件",
  "filePath": "src/demo.ts",
  "body": ""
}
```

```json
{
  "kind": "tool-call",
  "toolName": "websearch",
  "title": "🔎 搜索网页",
  "query": "ace-process schema",
  "body": ""
}
```

#### 3. `tool-result`

最小格式：

```json
{
  "kind": "tool-result",
  "toolName": "read",
  "title": "📖 读取文件",
  "body": ""
}
```

完整字段：

```json
{
  "kind": "tool-result",
  "toolName": "read | grep | glob | ls | bash | cmd | powershell | write | edit | multiedit | patch | task | todo | todowrite | webfetch | websearch",
  "title": "UI 标题",
  "toolId": "可选。provider/tool call id",
  "output": "可选。标准文本输出",
  "exitCode": 0,
  "filePath": "可选。文件路径",
  "content": "可选。文件内容",
  "todos": [
    {
      "content": "任务内容",
      "status": "pending | in_progress | completed"
    }
  ],
  "changes": [
    {
      "toolName": "可选",
      "title": "可选",
      "filePath": "可选",
      "content": "可选",
      "oldString": "可选",
      "newString": "可选",
      "kind": "可选"
    }
  ],
  "error": true,
  "errorText": "可选。错误正文",
  "errorMessage": "可选。错误消息",
  "message": "可选。通用消息",
  "body": "可选。补充正文"
}
```

常见例子：

```json
{
  "kind": "tool-result",
  "toolName": "bash",
  "title": "💻 执行命令",
  "output": "3 files changed",
  "exitCode": 0,
  "body": ""
}
```

```json
{
  "kind": "tool-result",
  "toolName": "read",
  "title": "📖 读取文件",
  "filePath": "src/demo.ts",
  "content": "export const demo = 1;",
  "body": ""
}
```

```json
{
  "kind": "tool-result",
  "toolName": "patch",
  "title": "✏️ 编辑文件",
  "changes": [
    {
      "filePath": "src/demo.ts",
      "oldString": "const before = 1;",
      "newString": "const after = 2;"
    }
  ],
  "body": ""
}
```

#### 4. `subtask-start`

```json
{
  "kind": "subtask-start",
  "title": "Inspect routing layer",
  "description": "Inspect routing layer",
  "agent": "explorer",
  "prompt": "Read the stream route and report how process blocks flow to ChatMessage.",
  "body": ""
}
```

语义：

- 表示一个子任务/子 agent 开始
- UI 以 subtask tool card 渲染

#### 5. `subtask-result`

```json
{
  "kind": "subtask-result",
  "sessionId": "task-1-session",
  "resultText": "Raw content now stays structured through ace-process.",
  "body": ""
}
```

语义：

- 表示子任务完成结果
- `sessionId` 用于会话追踪
- `resultText` 是最终展示文本

### 当前规范边界

当前 `src/lib/engines` wrapper 层只应以 `ace-process` JSON 为过程展示协议：

- reasoning 用 `kind: "reasoning"`
- tool 调用用 `kind: "tool-call"`
- tool 结果用 `kind: "tool-result"`
- 子任务开始用 `kind: "subtask-start"`
- 子任务结果用 `kind: "subtask-result"`

不要再生成这些旧过程协议：

- `<think>...</think>`
- `<task_result>...</task_result>`
- `<path>...</path><content>...</content>`

类型定义在：

- [ai-process-blocks.ts](../chat/ai-process-blocks.ts)

### 共享 formatter

wrapper 不应该自己再拼 `ace-process` JSON。统一入口在：

- [ace-process-formatters.ts](../chat/ace-process-formatters.ts)

当前共享的关键能力：

- `formatAceReasoning(...)`
- `formatAceToolCall(...)`
- `formatAceToolResult(...)`
- `formatAceSubtaskStart(...)`
- `formatAceSubtaskResult(...)`
- `resolveAceToolName(...)`
- `inferCommandToolName(...)`
- `normalizeAceFileChange(...)`
- `formatAceFileChangesResult(...)`
- `getAceToolTitle(...)`
- `getAceToolFallbackTitle(...)`

### 规范化后的工具类别

目前统一识别的 canonical tool name 包括：

- `bash`
- `cmd`
- `powershell`
- `read`
- `grep`
- `glob`
- `ls`
- `write`
- `edit`
- `multiedit`
- `patch`
- `task`
- `todo`
- `todowrite`
- `webfetch`
- `websearch`

这里有两个层次：

1. wrapper 先把 provider 原始事件映射成 canonical tool name
2. UI 再根据 canonical tool name 渲染统一卡片

例如：

- `Get-Content`, `cat`, `head`, `tail` 会收敛到 `read`
- `Select-String`, `grep`, `rg`, `findstr` 会收敛到 `grep`
- `Get-ChildItem`, `ls`, `find`, `tree`, `dir` 会收敛到 `ls`

### wrapper 接入约定

新增或修改 wrapper 时，遵守这几个约定：

1. wrapper 负责理解 provider 的原始事件形状
2. wrapper 只做必要的 provider 适配，不重复定义 UI 语义
3. `reasoning / subtask / tool-call / tool-result / file changes` 优先走共享 formatter
4. 如果某个 provider 有特殊事件，只在 wrapper 里做事件解包，最终仍输出 canonical ace-process block

对于 ACP 系列 wrapper，例如：

- `kiro-cli-wrapper.ts`
- `trae-cli-wrapper.ts`
- `claude-code-acp-wrapper.ts`

它们默认通过 [acp-wrapper-base.ts](./acp-wrapper-base.ts) 继承这套统一逻辑。

### Cursor 和 Codex 的额外说明

- `Cursor` 的特殊点是 `tool_call` 早期可能没有 `rawInput`，因此 wrapper 会先缓存，再在 `tool-call-update` 时补齐并统一格式化。
- `Codex` 的特殊点是很多工具行为只以 `command_execution` 出现，因此会先通过 `inferCommandToolName(...)` 把命令归类成 `read / grep / ls / bash / cmd / powershell` 等 canonical 类型。

## 支持的引擎

### 1. Claude Code (默认)
- **状态**: ✅ 可用
- **命令**: `claude`
- **特性**: Anthropic 官方 CLI，功能完整
- **协议**: 专有协议

### 2. Kiro CLI
- **状态**: ✅ 可用
- **命令**: `kiro-cli acp`
- **特性**: 基于 ACP 协议，支持自定义 Agent 配置
- **协议**: ACP (Agent Client Protocol) - JSON-RPC 2.0

### 3. Codex
- **状态**: ✅ 可用
- **命令**: `codex`
- **特性**: OpenAI Codex 引擎
- **协议**: Codex SDK / CLI 事件流

### 4. Cursor CLI
- **状态**: ✅ 可用
- **命令**: `agent acp`
- **特性**: Cursor 命令行工具
- **协议**: ACP (Agent Client Protocol)

### 5. Trae CLI
- **状态**: ✅ 可用
- **命令**: `trae-cli acp serve`
- **特性**: Trae CLI wrapper
- **协议**: ACP (Agent Client Protocol)

### 6. Claude Code ACP
- **状态**: ✅ 可用
- **命令**: `claude-agent-acp`
- **特性**: Claude Code 的 ACP 适配层
- **协议**: ACP (Agent Client Protocol)

### 7. OpenCode
- **状态**: ✅ 可用
- **命令**: `opencode`
- **特性**: OpenCode SDK / HTTP 适配
- **协议**: OpenCode 事件流

### 8. 其他已接入 wrapper
- `nga`
- `codegenie`
- `magic-cli`

这些 wrapper 都已经接到统一的 engine factory 和 stream 协议里。这里的“可用”指项目内 wrapper 已实现并参与引擎选择，不表示用户本机一定已经安装对应 CLI。

## 配置引擎

### 方法 1: 通过 UI 配置

访问 `/engines` 页面，选择要使用的引擎。系统会自动检查引擎可用性。

### 方法 2: 手动配置

在项目根目录创建 `.engine.json` 文件：

```json
{
  "engine": "kiro-cli",
  "updatedAt": "2026-03-05T12:00:00.000Z"
}
```

支持的引擎值：
- `claude-code` (默认)
- `kiro-cli`
- `codex`
- `cursor`
- `trae-cli`
- `claude-code-acp`
- `opencode`
- `nga`
- `codegenie`
- `magic-cli`

## 使用 Kiro CLI

### 安装

```bash
# 安装 Kiro CLI
curl -fsSL https://cli.kiro.dev/install | bash
```

安装后，访问 `/engines` 页面，点击"刷新可用性"按钮，系统会检测到 Kiro CLI 可用。

### Agent 配置

Kiro CLI 支持自定义 Agent 配置。在项目中创建 `.kiro/agents/` 目录：

```json
{
  "name": "my-agent",
  "description": "A custom agent for my workflow",
  "tools": ["read", "write"],
  "allowedTools": ["read"],
  "resources": [
    "file://README.md",
    "file://.kiro/steering/**/*.md",
    "skill://.kiro/skills/**/SKILL.md"
  ],
  "prompt": "You are a helpful coding assistant",
  "model": "claude-sonnet-4"
}
```

### 使用特定 Agent

在工作流配置中指定 agent 名称，系统会自动使用对应的 Kiro CLI agent 配置。

## 架构

### 引擎接口

所有引擎都实现统一的 `Engine` 接口：

```typescript
interface Engine {
  execute(options: EngineOptions): Promise<EngineResult>;
  cancel(): void;
  isAvailable(): Promise<boolean>;
  getName(): string;
  on(event: 'stream', listener: (event: EngineStreamEvent) => void): void;
  off(event: 'stream', listener: (event: EngineStreamEvent) => void): void;
}
```

### 引擎工厂

`engine-factory.ts` 负责根据配置创建相应的引擎实例：

```typescript
import { createEngine, getConfiguredEngine } from '@/lib/engines';

// 获取配置的引擎类型
const engineType = await getConfiguredEngine();

// 创建引擎实例
const engine = await createEngine(engineType);
```

### 文件结构

```
src/lib/engines/
├── index.ts
├── engine-interface.ts
├── engine-factory.ts
├── acp-wrapper-base.ts
├── claude-code-wrapper.ts
├── claude-code-acp-wrapper.ts
├── codex-wrapper.ts
├── cursor-wrapper.ts
├── kiro-cli-wrapper.ts
├── trae-cli-wrapper.ts
├── opencode-wrapper.ts
├── opencode-sdk-wrapper.ts
├── opencode-http-adapter.ts
└── ...
```

## 工作流集成

工作流管理器会在启动时自动初始化配置的引擎：

1. 读取 `.engine.json` 配置文件
2. 创建对应的引擎实例
3. 检查引擎可用性
4. 如果引擎不可用，自动回退到 Claude Code

执行任务时，系统会根据配置使用相应的引擎：

```typescript
// workflow-manager.ts 中的执行流程
await this.initializeEngine();
const result = await this.executeWithEngine(
  processId, agent, step, prompt, systemPrompt, model, options
);
```

## 开发新引擎

要添加新的引擎支持：

1. 实现 `Engine` 接口
2. 在 `engine-factory.ts` 中添加创建逻辑
3. 更新 `EngineType` 类型定义
4. 在 UI 中添加引擎选项

示例：

```typescript
import { Engine, EngineOptions, EngineResult } from './engine-interface';

export class MyCustomEngine implements Engine {
  getName(): string {
    return 'my-engine';
  }

  async isAvailable(): Promise<boolean> {
    // 检查引擎是否可用
    return true;
  }

  async execute(options: EngineOptions): Promise<EngineResult> {
    // 实现执行逻辑
    return {
      success: true,
      output: 'Result',
    };
  }

  cancel(): void {
    // 实现取消逻辑
  }

  on(event: 'stream', listener: any): void {
    // 实现事件监听
  }

  off(event: 'stream', listener: any): void {
    // 实现事件移除
  }
}
```

## 测试

运行 Kiro CLI 测试：

```bash
npm run check:engines
npm run check:engine-chat
```

## 故障排除

### Agent 配置未找到

确保 agent 配置文件存在于正确的位置，并且格式正确。

### 引擎切换不生效

1. 检查 `.engine.json` 文件是否正确创建
2. 重启工作流服务
3. 在 `/engines` 页面刷新可用性检查

## 参考资料

- [ACP 协议文档](https://agentclientprotocol.com/)
