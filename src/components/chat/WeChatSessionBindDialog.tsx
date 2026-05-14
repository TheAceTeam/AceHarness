'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { copyText } from '@/lib/core/clipboard';
import {
  channelApi,
  type ChannelBindingRecord,
  type ChannelIntegrationRecord,
  type WeChatOfficialLoginSessionRecord,
} from '@/lib/core/api';
import type { ChatSession } from '@/contexts/ChatContext';

interface WeChatSessionBindDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeSession: ChatSession | null;
  origin: string;
  onBindingSaved: (input: {
    integration: ChannelIntegrationRecord;
    binding: ChannelBindingRecord;
    targetLabel: string;
    accountId?: string;
  }) => void;
}

function buildSessionConversationId(session: ChatSession | null): string {
  if (!session?.id) return 'wechat-home-session';
  return `wechat-${session.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48)}`;
}

function resolveBindingTarget(session: ChatSession | null): {
  bindingType: 'agent-chat';
  targetLabel: string;
  payload: Record<string, any>;
} {
  if (session?.workflowBinding?.configFile && session.workflowBinding.runId) {
    return {
      bindingType: 'agent-chat',
      targetLabel: session.title || '当前对话',
      payload: {
        agentName: session.agentBinding?.agentName || session.workflowBinding.supervisorAgent || 'default-supervisor',
        agentSessionId: session.backendSessionId || session.workflowBinding.supervisorSessionId || undefined,
        frontendSessionId: session.id,
        runId: session.workflowBinding.runId,
        configFile: session.workflowBinding.configFile,
      },
    };
  }

  const agentName = session?.agentBinding?.agentName || 'default-supervisor';
  return {
    bindingType: 'agent-chat',
    targetLabel: session?.title || '当前对话',
    payload: {
      agentName,
      agentSessionId: session?.backendSessionId || undefined,
      frontendSessionId: session?.id,
    },
  };
}

export default function WeChatSessionBindDialog(props: WeChatSessionBindDialogProps) {
  const { open, onOpenChange, activeSession, origin, onBindingSaved } = props;
  const { toast } = useToast();

  const [integration, setIntegration] = useState<ChannelIntegrationRecord | null>(null);
  const [binding, setBinding] = useState<ChannelBindingRecord | null>(null);
  const [loginSession, setLoginSession] = useState<WeChatOfficialLoginSessionRecord | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [startingBridge, setStartingBridge] = useState(false);
  const [checkingLogin, setCheckingLogin] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const qrPopupRef = useRef<Window | null>(null);
  const autoConfirmGenerationRef = useRef(0);
  const finalizedLoginSessionRef = useRef<string | null>(null);

  const bindingTarget = useMemo(() => resolveBindingTarget(activeSession), [activeSession]);
  const externalConversationId = useMemo(() => buildSessionConversationId(activeSession), [activeSession]);
  const externalConversationName = activeSession?.title || '首页对话';

  const closeQrPopup = () => {
    try {
      if (qrPopupRef.current && !qrPopupRef.current.closed) {
        qrPopupRef.current.close();
      }
    } catch {}
    qrPopupRef.current = null;
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

    qrPopupRef.current = window.open(
      url,
      'aceharness-wechat-login',
      'popup=yes,width=420,height=760,resizable=yes,scrollbars=yes'
    );
  };

  useEffect(() => {
    if (!open) {
      closeQrPopup();
      setLoginSession(null);
      autoConfirmGenerationRef.current += 1;
      finalizedLoginSessionRef.current = null;
    }
    return () => {
      closeQrPopup();
    };
  }, [open]);

  useEffect(() => {
    closeQrPopup();
    setLoginSession(null);
    setBinding(null);
    autoConfirmGenerationRef.current += 1;
    finalizedLoginSessionRef.current = null;
  }, [activeSession?.id]);

  const ensureIntegrationAndBinding = async (): Promise<{
    integration: ChannelIntegrationRecord;
    binding: ChannelBindingRecord;
  }> => {
    let selected = integration;
    if (!selected) {
      const result = await channelApi.setup({
        provider: 'wechat-bridge',
        name: `微信接入 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      });
      selected = result.integration;
      setIntegration(selected);
    }

    if (!selected.secret || !selected.webhookPath) {
      throw new Error('当前接入点缺少 webhook 或 secret，请前往高级设置重新生成。');
    }

    if (binding) {
      return { integration: selected, binding };
    }

    const result = await channelApi.saveBinding({
      integrationId: selected.id,
      externalConversationId,
      externalConversationName,
      bindingType: bindingTarget.bindingType,
      ...bindingTarget.payload,
      metadata: {
        source: 'home-session-bind',
        frontendSessionId: activeSession?.id,
        frontendSessionTitle: activeSession?.title,
      },
    });
    setBinding(result.binding);
    return { integration: selected, binding: result.binding };
  };

  const finalizeConfirmedLogin = async (session: WeChatOfficialLoginSessionRecord, currentIntegration: ChannelIntegrationRecord) => {
    if (finalizedLoginSessionRef.current === session.id) return;
    finalizedLoginSessionRef.current = session.id;
    closeQrPopup();
    setStartingBridge(true);
    try {
      await channelApi.startWeChatOfficialBridge({
        integrationId: currentIntegration.id,
        accountId: session.accountId || '',
      });
      toast('success', '微信已连接，桥接器已启动');
      if (binding) {
        onBindingSaved({
          integration: currentIntegration,
          binding,
          targetLabel: bindingTarget.targetLabel,
          accountId: session.accountId,
        });
      }
    } catch (error: any) {
      finalizedLoginSessionRef.current = null;
      toast('error', error?.message || '微信桥接器启动失败');
    } finally {
      setStartingBridge(false);
    }
  };

  const pollLoginStatusInBackground = async (
    sessionId: string,
    currentIntegration: ChannelIntegrationRecord,
    generation: number,
  ) => {
    setCheckingLogin(true);
    try {
      while (generation === autoConfirmGenerationRef.current) {
        const data = await channelApi.getWeChatOfficialLoginSession(sessionId);
        if (generation !== autoConfirmGenerationRef.current) return;
        setLoginSession(data.session);
        if (data.session.status === 'confirmed') {
          await finalizeConfirmedLogin(data.session, currentIntegration);
          return;
        }
        if (data.session.status === 'expired' || data.session.status === 'error') {
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
    } catch {
      // Background wait should not interrupt the user with an error toast.
    } finally {
      if (generation === autoConfirmGenerationRef.current) {
        setCheckingLogin(false);
      }
    }
  };

  const startSetupFlow = async () => {
    if (!activeSession?.id) {
      toast('warning', '当前还没有可绑定的首页会话');
      return;
    }
    setBootstrapping(true);
    setLoginSession(null);
    autoConfirmGenerationRef.current += 1;
    const generation = autoConfirmGenerationRef.current;
    try {
      const prepared = await ensureIntegrationAndBinding();
      const login = await channelApi.createWeChatOfficialLoginSession();
      setIntegration(prepared.integration);
      setBinding(prepared.binding);
      setLoginSession(login.session);
      finalizedLoginSessionRef.current = null;
      openQrPopup(login.session.qrcodeUrl);
      void pollLoginStatusInBackground(login.session.id, prepared.integration, generation);
    } catch (error: any) {
      toast('error', error?.message || '开始微信接入失败');
    } finally {
      setBootstrapping(false);
    }
  };

  const restartQr = async () => {
    setLoginSession(null);
    await startSetupFlow();
  };

  const confirmLogin = async () => {
    if (!loginSession?.id || !integration) return;
    setCheckingLogin(true);
    try {
      const data = await channelApi.waitForWeChatOfficialLoginSession(loginSession.id, 45000);
      setLoginSession(data.session);

      if (data.session.status === 'confirmed') {
        await finalizeConfirmedLogin(data.session, integration);
        return;
      }

      if (data.session.status === 'scanned') {
        toast('warning', '已扫码，请在手机上完成确认');
        return;
      }

      if (data.session.status === 'pending') {
        toast('warning', '还没有检测到扫码，请先在微信里扫码');
        return;
      }

      if (data.session.status === 'expired') {
        toast('warning', '二维码已过期，请重新生成');
        return;
      }

      if (data.session.status === 'error') {
        toast('error', data.session.error || '扫码状态异常');
      }
    } catch (error: any) {
      toast('error', error?.message || '检查扫码状态失败');
    } finally {
      setCheckingLogin(false);
    }
  };

  const statusText = loginSession?.status === 'confirmed'
    ? '已连接'
    : loginSession?.status === 'scanned'
      ? '已扫码，等待微信确认'
      : loginSession?.status === 'expired'
        ? '二维码已过期'
        : loginSession?.status === 'error'
          ? (loginSession.error || '二维码状态异常')
          : '等待扫码';

  const webhookUrl = integration ? `${origin}${integration.webhookPath}` : '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>接入微信</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">将要接入</Badge>
              <div className="text-sm font-medium">{bindingTarget.targetLabel}</div>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              点一次开始接入，扫码完成后，这个对话就能直接在微信里继续聊。
            </div>
          </div>

          {!loginSession ? (
            <div className="rounded-xl border p-6">
              <div className="text-base font-medium">开始接入微信</div>
              <div className="mt-2 text-sm text-muted-foreground">
                不需要额外配置，按提示扫码即可。
              </div>
              <div className="mt-5 flex gap-2">
                <Button onClick={startSetupFlow} disabled={bootstrapping}>
                  {bootstrapping ? '准备中...' : '开始接入微信'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-xl border p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-base font-medium">扫码绑定微信</div>
                  <Badge variant={loginSession.status === 'confirmed' ? 'secondary' : 'outline'}>
                    {statusText}
                  </Badge>
                </div>

                <div className="mt-4 rounded-lg border bg-white p-4">
                  <div className="mx-auto flex min-h-[280px] w-full max-w-[320px] flex-col items-center justify-center rounded border border-dashed p-5 text-center">
                    <div className="text-sm font-medium">扫码页已在新窗口打开</div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      请在新打开的页面中完成扫码确认。确认成功后，这里会自动更新为已连接。
                    </div>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <Button
                        onClick={() => {
                          openQrPopup(loginSession?.qrcodeUrl);
                        }}
                        disabled={!loginSession?.qrcodeUrl}
                      >
                        打开扫码页
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void copyText(loginSession?.qrcodeUrl || '')}
                        disabled={!loginSession?.qrcodeUrl}
                      >
                        复制链接
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <div>1. 打开手机微信扫一扫。</div>
                  <div>2. 在新窗口中的扫码页完成确认。</div>
                  <div>3. 等当前页面显示“已连接”即可。</div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" onClick={restartQr} disabled={bootstrapping}>
                    重新生成二维码
                  </Button>
                  <Button
                    variant="outline"
                    onClick={confirmLogin}
                    disabled={!loginSession?.id || checkingLogin || startingBridge}
                  >
                    {checkingLogin ? '检查中...' : '刷新状态'}
                  </Button>
                  <Button variant="outline" onClick={() => setShowAdvanced((prev) => !prev)}>
                    {showAdvanced ? '收起高级设置' : '展开高级设置'}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border p-5">
                <div className="text-base font-medium">如何测试</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  扫码成功后会自动完成绑定。直接在微信里给这个 Bot 发消息，就会继续当前对话。
                </div>
                <div className="mt-4 rounded-lg border bg-muted/20 p-3">
                  <div className="text-sm font-medium">使用方法</div>
                  <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <div>1. 先完成扫码绑定，等当前页面显示“已连接”。</div>
                    <div>2. 打开微信，给刚绑定的 Bot 发一条消息，例如“你好”。</div>
                    <div>3. 之后你就可以直接在微信里继续当前对话。</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {showAdvanced ? (
            <div className="rounded-xl border p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">高级设置与排错信息</div>
                <Button size="sm" variant="outline" onClick={() => void copyText(JSON.stringify({
                  integrationId: integration?.id,
                  webhookUrl,
                  secret: integration?.secret,
                  conversationId: binding?.externalConversationId,
                  qrcodeUrl: loginSession?.qrcodeUrl,
                }, null, 2))}>
                  复制
                </Button>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Webhook URL</Label>
                  <Input readOnly value={webhookUrl || '尚未生成'} />
                </div>
                <div className="space-y-2">
                  <Label>Shared Secret</Label>
                  <Input readOnly value={integration?.secret || '尚未生成'} />
                </div>
                <div className="space-y-2">
                  <Label>微信会话标识</Label>
                  <Input readOnly value={binding?.externalConversationId || externalConversationId} />
                </div>
                <div className="space-y-2">
                  <Label>二维码链接</Label>
                  <Input readOnly value={loginSession?.qrcodeUrl || '尚未生成'} />
                </div>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                如果这里没有 secret 或 webhook，说明接入点未准备好。重新点“开始接入微信”即可自动生成；如果仍失败，再去 `账号 / 渠道接入` 页面排查。
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
