# 微信接入

ACEHarness 的微信接入由系统内置的 TypeScript iLink 适配器完成。用户侧只需要在当前对话里点击“微信 Bot / 接入微信”，然后按页面提示扫码确认。

扫码完成后，ACEHarness 会自动完成这些事情：

- 创建或复用当前用户的微信 channel integration
- 把当前首页对话绑定到这个 channel
- 保存微信账号 token、同步游标和会话 `context_token`
- 启动后台长轮询，持续接收微信消息
- 把 ACEHarness 的回复发回微信
- 在服务重启后自动恢复有效的微信轮询

## 用户流程

```mermaid
sequenceDiagram
  participant User as 用户
  participant Page as ACEHarness 页面
  participant Login as 微信扫码会话
  participant Bridge as ACEHarness iLink 适配器
  participant WeChat as 微信 iLink

  User->>Page: 点击“微信 Bot / 接入微信”
  Page->>Page: 自动创建 channel 和当前对话绑定
  Page->>Login: 创建扫码登录会话
  Login->>WeChat: 获取二维码
  WeChat-->>Page: 返回二维码页面
  User->>WeChat: 手机微信扫码并确认
  Page->>Login: 轮询扫码状态
  Login-->>Page: 返回已确认的微信账号
  Page->>Bridge: 启动当前账号的消息轮询
  Bridge->>WeChat: getupdates 长轮询
```

普通接入流程不需要填写桥接参数。页面高级排错信息中展示的内部接入参数，仅用于问题定位。

## 系统原理

微信接入分成三层：

1. iLink 适配层  
   ACEHarness 直接调用微信 iLink 接口：用二维码完成登录，用 `getupdates` 拉取文本消息，用 `sendmessage` 发送回复。

2. Channel 运行时层  
   适配器把微信消息转换成 ACEHarness 标准 channel 入站消息，投递到 `/api/channels/inbound/:integrationId`。

3. 对话绑定层  
   一个微信会话会绑定到一个 ACEHarness 对话目标。当前首页入口会把微信 channel 绑定到当前首页对话，后续微信消息继续进入同一个上下文。

```mermaid
flowchart LR
  User["微信用户"]
  WeChat["微信 iLink"]
  Adapter["ACEHarness iLink 适配器"]
  Store[("本地微信账号状态\naccount token / sync buf / context_token")]
  Channel["Channel Integration"]
  Inbound["Channel Inbound API"]
  Binding[("会话绑定")]
  Chat["ACEHarness 当前对话"]

  User -->|"发送消息"| WeChat
  Adapter <-->|"二维码登录 / getupdates / sendmessage"| WeChat
  Adapter --> Store
  Adapter -->|"标准 channel 消息"| Inbound
  Channel --> Inbound
  Inbound --> Binding
  Binding --> Chat
  Chat -->|"replyMessages"| Inbound
  Inbound -->|"结构化回复"| Adapter
  Adapter -->|"sendmessage"| WeChat
  WeChat -->|"回复"| User
```

## 消息收发流程

```mermaid
sequenceDiagram
  participant User as 微信用户
  participant WeChat as 微信 iLink
  participant Adapter as ACEHarness iLink 适配器
  participant Inbound as Channel Inbound API
  participant Binding as 会话绑定
  participant Chat as ACEHarness 对话

  User->>WeChat: 发送文本
  Adapter->>WeChat: getupdates
  WeChat-->>Adapter: 返回消息、发送人和 context_token
  Adapter->>Inbound: 投递标准 channel 消息
  Inbound->>Binding: 查找微信会话绑定
  Binding-->>Inbound: 返回当前对话目标
  Inbound->>Chat: 注入用户消息
  Chat-->>Inbound: 返回 replyMessages
  Inbound-->>Adapter: 返回结构化回复
  Adapter->>WeChat: sendmessage
  WeChat-->>User: 用户收到回复
```

## 重启恢复

ACEHarness 启动时会恢复有效的微信接入。恢复过程会校验 channel、微信账号和用户归属，校验通过后重新启动对应账号的 `getupdates` 轮询。

```mermaid
sequenceDiagram
  participant Server as ACEHarness 启动
  participant Restore as 微信恢复器
  participant Channels as Channel Store
  participant Accounts as 微信账号状态
  participant Bridge as iLink 适配器

  Server->>Restore: 调度微信桥接恢复
  Restore->>Channels: 扫描官方微信 channel
  Restore->>Accounts: 读取已保存账号
  Restore->>Restore: 校验账号、用户归属、secret、webhook
  alt channel 有效
    Restore->>Bridge: 重新启动 getupdates 轮询
  else channel 无效
    Restore->>Channels: 删除 channel integration
    Restore->>Channels: 删除相关 binding
  end
```

恢复时会清理无效 channel，而不是只跳过。以下情况会直接删除对应的 `channel-...` 记录及其绑定：

- channel 没有绑定微信账号
- 绑定的微信账号不存在
- 微信账号没有用户归属
- 微信账号归属和 channel 创建者不一致
- 同一个微信账号已经被另一个有效 channel 恢复
- channel 缺少内部 webhook 或 secret

删除后，下次服务启动不会再检查这些已判定无效的 channel。

## 多用户规则

微信账号和 channel 都带有创建者归属：

- 扫码登录创建的微信账号会记录 `createdBy`
- channel integration 会记录 `createdBy`
- 启动桥接时会校验账号是否属于当前用户
- 恢复桥接时也会校验账号归属和 channel 归属是否一致
- 同一个进程内，一个微信账号只允许被一个 channel 轮询

这样可以避免多用户场景下 A 用户的 channel 恢复到 B 用户的微信账号，也避免同一个微信账号被多个 channel 重复拉取消息。

## 能力边界

微信接入支持文本消息闭环：扫码登录、保活、接收文本、投递到当前对话、发送文本回复。

微信接入流程不处理图片、文件、媒体上传和 typing ticket。

`scripts/wechat-bridge-relay.mjs` 和外部 webhook bridge 属于兼容能力，用于接入已有自研适配器；扫码接入不需要使用这条路径。
