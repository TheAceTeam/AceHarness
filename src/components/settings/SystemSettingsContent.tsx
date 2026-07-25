'use client';

import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DataCard,
  DataCardActions,
  DataCardDescription,
  DataCardHeader,
  DataCardMeta,
  DataCardTitle,
} from '@/components/ui/data-card';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField, FormSection } from '@/components/ui/form-section';
import { Input } from '@/components/ui/input';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { ConfirmModal, type ConfirmModalVariant } from '@/components/ui/confirm-modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { Progress } from '@/components/ui/progress';
import { MemoryV2DiagnosticsPanel } from '@/components/memory-v2/MemoryV2DiagnosticsPanel';
import { MemoryV2GovernancePanel } from '@/components/memory-v2/MemoryV2GovernancePanel';
import { Download, RefreshCw } from 'lucide-react';
import {
  cangjieSdkApi,
  systemSettingsApi,
  type InstalledSdk,
  type SdkCatalogEntry,
  type SdkChannel,
  type SdkOverviewResponse,
} from '@/lib/core/api';

const ENGINE_ENV_DESCRIPTIONS = [
  {
    id: 'claude',
    label: 'Claude',
    description: 'Claude wrapper 会把这些值传给 Claude Code 进程；这里仅说明真实读取的变量，不提供编辑入口。',
    vars: [
      { key: 'ANTHROPIC_AUTH_TOKEN', description: 'Claude Code 使用的认证令牌。' },
      { key: 'ANTHROPIC_BASE_URL', description: 'Claude Code 请求地址；设置后会同步写入 Claude Code base URL。' },
      { key: 'CLAUDE_CODE_BASE_URL', description: 'Claude Code base URL 兼容变量，代码会归一化为 ANTHROPIC_BASE_URL。' },
      { key: 'CLAUDE_CODE_API_BASE_URL', description: 'Claude Code API base URL 兼容变量，代码会归一化为 ANTHROPIC_BASE_URL。' },
      { key: 'ACE_CLAUDE_CODE_EXECUTABLE', description: '指定 ACEHarness 使用的 Claude Code 可执行文件。' },
      { key: 'CLAUDE_CODE_EXECUTABLE', description: 'Claude Code 可执行文件备用变量。' },
    ],
  },
  {
    id: 'codex',
    label: 'Codex',
    description: 'Codex wrapper 会把这些值传给 Codex SDK；这里仅说明真实读取的变量，不提供编辑入口。',
    vars: [
      { key: 'OPENAI_API_KEY', description: 'Codex SDK 使用的 API 密钥。' },
      { key: 'OPENAI_BASE_URL', description: 'Codex SDK 使用的 base URL；设置后会写入 Codex model provider 配置。' },
    ],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    description: 'OpenCode 相关代码读取这些运行参数和配置目录变量；模型密钥通常由 OpenCode 自身配置或模型路由处理。',
    vars: [
      { key: 'OPENCODE_CONFIG_DIR', description: '指定 OpenCode 全局配置目录。' },
      { key: 'ACE_OPENCODE_STREAM_TIMEOUT_MS', description: 'OpenCode HTTP stream 总超时时间，单位毫秒。' },
      { key: 'ACE_OPENCODE_STREAM_IDLE_TIMEOUT_MS', description: 'OpenCode HTTP stream 空闲超时时间，单位毫秒。' },
    ],
  },
  {
    id: 'kiro',
    label: 'Kiro',
    description: '当前项目的 Kiro wrapper 只启动 kiro-cli 并传入模型参数，代码里没有定义专属 Kiro 环境变量 schema。',
    vars: [],
  },
  {
    id: 'other-cli',
    label: '其他 CLI',
    description: '这里只列当前代码或配置中明确出现的其他 CLI 相关变量。',
    vars: [
      { key: 'GEMINI_MODEL', description: 'Gemini CLI 模型覆盖变量，见模型默认配置注释。' },
      { key: 'MAGIC_CLI_PATH', description: '指定 Magic CLI 可执行文件路径。' },
      { key: 'ACE_NGA_SDK_BASE_URL', description: 'NGA SDK 连接外部服务地址；未设置时启动本地 serve。' },
      { key: 'ACE_NGA_SDK_COMMAND', description: '指定 NGA SDK 启动命令。' },
      { key: 'ACE_NGA_BIN', description: 'NGA SDK 启动命令备用变量。' },
      { key: 'ACE_CODEGENIE_SDK_BASE_URL', description: 'CodeGenie SDK 连接外部服务地址；未设置时启动本地 serve。' },
      { key: 'ACE_CODEGENIE_SDK_COMMAND', description: '指定 CodeGenie SDK 启动命令。' },
      { key: 'ACE_CODEGENIE_BIN', description: 'CodeGenie SDK 启动命令备用变量。' },
    ],
  },
] as const;

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

interface WorkspaceExperienceForm {
  mode: 'engineer' | 'one-person-company';
  defaultEntry: 'home' | 'meeting-room' | 'office' | 'workflows';
  onePersonCompanyOnboardingSeen: boolean;
}

interface AgentMemoryForm {
  captureEnabled: boolean;
  governanceMode: 'manual' | 'review' | 'auto';
}

interface RuntimeDebugForm {
  acpxTraceEnabled: boolean;
  acpxTraceDirectory: string;
}

type SettingsSectionId = 'system' | 'memory' | 'runtime' | 'security' | 'advanced';

type ConfirmRequest = {
  open: boolean;
  variant: ConfirmModalVariant;
  title: string;
  objectName?: string;
  consequence: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
};

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string; description: string }> = [
  { id: 'system', label: 'System', description: 'Workspace defaults, notifications, and cache parameters.' },
  { id: 'memory', label: 'Memory', description: 'Global Memory V2 governance, audit, and cutover diagnostics.' },
  { id: 'runtime', label: '工具链', description: '托管 SDK 与系统环境。' },
  { id: 'security', label: 'Security', description: 'Tokens and secret-bearing notification settings.' },
  { id: 'advanced', label: 'Advanced', description: 'Reference material and lower-frequency controls.' },
];

function getManagedSourceLabel(source: SdkOverviewResponse['effective']['source']) {
  if (source === 'managed') return '托管 SDK';
  return '未启用';
}

function getChannelLabel(channel: SdkChannel) {
  if (channel === 'nightly') return 'Nightly';
  if (channel === 'sts') return 'STS';
  return 'LTS';
}

function normalizeEmailFormForCompare(form: EmailNotificationForm) {
  return JSON.stringify({ ...form, smtpPassword: '' });
}

export default function SystemSettingsContent() {
  const { toast } = useToast();

  const [sdkOverview, setSdkOverview] = useState<SdkOverviewResponse | null>(null);
  const [sdkLoading, setSdkLoading] = useState(true);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [sdkActionKey, setSdkActionKey] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<{ phase: string; downloaded: number; total: number } | null>(null);

  const [gitcodeToken, setGitcodeToken] = useState('');
  const [gitcodeConfigured, setGitcodeConfigured] = useState(false);
  const [engineAvailabilityCacheMinutes, setEngineAvailabilityCacheMinutes] = useState('30');
  const [engineAvailabilityCacheBaseline, setEngineAvailabilityCacheBaseline] = useState('30');
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
  const [emailBaseline, setEmailBaseline] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [workspaceExperienceForm, setWorkspaceExperienceForm] = useState<WorkspaceExperienceForm>({
    mode: 'engineer',
    defaultEntry: 'home',
    onePersonCompanyOnboardingSeen: false,
  });
  const [agentMemoryForm, setAgentMemoryForm] = useState<AgentMemoryForm>({
    captureEnabled: false,
    governanceMode: 'review',
  });
  const [runtimeDebugForm, setRuntimeDebugForm] = useState<RuntimeDebugForm>({
    acpxTraceEnabled: false,
    acpxTraceDirectory: '',
  });
  const [experienceBaseline, setExperienceBaseline] = useState('');
  const [experienceSaving, setExperienceSaving] = useState(false);
  const [experienceError, setExperienceError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('system');
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const managedHomeActive = sdkOverview?.effective.source === 'managed';

  const tokenDirty = Boolean(gitcodeToken.trim());
  const emailDirty = emailBaseline !== '' && (
    normalizeEmailFormForCompare(emailForm) !== emailBaseline || Boolean(emailForm.smtpPassword.trim())
  );
  const experienceDirty = experienceBaseline !== '' && JSON.stringify({
    workspaceExperience: workspaceExperienceForm,
    agentMemory: agentMemoryForm,
    runtimeDebug: runtimeDebugForm,
  }) !== experienceBaseline;
  const engineCacheDirty = engineAvailabilityCacheMinutes !== engineAvailabilityCacheBaseline;
  const systemSaving = tokenSaving || emailSaving || experienceSaving || sdkActionKey !== null;

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
      const nextWorkspaceExperienceForm = {
        mode: settings.workspaceExperience?.mode === 'one-person-company' ? 'one-person-company' : 'engineer',
        defaultEntry: settings.workspaceExperience?.defaultEntry || (settings.workspaceExperience?.mode === 'one-person-company' ? 'office' : 'home'),
        onePersonCompanyOnboardingSeen: Boolean(settings.workspaceExperience?.onePersonCompanyOnboardingSeen),
      } satisfies WorkspaceExperienceForm;
      const nextAgentMemoryForm = {
        captureEnabled: Boolean(settings.agentMemory?.captureEnabled),
        governanceMode: settings.agentMemory?.governanceMode || 'review',
      } satisfies AgentMemoryForm;
      const nextRuntimeDebugForm = {
        acpxTraceEnabled: Boolean(settings.runtimeDebug?.acpxTraceEnabled),
        acpxTraceDirectory: settings.runtimeDebug?.acpxTraceDirectory || '',
      } satisfies RuntimeDebugForm;
      const nextEmailForm = {
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
      } satisfies EmailNotificationForm;
      setGitcodeConfigured(settings.gitcodeTokenConfigured);
      setEngineAvailabilityCacheMinutes(String(settings.engineAvailabilityCacheMinutes || 30));
      setEngineAvailabilityCacheBaseline(String(settings.engineAvailabilityCacheMinutes || 30));
      setWorkspaceExperienceForm(nextWorkspaceExperienceForm);
      setAgentMemoryForm(nextAgentMemoryForm);
      setRuntimeDebugForm(nextRuntimeDebugForm);
      setExperienceBaseline(JSON.stringify({ workspaceExperience: nextWorkspaceExperienceForm, agentMemory: nextAgentMemoryForm, runtimeDebug: nextRuntimeDebugForm }));
      setEmailForm(nextEmailForm);
      setEmailBaseline(normalizeEmailFormForCompare(nextEmailForm));
    } catch (error: any) {
      const message = error?.message || '加载 GitCode Token 状态失败';
      setTokenError(message);
      toast('error', message);
    } finally {
      setTokenLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadSdkOverview();
    void loadTokenSettings();
  }, [loadSdkOverview, loadTokenSettings]);

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
      setEngineAvailabilityCacheBaseline(String(Math.round(minutes)));
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
      const nextEmailForm = { ...emailForm, smtpPassword: '', smtpPasswordConfigured: emailForm.smtpPasswordConfigured || Boolean(emailForm.smtpPassword.trim()) };
      setEmailForm(nextEmailForm);
      setEmailBaseline(normalizeEmailFormForCompare(nextEmailForm));
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

  const saveWorkspaceExperience = async () => {
    setExperienceSaving(true);
    setExperienceError(null);
    try {
      await systemSettingsApi.save({
        workspaceExperience: workspaceExperienceForm,
        agentMemory: agentMemoryForm,
        runtimeDebug: {
          acpxTraceEnabled: runtimeDebugForm.acpxTraceEnabled,
        },
      });
      setExperienceBaseline(JSON.stringify({ workspaceExperience: workspaceExperienceForm, agentMemory: agentMemoryForm, runtimeDebug: runtimeDebugForm }));
      toast('success', '体验与记忆设置已保存');
      await loadTokenSettings();
    } catch (error: any) {
      const message = error?.message || '保存体验与记忆设置失败';
      setExperienceError(message);
      toast('error', message);
    } finally {
      setExperienceSaving(false);
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

  const handleRemoveSdk = (entry: SdkCatalogEntry) => {
    setConfirmRequest({
      open: true,
      variant: 'delete',
      title: '删除托管 SDK',
      objectName: `${entry.releaseName} (${entry.version})`,
      consequence: '删除后，该托管 SDK 版本将从本机托管目录移除。',
      confirmLabel: '删除',
      onConfirm: async () => {
        setConfirmRequest(null);
        await runSdkAction(
          `remove:${entry.channel}:${entry.version}`,
          async () => { await cangjieSdkApi.remove(entry.version, entry.channel); },
          'SDK 删除成功',
        );
      },
    });
  };

  const handleInstallSdk = (entry: SdkCatalogEntry, actionKey: string) => {
    setConfirmRequest({
      open: true,
      variant: 'default',
      title: '安装托管 SDK',
      objectName: `${entry.releaseName} (${entry.version})`,
      consequence: '安装会下载并写入托管 SDK 目录。',
      confirmLabel: '安装',
      onConfirm: async () => {
        setConfirmRequest(null);
        await runSdkAction(
          actionKey,
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
        );
      },
    });
  };

  const handleActivateSdk = (entry: SdkCatalogEntry, actionKey: string) => {
    setConfirmRequest({
      open: true,
      variant: 'default',
      title: '激活托管 SDK',
      objectName: `${entry.releaseName} (${entry.version})`,
      consequence: '激活后，系统运行时会优先使用该托管 CANGJIE_HOME。',
      confirmLabel: '激活',
      onConfirm: async () => {
        setConfirmRequest(null);
        await runSdkAction(
          actionKey,
          async () => { await cangjieSdkApi.activate(entry.version, entry.channel); },
          'SDK 切换成功',
        );
      },
    });
  };

  const handleDeactivateSdk = () => {
    setConfirmRequest({
      open: true,
      variant: 'reset',
      title: '取消激活托管 SDK',
      consequence: '取消激活后，系统将回退到环境变量或宿主机解析到的 CANGJIE_HOME。',
      confirmLabel: '取消激活',
      onConfirm: async () => {
        setConfirmRequest(null);
        await runSdkAction(
          'deactivate',
          async () => { await cangjieSdkApi.deactivate(); },
          '已取消激活',
        );
      },
    });
  };

  const pageLoading = sdkLoading && tokenLoading;

  return (
    <>
      <div className="space-y-5">
        <PageToolbar
          className="rounded-xl border border-border bg-card px-4"
          filters={
            <div className="flex flex-wrap items-center gap-2">
              {SETTINGS_SECTIONS.map((section) => (
                <Button
                  key={section.id}
                  type="button"
                  variant={activeSection === section.id ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveSection(section.id)}
                  className="h-8"
                  title={section.description}
                >
                  {section.label}
                </Button>
              ))}
            </div>
          }
          activeFilters={
            <div className="flex flex-wrap gap-2">
              <StatusPill tone={experienceDirty || engineCacheDirty || tokenDirty || emailDirty ? 'warning' : 'neutral'}>
                {experienceDirty || engineCacheDirty || tokenDirty || emailDirty ? '有未保存更改' : '无未保存更改'}
              </StatusPill>
              <StatusPill tone="neutral" dot={false}>
                {SETTINGS_SECTIONS.find((section) => section.id === activeSection)?.description}
              </StatusPill>
            </div>
          }
        />

        {pageLoading ? (
          <EmptyState
            icon={<RefreshCw className="h-5 w-5" />}
            title="正在加载系统设置"
            description="托管 SDK 和系统参数会并行读取。"
          />
        ) : null}

        {activeSection === 'system' ? (
          <DataCard className="p-0">
            <FormSection
              className="px-5"
              title="系统工作区与 Agent 记忆"
              description="这些是系统级默认值，会影响新会话、会议室、办公室和工作流运行时行为，不属于个人账号资料。"
              actions={(
                <Button size="sm" onClick={saveWorkspaceExperience} disabled={experienceSaving || tokenLoading}>
                  {experienceSaving ? '保存中...' : '保存设置'}
                </Button>
              )}
            >
              {experienceError ? (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{experienceError}</div>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  label="默认界面"
                  description="系统启动后默认进入的产品模式。"
                  control={(
                    <Select
                      value={workspaceExperienceForm.mode}
                      onValueChange={(value) => {
                        const mode = value === 'one-person-company' ? 'one-person-company' : 'engineer';
                        setWorkspaceExperienceForm((prev) => ({
                          ...prev,
                          mode,
                          defaultEntry: mode === 'one-person-company' && prev.defaultEntry === 'home' ? 'office' : prev.defaultEntry,
                        }));
                      }}
                      disabled={experienceSaving}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="engineer">开发工程师界面</SelectItem>
                        <SelectItem value="one-person-company">一人公司界面</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                <FormField
                  label="默认入口"
                  description="用于系统级启动入口，不覆盖个人资料。"
                  control={(
                    <Select
                      value={workspaceExperienceForm.defaultEntry}
                      onValueChange={(value) => setWorkspaceExperienceForm((prev) => ({ ...prev, defaultEntry: value as WorkspaceExperienceForm['defaultEntry'] }))}
                      disabled={experienceSaving}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="home">首页</SelectItem>
                        <SelectItem value="meeting-room">会议室</SelectItem>
                        <SelectItem value="office">办公室</SelectItem>
                        <SelectItem value="workflows">工作流</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  label="记忆捕获"
                  description="关闭后，AI 不会写入新的记忆；已有 Memory V2 索引仍按协议参与按需读取。"
                  control={(
                    <div className="flex h-10 items-center">
                      <Switch
                        checked={agentMemoryForm.captureEnabled}
                        onCheckedChange={(checked) => setAgentMemoryForm((prev) => ({ ...prev, captureEnabled: checked }))}
                        disabled={experienceSaving}
                      />
                    </div>
                  )}
                />
                <FormField
                  label="长期记忆治理"
                  description="控制长期记忆候选的服务端生命周期；不会改变 AI 对短期/长期的自主分类。"
                  control={(
                    <Select
                      value={agentMemoryForm.governanceMode}
                      onValueChange={(value) => setAgentMemoryForm((prev) => ({ ...prev, governanceMode: value as AgentMemoryForm['governanceMode'] }))}
                      disabled={experienceSaving}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">全部人工审核</SelectItem>
                        <SelectItem value="review">长期记忆待审核</SelectItem>
                        <SelectItem value="auto">长期记忆自动生效</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <FormField
                label="ACPX 调试日志"
                description="开启后记录 AI 调用原始事件、归一化事件和对话渲染片段；悬浮入口会打开日志目录。"
                control={(
                  <div className="flex flex-wrap items-center gap-3">
                    <Switch
                      checked={runtimeDebugForm.acpxTraceEnabled}
                      onCheckedChange={(checked) => setRuntimeDebugForm((prev) => ({ ...prev, acpxTraceEnabled: checked }))}
                      disabled={experienceSaving}
                    />
                    <StatusPill tone={runtimeDebugForm.acpxTraceEnabled ? 'info' : 'neutral'}>
                      {runtimeDebugForm.acpxTraceEnabled ? '已开启' : '已关闭'}
                    </StatusPill>
                    {runtimeDebugForm.acpxTraceDirectory ? (
                      <code className="break-all rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                        {runtimeDebugForm.acpxTraceDirectory}
                      </code>
                    ) : null}
                  </div>
                )}
              />
            </FormSection>

            <FormSection
              className="px-5"
              title="运行参数缓存"
              description="模型/引擎选择框和引擎管理页会复用这份可用性结果；手动刷新会强制重查。"
              actions={(
                <Button size="sm" variant="outline" onClick={saveEngineAvailabilityCache} disabled={tokenSaving || tokenLoading}>
                  {tokenSaving ? '保存中...' : '保存时长'}
                </Button>
              )}
            >
              {tokenError ? (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{tokenError}</div>
              ) : null}
              <FormField
                label="引擎可用性缓存"
                description="范围 1 到 1440 分钟，默认 30 分钟。"
                control={(
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
                )}
              />
            </FormSection>
          </DataCard>
        ) : null}

        {activeSection === 'memory' ? (
          <div className="space-y-8">
            <MemoryV2GovernancePanel />
            <MemoryV2DiagnosticsPanel />
          </div>
        ) : null}

        {activeSection === 'runtime' ? (
          <div className="space-y-5">
            <DataCard className="p-0">
              <FormSection
                className="px-5"
                title="托管 Cangjie SDK"
                description="统一管理本机 Cangjie SDK。安装、激活和删除会影响系统使用的 CANGJIE_HOME。"
                actions={(
                  <div className="flex flex-wrap gap-2">
                    {sdkOverview?.active ? (
                      <Button variant="outline" size="sm" onClick={handleDeactivateSdk} disabled={sdkLoading || sdkActionKey !== null}>
                        {sdkActionKey === 'deactivate' ? '取消中...' : '取消激活'}
                      </Button>
                    ) : null}
                    <Button variant="outline" size="sm" onClick={loadSdkOverview} disabled={sdkLoading || sdkActionKey !== null}>
                      {sdkLoading ? '加载中...' : '刷新'}
                    </Button>
                  </div>
                )}
              >
                {sdkError && !sdkOverview ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm space-y-3">
                    <div className="text-destructive">{sdkError}</div>
                    <Button variant="outline" size="sm" onClick={loadSdkOverview} disabled={sdkLoading}>重试</Button>
                  </div>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2">
                  <DataCard>
                    <DataCardTitle>当前服务器</DataCardTitle>
                    <DataCardDescription className="font-medium text-foreground">{sdkOverview ? `${sdkOverview.host.os} / ${sdkOverview.host.arch}` : '-'}</DataCardDescription>
                  </DataCard>
                  <DataCard>
                    <DataCardHeader>
                      <DataCardTitle>当前来源</DataCardTitle>
                      <StatusPill tone={managedHomeActive ? 'success' : 'neutral'}>{getManagedSourceLabel(sdkOverview?.effective.source || 'none')}</StatusPill>
                    </DataCardHeader>
                    <DataCardDescription className="break-all">{sdkOverview?.effective.cangjieHome || '未解析到 CANGJIE_HOME'}</DataCardDescription>
                  </DataCard>
                  <DataCard>
                    <DataCardTitle>当前激活版本</DataCardTitle>
                    <DataCardDescription className="font-medium text-foreground">
                      {sdkOverview?.active ? `${getChannelLabel(sdkOverview.active.channel)} · ${sdkOverview.active.version}` : '未激活'}
                    </DataCardDescription>
                  </DataCard>
                  <DataCard>
                    <DataCardTitle>Diagnostics</DataCardTitle>
                    <DataCardDescription>{sdkOverview?.effective.diagnostics?.length ? sdkOverview.effective.diagnostics.join('；') : '无'}</DataCardDescription>
                  </DataCard>
                </div>
                {sdkError && sdkOverview ? (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{sdkError}</div>
                ) : null}
                {sdkLoading && !sdkOverview ? (
                  <EmptyState icon={<Download className="h-5 w-5" />} title="托管 SDK 信息加载中" />
                ) : null}
                {!sdkLoading && sdkOverview ? (
                  <div className="space-y-4">
                    {(['nightly', 'sts', 'lts'] as SdkChannel[]).map((channel) => (
                      <div key={channel} className="space-y-2">
                        <div className="text-sm font-medium text-muted-foreground">{getChannelLabel(channel)}</div>
                        {(groupedCatalog[channel] || []).length === 0 ? (
                          <EmptyState className="min-h-[120px]" title="暂无可用版本" description={`${getChannelLabel(channel)} 通道没有匹配当前平台的版本。`} />
                        ) : (
                          <div className="grid gap-3 lg:grid-cols-2">
                            {groupedCatalog[channel].map((entry) => {
                              const matched = getMatchingPackage(entry);
                              const installed = getInstalledRecord(entry);
                              const isActive = sdkOverview.active?.version === entry.version && sdkOverview.active?.channel === entry.channel;
                              const installKey = `install:${entry.channel}:${entry.version}`;
                              const activateKey = `activate:${entry.channel}:${entry.version}`;
                              const removeKey = `remove:${entry.channel}:${entry.version}`;
                              return (
                                <DataCard key={`${entry.channel}-${entry.version}`} selected={isActive}>
                                  <DataCardHeader>
                                    <div className="min-w-0">
                                      <DataCardTitle className="break-all">{entry.releaseName}</DataCardTitle>
                                      <DataCardDescription className="break-all font-mono text-xs">{entry.version}</DataCardDescription>
                                    </div>
                                    {isActive ? <StatusPill tone="success">当前激活</StatusPill> : <StatusPill tone={installed ? 'info' : 'neutral'}>{installed ? '已安装' : '未安装'}</StatusPill>}
                                  </DataCardHeader>
                                  <DataCardMeta>
                                    <StatusPill tone={matched ? 'neutral' : 'warning'} dot={false}>{matched ? matched.name : '当前平台不可安装'}</StatusPill>
                                  </DataCardMeta>
                                  {installed ? <DataCardDescription className="break-all font-mono text-xs">{installed.installDir}</DataCardDescription> : null}
                                  <DataCardActions className="justify-start">
                                    <Button size="sm" variant="outline" disabled={!matched || sdkActionKey !== null} onClick={() => handleInstallSdk(entry, installKey)}>
                                      {sdkActionKey === installKey ? (
                                        installProgress?.phase === 'download' && installProgress.total > 0
                                          ? `下载中 ${Math.round(installProgress.downloaded / installProgress.total * 100)}%`
                                          : installProgress?.phase === 'extract' ? '解压中...'
                                          : installProgress?.phase === 'finalize' ? '整理中...'
                                          : '安装中...'
                                      ) : installed ? '重新安装' : '安装'}
                                    </Button>
                                    <Button size="sm" disabled={!installed || isActive || sdkActionKey !== null} onClick={() => handleActivateSdk(entry, activateKey)}>
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
                                  </DataCardActions>
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
                                </DataCard>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </FormSection>
            </DataCard>

          </div>
        ) : null}

        {activeSection === 'security' ? (
          <div className="space-y-5">
            <DataCard className="p-0">
              <FormSection
                className="px-5"
                title="GitCode Token"
                description="配置此系统 Token 后即可检测和下载托管 SDK；留空会保留已保存值。"
                actions={(
                  <Button size="sm" onClick={saveGitcodeToken} disabled={tokenSaving || !gitcodeToken.trim()}>
                    {tokenSaving ? '保存中...' : '保存 GitCode Token'}
                  </Button>
                )}
              >
                {!gitcodeConfigured && !tokenLoading ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    尚未配置 GitCode Token，SDK 检测和下载功能将不可用。
                  </div>
                ) : null}
                {tokenError ? (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{tokenError}</div>
                ) : null}
                <FormField
                  label="Token"
                  description="输入新值会覆盖已保存 Token；已保存值以安全方式保管。"
                  control={(
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
                  )}
                />
                <StatusPill tone={tokenLoading ? 'info' : gitcodeConfigured ? 'success' : 'warning'}>
                  {tokenLoading ? '加载中' : gitcodeConfigured ? '已配置' : '未配置'}
                </StatusPill>
              </FormSection>
            </DataCard>

            <DataCard className="p-0">
              <FormSection
                className="px-5"
                title="人工审查邮件推送"
                description="系统在工作流进入人工审查时发送邮件；SMTP 密码按敏感值安全保存。"
                actions={(
                  <Button size="sm" onClick={saveEmailNotifications} disabled={emailSaving || tokenLoading}>
                    {emailSaving ? '保存中...' : '保存邮件配置'}
                  </Button>
                )}
              >
                {emailError ? (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{emailError}</div>
                ) : null}
                <FormField
                  label="启用邮件提醒"
                  description="默认发送给工作流发起人的登录邮箱，可额外抄送团队邮箱。"
                  control={(
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={emailForm.enabled}
                        onCheckedChange={(checked) => setEmailForm((prev) => ({ ...prev, enabled: checked }))}
                        disabled={emailSaving}
                      />
                      <StatusPill tone={emailForm.enabled ? 'success' : 'neutral'}>
                        {emailForm.enabled ? '已启用' : '未启用'}
                      </StatusPill>
                      <StatusPill tone={emailForm.smtpPasswordConfigured ? 'success' : 'warning'} dot={false}>
                        {emailForm.smtpPasswordConfigured ? '已保存 SMTP 密码' : '尚未保存 SMTP 密码'}
                      </StatusPill>
                    </div>
                  )}
                />
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField label="SMTP Host" control={<Input value={emailForm.smtpHost} onChange={(event) => setEmailForm((prev) => ({ ...prev, smtpHost: event.target.value }))} placeholder="例如：smtp.qq.com" disabled={emailSaving} />} />
                  <FormField label="SMTP Port" control={<Input value={emailForm.smtpPort} onChange={(event) => setEmailForm((prev) => ({ ...prev, smtpPort: event.target.value }))} placeholder="465 或 587" disabled={emailSaving} />} />
                  <FormField label="SMTP 用户名" control={<Input value={emailForm.smtpUsername} onChange={(event) => setEmailForm((prev) => ({ ...prev, smtpUsername: event.target.value }))} placeholder="通常是邮箱地址" disabled={emailSaving} />} />
                  <FormField label="SMTP 密码 / 授权码" description="输入新值可覆盖已保存值。" control={<Input type="password" value={emailForm.smtpPassword} onChange={(event) => setEmailForm((prev) => ({ ...prev, smtpPassword: event.target.value }))} placeholder={emailForm.smtpPasswordConfigured ? '已保存，输入新值可覆盖' : '请输入 SMTP 密码或授权码'} disabled={emailSaving} />} />
                  <FormField label="发件人邮箱" control={<Input value={emailForm.fromEmail} onChange={(event) => setEmailForm((prev) => ({ ...prev, fromEmail: event.target.value }))} placeholder="例如：notify@example.com" disabled={emailSaving} />} />
                  <FormField label="发件人名称" control={<Input value={emailForm.fromName} onChange={(event) => setEmailForm((prev) => ({ ...prev, fromName: event.target.value }))} placeholder="例如：ACEHarness" disabled={emailSaving} />} />
                  <FormField label="Reply-To" control={<Input value={emailForm.replyTo} onChange={(event) => setEmailForm((prev) => ({ ...prev, replyTo: event.target.value }))} placeholder="可选：回复邮箱" disabled={emailSaving} />} />
                  <FormField label="主题前缀" control={<Input value={emailForm.subjectPrefix} onChange={(event) => setEmailForm((prev) => ({ ...prev, subjectPrefix: event.target.value }))} placeholder="可选：例如 [ACEHarness]" disabled={emailSaving} />} />
                </div>
                <FormField
                  label="使用 SSL / TLS"
                  description="常见情况下，465 建议开启；587 可以关闭后走 STARTTLS。"
                  control={<Switch checked={emailForm.smtpSecure} onCheckedChange={(checked) => setEmailForm((prev) => ({ ...prev, smtpSecure: checked }))} disabled={emailSaving} />}
                />
                <FormField
                  label="抄送邮箱"
                  description="不填写时，只发给当前工作流运行的发起人邮箱。"
                  control={(
                    <Textarea
                      value={emailForm.ccEmails}
                      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setEmailForm((prev) => ({ ...prev, ccEmails: event.target.value }))}
                      placeholder="可选，多个邮箱用逗号、分号或换行分隔"
                      rows={3}
                      disabled={emailSaving}
                    />
                  )}
                />
              </FormSection>
            </DataCard>
          </div>
        ) : null}

        {activeSection === 'advanced' ? (
          <div className="space-y-5">
            <DataCard>
              <DataCardHeader>
                <div>
                  <DataCardTitle>高级设置边界</DataCardTitle>
                  <DataCardDescription>第一批实现保留原有功能，并把低频参考信息放在 Advanced，避免挤占常用系统、安全与工具链配置。</DataCardDescription>
                </div>
                <StatusPill tone="accent">Advanced</StatusPill>
              </DataCardHeader>
              <DataCardMeta>
                <StatusPill tone="neutral" dot={false}>没有个人 Account 表单</StatusPill>
                <StatusPill tone="neutral" dot={false}>不含 Channels 设置</StatusPill>
                <StatusPill tone="warning" dot={false}>未新增 reset/test API</StatusPill>
              </DataCardMeta>
            </DataCard>
            <DataCard className="p-0">
              <FormSection
                className="px-5"
                title="环境变量说明"
                description="这里只展示说明；环境变量由宿主系统或运行环境提供，系统设置页不提供编辑、保存或删除入口。"
              >
                <Tabs defaultValue="claude" className="space-y-4">
                  <TabsList className="flex h-auto flex-wrap justify-start">
                    {ENGINE_ENV_DESCRIPTIONS.map((engine) => (
                      <TabsTrigger key={engine.id} value={engine.id}>
                        {engine.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {ENGINE_ENV_DESCRIPTIONS.map((engine) => (
                    <TabsContent key={engine.id} value={engine.id} className="mt-0 space-y-3">
                      <p className="text-sm text-muted-foreground">{engine.description}</p>
                      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm text-muted-foreground">
                        {engine.vars.length > 0 ? engine.vars.map((item) => (
                          <div key={item.key} className="contents">
                            <code className="font-mono text-primary">{item.key}</code>
                            <span>{item.description}</span>
                          </div>
                        )) : (
                          <div className="col-span-2 rounded-md border border-border bg-muted/20 px-3 py-2">
                            当前代码未声明可配置的专属环境变量。
                          </div>
                        )}
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              </FormSection>
            </DataCard>
          </div>
        ) : null}

      </div>

      <ConfirmModal
        open={Boolean(confirmRequest?.open)}
        variant={confirmRequest?.variant || 'default'}
        title={confirmRequest?.title}
        objectName={confirmRequest?.objectName}
        consequence={confirmRequest?.consequence || ''}
        confirmLabel={confirmRequest?.confirmLabel}
        loading={sdkActionKey !== null}
        onConfirm={() => void confirmRequest?.onConfirm()}
        onCancel={() => setConfirmRequest(null)}
        onOpenChange={(open) => {
          if (!open) setConfirmRequest(null);
        }}
      />
    </>
  );
}
