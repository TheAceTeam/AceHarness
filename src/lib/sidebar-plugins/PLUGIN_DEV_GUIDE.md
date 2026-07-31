# Home Sidebar Plugin System - Developer Guide

## Overview

The home sidebar plugin system allows you to add custom features to the home page by
creating a JSON manifest file. Plugins can contribute:

- **Quick Actions (快捷方式)** - Buttons shown above the chat input
- **Sidebar Tabs** - Tabs in the HomeCommandSidebar
- **Intents** - Actions triggered when quick actions or external events activate

## Quick Start

1. Create a JSON manifest in `src/lib/sidebar-plugins/manifests/`
2. Import it in `src/lib/sidebar-plugins/registry.ts`
3. Add it to the `builtinManifests` array

## Manifest Format

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "What this plugin does",
  "version": "1.0.0",
  "author": "Your Name",
  "enabled": true,
  "order": 50,

  "categories": [
    { "id": "my-category", "title": "My Category", "icon": "star", "order": 50 }
  ],

  "actions": [
    {
      "id": "my-action",
      "label": "Do Something",
      "icon": "play_arrow",
      "color": "from-blue-500 to-blue-600",
      "prompt": "Execute my action",
      "pinned": false,
      "category": "my-category",
      "order": 10
    }
  ],

  "tabs": [
    { "id": "my-tab", "label": "My Tab", "availableWhen": ["hasWorkflow"], "order": 40 }
  ],

  "intents": [
    {
      "id": "my-intent",
      "targetTab": "my-tab",
      "initialStage": "idle",
      "opensModal": false,
      "description": "What this intent does"
    }
  ]
}
```

## Field Reference

### Plugin Root

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique plugin identifier |
| `name` | string | Yes | Display name |
| `description` | string | No | Brief description |
| `version` | string | No | Semver version |
| `author` | string | No | Author name |
| `enabled` | boolean | No | Whether plugin is active (default: true) |
| `order` | number | No | Global sort order (default: 100) |

### Quick Action Categories

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Category identifier |
| `title` | string | Yes | Display title |
| `icon` | string | Yes | Material Symbols icon name |
| `order` | number | No | Sort order among categories |

### Quick Actions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Action identifier |
| `label` | string | Yes | Button label |
| `icon` | string | Yes | Material Symbols icon name |
| `color` | string | Yes | Tailwind gradient classes |
| `prompt` | string | Yes | Text sent on click (or `__HOME_ACTION__:xxx` trigger) |
| `pinned` | boolean | No | Always visible above chat input |
| `category` | string | Yes | Category ID this action belongs to |
| `order` | number | No | Sort order within category |
| `guide` | object | No | Optional guide dialog content |

### Sidebar Tabs

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Tab identifier (maps to HomeSidebarTab) |
| `label` | string | Yes | Tab display label |
| `availableWhen` | string[] | No | Context conditions that must be true |
| `order` | number | No | Sort order among tabs |

### Intents

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Intent identifier |
| `targetTab` | string | Yes | Which tab to activate |
| `initialStage` | string | No | Stage to set when triggered |
| `opensModal` | boolean | No | Whether to open a creation modal |
| `description` | string | No | What this intent does |

## Action Prompts

Actions can use two types of prompts:

1. **Regular prompts** - Sent directly to the chat AI:
   ```json
   { "prompt": "列出所有工作流配置" }
   ```

2. **Home action triggers** - Activate sidebar intents:
   ```json
   { "prompt": "__HOME_ACTION__:create_agent" }
   ```

## Visibility Conditions

Tab `availableWhen` supports these built-in conditions:

- `hasWorkflow` - A workflow binding exists in the current session
- `hasCollaboration` - A collaboration room is active

## Runtime API

For dynamic plugin registration (e.g., user-installed plugins):

```typescript
import { registerPlugin, unregisterPlugin, getAllPlugins } from '@/lib/sidebar-plugins';

// Register at runtime
registerPlugin({
  id: 'user-plugin',
  name: 'User Plugin',
  enabled: true,
  actions: [
    { id: 'custom-action', label: 'Custom', icon: 'bolt', color: 'from-sky-500 to-sky-600', prompt: 'do something', category: 'create', order: 99 }
  ],
});

// List all active plugins
const plugins = getAllPlugins();

// Remove a plugin
unregisterPlugin('user-plugin');
```

## Built-in Plugins

| ID | Name | Actions | Tabs |
|----|------|---------|------|
| `core-views` | 查看功能 | 工作流列表, Agent列表, 模型列表, Skill列表, 运行状态, 运行历史 | - |
| `core-optimize` | 优化功能 | 优化提示词, 分析运行 | - |
| `create-agent` | 创建 Agent | 创建 Agent | agent |
| `supervisor` | 工作流协作 | 工作流运行与协作 | commander |

议场是内置功能，不作为首页侧边栏插件注册。

## Adding a Custom Plugin

Example: Adding a "Deploy" quick action:

```json
// src/lib/sidebar-plugins/manifests/deploy.json
{
  "id": "deploy",
  "name": "部署功能",
  "description": "一键部署工作流到生产环境",
  "version": "1.0.0",
  "enabled": true,
  "order": 25,
  "categories": [
    { "id": "deploy", "title": "部署", "icon": "rocket_launch", "order": 25 }
  ],
  "actions": [
    {
      "id": "deploy-workflow",
      "label": "部署工作流",
      "icon": "rocket_launch",
      "color": "from-violet-500 to-violet-600",
      "prompt": "__HOME_ACTION__:deploy_workflow",
      "pinned": true,
      "category": "deploy",
      "order": 10
    }
  ],
  "intents": [
    {
      "id": "deploy-workflow",
      "targetTab": "commander",
      "initialStage": "preflight",
      "description": "部署当前工作流到生产环境"
    }
  ]
}
```

Then register it in `registry.ts`:
```typescript
import deploy from './manifests/deploy.json';
// Add to builtinManifests array
```
