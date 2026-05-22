export type ChannelProviderId =
  | 'feishu-webhook'
  | 'dingtalk-webhook'
  | 'wechat-bridge'
  | 'generic-webhook';

export interface ChannelProviderPreset {
  id: ChannelProviderId;
  name: string;
  category: 'official' | 'bridge' | 'generic';
  transport: 'webhook';
  description: string;
  capabilities: Array<'workflow-runtime' | 'agent-chat' | 'attachments'>;
  fields: Array<{
    key: string;
    label: string;
    type: 'text' | 'password' | 'url' | 'textarea';
    required?: boolean;
    placeholder?: string;
    help?: string;
  }>;
  setupGuide: string[];
}

export const CHANNEL_PROVIDER_PRESETS: ChannelProviderPreset[] = [
  {
    id: 'feishu-webhook',
    name: 'Feishu / Lark Bot',
    category: 'official',
    transport: 'webhook',
    description: '通过飞书事件订阅 webhook 接入工作流运行时和对话。',
    capabilities: ['workflow-runtime', 'agent-chat', 'attachments'],
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', required: true },
      { key: 'appSecret', label: 'App Secret', type: 'password', required: true },
      { key: 'verificationToken', label: 'Verification Token', type: 'password' },
      { key: 'encryptKey', label: 'Encrypt Key', type: 'password' },
    ],
    setupGuide: [
      '在飞书开放平台创建机器人应用并开启事件订阅。',
      '将系统返回的 webhook URL 配置为事件回调地址。',
      '把 App ID / App Secret 等密钥填入集成配置。',
    ],
  },
  {
    id: 'dingtalk-webhook',
    name: 'DingTalk Bot',
    category: 'official',
    transport: 'webhook',
    description: '通过钉钉机器人回调和发送接口接入运行时对话。',
    capabilities: ['workflow-runtime', 'agent-chat'],
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      { key: 'signingSecret', label: 'Signing Secret', type: 'password' },
    ],
    setupGuide: [
      '在钉钉开放平台创建机器人应用并打开消息接收能力。',
      '将 webhook URL 写入事件订阅配置。',
      '保存 Client ID / Client Secret，用于出站发送和签名验证。',
    ],
  },
  {
    id: 'wechat-bridge',
    name: 'WeChat Bridge',
    category: 'bridge',
    transport: 'webhook',
    description: '通过中间桥接器把微信消息归一化后送入 ACEHarness。',
    capabilities: ['workflow-runtime', 'agent-chat', 'attachments'],
    fields: [
      { key: 'bridgeName', label: 'Bridge Name', type: 'text', placeholder: 'hermes / wechaty / custom bridge' },
      { key: 'bridgeCallbackUrl', label: 'Bridge Callback URL', type: 'url', placeholder: 'https://bridge.example.com/callback' },
    ],
    setupGuide: [
      '将系统生成的 inbound webhook URL 配置到微信桥接器。',
      '桥接器只需要发送标准化 JSON，不必感知 workflow 细节。',
      '适合接入个人微信、企业微信或自研消息代理。',
    ],
  },
  {
    id: 'generic-webhook',
    name: 'Generic Webhook',
    category: 'generic',
    transport: 'webhook',
    description: '适用于自研 IM、企业内网消息总线或任意 webhook 源。',
    capabilities: ['workflow-runtime', 'agent-chat'],
    fields: [
      { key: 'notes', label: 'Notes', type: 'textarea', placeholder: '可选：记录上游系统说明' },
    ],
    setupGuide: [
      '向 webhook URL POST 一个标准化消息包即可接入。',
      '适合做平台适配器调试和快速集成。',
    ],
  },
];

export function getChannelProviderPreset(id: string): ChannelProviderPreset | null {
  return CHANNEL_PROVIDER_PRESETS.find((item) => item.id === id) || null;
}
