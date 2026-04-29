# <domain-display-name>增量规范

## 术语表

- **<term-name>**: <术语解释；说明和主规范中的对应关系>

## 新增需求

### 需求:<new-requirement-name>
系统 MUST <描述本次新增的可观察行为>。

#### 场景:<new-happy-path>
- 假如<新增能力的前置条件>
- 当<用户或系统触发新增能力>
- 则<系统产生新增结果>
- 并且<状态、权限、输出或持久化保持一致>

#### 场景:<new-edge-case>
- 假如<输入缺失、状态冲突或依赖不可用>
- 当<用户或系统触发新增能力>
- 则<系统给出可观察的失败、降级或等待行为>

## 修改需求

### 需求:<changed-requirement-name>
系统 MUST <描述已有行为被修改后的新契约>。

#### 场景:<changed-behavior-scenario>
- 假如<已有行为的前置条件>
- 当<触发条件发生>
- 则<系统按照新的契约响应>
- 并且<旧行为中仍需保留的兼容结果>

## 删除需求

### 需求:<removed-requirement-name>
系统 MUST NOT <描述不再保留的行为>。

#### 场景:<removed-behavior-scenario>
- 假如<用户或系统尝试使用已删除行为>
- 当<触发旧入口或旧配置>
- 则<系统拒绝、忽略、迁移或提示>
- 并且<不会破坏当前稳定行为>

## 验收映射

- 需求 `<requirement-name>` 对应任务：`tasks.md` 中 `<task-id>`
- 需求 `<requirement-name>` 对应设计：`design.md` 中 `<section-or-component>`
- 需求 `<requirement-name>` 对应验证：`<test-or-manual-check>`
