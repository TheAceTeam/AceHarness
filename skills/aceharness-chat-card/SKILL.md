---
name: aceharness-chat-card
description: 通用可视化卡片渲染技能。
descriptionZH: 可视化卡片渲染。【触发场景】用卡片显示、做个卡片展示、生成可视化卡片/PR 卡片/Issue
  卡片/card/tabs/badge/徽章/进度条/header/info 行。【注意】无需说 AceHarness，看到卡片需求即触发。输出 card
  JSON 代码块，支持头部/键值对/徽章/badge/代码块/进度条/tabs/badges/折叠区。
tags:
  - 卡片
  - UI
  - 对话
  - 可视化
---

# Aceharness Chat Card

通用可视化卡片渲染技能。**每当用户提到以下任何场景时，必须调用此 skill：**
- 「用卡片显示」「做个卡片展示」「生成可视化卡片」「生成卡片」
- 「显示成卡片形式」「用卡片呈现」「卡片形式展示」
- 「做个 xxx 的摘要卡片」「PR 卡片」「Issue 卡片」「Agent 卡片」「工作流状态卡片」
- 「生成带图标的」「带徽章的」「进度条」「标签页」「折叠区」
- 无论用户是否明确提到「Aceharness」或「card」，只要有可视化卡片需求就必须使用

---

## ⚠️ 最高优先级规则

### 规则 1：输出格式正确性

**展示任何结构化内容时，必须放在 `<result>...</result>` 内，并在其中使用 ```card 代码块：**
- PR/Issue 分析、统计数据、状态、列表、摘要等 → 必须用 `<result>` 包裹的 ```card
- 兼容场景下可用 `<result>` 包裹的 ```json，但不推荐
- `<result>` 外面的 ```card / ```json 不会被系统尝试渲染
- card 代码块与普通文字内容必须**独立输出**，不要混在同一条消息里

正确示例：
```
这是分析结果：

<result>
```card
{"header": {...}, "blocks": [...]}
```
</result>
```

错误示例（禁止）：
```
这里有个 PR：`{"header": {...}, "blocks": [...]}`
```

错误示例（不会渲染）：
```
```card
{"header": {...}, "blocks": [...]}
```
```

### 规则 2：生成前必须验证

**生成任何 ```card 代码块前，必须用验证脚本确认格式正确：**

```bash
# 方式 1：生成后验证
echo '{"header": {...}, "blocks": [...]}' | node /absolute/path/to/skills/aceharness-chat-card/scripts/validate-card.mjs

# 方式 2：直接验证
node /absolute/path/to/skills/aceharness-chat-card/scripts/validate-card.mjs /path/to/card.json
```

发现错误**立即修正**后，再输出到用户可见区域。

### 规则 3：card 与 action 是完全独立的概念

| 概念 | 定义 | 代码块 |
|------|------|--------|
| card | 可视化卡片，用于展示结构化信息 | ```card ``` |
| action | 操作指令块，用于触发系统行为 | ```action ``` |

两者**完全独立**，用途不同，语法不同，禁止混淆。

---

## 推荐常用图标（不限于此列表，任何 Material Icons 图标名均可使用，验证脚本会检查合法性）

**Git/代码相关：** `merge_type` `fork_right` `account_tree` `commit` `tag` `source` `link` `content_copy` `difference` `analytics` `rule` `fact_check` `rate_review` `approval` `merge` `playlist_add_check` `done_all`

**文件相关：** `description` `insert_drive_file` `note` `article` `folder` `file_copy` `receipt`

**代码/编译：** `code` `terminal` `memory` `developer_mode` `engineering` `precision_manufacturing` `bug_report` `error` `warning` `outbound` `text_fields` `dns` `router` `cloud` `storage` `backup` `restore` `sync`

**状态/进度：** `running_with_errors` `pending` `hourglass_empty` `schedule` `timelapse` `autorenew` `visibility` `check_circle` `cancel` `stop` `play_arrow` `pause` `refresh` `next_plan` `assistant` `psychology` `recommend`

**操作相关：** `search` `filter_list` `sort` `download` `upload` `settings` `launch` `arrow_forward` `arrow_back` `close` `add` `remove` `edit` `delete`

**信息相关：** `info` `help` `smart_toy` `rocket_launch` `bolt` `flash_on` `electric_bolt` `power` `battery_charging_full` `device_thermostat` `speed`

**导航/界面：** `chat` `mail` `phone` `flag` `bookmark` `star` `favorite` `thumb_up` `thumb_down` `share`

---

## Card JSON Schema

```typescript
interface CardSchema {
  header?: {
    icon?: string;        // material-symbols-outlined 图标名（任何合法 Material Icons 名称）
    title: string;
    subtitle?: string;
    gradient?: string;    // tailwind 渐变，如 "from-blue-500 to-cyan-500"
    badges?: { text: string; color?: string }[];
  };
  blocks: Block[];        // 有序内容块，**禁止为空数组**
  actions?: { label: string; prompt: string; icon?: string }[];
}

type Block =
  | { type: 'info'; rows: { label: string; value: string; icon?: string }[] }
  | { type: 'badges'; items: { text: string; color?: string }[] }
  | { type: 'text'; content: string; maxLines?: number }
  | { type: 'code'; code: string; lang?: string; copyable?: boolean }
  | { type: 'progress'; value: number; max?: number; label?: string }
  | { type: 'steps'; current: number; total: number }
  | { type: 'tabs'; tabs: { key: string; label: string; blocks: Block[] }[] }
  | { type: 'collapse'; title: string; icon?: string; subtitle?: string; blocks: Block[]; defaultOpen?: boolean }
  | { type: 'list'; items: { icon?: string; color?: string; text: string }[] }
  | { type: 'status'; state: string; color?: string; animated?: boolean; rows?: { label: string; value: string }[] }
  | { type: 'actions'; items: { label: string; prompt: string; icon?: string }[] }
  | { type: 'divider' }
```

---

## ❌ 常见错误

### 错误 1：没有放进 `<result>`

**错误写法：**
````
```card
{"header": {...}, "blocks": [...]}
```
````

**正确写法：**
````
<result>
```card
{"header": {...}, "blocks": [...]}
```
</result>
````

### 错误 2：使用 ```json 而不是 ```card

**错误写法：**
````
<result>
```json
{"header": {...}, "blocks": [...]}
```
</result>
````

**正确写法：**
````
<result>
```card
{"header": {...}, "blocks": [...]}
```
</result>
````

### 错误 3：card 内容和非 card 文字混在一起

**错误写法：**
```
这里有个 PR 的分析结果：
<result>
```card
{"header": {...}}
```
</result>
请查看以上内容。
```

**正确写法：**
```
这是 PR 分析结果：

<result>
```card
{"header": {...}, "blocks": [...]}
```
</result>
```

### 错误 4：blocks 为空或不填

**错误写法：**
<result>
```card
{"header": {"title": "xxx"}, "blocks": []}
```
</result>

**正确写法：**
<result>
```card
{"header": {"title": "xxx"}, "blocks": [{"type": "text", "content": "描述内容"}]}
```
</result>

### 错误 5：使用白名单外的图标名

**错误写法：**
<result>
```card
{"header": {"icon": "my_custom_icon", "title": "xxx"}}
```
</result>

**正确写法：**
<result>
```card
{"header": {"icon": "rocket_launch", "title": "xxx"}}
```
</result>

### 错误 6：跳过验证直接输出

生成 card 后**必须**通过验证脚本检查格式，发现错误立即修正后再输出。

---

## 使用示例

### PR 分析卡片
````card
<result>
```card
{"header": {"icon": "merge_type", "title": "fix: 修复内存泄漏问题", "subtitle": "Cangjie/cangjie_compiler #1224", "gradient": "from-blue-500 to-cyan-500", "badges": [{"text": "open", "color": "green"}, {"text": "bug-fix", "color": "orange"}]}, "blocks": [{"type": "info", "rows": [{"label": "作者", "value": "zhangsan", "icon": "person"}, {"label": "源分支", "value": "fix/memory-leak"}, {"label": "目标分支", "value": "master"}]}, {"type": "text", "content": "修复了编译器在处理大型 AST 时的内存泄漏问题...", "maxLines": 3}, {"type": "list", "items": [{"icon": "check_circle", "color": "text-green-400", "text": "修改了 3 个文件"}, {"icon": "warning", "color": "text-yellow-400", "text": "存在 2 个待解决的评论"}]}], "actions": [{"label": "查看修改文件", "prompt": "获取这个 PR 的修改文件列表", "icon": "description"}, {"label": "查看评论", "prompt": "获取这个 PR 的评论", "icon": "comment"}]}
```
</result>
````

### Agent 详情卡片
````card
<result>
```card
{"header": {"icon": "smart_toy", "title": "architect", "subtitle": "架构师 - 负责设计技术方案", "gradient": "from-purple-500 to-pink-500", "badges": [{"text": "blue-team", "color": "blue"}, {"text": "claude-sonnet", "color": "purple"}]}, "blocks": [{"type": "info", "rows": [{"label": "团队", "value": "蓝队 (defender)"}, {"label": "模型", "value": "claude-sonnet-4-6"}, {"label": "类别", "value": "architect"}]}, {"type": "tabs", "tabs": [{"key": "prompts", "label": "提示词", "blocks": [{"type": "collapse", "title": "系统提示词", "subtitle": "2048 字符", "blocks": [{"type": "code", "code": "你是一个架构师...", "copyable": true}]}]}, {"key": "capabilities", "label": "能力", "blocks": [{"type": "badges", "items": [{"text": "代码审查", "color": "blue"}, {"text": "架构设计", "color": "green"}]}]}]}], "actions": [{"label": "编辑 Agent", "prompt": "编辑这个 Agent 的配置", "icon": "edit"}]}
```
</result>
````

### 工作流状态卡片
````card
<result>
```card
{"header": {"icon": "play_circle", "title": "AST 内存优化", "gradient": "from-green-500 to-emerald-500"}, "blocks": [{"type": "status", "state": "运行中", "color": "green", "animated": true, "rows": [{"label": "当前阶段", "value": "测试阶段"}, {"label": "当前步骤", "value": "tester (功能测试)"}]}, {"type": "progress", "value": 7, "max": 12, "label": "7/12 步骤完成"}], "actions": [{"label": "停止工作流", "prompt": "停止当前工作流", "icon": "stop"}, {"label": "查看日志", "prompt": "查看当前运行的详细日志", "icon": "article"}]}
```
</result>
````

---

## 验证脚本使用说明

验证脚本位置：`skills/aceharness-chat-card/scripts/validate-card.mjs`

使用方法：
```bash
# 从 stdin 读取验证
echo '{"header": {...}, "blocks": [...]}' | node /absolute/path/to/skills/aceharness-chat-card/scripts/validate-card.mjs

# 从文件验证
node /absolute/path/to/skills/aceharness-chat-card/scripts/validate-card.mjs /path/to/card.json
```

验证通过后返回退出码 0，失败返回退出码 1 并输出错误信息。
