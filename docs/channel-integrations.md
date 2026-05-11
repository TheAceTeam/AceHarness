# 微信接入

当前版本先把微信接入做顺。页面入口在 `/account/channels`。

## 你只需要准备这 3 样东西

- 一台运行 ACEHarness 的电脑
- 一个个人微信号
- 一个正在运行的 workflow

ACEHarness 不负责微信扫码和保活，只负责接收桥接器转发过来的标准化消息。

## 基础架构

接入链路分 4 层：

1. 微信适配器  
   负责扫码登录、保活、从微信收发消息。可以是 OpenClaw、Hermes WeChat Adapter，或你自己的 ClawBot。

2. 桥接协议  
   负责把微信适配器的消息转成 ACEHarness 能识别的标准 JSON，并接收 ACEHarness 的结构化回包。

3. 会话绑定  
   一个微信会话固定绑定一个运行时目标：
   - 一个 workflow run
   - 或一场 roundtable

4. 运行时对话  
   workflow 和圆桌都走同一条 webhook 入口，但 roundtable 会返回多角色结构化消息。

## 页面里怎么用

### 第一步：生成接入地址

进入 `/account/channels`，点击“生成微信接入地址”。

系统会生成：

- `Webhook URL`
- `Shared Secret`

这两个值就是给微信桥接器填的，不需要先配置默认 workflow、圆桌参与者之类的内部参数。

### 第二步：把地址贴到桥接器

桥接器需要把微信消息转成下面这种 JSON，发到 ACEHarness：

```json
{
  "secret": "<integration-secret>",
  "message": {
    "conversationId": "wechat-room-001",
    "conversationName": "微信测试群",
    "userId": "wx-user-001",
    "userName": "Alice",
    "text": "/status"
  }
}
```

也可以把密钥放到请求头：

```text
x-ace-channel-secret: <integration-secret>
```

### 第三步：在线测试

页面内置“在线测试”：

- 填一个会话 ID
- 输入一条消息
- 点击“发送在线测试消息”

如果当前有运行中的 workflow，系统会优先把这个会话自动绑定到该 workflow。

同一个微信会话一旦绑定成功，后续消息会继续落在这个运行时上下文里，不会在多个 workflow 之间来回跳。

如果你发送 `/roundtable start <议题>`，这个会话会切换为 roundtable 绑定，后续消息继续走该圆桌。

## 运行时支持的消息

- 普通文本：作为实时反馈注入 workflow
- `/status`
- `/questions`
- `/answer <questionId> <内容>`
- `/roundtable start <议题>`

`/roundtable start` 会直接拉起工作流运行时圆桌会议。

## 结构化回包协议

`POST /api/channels/inbound/:integrationId` 除了兼容旧的 `replies: string[]`，现在还会返回 `replyMessages`：

```json
{
  "ok": true,
  "replies": [
    "architect: 建议先收敛接口范围。",
    "default-supervisor: 本轮先冻结需求边界。"
  ],
  "replyMessages": [
    {
      "kind": "roundtable-message",
      "speakerType": "agent",
      "speakerName": "architect",
      "text": "建议先收敛接口范围。"
    },
    {
      "kind": "roundtable-summary",
      "speakerType": "supervisor",
      "speakerName": "default-supervisor",
      "text": "本轮先冻结需求边界。"
    }
  ]
}
```

桥接器应该优先使用 `replyMessages` 发回微信，`replies` 只作为兼容字段。

## 仓库内置的最小桥接器

仓库里提供了一个最小中继脚本：

`scripts/wechat-bridge-relay.mjs`

用途：

- `POST /weixin/event`  
  接收微信适配器事件，转发到 ACEHarness webhook

- `POST /ace/outbound`  
  接收 ACEHarness 主动推送的结构化消息

- `GET /healthz`  
  查看桥接器状态

- `GET /logs`  
  查看最近的入站/出站日志

桥接器运行时会把入站消息和 ACEHarness 回包同时打印到命令行。

启动方式：

```bash
ACE_WEBHOOK_URL=http://127.0.0.1:3000/api/channels/inbound/channel-xxx \
ACE_SECRET=your-secret \
PORT=8787 \
npm run wechat:relay
```

如果要让 ACEHarness 主动把消息推给这个中继器，把渠道集成的 `providerConfig.bridgeCallbackUrl` 或 `outboundWebhookUrl` 设成：

```text
http://127.0.0.1:8787/ace/outbound
```

如果你的微信适配器可以发 HTTP webhook，就让它把消息发到：

```text
http://127.0.0.1:8787/weixin/event
```

## 与 OpenClaw / Hermes 的关系

- OpenClaw / Hermes 解决的是“微信账号怎么登录、怎么保活、怎么收发消息”
- ACEHarness 解决的是“消息进来后绑定哪个 workflow、怎么发起圆桌、怎么处理运行时命令”

也就是说，ACEHarness 现在的基础层已经适合接在 OpenClaw / Hermes 之后。

## 优先复用的成熟适配器

当前推荐优先级：

1. OpenClaw + `@tencent-weixin/openclaw-weixin`
2. Hermes + `hermes-wechat`
3. 其他成熟 `wechaty` 体系适配器

原则是：

- 微信登录、二维码、保活、收发消息尽量复用现成适配器
- ACEHarness 只负责桥接协议、会话绑定、运行时路由和圆桌输出

但现在仓库里还新增了一条 **ACEHarness 自己的 TS 官方适配器实现**，它是参考 `hermes-wechat` 的 iLink 接入方式做的，不再依赖 patch Hermes。

## ACEHarness 官方适配器（TS）

新增命令：

```bash
npm run wechat:official -- login
```

用途：

- 走 iLink Bot API 获取二维码
- 在命令行打印二维码 URL
- 如果本机安装了 `qrcode-terminal`，会额外打印 ASCII 二维码
- 登录成功后把账号信息保存到 ACEHarness 本地数据目录

登录成功后，再启动官方桥接：

```bash
npm run wechat:official -- bridge --account <accountId> --integration <integrationId> --webhook <webhookUrl> --secret <secret>
```

这条桥接命令会：

- 用官方 iLink 协议长轮询 `getupdates`
- 把文本消息转发到 ACEHarness 的渠道 webhook
- 读取 `replyMessages`
- 再通过官方 `sendmessage` 发回微信

当前这版先把 **文本消息的官方闭环** 做起来，媒体上传、图片、文件、typing ticket 后续再继续补。

## 二维码登录后继续测试

仓库里提供了一个交互式编排脚本：

`npm run wechat:qr-test`

这个脚本本身不生成二维码，它会直接运行成熟适配器自己的登录命令，让二维码原样打印在当前终端里。你扫码成功后，它再继续后续测试。

### OpenClaw 模式

如果本机已经装好 `openclaw`，可以直接这样跑：

```bash
WECHAT_PROFILE=openclaw \
WECHAT_AFTER_LOGIN_COMMAND="npm run wechat:relay" \
npm run wechat:qr-test
```

这个流程会依次执行：

1. 安装 `@tencent-weixin/openclaw-weixin`
2. 启用插件
3. 运行 `openclaw channels login --channel openclaw-weixin`
4. 在命令行显示二维码，等你扫码
5. 登录成功后重启 OpenClaw gateway
6. 再继续执行 `WECHAT_AFTER_LOGIN_COMMAND`

### 自定义适配器模式

如果你用的是 Hermes 或其他成熟适配器，就把它们自己的登录命令传进来：

```bash
WECHAT_LOGIN_COMMAND="cd ~/.hermes/hermes-agent && .venv/bin/python /tmp/weixin-login.py" \
WECHAT_AFTER_LOGIN_COMMAND="npm run wechat:relay" \
npm run wechat:qr-test
```

如果你的适配器在登录前还需要预装步骤，可以再补：

```bash
WECHAT_PREP_COMMAND="your prepare command" \
WECHAT_LOGIN_COMMAND="your login command" \
WECHAT_FINALIZE_COMMAND="your finalize command" \
WECHAT_AFTER_LOGIN_COMMAND="npm run wechat:relay" \
npm run wechat:qr-test
```

## 现在这版的边界

- 当前页面已经去掉了默认 workflow、默认绑定类型、圆桌参与者等用户前置配置。
- 微信扫码登录、保活、消息收发仍由外部微信适配器负责。
- 如果当前没有运行中的 workflow，自动绑定不会生效，在线测试会返回缺少运行时上下文。
