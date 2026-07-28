'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, ExternalLink, KeyRound, Link2, MessageSquareText, Plus, QrCode, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import {
  DataCard,
  DataCardDescription,
  DataCardHeader,
  DataCardTitle,
} from '@/components/ui/data-card';
import {
  DetailDrawer,
  DetailDrawerBody,
  DetailDrawerContent,
  DetailDrawerDescription,
  DetailDrawerFooter,
  DetailDrawerHeader,
  DetailDrawerTitle,
} from '@/components/ui/detail-drawer';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { StatusPill } from '@/components/ui/status-pill';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { copyText } from '@/lib/core/clipboard';
import {
  channelApi,
  type ChannelBindingRecord,
  type ChannelIntegrationRecord,
  type ChannelProviderPreset,
  type WeChatOfficialLoginSessionRecord,
} from '@/lib/core/api';

type ConfirmAction = 'reveal-secret' | 'copy-secret' | 'delete-integration' | 'bootstrap' | null;

function providerLabel(providerId: string, providers: ChannelProviderPreset[]) {
  return providers.find((provider) => provider.id === providerId)?.name || providerId;
}

function integrationStatus(integration: ChannelIntegrationRecord | null) {
  if (!integration) return <StatusPill tone="neutral">未选择</StatusPill>;
  return integration.enabled ? <StatusPill tone="success">已启用</StatusPill> : <StatusPill tone="neutral">已停用</StatusPill>;
}

function loginStatusTone(status?: WeChatOfficialLoginSessionRecord['status']) {
  if (status === 'confirmed') return 'success';
  if (status === 'expired' || status === 'error') return 'danger';
  if (status === 'scanned') return 'warning';
  return 'info';
}

function loginStatusLabel(status?: WeChatOfficialLoginSessionRecord['status']) {
  if (status === 'confirmed') return '已确认';
  if (status === 'scanned') return '已扫码';
  if (status === 'expired') return '已过期';
  if (status === 'error') return '异常';
  return '等待扫码';
}

function CommandBlock({ title, content, onCopy }: { title: string; content: string; onCopy: () => void }) {
  return (
    <DataCard className="p-0">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="text-sm font-medium">{title}</div>
        <Button size="sm" variant="outline" onClick={onCopy}>
          <Copy className="mr-2 h-4 w-4" />
          复制
        </Button>
      </div>
      <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-all p-4 text-xs leading-5 text-muted-foreground">{content}</pre>
    </DataCard>
  );
}

export default function ChannelIntegrationsContent() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<ChannelProviderPreset[]>([]);
  const [integrations, setIntegrations] = useState<ChannelIntegrationRecord[]>([]);
  const [bindings, setBindings] = useState<ChannelBindingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [origin, setOrigin] = useState('');
  const [query, setQuery] = useState('');
  const [selectedIntegrationId, setSelectedIntegrationId] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const [bootstrapText, setBootstrapText] = useState('');
  const [testSendText, setTestSendText] = useState('CSIHarness channel test');
  const [testSendResult, setTestSendResult] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [inboundConversationId, setInboundConversationId] = useState('wechat-test-room');
  const [inboundConversationName, setInboundConversationName] = useState('微信在线测试');
  const [inboundMessage, setInboundMessage] = useState('你好，帮我看下当前运行状态');
  const [inboundResult, setInboundResult] = useState('');
  const [inboundTesting, setInboundTesting] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginSession, setLoginSession] = useState<WeChatOfficialLoginSessionRecord | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [bridgeAccountId, setBridgeAccountId] = useState('');
  const qrPopupRef = useRef<Window | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [providerData, integrationData] = await Promise.all([
        channelApi.listProviders(),
        channelApi.listIntegrations(),
      ]);
      setProviders(providerData.providers || []);
      setIntegrations(integrationData.integrations || []);
      setSelectedIntegrationId((prev) => prev || integrationData.integrations?.[0]?.id || '');
    } catch (error: any) {
      toast('error', error?.message || '加载渠道集成失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);

  const selectedIntegration = useMemo(
    () => integrations.find((item) => item.id === selectedIntegrationId) || null,
    [integrations, selectedIntegrationId],
  );

  useEffect(() => {
    setSecretVisible(false);
    setBootstrapText('');
    setTestSendResult('');
    if (!selectedIntegration?.id) {
      setBindings([]);
      return;
    }
    channelApi.listBindings(selectedIntegration.id)
      .then((data) => setBindings(data.bindings || []))
      .catch((error: any) => toast('error', error?.message || '加载渠道绑定失败'));
  }, [selectedIntegration?.id, toast]);

  const filteredIntegrations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return integrations;
    return integrations.filter((integration) => [
      integration.name,
      integration.id,
      integration.provider,
      integration.webhookPath,
    ].some((value) => value.toLowerCase().includes(normalized)));
  }, [integrations, query]);

  const webhookUrl = selectedIntegration ? `${origin}${selectedIntegration.webhookPath}` : '';
  const maskedSecret = selectedIntegration?.secret ? `${selectedIntegration.secret.slice(0, 6)}...${selectedIntegration.secret.slice(-4)}` : '尚未生成';
  const selectedProvider = selectedIntegration ? providers.find((provider) => provider.id === selectedIntegration.provider) : null;

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

  const createIntegration = async (provider = 'wechat-bridge') => {
    setSubmitting(true);
    try {
      const result = await channelApi.setup({
        provider,
        name: `${providerLabel(provider, providers)} ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      });
      toast('success', '渠道集成已创建');
      setSelectedIntegrationId(result.integration.id);
      setDrawerOpen(true);
      await loadData();
    } catch (error: any) {
      toast('error', error?.message || '创建渠道集成失败');
    } finally {
      setSubmitting(false);
    }
  };

  const updateSelectedIntegration = (integration: ChannelIntegrationRecord) => {
    setIntegrations((prev) => prev.map((item) => item.id === integration.id ? integration : item));
  };

  const toggleIntegration = async (enabled: boolean) => {
    if (!selectedIntegration) return;
    try {
      const data = await channelApi.updateIntegration(selectedIntegration.id, { enabled });
      updateSelectedIntegration(data.integration);
      toast('success', enabled ? '渠道集成已启用' : '渠道集成已停用');
    } catch (error: any) {
      toast('error', error?.message || '更新渠道状态失败');
    }
  };

  const deleteIntegration = async () => {
    if (!selectedIntegration) return;
    setSubmitting(true);
    try {
      await channelApi.deleteIntegration(selectedIntegration.id);
      toast('success', '渠道集成已删除');
      setDrawerOpen(false);
      setSelectedIntegrationId('');
      await loadData();
    } catch (error: any) {
      toast('error', error?.message || '删除渠道集成失败');
    } finally {
      setSubmitting(false);
      setConfirmAction(null);
    }
  };

  const runInboundSimulation = async () => {
    if (!selectedIntegration) {
      toast('warning', '请先选择一个渠道集成');
      return;
    }
    if (!inboundConversationId.trim() || !inboundMessage.trim()) {
      toast('warning', '请填写测试会话和消息内容');
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
      toast('success', '入站测试完成');
    } catch (error: any) {
      const message = error?.message || '入站测试失败';
      setInboundResult(JSON.stringify({ error: message }, null, 2));
      toast('error', message);
    } finally {
      setInboundTesting(false);
    }
  };

  const runTestSend = async () => {
    if (!selectedIntegration) return;
    setTestSending(true);
    setTestSendResult('');
    try {
      const result = await channelApi.testSend(selectedIntegration.id, { text: testSendText.trim() || undefined });
      setTestSendResult(JSON.stringify(result, null, 2));
      toast('success', '出站测试已发送');
    } catch (error: any) {
      const message = error?.message || '出站测试失败';
      setTestSendResult(JSON.stringify({ error: message }, null, 2));
      toast('error', message);
    } finally {
      setTestSending(false);
    }
  };

  const getBootstrap = async () => {
    if (!selectedIntegration) return;
    setSubmitting(true);
    try {
      const result = await channelApi.getBootstrap(selectedIntegration.id);
      setBootstrapText(JSON.stringify(result, null, 2));
      toast('success', '桥接协议已读取');
    } catch (error: any) {
      toast('error', error?.message || '读取桥接协议失败');
    } finally {
      setSubmitting(false);
      setConfirmAction(null);
    }
  };

  const openQrPopup = (url?: string) => {
    if (!url) return;
    try {
      if (qrPopupRef.current && !qrPopupRef.current.closed) {
        qrPopupRef.current.location.href = url;
        qrPopupRef.current.focus();
        return;
      }
    } catch {}
    qrPopupRef.current = window.open(url, 'aceharness-wechat-login', 'popup=yes,width=420,height=760,resizable=yes,scrollbars=yes');
  };

  const createLoginSession = async () => {
    setLoginBusy(true);
    try {
      const result = await channelApi.createWeChatOfficialLoginSession();
      setLoginSession(result.session);
      openQrPopup(result.session.qrcodeUrl);
      toast('success', '微信扫码会话已创建');
    } catch (error: any) {
      toast('error', error?.message || '创建微信扫码会话失败');
    } finally {
      setLoginBusy(false);
    }
  };

  const refreshLoginStatus = async () => {
    if (!loginSession?.id) return;
    setLoginBusy(true);
    try {
      const result = await channelApi.waitForWeChatOfficialLoginSession(loginSession.id, 45000);
      setLoginSession(result.session);
      if (result.session.accountId) setBridgeAccountId(result.session.accountId);
    } catch (error: any) {
      toast('error', error?.message || '检查扫码状态失败');
    } finally {
      setLoginBusy(false);
    }
  };

  const startBridge = async () => {
    if (!selectedIntegration || !bridgeAccountId.trim()) {
      toast('warning', '请先确认微信 accountId');
      return;
    }
    setLoginBusy(true);
    try {
      const result = await channelApi.startWeChatOfficialBridge({
        integrationId: selectedIntegration.id,
        accountId: bridgeAccountId.trim(),
      });
      updateSelectedIntegration(result.integration);
      toast('success', '微信桥接器已启动');
      setLoginDialogOpen(false);
    } catch (error: any) {
      toast('error', error?.message || '启动微信桥接失败');
    } finally {
      setLoginBusy(false);
    }
  };

  const runConfirmAction = () => {
    if (confirmAction === 'reveal-secret') {
      setSecretVisible(true);
      setConfirmAction(null);
      return;
    }
    if (confirmAction === 'copy-secret') {
      void copyText(selectedIntegration?.secret || '');
      setConfirmAction(null);
      return;
    }
    if (confirmAction === 'bootstrap') {
      void getBootstrap();
      return;
    }
    if (confirmAction === 'delete-integration') {
      void deleteIntegration();
    }
  };

  const confirmTitle =
    confirmAction === 'delete-integration'
      ? '删除渠道集成？'
      : confirmAction === 'bootstrap'
        ? '读取桥接 bootstrap？'
        : '确认访问敏感凭据？';

  const confirmConsequence =
    confirmAction === 'delete-integration'
      ? `将删除 ${selectedIntegration?.name || '当前集成'}，相关 webhook 将不可用。此操作不可撤销。`
      : confirmAction === 'bootstrap'
        ? 'Bootstrap 会返回桥接协议、凭据关联信息和 binding 摘要，仅在需要配置桥接器时读取。'
        : 'Shared Secret 可用于向 webhook 发送消息。只在需要配置桥接器或排错时显示或复制。';

  const confirmVariant = confirmAction === 'delete-integration' ? 'delete' : confirmAction === 'bootstrap' ? 'credential' : 'credential';
  const confirmLabel = confirmAction === 'delete-integration' ? '删除' : '确认';

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        eyebrow="Operate"
        title="Channel Integrations"
        subtitle="管理消息渠道、Webhook、桥接器、会话绑定和运行时收发测试。当前入口保留 /account/channels 深链。"
        status={<StatusPill tone={integrations.some((item) => item.enabled) ? 'success' : 'neutral'}>{integrations.filter((item) => item.enabled).length} active</StatusPill>}
        primaryAction={(
          <Button onClick={() => void createIntegration()} disabled={submitting || loading}>
            <Plus className="mr-2 h-4 w-4" />
            新建集成
          </Button>
        )}
        secondaryActions={(
          <Button variant="outline" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
        )}
      />

      <PageToolbar
        search={<Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、provider、webhook" />}
        activeFilters={selectedIntegration ? (
          <StatusPill tone="accent">Selected: {selectedIntegration.name}</StatusPill>
        ) : null}
      />

      <div className="space-y-6 px-6 py-6">
        <section>
          <DataCard className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <div className="text-sm font-semibold">Provider Catalog</div>
                <div className="text-xs text-muted-foreground">选择 provider preset 创建 webhook/bridge 集成。</div>
              </div>
              <StatusPill tone="neutral">{providers.length} presets</StatusPill>
            </div>
            <DataTable
              rows={providers}
              rowKey="id"
              loading={loading}
              density="compact"
              columns={[
                {
                  id: 'provider',
                  header: 'Provider',
                  render: (provider) => (
                    <div className="min-w-0">
                      <div className="truncate font-medium">{provider.name}</div>
                      <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{provider.description}</div>
                    </div>
                  ),
                },
                { id: 'category', header: 'Category', width: 120, render: (provider) => <StatusPill tone={provider.category === 'official' ? 'accent' : 'neutral'}>{provider.category}</StatusPill> },
                { id: 'transport', header: 'Transport', width: 130, accessor: 'transport' },
                { id: 'capabilities', header: 'Capabilities', render: (provider) => <span className="text-sm text-muted-foreground">{provider.capabilities.join(', ') || 'no capability metadata'}</span> },
              ]}
              rowActions={(provider) => [
                { actions: [{ id: 'create', label: '添加集成', icon: <Plus className="h-4 w-4" />, primary: true, disabled: submitting, onSelect: () => void createIntegration(provider.id) }] },
              ]}
              emptyState={{ title: 'Provider catalog', description: '当前没有 provider preset。' }}
            />
          </DataCard>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <DataCard className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <div className="text-sm font-semibold">Integrations</div>
                <div className="text-xs text-muted-foreground">Webhook 集成列表。选择一行查看 credential、binding 和测试动作。</div>
              </div>
              <StatusPill tone="neutral">{filteredIntegrations.length} items</StatusPill>
            </div>
            <DataTable
              rows={filteredIntegrations}
              rowKey="id"
              loading={loading}
              density="compact"
              onRowClick={(integration) => {
                setSelectedIntegrationId(integration.id);
                setDrawerOpen(true);
              }}
              columns={[
                {
                  id: 'name',
                  header: 'Name',
                  render: (integration) => (
                    <div className="block max-w-[260px] text-left">
                      <span className="block truncate font-medium">{integration.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{integration.webhookPath}</span>
                    </div>
                  ),
                },
                { id: 'provider', header: 'Provider', render: (integration) => providerLabel(integration.provider, providers) },
                { id: 'status', header: 'Status', render: (integration) => integrationStatus(integration) },
                { id: 'binding', header: 'Binding', render: (integration) => bindings.filter((binding) => binding.integrationId === integration.id).length || '-' },
              ]}
              rowActions={(integration) => [
                {
                  actions: [
                    {
                      id: 'manage',
                      label: '管理',
                      icon: <ExternalLink className="h-4 w-4" />,
                      primary: true,
                      onSelect: () => {
                        setSelectedIntegrationId(integration.id);
                        setDrawerOpen(true);
                      },
                    },
                  ],
                },
              ]}
              emptyState={{
                icon: <Link2 className="h-5 w-5" />,
                title: '还没有渠道集成',
                description: '创建一个 webhook 集成后，可以连接微信桥接器、绑定会话并测试运行时消息。',
                primaryAction: <Button onClick={() => void createIntegration()} disabled={submitting}>新建集成</Button>,
              }}
            />
          </DataCard>

          <DataCard>
            <DataCardHeader>
              <div>
                <DataCardTitle>Selected Integration</DataCardTitle>
                <DataCardDescription>{selectedIntegration ? selectedIntegration.name : '选择一个集成查看操作面板。'}</DataCardDescription>
              </div>
              {integrationStatus(selectedIntegration)}
            </DataCardHeader>
            {selectedIntegration ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 text-sm">
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Webhook URL</div>
                    <div className="mt-1 break-all font-mono text-xs">{webhookUrl}</div>
                    <Button className="mt-3" size="sm" variant="outline" onClick={() => void copyText(webhookUrl)}>
                      <Copy className="mr-2 h-4 w-4" />
                      复制 URL
                    </Button>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Shared Secret</div>
                    <div className="mt-1 break-all font-mono text-xs">{secretVisible ? selectedIntegration.secret : maskedSecret}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setConfirmAction('reveal-secret')}>
                        <KeyRound className="mr-2 h-4 w-4" />
                        显示
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmAction('copy-secret')}>
                        <Copy className="mr-2 h-4 w-4" />
                        复制 Secret
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <Label htmlFor="channel-enabled">启用集成</Label>
                  <Switch id="channel-enabled" checked={selectedIntegration.enabled} onCheckedChange={toggleIntegration} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setLoginDialogOpen(true)}>
                    <QrCode className="mr-2 h-4 w-4" />
                    QR / Bridge
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmAction('bootstrap')}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Bootstrap
                  </Button>
                  <Button variant="outline" onClick={() => setDrawerOpen(true)}>
                    详情
                  </Button>
                </div>
              </div>
            ) : null}
          </DataCard>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <DataCard>
            <DataCardHeader>
              <div>
                <DataCardTitle>Inbound Runtime Test</DataCardTitle>
                <DataCardDescription>模拟桥接器向 webhook 发入站消息，验证密钥、binding 和运行时路由。</DataCardDescription>
              </div>
              <StatusPill tone={inboundResult.includes('"error"') ? 'danger' : inboundResult ? 'success' : 'neutral'}>{inboundResult ? '有结果' : '未运行'}</StatusPill>
            </DataCardHeader>
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Input value={inboundConversationId} onChange={(event) => setInboundConversationId(event.target.value)} placeholder="会话 ID" />
                <Input value={inboundConversationName} onChange={(event) => setInboundConversationName(event.target.value)} placeholder="会话名称" />
              </div>
              <Textarea value={inboundMessage} onChange={(event) => setInboundMessage(event.target.value)} placeholder="输入一条测试消息" className="min-h-[120px]" />
              <div className="flex flex-wrap gap-2">
                <Button onClick={runInboundSimulation} disabled={inboundTesting || !selectedIntegration}>
                  <MessageSquareText className="mr-2 h-4 w-4" />
                  {inboundTesting ? '测试中...' : '发送入站测试'}
                </Button>
                <Button variant="outline" onClick={() => setInboundMessage('/status')}>/status</Button>
                <Button variant="outline" onClick={() => setInboundMessage('/questions')}>/questions</Button>
              </div>
              <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/20 p-3 text-xs">{inboundResult || '还没有测试结果。'}</pre>
            </div>
          </DataCard>

          <DataCard>
            <DataCardHeader>
              <div>
                <DataCardTitle>Outbound Test Send</DataCardTitle>
                <DataCardDescription>调用 integration 的 test-send 端点，验证桥接器出站发送能力。</DataCardDescription>
              </div>
              <StatusPill tone={testSendResult.includes('"error"') ? 'danger' : testSendResult ? 'success' : 'neutral'}>{testSendResult ? '有结果' : '未运行'}</StatusPill>
            </DataCardHeader>
            <div className="mt-4 space-y-3">
              <Textarea value={testSendText} onChange={(event) => setTestSendText(event.target.value)} placeholder="出站测试消息" className="min-h-[120px]" />
              <Button onClick={runTestSend} disabled={testSending || !selectedIntegration}>
                {testSending ? '发送中...' : '发送出站测试'}
              </Button>
              <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/20 p-3 text-xs">{testSendResult || '还没有测试结果。'}</pre>
            </div>
          </DataCard>
        </section>

        {selectedIntegration ? (
          <section className="grid gap-4 xl:grid-cols-2">
            <CommandBlock title="标准 JSON 示例" content={samplePayload} onCopy={() => void copyText(samplePayload)} />
            <CommandBlock title="快速测试链接（curl）" content={curlCommand} onCopy={() => void copyText(curlCommand)} />
          </section>
        ) : null}
      </div>

      <DetailDrawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DetailDrawerContent widthClassName="w-[min(520px,calc(100vw-1rem))]">
          <DetailDrawerHeader>
            <DetailDrawerTitle>{selectedIntegration?.name || 'Channel integration'}</DetailDrawerTitle>
            <DetailDrawerDescription>{selectedIntegration ? `${providerLabel(selectedIntegration.provider, providers)} / ${selectedIntegration.id}` : 'No integration selected'}</DetailDrawerDescription>
          </DetailDrawerHeader>
          <DetailDrawerBody className="space-y-5">
            {selectedIntegration ? (
              <>
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <div className="text-sm font-medium">状态</div>
                    <div className="text-xs text-muted-foreground">启用后 webhook 会接受消息。</div>
                  </div>
                  <Switch checked={selectedIntegration.enabled} onCheckedChange={toggleIntegration} />
                </div>
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div className="text-sm font-medium">Credential / Webhook</div>
                  <div className="break-all text-xs text-muted-foreground">{webhookUrl}</div>
                  <div className="break-all font-mono text-xs">{secretVisible ? selectedIntegration.secret : maskedSecret}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void copyText(webhookUrl)}>复制 URL</Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmAction('copy-secret')}>复制 Secret</Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmAction('reveal-secret')}>显示 Secret</Button>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">Bindings</div>
                      <div className="text-xs text-muted-foreground">当前 integration 的会话绑定。</div>
                    </div>
                    <StatusPill tone="neutral">{bindings.length}</StatusPill>
                  </div>
                  <DataTable
                    rows={bindings}
                    rowKey="id"
                    density="compact"
                    columns={[
                      {
                        id: 'conversation',
                        header: 'Conversation',
                        render: (binding) => (
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{binding.externalConversationName || binding.externalConversationId}</div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">{binding.externalConversationId}</div>
                          </div>
                        ),
                      },
                      { id: 'type', header: 'Type', width: 120, render: (binding) => <StatusPill tone="info">{binding.bindingType}</StatusPill> },
                      { id: 'target', header: 'Target', render: (binding) => <span className="text-xs text-muted-foreground">{binding.runId || binding.agentName || binding.frontendSessionId || binding.id}</span> },
                    ]}
                    emptyState={{ title: '暂无 binding', description: '入站消息会按当前策略自动创建或走手动绑定流程。' }}
                  />
                </div>
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <div className="text-sm font-medium">Provider setup guide</div>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {(selectedProvider?.setupGuide?.length ? selectedProvider.setupGuide : [
                      '把 Webhook URL 配置到桥接器。',
                      '把 Shared Secret 配置到请求头 x-ace-channel-secret 或 JSON secret 字段。',
                      '按 binding 策略让会话绑定到 workflow run 或 agent chat。',
                    ]).map((step, index) => (
                      <div key={`${step}-${index}`}>{index + 1}. {step}</div>
                    ))}
                  </div>
                </div>
                {bootstrapText ? (
                  <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/20 p-3 text-xs">{bootstrapText}</pre>
                ) : null}
              </>
            ) : null}
          </DetailDrawerBody>
          <DetailDrawerFooter>
            <Button variant="outline" onClick={() => setLoginDialogOpen(true)} disabled={!selectedIntegration}>QR / Bridge</Button>
            <Button variant="outline" onClick={() => setConfirmAction('bootstrap')} disabled={!selectedIntegration}>Bootstrap</Button>
            <Button variant="destructive" onClick={() => setConfirmAction('delete-integration')} disabled={!selectedIntegration || submitting}>
              <Trash2 className="mr-2 h-4 w-4" />
              删除
            </Button>
          </DetailDrawerFooter>
        </DetailDrawerContent>
      </DetailDrawer>

      <Dialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>QR Login / WeChat Bridge</DialogTitle>
            <DialogDescription>创建微信扫码会话，确认 accountId 后启动 official bridge。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">扫码会话</div>
                  <div className="text-xs text-muted-foreground">{loginSession?.id || '尚未创建'}</div>
                </div>
                <StatusPill tone={loginStatusTone(loginSession?.status)}>{loginStatusLabel(loginSession?.status)}</StatusPill>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={createLoginSession} disabled={loginBusy || !selectedIntegration}>
                  <QrCode className="mr-2 h-4 w-4" />
                  {loginSession ? '重新生成二维码' : '生成二维码'}
                </Button>
                <Button variant="outline" onClick={() => openQrPopup(loginSession?.qrcodeUrl)} disabled={!loginSession?.qrcodeUrl}>打开扫码页</Button>
                <Button variant="outline" onClick={() => void copyText(loginSession?.qrcodeUrl || '')} disabled={!loginSession?.qrcodeUrl}>复制扫码链接</Button>
                <Button variant="outline" onClick={refreshLoginStatus} disabled={loginBusy || !loginSession?.id}>刷新状态</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bridge-account-id">WeChat accountId</Label>
              <Input id="bridge-account-id" value={bridgeAccountId} onChange={(event) => setBridgeAccountId(event.target.value)} placeholder="扫码确认后自动填入，或手动输入" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoginDialogOpen(false)}>关闭</Button>
            <Button onClick={startBridge} disabled={loginBusy || !selectedIntegration || !bridgeAccountId.trim()}>启动桥接器</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={confirmAction !== null}
        variant={confirmVariant}
        title={confirmTitle}
        objectName={selectedIntegration?.name}
        consequence={confirmConsequence}
        confirmLabel={confirmLabel}
        loading={submitting}
        onConfirm={runConfirmAction}
        onCancel={() => setConfirmAction(null)}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      />
    </div>
  );
}
