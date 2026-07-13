'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { copyText } from '@/lib/core/clipboard';
import { channelApi, type ChannelIntegrationRecord } from '@/lib/core/api';

function CommandBlock({ title, content, onCopy }: { title: string; content: string; onCopy: () => void }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{title}</div>
        <Button size="sm" variant="outline" onClick={onCopy}>复制</Button>
      </div>
      <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-3 text-xs">{content}</pre>
    </div>
  );
}

export default function ChannelIntegrationsContent() {
  const { toast } = useToast();
  const [integrations, setIntegrations] = useState<ChannelIntegrationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [origin, setOrigin] = useState('');
  const [selectedIntegrationId, setSelectedIntegrationId] = useState('');
  const [inboundConversationId, setInboundConversationId] = useState('wechat-test-room');
  const [inboundConversationName, setInboundConversationName] = useState('微信在线测试');
  const [inboundMessage, setInboundMessage] = useState('你好，帮我看下当前运行状态');
  const [inboundResult, setInboundResult] = useState('');
  const [inboundTesting, setInboundTesting] = useState(false);

  const loadIntegrations = useCallback(async () => {
    setLoading(true);
    try {
      const data = await channelApi.listIntegrations();
      const wechatIntegrations = (data.integrations || []).filter((item) => item.provider === 'wechat-bridge');
      setIntegrations(wechatIntegrations);
      if (wechatIntegrations.length > 0) {
        setSelectedIntegrationId((prev) => prev || wechatIntegrations[0].id);
      } else {
        setSelectedIntegrationId('');
      }
    } catch (error: any) {
      toast('error', error?.message || '加载微信接入失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadIntegrations();
  }, [loadIntegrations]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  const selectedIntegration = useMemo(
    () => integrations.find((item) => item.id === selectedIntegrationId) || integrations[0] || null,
    [integrations, selectedIntegrationId],
  );

  const webhookUrl = selectedIntegration
    ? `${origin}${selectedIntegration.webhookPath}`
    : '';

  const samplePayload = selectedIntegration ? JSON.stringify({
    secret: selectedIntegration.secret,
    message: {
      conversationId: inboundConversationId || 'wechat-test-room',
      conversationName: inboundConversationName || '微信在线测试',
      userId: 'wechat-user-001',
      userName: '微信测试用户',
      text: inboundMessage || '/status',
    },
  }, null, 2) : '';

  const curlCommand = selectedIntegration
    ? [
        `curl -X POST "${webhookUrl}" \\`,
        '  -H "Content-Type: application/json" \\',
        `  -H "x-ace-channel-secret: ${selectedIntegration.secret}" \\`,
        `  -d '${samplePayload.replace(/\r?\n/g, '\n')}'`,
      ].join('\n')
    : '';

  const createIntegration = async () => {
    setSubmitting(true);
    try {
      const result = await channelApi.setup({
        provider: 'wechat-bridge',
        name: `微信接入 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      });
      toast('success', '微信接入地址已生成');
      setSelectedIntegrationId(result.integration.id);
      await loadIntegrations();
    } catch (error: any) {
      toast('error', error?.message || '创建微信接入失败');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleIntegration = async (enabled: boolean) => {
    if (!selectedIntegration) return;
    try {
      const data = await channelApi.updateIntegration(selectedIntegration.id, { enabled });
      setIntegrations((prev) => prev.map((item) => item.id === selectedIntegration.id ? data.integration : item));
      toast('success', enabled ? '微信接入已启用' : '微信接入已停用');
    } catch (error: any) {
      toast('error', error?.message || '更新微信接入状态失败');
    }
  };

  const runInboundSimulation = async () => {
    if (!selectedIntegration) {
      toast('warning', '请先生成微信接入地址');
      return;
    }
    if (!inboundConversationId.trim() || !inboundMessage.trim()) {
      toast('warning', '请先填写测试会话和消息内容');
      return;
    }
    setInboundTesting(true);
    setInboundResult('');
    try {
      const result = await channelApi.simulateInbound(selectedIntegration, {
        conversationId: inboundConversationId.trim(),
        conversationName: inboundConversationName.trim() || undefined,
        text: inboundMessage.trim(),
      });
      setInboundResult(JSON.stringify(result, null, 2));
      toast('success', '在线测试完成');
    } catch (error: any) {
      const message = error?.message || '模拟失败';
      setInboundResult(JSON.stringify({ error: message }, null, 2));
      toast('error', message);
    } finally {
      setInboundTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border p-6">
        <div className="space-y-2">
          <Badge variant="outline">WeChat</Badge>
          <h2 className="text-2xl font-semibold">微信接入</h2>
          <p className="text-sm text-muted-foreground">
            参考 OpenClaw 和 Hermes WeChat Adapter 的操作方式，这里把接入收成 3 步：生成地址、接桥接器、在线测试。
            不需要先填默认 Workflow 或运行时绑定这类内部参数。
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="text-xs text-muted-foreground">你需要准备</div>
            <div className="mt-1 font-medium">一台运行 CSIHarness 的电脑</div>
            <div className="mt-1 text-sm text-muted-foreground">本机或服务器都可以，只要微信桥接器能访问到 CSIHarness。</div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="text-xs text-muted-foreground">你需要准备</div>
            <div className="mt-1 font-medium">个人微信号</div>
            <div className="mt-1 text-sm text-muted-foreground">桥接器负责扫码登录和保活，CSIHarness 只负责接收和处理消息。</div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="text-xs text-muted-foreground">你需要准备</div>
            <div className="mt-1 font-medium">一个正在运行的 Workflow</div>
            <div className="mt-1 text-sm text-muted-foreground">没有运行中的 workflow 时，微信消息没法自动挂到运行时上下文。</div>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">第一步：生成接入地址</h3>
            <p className="mt-1 text-sm text-muted-foreground">这一页只生成 CSIHarness 的 webhook 地址和密钥，不要求你先理解内部绑定配置。</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void loadIntegrations()} disabled={loading}>刷新</Button>
            <Button onClick={createIntegration} disabled={submitting || loading}>{submitting ? '生成中...' : '生成微信接入地址'}</Button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">加载中...</div>
        ) : integrations.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            还没有微信接入地址。点右上角按钮即可生成。
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="space-y-3">
              {integrations.map((integration) => (
                <button
                  type="button"
                  key={integration.id}
                  onClick={() => setSelectedIntegrationId(integration.id)}
                  className={`w-full rounded-lg border p-4 text-left ${selectedIntegration?.id === integration.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/20'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{integration.name}</div>
                    <Badge variant={integration.enabled ? 'secondary' : 'outline'}>{integration.enabled ? '已启用' : '已停用'}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{integration.id}</div>
                </button>
              ))}
            </div>

            {selectedIntegration ? (
              <div className="space-y-4">
                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium">当前接入点</div>
                      <div className="mt-1 text-xs text-muted-foreground">{selectedIntegration.webhookPath}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">启用</span>
                      <Switch checked={selectedIntegration.enabled} onCheckedChange={toggleIntegration} />
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="text-xs text-muted-foreground">Webhook URL</div>
                      <div className="mt-1 break-all font-mono text-xs">{webhookUrl}</div>
                      <Button size="sm" variant="outline" className="mt-2" onClick={() => void copyText(webhookUrl)}>复制 URL</Button>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="text-xs text-muted-foreground">Shared Secret</div>
                      <div className="mt-1 break-all font-mono text-xs">{selectedIntegration.secret}</div>
                      <Button size="sm" variant="outline" className="mt-2" onClick={() => void copyText(selectedIntegration.secret)}>复制 Secret</Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="text-sm font-medium">第二步：接到你的微信桥接器</div>
                  <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <div>1. 在微信桥接器里，把消息回调地址指向上面的 Webhook URL。</div>
                    <div>2. 把 Shared Secret 一并配置进去，桥接器发消息时放到 `x-ace-channel-secret` 请求头，或放在 JSON 里的 `secret` 字段。</div>
                    <div>3. 微信扫码、保活、消息收发由桥接器负责，CSIHarness 只接标准化消息。</div>
                    <div>4. 同一个微信会话第一次发消息时，系统会优先自动绑定到你当前正在运行的 workflow。</div>
                    <div>5. 如果你先不扫码，可以先跑仓库里的 `npm run wechat:relay`，它会把入站和出站消息打印到命令行，先验证链路。</div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <CommandBlock
                    title="标准 JSON 示例"
                    content={samplePayload}
                    onCopy={() => void copyText(samplePayload)}
                  />
                  <CommandBlock
                    title="快速测试链接（curl）"
                    content={curlCommand}
                    onCopy={() => void copyText(curlCommand)}
                  />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-xl border p-6">
        <div>
          <h3 className="text-lg font-semibold">第三步：在线测试</h3>
          <p className="mt-1 text-sm text-muted-foreground">不接微信也可以先在网页里模拟一条消息，确认 webhook、密钥和运行时路由都通了。</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Input value={inboundConversationId} onChange={(event) => setInboundConversationId(event.target.value)} placeholder="会话 ID，例如 wechat-test-room" />
          <Input value={inboundConversationName} onChange={(event) => setInboundConversationName(event.target.value)} placeholder="会话名称，例如 微信在线测试" />
        </div>
        <Textarea value={inboundMessage} onChange={(event) => setInboundMessage(event.target.value)} placeholder="输入一条测试消息" className="min-h-[140px]" />
        <div className="flex flex-wrap gap-2">
          <Button onClick={runInboundSimulation} disabled={inboundTesting || !selectedIntegration}>{inboundTesting ? '测试中...' : '发送在线测试消息'}</Button>
          <Button variant="outline" onClick={() => setInboundMessage('/status')}>填入 /status</Button>
          <Button variant="outline" onClick={() => setInboundMessage('/questions')}>填入 /questions</Button>
        </div>

        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="text-sm font-medium">运行时怎么用</div>
          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
            <div>绑定规则：一个微信会话会固定绑定到一个 workflow，后续消息沿用同一上下文。</div>
            <div>普通文本：默认作为实时反馈注入当前 workflow。</div>
            <div><code>/status</code>：查看当前运行状态。</div>
            <div><code>/questions</code>：查看待回答的人类问题。</div>
            <div><code>/answer &lt;questionId&gt; &lt;内容&gt;</code>：回答 workflow 的人工问题。</div>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="text-xs text-muted-foreground">测试结果</div>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-3 text-xs">{inboundResult || '还没有测试结果。'}</pre>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border p-6">
        <div>
          <h3 className="text-lg font-semibold">推荐适配器</h3>
          <p className="mt-1 text-sm text-muted-foreground">优先复用成熟三方适配器。二维码由适配器自己打印，CSIHarness 只接后面的桥接与运行时。</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <CommandBlock
            title="CSIHarness TS 官方适配器"
            content={[
              'npm run wechat:official -- login',
              '',
              'npm run wechat:official -- bridge --account <accountId> --integration <integrationId> --webhook <webhookUrl> --secret <secret>',
            ].join('\n')}
            onCopy={() => void copyText([
              'npm run wechat:official -- login',
              '',
              'npm run wechat:official -- bridge --account <accountId> --integration <integrationId> --webhook <webhookUrl> --secret <secret>',
            ].join('\n'))}
          />
          <CommandBlock
            title="OpenClaw 扫码后继续"
            content={[
              'WECHAT_PROFILE=openclaw \\',
              'WECHAT_AFTER_LOGIN_COMMAND="npm run wechat:relay" \\',
              'npm run wechat:qr-test',
            ].join('\n')}
            onCopy={() => void copyText([
              'WECHAT_PROFILE=openclaw \\',
              'WECHAT_AFTER_LOGIN_COMMAND="npm run wechat:relay" \\',
              'npm run wechat:qr-test',
            ].join('\n'))}
          />
          <CommandBlock
            title="Hermes / 其他适配器"
            content={[
              'WECHAT_LOGIN_COMMAND="<你的适配器登录命令>" \\',
              'WECHAT_AFTER_LOGIN_COMMAND="npm run wechat:relay" \\',
              'npm run wechat:qr-test',
            ].join('\n')}
            onCopy={() => void copyText([
              'WECHAT_LOGIN_COMMAND="<你的适配器登录命令>" \\',
              'WECHAT_AFTER_LOGIN_COMMAND="npm run wechat:relay" \\',
              'npm run wechat:qr-test',
            ].join('\n'))}
          />
        </div>
      </section>
    </div>
  );
}
