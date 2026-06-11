'use client';

import type { ChangeEvent } from 'react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { EnvironmentVariables } from '@/components/ai-elements/environment-variables';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { Progress } from '@/components/ui/progress';                                                                                                 
import { copyText } from '@/lib/core/clipboard';
import {
  cangjieSdkApi,
  envApi,
  systemSettingsApi,
  type InstalledSdk,
  type SdkCatalogEntry,
  type SdkChannel,
  type SdkOverviewResponse,
} from '@/lib/core/api';

interface EnvVar {
  key: string;
  value: string;
  enabled: boolean;
}

interface EnvVarRow extends EnvVar {
  id: string;
}

interface EnvVarError {
  key?: string;
}

const AI_ENV_PRESETS = [
  { key: 'ANTHROPIC_API_KEY', description: 'Anthropic API 密钥，Claude/Anthropic 兼容调用会读取。' },
  { key: 'ANTHROPIC_BASE_URL', description: 'Anthropic 自定义 API 地址，用于代理或自建网关。' },
  { key: 'OPENAI_API_KEY', description: 'OpenAI API 密钥，Codex/OpenAI 兼容调用会读取。' },
  { key: 'OPENAI_BASE_URL', description: 'OpenAI 兼容 API 地址，Codex 会显式传给 SDK。' },
];

const AI_ENV_DESCRIPTION_BY_KEY = new Map(AI_ENV_PRESETS.map((item) => [item.key, item.description]));

interface EmailNotificationForm {
  enabled: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword: string;
  smtpPasswordConfigured: boolean;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  ccEmails: string;
  subjectPrefix: string;
}

function getManagedSourceLabel(source: SdkOverviewResponse['effective']['source']) {
  if (source === 'managed') return '托管 SDK';
  return '未启用';
}

function getChannelLabel(channel: SdkChannel) {
  if (channel === 'nightly') return 'Nightly';
  if (channel === 'sts') return 'STS';
  return 'LTS';
}

function makeEnvVarRowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEnvVarRow(input?: Partial<EnvVar>): EnvVarRow {
  return {
    id: makeEnvVarRowId(),
    key: input?.key || '',
    value: input?.value || '',
    enabled: input?.enabled ?? true,
  };
}

function stripEnvVarRow(item: EnvVarRow): EnvVar {
  return {
    key: item.key,
    value: item.value,
    enabled: item.enabled,
  };
}

function validateEnvVars(vars: EnvVar[]) {
  const errors: EnvVarError[] = vars.map(() => ({}));
  const keyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const keyMap = new Map<string, number[]>();

  vars.forEach((item, index) => {
    const trimmedKey = item.key.trim();
    const isEmptyRow = !trimmedKey && !item.value.trim() && item.enabled;

    if (!trimmedKey) {
      if (!isEmptyRow) {
        errors[index].key = '请输入变量名';
      }
      return;
    }

    if (!keyPattern.test(trimmedKey)) {
      errors[index].key = '仅支持字母、数字和下划线，且不能以数字开头';
      return;
    }

    const indexes = keyMap.get(trimmedKey) || [];
    indexes.push(index);
    keyMap.set(trimmedKey, indexes);
  });

  for (const indexes of keyMap.values()) {
    if (indexes.length > 1) {
      for (const index of indexes) {
        errors[index].key = '变量名不能重复';
      }
    }
  }

  return {
    errors,
    hasErrors: errors.some((item) => Boolean(item.key)),
  };
}

export default function SystemSettingsContent() {
  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();

  const [vars, setVars] = useState<EnvVarRow[]>([]);
  const [varErrors, setVarErrors] = useState<EnvVarError[]>([]);
  const [envLoading, setEnvLoading] = useState(true);
  const [envSaving, setEnvSaving] = useState(false);
  const [envError, setEnvError] = useState<string | null>(null);

  const [sdkOverview, setSdkOverview] = useState<SdkOverviewResponse | null>(null);
  const [sdkLoading, setSdkLoading] = useState(true);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [sdkActionKey, setSdkActionKey] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<{ phase: string; downloaded: number; total: number } | null>(null);

  const [gitcodeToken, setGitcodeToken] = useState('');
  const [gitcodeConfigured, setGitcodeConfigured] = useState(false);
  const [engineAvailabilityCacheMinutes, setEngineAvailabilityCacheMinutes] = useState('30');
  const [tokenLoading, setTokenLoading] = useState(true);
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [emailForm, setEmailForm] = useState<EmailNotificationForm>({
    enabled: false,
    smtpHost: '',
    smtpPort: '465',
    smtpSecure: true,
    smtpUsername: '',
    smtpPassword: '',
    smtpPasswordConfigured: false,
    fromEmail: '',
    fromName: '',
    replyTo: '',
    ccEmails: '',
    subjectPrefix: '',
  });
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const managedHomeActive = sdkOverview?.effective.source === 'managed';

  const displayVars = useMemo(() => {
    if (!managedHomeActive) return vars;
    return vars.map((item) => (
      item.key.trim() === 'CANGJIE_HOME'
        ? { ...item, value: sdkOverview?.effective.cangjieHome || '' }
        : item
    ));
  }, [managedHomeActive, sdkOverview?.effective.cangjieHome, vars]);

  const environmentVariableItems = useMemo(() => displayVars.map((item, index) => ({
    id: item.id,
    key: item.key,
    value: item.value,
    enabled: item.enabled,
    required: item.key.trim() === 'CANGJIE_HOME',
    description: AI_ENV_DESCRIPTION_BY_KEY.get(item.key.trim()),
    maskValue: /(TOKEN|SECRET|PASSWORD|KEY)/iu.test(item.key.trim()),
    disableValueEdit: managedHomeActive && item.key.trim() === 'CANGJIE_HOME',
    keyError: varErrors[index]?.key,
    valueHint: managedHomeActive && item.key.trim() === 'CANGJIE_HOME'
      ? '当前已启用托管 SDK，此处展示有效路径，原始环境变量回退值不会被覆盖。'
      : undefined,
  })), [displayVars, managedHomeActive, varErrors]);

  const groupedCatalog = useMemo(() => {
    const groups: Record<SdkChannel, SdkCatalogEntry[]> = { nightly: [], sts: [], lts: [] };
    for (const entry of sdkOverview?.catalog || []) {
      groups[entry.channel].push(entry);
    }
    return groups;
  }, [sdkOverview]);

  const getMatchingPackage = (entry: SdkCatalogEntry) => entry.packages.find(
    (pkg) => pkg.os === sdkOverview?.host.os && pkg.arch === sdkOverview?.host.arch,
  );

  const getInstalledRecord = (entry: SdkCatalogEntry): InstalledSdk | undefined => {
    if (!sdkOverview) return undefined;
    return sdkOverview.installs.find(
      (item) => item.version === entry.version
        && item.channel === entry.channel
        && item.os === sdkOverview.host.os
        && item.arch === sdkOverview.host.arch,
    );
  };

  const syncVarErrors = (nextVars: EnvVarRow[]) => {
    setVarErrors((prev) => nextVars.map((_, index) => prev[index] || {}));
  };

  const loadEnvVars = useCallback(async () => {
    setEnvLoading(true);
    setEnvError(null);
    try {
      const data = await envApi.get('system');
      const nextVars = (data.vars || []).map((item) => createEnvVarRow(item));
      setVars(nextVars);
      setVarErrors(nextVars.map(() => ({})));
    } catch (error: any) {
      const message = error?.message || '加载环境变量失败';
      setEnvError(message);
      toast('error', message);
    } finally {
      setEnvLoading(false);
    }
  }, [toast]);

  const loadSdkOverview = useCallback(async () => {
    setSdkLoading(true);
    setSdkError(null);
    try {
      const overview = await cangjieSdkApi.getOverview();
      setSdkOverview(overview);
    } catch (error: any) {
      const message = error?.message || '加载托管 SDK 信息失败';
      setSdkError(message);
      toast('error', message);
    } finally {
      setSdkLoading(false);
    }
  }, [toast]);

  const loadTokenSettings = useCallback(async () => {
    setTokenLoading(true);
    setTokenError(null);
    try {
      const settings = await systemSettingsApi.get();
      setGitcodeConfigured(settings.gitcodeTokenConfigured);
      setEngineAvailabilityCacheMinutes(String(settings.engineAvailabilityCacheMinutes || 30));
      setEmailForm({
        enabled: Boolean(settings.emailNotifications?.enabled),
        smtpHost: settings.emailNotifications?.smtpHost || '',
        smtpPort: String(settings.emailNotifications?.smtpPort || 465),
        smtpSecure: settings.emailNotifications?.smtpSecure !== false,
        smtpUsername: settings.emailNotifications?.smtpUsername || '',
        smtpPassword: '',
        smtpPasswordConfigured: Boolean(settings.emailNotifications?.smtpPasswordConfigured),
        fromEmail: settings.emailNotifications?.fromEmail || '',
        fromName: settings.emailNotifications?.fromName || '',
        replyTo: settings.emailNotifications?.replyTo || '',
        ccEmails: settings.emailNotifications?.ccEmails || '',
        subjectPrefix: settings.emailNotifications?.subjectPrefix || '',
      });
    } catch (error: any) {
      const message = error?.message || '加载 GitCode Token 状态失败';
      setTokenError(message);
      toast('error', message);
    } finally {
      setTokenLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadEnvVars();
    void loadSdkOverview();
    void loadTokenSettings();
  }, [loadEnvVars, loadSdkOverview, loadTokenSettings]);

  const updateVar = (index: number, patch: Partial<EnvVar>) => {
    setVars((prev) => {
      const next = prev.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
      syncVarErrors(next);
      return next;
    });

    if (patch.key !== undefined) {
      setVarErrors((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, key: undefined } : item)));
    }
  };

  const addRow = () => {
    setVars((prev) => {
      const next = [...prev, createEnvVarRow()];
      syncVarErrors(next);
      return next;
    });
  };

  const addPresetEnvVar = (key: string) => {
    setVars((prev) => {
      if (prev.some((item) => item.key.trim() === key)) return prev;
      const next = [...prev, createEnvVarRow({ key })];
      syncVarErrors(next);
      return next;
    });
  };

  const removeVar = (index: number) => {
    setVars((prev) => {
      const next = prev.filter((_, itemIndex) => itemIndex !== index);
      syncVarErrors(next);
      return next;
    });
    setVarErrors((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const saveEnvVars = async () => {
    const normalizedVars = vars.map((item) => ({ ...item, key: item.key.trim() }));
    const validation = validateEnvVars(normalizedVars);
    setVarErrors(validation.errors);
    if (validation.hasErrors) {
      setEnvError('请先修正环境变量中的错误后再保存');
      toast('error', '请先修正环境变量中的错误后再保存');
      return;
    }

    setEnvSaving(true);
    setEnvError(null);
    try {
      await envApi.save('system', normalizedVars.filter((item) => item.key).map(stripEnvVarRow));
      setVars(normalizedVars);
      toast('success', '环境变量保存成功');
    } catch (error: any) {
      const message = error?.message || '保存环境变量失败';
      setEnvError(message);
      toast('error', message);
    } finally {
      setEnvSaving(false);
    }
  };

  const copyEnvVar = async (index: number) => {
    const item = vars[index];
    if (!item) return;
    const ok = await copyText(`export ${item.key.trim()}="${item.value}"`);
    toast(ok ? 'success' : 'error', ok ? `已复制 ${item.key.trim() || '环境变量'} 导出命令` : '复制失败');
  };

  const saveGitcodeToken = async () => {
    const trimmed = gitcodeToken.trim();
    if (!trimmed) {
      setTokenError(gitcodeConfigured ? '请输入新 Token 后再保存' : '请输入 GitCode Token');
      return;
    }

    setTokenSaving(true);
    setTokenError(null);
    try {
      await systemSettingsApi.save({ gitcodeToken: trimmed });
      setGitcodeToken('');
      setGitcodeConfigured(true);
      toast('success', 'GitCode Token 保存成功');
      await loadTokenSettings();
    } catch (error: any) {
      const message = error?.message || '保存 GitCode Token 失败';
      setTokenError(message);
      toast('error', message);
    } finally {
      setTokenSaving(false);
    }
  };

  const saveEngineAvailabilityCache = async () => {
    const minutes = Number(engineAvailabilityCacheMinutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) {
      setTokenError('引擎可用性缓存时长必须在 1 到 1440 分钟之间');
      return;
    }

    setTokenSaving(true);
    setTokenError(null);
    try {
      await systemSettingsApi.save({
        engineAvailabilityCacheMinutes: Math.round(minutes),
      });
      toast('success', '引擎可用性缓存时长已保存');
      await loadTokenSettings();
    } catch (error: any) {
      const message = error?.message || '保存引擎可用性缓存时长失败';
      setTokenError(message);
      toast('error', message);
    } finally {
      setTokenSaving(false);
    }
  };

  const saveEmailNotifications = async () => {
    if (emailForm.enabled) {
      if (!emailForm.smtpHost.trim() || !emailForm.fromEmail.trim()) {
        setEmailError('启用邮件推送前，请至少填写 SMTP Host 和发件人邮箱');
        toast('error', '请先补齐邮件配置');
        return;
      }
      const port = Number(emailForm.smtpPort);
      if (!Number.isFinite(port) || port <= 0) {
        setEmailError('SMTP Port 必须是有效端口');
        toast('error', 'SMTP 端口无效');
        return;
      }
    }

    setEmailSaving(true);
    setEmailError(null);
    try {
      await systemSettingsApi.save({
        emailNotifications: {
          enabled: emailForm.enabled,
          smtpHost: emailForm.smtpHost.trim(),
          smtpPort: Number(emailForm.smtpPort) || 465,
          smtpSecure: emailForm.smtpSecure,
          smtpUsername: emailForm.smtpUsername.trim(),
          smtpPassword: emailForm.smtpPassword.trim() || undefined,
          fromEmail: emailForm.fromEmail.trim(),
          fromName: emailForm.fromName.trim(),
          replyTo: emailForm.replyTo.trim(),
          ccEmails: emailForm.ccEmails.trim(),
          subjectPrefix: emailForm.subjectPrefix.trim(),
        },
      });
      setEmailForm((prev) => ({ ...prev, smtpPassword: '', smtpPasswordConfigured: prev.smtpPasswordConfigured || Boolean(prev.smtpPassword.trim()) }));
      toast('success', emailForm.enabled ? '人工审查邮件推送已保存' : '邮件推送设置已更新');
      await loadTokenSettings();
    } catch (error: any) {
      const message = error?.message || '保存邮件推送配置失败';
      setEmailError(message);
      toast('error', message);
    } finally {
      setEmailSaving(false);
    }
  };

  const runSdkAction = async (actionKey: string, action: () => Promise<void>, successMessage: string) => {
    setSdkActionKey(actionKey);
    setInstallProgress(null);
    setSdkError(null);
    try {
      await action();
      toast('success', successMessage);
      await loadSdkOverview();
    } catch (error: any) {
      const message = error?.message || 'SDK 操作失败';
      setSdkError(message);
      toast('error', message);
    } finally {
      setSdkActionKey(null);
      setInstallProgress(null);
    }
  };

  const handleRemoveSdk = async (entry: SdkCatalogEntry) => {
    const confirmed = await confirm({
      title: '删除托管 SDK',
      description: `确定要删除 ${entry.releaseName} (${entry.version}) 吗？`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!confirmed) return;

    await runSdkAction(
      `remove:${entry.channel}:${entry.version}`,
      async () => { await cangjieSdkApi.remove(entry.version, entry.channel); },
      'SDK 删除成功',
    );
  };

  const pageLoading = envLoading && sdkLoading && tokenLoading;

  return (
    <>
      <div className="space-y-6">
        {pageLoading ? (
          <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">加载中...</div>
        ) : null}

        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">GitCode Token</h2>
              <p className="mt-1 text-sm text-muted-foreground">必须配置此 Token 才能检测和下载托管 SDK。空输入不会被解释为默认清空。</p>
            </div>
            <Button size="sm" onClick={saveGitcodeToken} disabled={tokenSaving || !gitcodeToken.trim()}>
              {tokenSaving ? '保存中...' : '保存 Token'}
            </Button>
          </div>

          {!gitcodeConfigured && !tokenLoading ? (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
              尚未配置 GitCode Token，SDK 检测和下载功能将不可用。
            </div>
          ) : null}

          {tokenError ? (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{tokenError}</div>
          ) : null}

          <div className="space-y-2">
            <Input
              type="password"
              value={gitcodeToken}
              onChange={(event) => {
                setGitcodeToken(event.target.value);
                if (tokenError) setTokenError(null);
              }}
              disabled={tokenLoading || tokenSaving}
              placeholder={gitcodeConfigured ? '已配置，输入新值可覆盖' : '请输入 GitCode Token'}
            />
            <div className="text-sm text-muted-foreground">当前状态：{tokenLoading ? '加载中...' : gitcodeConfigured ? '✓ 已配置' : '未配置'}</div>
          </div>

          <div className="border-t pt-4 space-y-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">引擎可用性缓存时长</div>
                <div className="mt-1 text-xs text-muted-foreground">所有模型/引擎选择框和引擎管理页都会复用这份可用性结果。默认 30 分钟；手动点击“刷新可用性”会强制重查。</div>
              </div>
              <Button size="sm" variant="outline" onClick={saveEngineAvailabilityCache} disabled={tokenSaving || tokenLoading}>
                {tokenSaving ? '保存中...' : '保存时长'}
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={1440}
                value={engineAvailabilityCacheMinutes}
                onChange={(event) => {
                  setEngineAvailabilityCacheMinutes(event.target.value);
                  if (tokenError) setTokenError(null);
                }}
                disabled={tokenLoading || tokenSaving}
                className="max-w-[160px]"
              />
              <span className="text-sm text-muted-foreground">分钟</span>
            </div>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">人工审查邮件推送</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                当工作流进入人工审查时，系统会自动给该次运行的发起人发送邮件；如有需要，也可以额外抄送团队邮箱。
              </p>
            </div>
            <Button size="sm" onClick={saveEmailNotifications} disabled={emailSaving || tokenLoading}>
              {emailSaving ? '保存中...' : '保存邮件配置'}
            </Button>
          </div>

          <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">启用邮件提醒</div>
                <div className="mt-1 text-xs text-muted-foreground">默认发送给工作流发起人的登录邮箱，适合在微信之外补一条不易错过的提醒。</div>
              </div>
              <Switch
                checked={emailForm.enabled}
                onCheckedChange={(checked) => setEmailForm((prev) => ({ ...prev, enabled: checked }))}
                disabled={emailSaving}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              当前状态：{emailForm.enabled ? '已启用' : '未启用'}
              {emailForm.smtpPasswordConfigured ? ' · 已保存 SMTP 密码' : ' · 尚未保存 SMTP 密码'}
            </div>
          </div>

          {emailError ? (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{emailError}</div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">SMTP Host</div>
              <Input
                value={emailForm.smtpHost}
                onChange={(event) => setEmailForm((prev) => ({ ...prev, smtpHost: event.target.value }))}
                placeholder="例如：smtp.qq.com"
                disabled={emailSaving}
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">SMTP Port</div>
              <Input
                value={emailForm.smtpPort}
                onChange={(event) => setEmailForm((prev) => ({ ...prev, smtpPort: event.target.value }))}
                placeholder="465 或 587"
                disabled={emailSaving}
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">SMTP 用户名</div>
              <Input
                value={emailForm.smtpUsername}
                onChange={(event) => setEmailForm((prev) => ({ ...prev, smtpUsername: event.target.value }))}
                placeholder="通常是邮箱地址"
                disabled={emailSaving}
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">SMTP 密码 / 授权码</div>
              <Input
                type="password"
                value={emailForm.smtpPassword}
                onChange={(event) => setEmailForm((prev) => ({ ...prev, smtpPassword: event.target.value }))}
                placeholder={emailForm.smtpPasswordConfigured ? '已保存，输入新值可覆盖' : '请输入 SMTP 密码或授权码'}
                disabled={emailSaving}
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">发件人邮箱</div>
              <Input
                value={emailForm.fromEmail}
                onChange={(event) => setEmailForm((prev) => ({ ...prev, fromEmail: event.target.value }))}
                placeholder="例如：notify@example.com"
                disabled={emailSaving}
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">发件人名称</div>
              <Input
                value={emailForm.fromName}
                onChange={(event) => setEmailForm((prev) => ({ ...prev, fromName: event.target.value }))}
                placeholder="例如：ACEHarness"
                disabled={emailSaving}
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Reply-To</div>
              <Input
                value={emailForm.replyTo}
                onChange={(event) => setEmailForm((prev) => ({ ...prev, replyTo: event.target.value }))}
                placeholder="可选：回复邮箱"
                disabled={emailSaving}
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">主题前缀</div>
              <Input
                value={emailForm.subjectPrefix}
                onChange={(event) => setEmailForm((prev) => ({ ...prev, subjectPrefix: event.target.value }))}
                placeholder="可选：例如 [ACEHarness]"
                disabled={emailSaving}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Switch
                checked={emailForm.smtpSecure}
                onCheckedChange={(checked) => setEmailForm((prev) => ({ ...prev, smtpSecure: checked }))}
                disabled={emailSaving}
              />
              <div>
                <div className="text-sm font-medium">使用 SSL / TLS</div>
                <div className="text-xs text-muted-foreground">常见情况下，465 建议开启；587 可以关闭后走 STARTTLS。</div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">抄送邮箱</div>
            <Textarea
              value={emailForm.ccEmails}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setEmailForm((prev) => ({ ...prev, ccEmails: event.target.value }))}
              placeholder="可选，多个邮箱用逗号、分号或换行分隔"
              rows={3}
              disabled={emailSaving}
            />
            <div className="text-xs text-muted-foreground">不填写时，只发给当前工作流运行的发起人邮箱。</div>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">托管 Cangjie SDK</h2>
              <p className="mt-1 text-sm text-muted-foreground">独立管理托管 SDK，失败时不会阻塞其他系统设置分区。</p>
            </div>
            <div className="flex gap-2">
              {sdkOverview?.active && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runSdkAction(
                    'deactivate',
                    async () => { await cangjieSdkApi.deactivate(); },
                    '已取消激活',
                  )}
                  disabled={sdkLoading || sdkActionKey !== null}
                >
                  {sdkActionKey === 'deactivate' ? '取消中...' : '取消激活'}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={loadSdkOverview} disabled={sdkLoading || sdkActionKey !== null}>
                {sdkLoading ? '加载中...' : '刷新'}
              </Button>
            </div>
          </div>

          {sdkError && !sdkOverview ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm space-y-3">
              <div className="text-destructive">{sdkError}</div>
              <Button variant="outline" size="sm" onClick={loadSdkOverview} disabled={sdkLoading}>重试</Button>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2 text-sm">
            <div className="rounded-lg bg-muted/40 p-3">
              <div className="text-muted-foreground">当前服务器</div>
              <div className="mt-1 font-medium">{sdkOverview ? `${sdkOverview.host.os} / ${sdkOverview.host.arch}` : '-'}</div>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <div className="text-muted-foreground">当前来源</div>
              <div className="mt-1 font-medium">{getManagedSourceLabel(sdkOverview?.effective.source || 'none')}</div>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <div className="text-muted-foreground">当前激活版本</div>
              <div className="mt-1 font-medium">
                {sdkOverview?.active ? `${getChannelLabel(sdkOverview.active.channel)} · ${sdkOverview.active.version}` : '未激活'}
              </div>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <div className="text-muted-foreground">有效 CANGJIE_HOME</div>
              <div className="mt-1 font-mono text-xs break-all">{sdkOverview?.effective.cangjieHome || '未解析到'}</div>
            </div>
          </div>

          <div className="rounded-lg border border-dashed p-3 text-sm space-y-2">
            <div>
              <span className="text-muted-foreground">diagnostics：</span>
              <span>{sdkOverview?.effective.diagnostics?.length ? sdkOverview.effective.diagnostics.join('；') : '无'}</span>
            </div>
          </div>

          {sdkError && sdkOverview ? (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{sdkError}</div>
          ) : null}

          {sdkLoading && !sdkOverview ? (
            <div className="py-6 text-center text-sm text-muted-foreground">托管 SDK 信息加载中...</div>
          ) : null}

          {!sdkLoading && sdkOverview ? (
            <div className="space-y-4">
              {(['nightly', 'sts', 'lts'] as SdkChannel[]).map((channel) => (
                <div key={channel} className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">{getChannelLabel(channel)}</div>
                  {(groupedCatalog[channel] || []).length === 0 ? (
                    <div className="rounded-md bg-muted/30 p-3 text-sm text-muted-foreground">暂无可用版本</div>
                  ) : (
                    <div className="space-y-3">
                      {groupedCatalog[channel].map((entry) => {
                        const matched = getMatchingPackage(entry);
                        const installed = getInstalledRecord(entry);
                        const isActive = sdkOverview.active?.version === entry.version && sdkOverview.active?.channel === entry.channel;
                        const installKey = `install:${entry.channel}:${entry.version}`;
                        const activateKey = `activate:${entry.channel}:${entry.version}`;
                        const removeKey = `remove:${entry.channel}:${entry.version}`;
                        return (
                          <div key={`${entry.channel}-${entry.version}`} className="rounded-lg border p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium break-all">{entry.releaseName}</div>
                                <div className="text-xs text-muted-foreground break-all">{entry.version}</div>
                              </div>
                              {isActive ? (
                                <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">当前激活</span>
                              ) : null}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              当前平台包：{matched ? matched.name : '当前平台不可安装'}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              安装状态：{installed ? `已安装 · ${installed.installDir}` : '未安装'}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!matched || sdkActionKey !== null}
                                onClick={() => runSdkAction(
                                  installKey,
                                  async () => {
                                    await cangjieSdkApi.install(entry.version, entry.channel, (event) => {
                                      if (event.phase === 'download') {
                                        setInstallProgress({ phase: 'download', downloaded: event.downloaded ?? 0, total: event.total ?? 0 });
                                      } else {
                                        setInstallProgress({ phase: event.phase, downloaded: 0, total: 0 });
                                      }
                                    });
                                  },
                                  'SDK 安装成功',
                                )}
                              >
                                {sdkActionKey === installKey ? (
                                  installProgress?.phase === 'download' && installProgress.total > 0
                                    ? `下载中 ${Math.round(installProgress.downloaded / installProgress.total * 100)}%`
                                    : installProgress?.phase === 'extract' ? '解压中...'
                                    : installProgress?.phase === 'finalize' ? '整理中...'
                                    : '安装中...'
                                ) : installed ? '重新安装' : '安装'}
                              </Button>
                              <Button
                                size="sm"
                                disabled={!installed || isActive || sdkActionKey !== null}
                                onClick={() => runSdkAction(
                                  activateKey,
                                  async () => { await cangjieSdkApi.activate(entry.version, entry.channel); },
                                  'SDK 切换成功',
                                )}
                              >
                                {sdkActionKey === activateKey ? '切换中...' : '激活'}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                disabled={!installed || isActive || sdkActionKey !== null}
                                onClick={() => handleRemoveSdk(entry)}
                              >
                                {sdkActionKey === removeKey ? '删除中...' : '删除'}
                              </Button>
                            </div>
                            {sdkActionKey === installKey && installProgress ? (
                              <div className="space-y-1">
                                <div className="text-xs text-muted-foreground">
                                  {installProgress.phase === 'download'
                                    ? installProgress.total > 0
                                      ? `下载中 ${Math.round(installProgress.downloaded / 1024 / 1024)}MB / ${Math.round(installProgress.total / 1024 / 1024)}MB`
                                      : `下载中 ${Math.round(installProgress.downloaded / 1024 / 1024)}MB`
                                    : installProgress.phase === 'extract' ? '解压中...'
                                    : '整理文件...'}
                                </div>
                                {installProgress.phase === 'download' && installProgress.total > 0 ? (
                                  <Progress value={Math.min(100, Math.round(installProgress.downloaded / installProgress.total * 100))} className="h-1.5" />
                                ) : (
                                  <Progress value={null} className="h-1.5 [&>[data-slot=progress-indicator]]:animate-pulse [&>[data-slot=progress-indicator]]:w-1/3" />
                                )}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </section>

        {/* TODO: Not sure the modification */}
        <section className="rounded-xl border bg-card p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">环境变量说明</h2>
            <p className="mt-1 text-sm text-muted-foreground">这些变量会影响 Claude、Codex 与 OpenAI/Anthropic 兼容网关调用。</p>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {AI_ENV_PRESETS.map((preset) => (
              <Fragment key={preset.key}>
                <code className="font-mono text-primary">{preset.key}</code>
                <span>{preset.description}</span>
              </Fragment>
            ))}
          </div>
        </section>

        <section className="rounded-xl border bg-card p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">环境变量</h2>
              <p className="mt-1 text-sm text-muted-foreground">系统级环境变量会作为运行时回退配置参与解析。</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEnvVars} disabled={envSaving || envLoading}>
                {envSaving ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>

          {envError && !envLoading ? (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{envError}</div>
          ) : null}

          {envLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">环境变量加载中...</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/20 px-3 py-2">
                <div className="mb-2 text-xs font-medium text-muted-foreground">常用 AI 凭据</div>
                <div className="flex flex-wrap gap-2">
                  {AI_ENV_PRESETS.map((preset) => {
                    const exists = displayVars.some((item) => item.key.trim() === preset.key);
                    return (
                      <Button
                        key={preset.key}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 font-mono text-xs"
                        onClick={() => addPresetEnvVar(preset.key)}
                        disabled={envSaving || exists}
                        title={preset.description}
                      >
                        {preset.key}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <EnvironmentVariables
                items={environmentVariableItems}
                disabled={envSaving}
                onAdd={addRow}
                onRemove={removeVar}
                onChange={(index, patch) => updateVar(index, {
                  ...(patch.key !== undefined ? { key: patch.key } : {}),
                  ...(patch.value !== undefined ? { value: patch.value } : {}),
                  ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
                })}
                onCopy={copyEnvVar}
                emptyMessage="暂无环境变量"
              />
            </div>
          )}
        </section>
      </div>

      {dialogProps ? <ConfirmDialog {...dialogProps} /> : null}
    </>
  );
}
