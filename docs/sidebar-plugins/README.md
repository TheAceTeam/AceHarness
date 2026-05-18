# 首页侧边栏插件系统

## 概述

首页侧边栏采用插件架构，所有功能（创建工作流、创建 Agent、工作流 Supervisor、AI 狼人杀等）都以插件形式注册。你可以通过添加插件来扩展侧边栏的功能，包括：

- **快捷操作** — 首页和对话框上方的按钮
- **侧边栏面板** — Tab 内容区域
- **主题** — 自定义视觉风格
- **能力组合** — Agent 调用、圆桌可视化、断点恢复等

## 快速开始

### 1. 创建插件文件

在 `src/plugins/` 下创建你的插件目录：

```
src/plugins/my-plugin/
├── index.ts        # 插件定义
└── MyPanel.tsx     # 面板 UI（可选）
```

### 2. 定义插件

```typescript
// src/plugins/my-plugin/index.ts
import { definePlugin } from '@/lib/sidebar-plugins';
import { MyPanel } from './MyPanel';

export default definePlugin({
  id: 'my-plugin',
  name: '我的插件',
  version: '1.0.0',
  enabled: true,

  // 声明需要的能力
  capabilities: ['persistence', 'agent-calling'],

  // 贡献快捷操作按钮
  actions: {
    categories: [
      { id: 'my-category', title: '我的功能', icon: 'star', order: 50 },
    ],
    items: [
      {
        id: 'my-action',
        label: '执行操作',
        icon: 'play_arrow',
        color: 'from-blue-500 to-blue-600',
        prompt: '__HOME_ACTION__:my_action',
        category: 'my-category',
        order: 10,
      },
    ],
  },

  // 贡献侧边栏 Tab
  tab: {
    id: 'my-tab',
    label: '我的面板',
    order: 40,
    availableWhen: (ctx) => true, // 始终可用
    render: (props) => <MyPanel {...props} />,
  },

  // 处理 intent
  intents: [
    { id: 'my_action', targetTab: 'my-tab', description: '打开我的面板' },
  ],
});
```

### 3. 注册插件

在 `src/lib/sidebar-plugins/registry.ts` 中导入并注册：

```typescript
import myPlugin from '@/plugins/my-plugin';

// 添加到 fullPlugins 数组
let fullPlugins: HomePlugin[] = [
  // ... 现有插件
  myPlugin,
];
```

### 4. 编写面板 UI

```tsx
// src/plugins/my-plugin/MyPanel.tsx
'use client';

import type { PluginRenderProps } from '@/lib/sidebar-plugins';

export function MyPanel({ ctx, capabilities, state, setState }: PluginRenderProps) {
  const handleClick = async () => {
    // 使用 agent-calling 能力
    const output = await capabilities.agentCalling!.call({
      agentName: 'my-agent',
      message: '你好',
    });
    ctx.toast('success', `Agent 回复: ${output.slice(0, 50)}`);
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-medium">我的插件面板</h3>
      <button onClick={handleClick} className="px-3 py-1.5 bg-primary text-primary-foreground rounded">
        调用 Agent
      </button>
    </div>
  );
}
```

## 插件配置参考

### 基本字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `id` | string | ✓ | 唯一标识符 |
| `name` | string | ✓ | 显示名称 |
| `version` | string | | 版本号 |
| `enabled` | boolean | | 是否启用（默认 true） |
| `capabilities` | string[] | ✓ | 需要的能力列表 |

### 快捷操作 (actions)

```typescript
actions: {
  categories: [
    { id: string, title: string, icon: string, order?: number }
  ],
  items: [
    {
      id: string,          // 操作 ID
      label: string,       // 按钮文字
      icon: string,        // Material Symbols 图标名
      color: string,       // Tailwind 渐变色类
      prompt: string,      // 点击时发送的内容
      pinned?: boolean,    // 是否固定显示（不折叠）
      category: string,    // 所属分类 ID
      order?: number,      // 排序
      guide?: {            // 可选的引导对话框
        title: string,
        description: string,
        samplePrompt: string,
        assistantSteps: string[],
      },
    }
  ],
}
```

**prompt 格式：**
- 普通文本 — 直接发送到对话 AI
- `__HOME_ACTION__:xxx` — 触发侧边栏 intent

### 侧边栏 Tab (tab)

```typescript
tab: {
  id: string,                              // Tab ID
  label: string,                           // Tab 标签文字
  order?: number,                          // 排序（越小越靠前）
  availableWhen?: (ctx) => boolean,        // 可见条件
  render: (props: PluginRenderProps) => ReactNode,  // 渲染函数
}
```

**PluginRenderProps：**
- `ctx` — 运行时上下文（sessionId, engine, model, toast, router）
- `capabilities` — 已解析的能力对象
- `state` — 插件持久化状态
- `setState` — 更新插件状态

### 主题 (theme)

```typescript
theme: {
  id: string,
  classes: {
    panel?: string,       // 面板容器
    header?: string,      // 头部
    section?: string,     // 分区
    card?: string,        // 卡片
    badge?: string,       // 徽章
    button?: string,      // 主按钮
    ghostButton?: string, // 次要按钮
  },
  activeWhen?: (ctx) => boolean,  // 何时激活
}
```

### 状态机 (stateMachine)

```typescript
stateMachine: {
  initialPhase: string,
  phases: [
    { id: string, label: string, transitions: string[] }
  ],
}
```

### 断点恢复 (breakpoint)

```typescript
breakpoint: {
  handlers: string[],  // 支持断点的步骤名称
}
```

### Intent

```typescript
intents: [
  {
    id: string,           // Intent ID（对应 __HOME_ACTION__:xxx 中的 xxx）
    targetTab: string,    // 激活哪个 Tab
    initialStage?: string,// 初始阶段
    opensModal?: boolean, // 是否打开弹窗
    description?: string, // 说明
  }
]
```

## 可用能力

| 能力 ID | 说明 | 典型用途 |
|---------|------|----------|
| `agent-calling` | 流式调用 Agent | 多 Agent 对话、角色扮演 |
| `result-extraction` | 解析 `<result>` JSON | 投票、决策提取 |
| `breakpoint-resume` | 失败断点恢复 | 长流程中断续传 |
| `roundtable` | 圆桌可视化 | 多 Agent 座位布局 |
| `persistence` | 插件状态持久化 | 保存游戏进度、表单草稿 |
| `streaming-display` | 流式显示到对话区 | 实时输出 Agent 回复 |
| `theme` | 主题切换 | 自定义视觉风格 |
| `animations` | 动画效果 | 阶段转场、淘汰动画 |
| `modals` | 弹窗管理 | 创建向导、配置面板 |

## 内置插件

| 插件 | 说明 | 快捷操作 | Tab |
|------|------|----------|-----|
| `create-workflow` | 创建工作流 | 创建工作流、启动运行 | 工作流 |
| `create-agent` | 创建 Agent | 创建 Agent | 创建Agent |
| `supervisor` | 工作流 Supervisor | — | 指挥官 |
| `werewolf-lab` | AI 狼人杀 | AI 狼人杀 | 指挥官 |

## 运行时 API

### 动态注册/注销

```typescript
import { registerPlugin, unregisterPlugin } from '@/lib/sidebar-plugins';

// 运行时注册
registerPlugin(myPlugin);

// 运行时注销
unregisterPlugin('my-plugin');
```

### 在面板中使用能力

```tsx
import { useCapability } from '@/components/plugin-host';

function MyPanel() {
  const agentCalling = useCapability('agentCalling');
  const persistence = useCapability('persistence');

  // 读取持久化状态
  const savedData = persistence.get<MyState>();

  // 调用 Agent
  const result = await agentCalling.call({ agentName: 'xxx', message: '...' });

  // 保存状态
  persistence.set((prev) => ({ ...prev, lastResult: result }));
}
```

## 可见条件上下文

`availableWhen` 和 `activeWhen` 回调接收的 `ctx` 对象：

| 字段 | 类型 | 说明 |
|------|------|------|
| `hasWorkflow` | boolean | 当前 session 绑定了工作流 |
| `hasCollaboration` | boolean | 存在协作房间 |
| `hasCreation` | boolean | 存在创建会话 |
| `werewolfMode` | boolean | 狼人杀模式激活 |
| `activeIntent` | string | 当前活跃的 intent |
| `activePhase` | string | 当前状态机阶段 |

## 示例：添加一个"数据分析"插件

```typescript
// src/plugins/data-analysis/index.ts
import { definePlugin } from '@/lib/sidebar-plugins';

export default definePlugin({
  id: 'data-analysis',
  name: '数据分析',
  version: '1.0.0',
  enabled: true,
  capabilities: ['agent-calling', 'persistence', 'streaming-display'],

  actions: {
    categories: [
      { id: 'analysis', title: '分析', icon: 'analytics', order: 35 },
    ],
    items: [
      {
        id: 'analyze-data',
        label: '分析数据',
        icon: 'bar_chart',
        color: 'from-cyan-500 to-cyan-600',
        prompt: '__HOME_ACTION__:analyze_data',
        category: 'analysis',
        order: 10,
      },
    ],
  },

  tab: {
    id: 'analysis',
    label: '数据分析',
    order: 25,
    render: (props) => (
      <div className="p-4">
        <h3>数据分析面板</h3>
        {/* 你的 UI */}
      </div>
    ),
  },

  intents: [
    { id: 'analyze_data', targetTab: 'analysis', description: '打开数据分析面板' },
  ],
});
```
