'use client';

import { useCallback, useMemo, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from '@/lib/navigation/client';
import Link from '@/lib/navigation/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataCard, DataCardActions, DataCardDescription, DataCardHeader, DataCardMeta, DataCardTitle } from '@/components/ui/data-card';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField, FormSection } from '@/components/ui/form-section';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ObjectEditDrawer } from '@/components/ui/object-edit-drawer';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { StatusPill } from '@/components/ui/status-pill';
import AvatarPicker from '@/components/AvatarPicker';
import SpriteAvatar from '@/components/SpriteAvatar';
import AuthGuard from '@/components/AuthGuard';
import { WorkspaceEditor } from '@/components/workspace/WorkspaceEditor';
import EnvVarsDialog from '@/components/EnvVarsDialog';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ArrowLeft, ExternalLink, Folder, FolderOpen, KeyRound, Lock, Mail, NotebookTabs, RadioTower, RotateCcw, Save, Settings, UserRound, X } from 'lucide-react';
import { workspaceApi, type NotebookScope } from '@/lib/core/api';
import { useDashboardDockWorkspace } from '@/components/dashboard/DashboardDockWorkspace';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import {
  useChangeEmailMutation,
  useChangePasswordMutation,
  useCurrentUserQuery,
  useUpdateProfileMutation,
} from '@/client/query/auth';
import { PASSWORD_POLICY_DESCRIPTION, getLoginPasswordError } from '@/lib/auth/password-policy';

interface UserInfo {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  personalDir: string;
  avatar?: string;
  createdAt: number;
}

export function AccountContent({
  embedded = false,
  embeddedSearch = '',
  registerShellHeader = true,
}: {
  embedded?: boolean;
  embeddedSearch?: string;
  registerShellHeader?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dockWorkspace = useDashboardDockWorkspace();
  const effectiveSearchParams = useMemo(
    () => new URLSearchParams(embedded ? embeddedSearch : searchParams.toString()),
    [embedded, embeddedSearch, searchParams]
  );
  const [user, setUser] = useState<UserInfo | null>(null);
  const [profileDraft, setProfileDraft] = useState({ avatar: '', personalDir: '' });
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const currentUserQuery = useCurrentUserQuery();
  const changePasswordMutation = useChangePasswordMutation();
  const changeEmailMutation = useChangeEmailMutation();
  const updateProfileMutation = useUpdateProfileMutation();
  const loading = currentUserQuery.isLoading;
  const savingProfile = updateProfileMutation.isPending;

  useDocumentTitle(embedded ? null : '账户设置');
  const { isDashboardShell } = useDashboardShellHeader(registerShellHeader ? {
    title: '账户设置',
    subtitle: '个人资料、目录和账户偏好',
  } : undefined, []);

  // Password change
  const [pwdOpen, setPwdOpen] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState('');

  // Email change
  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState('');

  // Avatar change
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState('');

  // PersonalDir change
  const [dirOpen, setDirOpen] = useState(false);
  const [newDir, setNewDir] = useState('');
  const [dirError, setDirError] = useState('');
  const [dirSuccess, setDirSuccess] = useState('');

  // Workspace editor
  const [wsEditorOpen, setWsEditorOpen] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [notebookScope, setNotebookScope] = useState<NotebookScope>('personal');
  const [notebookShareToken, setNotebookShareToken] = useState<string | undefined>(undefined);
  const [notebookPermission, setNotebookPermission] = useState<'read' | 'write'>('write');
  const [showUserEnvVars, setShowUserEnvVars] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<'password' | 'email' | 'avatar' | 'directory' | null>(null);
  useEffect(() => {
    const nextUser = currentUserQuery.data as UserInfo | null;
    setUser(nextUser);
    if (!nextUser) return;
    setProfileDraft({
      avatar: nextUser.avatar || '',
      personalDir: nextUser.personalDir || '',
    });
    setProfileError('');
    setProfileSuccess('');
  }, [currentUserQuery.data]);

  useEffect(() => {
    const openWorkspace = effectiveSearchParams.get('workspace') === '1';
    if (openWorkspace) setWsEditorOpen(true);
  }, [effectiveSearchParams]);

  useEffect(() => {
    const openNotebook = effectiveSearchParams.get('notebook') === '1';
    if (!openNotebook) return;
    const scopeParam = effectiveSearchParams.get('notebookScope');
    if (scopeParam === 'global') {
      router.replace(`/notebook?${effectiveSearchParams.toString()}`);
      return;
    }

    const shareToken = effectiveSearchParams.get('notebookShare') || '';
    const fileParam = effectiveSearchParams.get('notebookFile');

    if (!shareToken) {
      setNotebookScope(scopeParam === 'global' ? 'global' : 'personal');
      setNotebookShareToken(undefined);
      setNotebookPermission('write');
      setNotebookOpen(true);
      return;
    }

    let cancelled = false;
    workspaceApi.resolveNotebookShare(shareToken)
      .then((share) => {
        if (cancelled) return;
        setNotebookScope(share.scope);
        setNotebookShareToken(shareToken);
        setNotebookPermission(share.permission);
        if (!fileParam) {
          const params = new URLSearchParams(effectiveSearchParams.toString());
          params.set('notebook', '1');
          params.set('notebookScope', share.scope);
          params.set('notebookFile', share.path);
          params.set('notebookShare', shareToken);
          params.set('notebookPermission', share.permission);
          router.replace(`/account?${params.toString()}`);
        }
        setNotebookOpen(true);
      })
      .catch(() => {
        if (cancelled) return;
        setNotebookScope('personal');
        setNotebookShareToken(undefined);
        setNotebookPermission('write');
      });
    return () => { cancelled = true; };
  }, [effectiveSearchParams, router]);

  const pushDashboardRoute = useCallback((route: string) => {
    const params = new URLSearchParams();
    params.set('route', route);
    router.push(`/dashboard?${params.toString()}`);
  }, [router]);

  const openPersonalNotebook = useCallback(() => {
    const search = 'notebook=1&notebookScope=personal';
    if (dockWorkspace) {
      dockWorkspace.openTab({
        id: 'notebook:personal:root',
        title: 'Cangjie Notebook',
        kind: 'notebook',
        search,
      });
      pushDashboardRoute(`/notebook?${search}`);
      return;
    }
    setNotebookScope('personal');
    setNotebookShareToken(undefined);
    setNotebookPermission('write');
    setNotebookOpen(true);
  }, [dockWorkspace, pushDashboardRoute]);

  const openChannelIntegrations = useCallback(() => {
    if (dockWorkspace) {
      dockWorkspace.openTab({ id: 'channels', title: '微信接入', kind: 'channels' });
      return;
    }
    router.push('/account/channels');
  }, [dockWorkspace, router]);

  const openSystemSettings = useCallback(() => {
    if (dockWorkspace) {
      dockWorkspace.openTab({ id: 'settings', title: '系统设置', kind: 'settings' });
      return;
    }
    router.push('/account/system-settings');
  }, [dockWorkspace, router]);

  const profileDirty = Boolean(user) && (
    profileDraft.avatar !== (user?.avatar || '') ||
    profileDraft.personalDir !== (user?.personalDir || '')
  );

  useEffect(() => {
    if (!profileDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [profileDirty]);

  const resetProfileDraft = useCallback(() => {
    if (!user) return;
    setProfileDraft({
      avatar: user.avatar || '',
      personalDir: user.personalDir || '',
    });
    setProfileError('');
    setProfileSuccess('');
  }, [user]);

  const saveProfileChanges = useCallback(async () => {
    if (!user || !profileDirty) return;
    setProfileError('');
    setProfileSuccess('');
    try {
      await updateProfileMutation.mutateAsync({
        avatar: profileDraft.avatar,
        personalDir: profileDraft.personalDir,
      });
      setUser(prev => prev ? { ...prev, avatar: profileDraft.avatar, personalDir: profileDraft.personalDir } : prev);
      setProfileSuccess('账户偏好已保存');
    } catch (error: any) {
      setProfileError(error?.message || '保存账户偏好失败');
    }
  }, [profileDirty, profileDraft.avatar, profileDraft.personalDir, updateProfileMutation, user]);

  const handleChangePassword = async () => {
    setPwdError(''); setPwdSuccess('');
    if (newPwd !== confirmPwd) { setPwdError('两次密码不一致'); return; }
    const passwordError = getLoginPasswordError(newPwd, {
      username: user?.username,
      email: user?.email,
      currentPassword: currentPwd,
    });
    if (passwordError) { setPwdError(passwordError); return; }
    try {
      await changePasswordMutation.mutateAsync({ currentPassword: currentPwd, newPassword: newPwd });
      setPwdSuccess('密码修改成功');
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
      setTimeout(() => setPwdOpen(false), 1000);
    } catch (error: any) {
      setPwdError(error?.message || '密码修改失败');
    }
  };

  const handleChangeEmail = async () => {
    setEmailError(''); setEmailSuccess('');
    if (!newEmail) { setEmailError('邮箱不能为空'); return; }
    try {
      await changeEmailMutation.mutateAsync(newEmail);
      setEmailSuccess('邮箱修改成功');
      setUser(prev => prev ? { ...prev, email: newEmail } : prev);
      setTimeout(() => setEmailOpen(false), 1000);
    } catch (error: any) {
      setEmailError(error?.message || '邮箱修改失败');
    }
  };

  const handleChangeAvatar = async () => {
    if (!selectedAvatar || !user) return;
    setProfileDraft(prev => ({ ...prev, avatar: selectedAvatar }));
    setAvatarOpen(false);
    setProfileSuccess('');
    setProfileError('');
  };

  const handleChangeDir = async () => {
    setDirError(''); setDirSuccess('');
    setProfileDraft(prev => ({ ...prev, personalDir: newDir }));
    setDirSuccess('个人目录已加入待保存更改');
    setTimeout(() => setDirOpen(false), 700);
  };

  const requestDrawerDiscard = (target: NonNullable<typeof discardTarget>) => {
    setDiscardTarget(target);
    return false;
  };

  const confirmDrawerDiscard = () => {
    if (discardTarget === 'password') {
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setPwdError('');
      setPwdSuccess('');
      setPwdOpen(false);
    } else if (discardTarget === 'email') {
      setNewEmail(user?.email || '');
      setEmailError('');
      setEmailSuccess('');
      setEmailOpen(false);
    } else if (discardTarget === 'avatar') {
      setSelectedAvatar(displayedAvatar);
      setAvatarOpen(false);
    } else if (discardTarget === 'directory') {
      setNewDir(displayedPersonalDir);
      setDirError('');
      setDirSuccess('');
      setDirOpen(false);
    }
    setDiscardTarget(null);
  };

  if (loading || !user) {
    return (
      <div className={embedded ? 'flex min-h-[320px] items-center justify-center bg-background' : 'min-h-screen flex items-center justify-center bg-background'}>
        <p className="text-muted-foreground">加载中...</p>
      </div>
    );
  }

  const initials = user.username?.charAt(0)?.toUpperCase() || '?';
  const displayedAvatar = profileDraft.avatar || user.avatar || '';
  const displayedPersonalDir = profileDraft.personalDir || '';
  const statusTone = profileDirty ? 'warning' : profileError ? 'danger' : profileSuccess ? 'success' : 'neutral';
  const statusLabel = profileDirty ? '有未保存更改' : profileError ? '保存失败' : profileSuccess ? '已保存' : '无未保存更改';
  const passwordDrawerDirty = Boolean(currentPwd || newPwd || confirmPwd);
  const emailDrawerDirty = newEmail !== user.email && Boolean(newEmail);
  const avatarDrawerDirty = selectedAvatar !== displayedAvatar && Boolean(selectedAvatar);
  const directoryDrawerDirty = newDir !== displayedPersonalDir && Boolean(newDir || displayedPersonalDir);

  return (
    <div className={embedded ? 'h-full overflow-auto bg-background' : 'min-h-screen bg-background'}>
      {!embedded && !isDashboardShell ? (
        <PageHeader
          title="账户设置"
          subtitle="管理个人资料、账户安全、个人目录和常用偏好。"
          eyebrow="GOVERN / ACCOUNT"
          leading={<UserRound className="mt-1 h-5 w-5 text-muted-foreground" />}
          status={<StatusPill tone={statusTone}>{statusLabel}</StatusPill>}
          secondaryActions={
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard"><ArrowLeft className="mr-2 h-4 w-4" />返回仪表盘</Link>
            </Button>
          }
          primaryAction={
            <Button size="sm" onClick={saveProfileChanges} disabled={!profileDirty || savingProfile}>
              <Save className="mr-2 h-4 w-4" />{savingProfile ? '保存中' : '保存更改'}
            </Button>
          }
        />
      ) : null}

      <PageToolbar
        actions={
          <>
            <Button variant="outline" size="sm" onClick={resetProfileDraft} disabled={!profileDirty || savingProfile}>
              <X className="mr-2 h-4 w-4" />取消更改
            </Button>
            <Button variant="outline" size="sm" onClick={openSystemSettings}>
              <Settings className="mr-2 h-4 w-4" />系统设置
            </Button>
          </>
        }
        activeFilters={
          profileError ? (
            <StatusPill tone="danger">{profileError}</StatusPill>
          ) : profileSuccess ? (
            <StatusPill tone="success">{profileSuccess}</StatusPill>
          ) : null
        }
      />

      <main className="mx-auto grid w-full max-w-5xl gap-6 px-6 py-6">
        <FormSection
          title="个人资料"
          description="更新头像、用户名和邮箱，让账户信息保持清晰准确。"
          actions={<StatusPill tone={user.role === 'admin' ? 'accent' : 'neutral'}>{user.role === 'admin' ? '管理员' : '普通用户'}</StatusPill>}
          className="rounded-xl border border-border bg-card px-5"
        >
          <FormField
            label="头像"
            control={
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setSelectedAvatar(displayedAvatar); setAvatarOpen(true); }}
                  className="group relative h-16 w-16 rounded-full p-0 focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2"
                >
                  <SpriteAvatar
                    avatar={displayedAvatar}
                    seed={user.username}
                    category="user-default"
                    alt={user.username}
                    fallback={initials}
                    className="h-16 w-16"
                    fallbackClassName="text-lg bg-primary/20 text-primary"
                  />
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/35 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    编辑
                  </span>
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setSelectedAvatar(displayedAvatar); setAvatarOpen(true); }}>选择头像</Button>
              </div>
            }
          />
          <FormField
            label="用户名"
            description="用于识别当前账户的登录名称。"
            control={<Input value={user.username} readOnly />}
          />
          <FormField
            label="邮箱"
            description="用于接收账户通知与安全提醒。"
            control={
              <div className="flex flex-wrap items-center gap-2">
                <Input value={user.email} readOnly className="min-w-[240px] flex-1" />
                <Button variant="outline" size="sm" onClick={() => { setNewEmail(user.email); setEmailError(''); setEmailSuccess(''); setEmailOpen(true); }}>
                  <Mail className="mr-2 h-4 w-4" />修改邮箱
                </Button>
              </div>
            }
          />
        </FormSection>

        <FormSection
          title="账户安全"
          description="定期更新登录密码，保持账户安全。"
          className="rounded-xl border border-border bg-card px-5"
        >
          <DataCard>
            <DataCardHeader>
              <div className="min-w-0">
                <DataCardTitle>登录密码</DataCardTitle>
                <DataCardDescription>使用当前密码验证后设置新密码。</DataCardDescription>
              </div>
              <StatusPill tone="neutral">独立确认</StatusPill>
            </DataCardHeader>
            <DataCardActions>
              <Button variant="outline" size="sm" onClick={() => { setPwdError(''); setPwdSuccess(''); setPwdOpen(true); }}>
                <Lock className="mr-2 h-4 w-4" />修改密码
              </Button>
            </DataCardActions>
          </DataCard>
        </FormSection>

        <FormSection
          title="个人目录与偏好"
          description="个人目录用于 Notebook 和个人工作区。更改目录后需要保存页面更改才会生效。"
          className="rounded-xl border border-border bg-card px-5"
        >
          <FormField
            label="个人目录"
            description="用于 Notebook 与个人工作区。"
            control={
              <div data-tour-step-id="account-directory" className="grid gap-3">
                {displayedPersonalDir ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input value={displayedPersonalDir} readOnly className="min-w-[260px] flex-1 font-mono text-xs" />
                    <Button variant="outline" size="sm" onClick={() => setWsEditorOpen(true)}>
                      <FolderOpen className="mr-2 h-4 w-4" />打开
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setNewDir(displayedPersonalDir); setDirError(''); setDirSuccess(''); setDirOpen(true); }}>
                      <Folder className="mr-2 h-4 w-4" />选择目录
                    </Button>
                  </div>
                ) : (
                  <EmptyState
                    icon={<Folder className="h-5 w-5" />}
                    title="未设置个人目录"
                    description="设置后可以打开个人工作区和 Notebook。"
                    primaryAction={<Button variant="outline" size="sm" onClick={() => { setNewDir(''); setDirError(''); setDirSuccess(''); setDirOpen(true); }}>选择目录</Button>}
                  />
                )}
              </div>
            }
          />
          <div className="grid gap-3 md:grid-cols-2">
            <DataCard
              role="button"
              tabIndex={displayedPersonalDir ? 0 : -1}
              data-tour-step-id="account-notebook"
              onClick={openPersonalNotebook}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openPersonalNotebook();
                }
              }}
              className="cursor-pointer"
              disabled={!displayedPersonalDir}
            >
              <DataCardHeader>
                <div className="flex min-w-0 items-start gap-3">
                  <div className="rounded-lg border border-primary/15 bg-accent p-2 text-accent-foreground">
                    <NotebookTabs className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <DataCardTitle>Cangjie Notebook</DataCardTitle>
                    <DataCardDescription>在个人目录下使用 .cj.md 管理和运行 Notebook。</DataCardDescription>
                  </div>
                </div>
                <StatusPill tone={displayedPersonalDir ? 'success' : 'neutral'}>{displayedPersonalDir ? '可用' : '未设置'}</StatusPill>
              </DataCardHeader>
              <DataCardMeta className="font-mono">{displayedPersonalDir || '未设置个人目录'}/.cangjie-notbook</DataCardMeta>
              <DataCardActions>
                <Button variant="outline" size="sm" className="pointer-events-none" tabIndex={-1}>
                  <FolderOpen className="mr-2 h-4 w-4" />打开
                </Button>
              </DataCardActions>
            </DataCard>

            <DataCard>
              <DataCardHeader>
                <div className="flex min-w-0 items-start gap-3">
                  <div className="rounded-lg border border-primary/15 bg-accent p-2 text-accent-foreground">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <DataCardTitle>个人环境变量</DataCardTitle>
                    <DataCardDescription>管理 Claude、Codex、OpenCode 和其他受支持 CLI 的启动配置。</DataCardDescription>
                  </div>
                </div>
              </DataCardHeader>
              <DataCardActions>
                <Button variant="outline" size="sm" onClick={() => setShowUserEnvVars(true)}>
                  <KeyRound className="mr-2 h-4 w-4" />编辑个人环境变量
                </Button>
              </DataCardActions>
            </DataCard>
          </div>
        </FormSection>

        <FormSection
          title="相关设置"
          description="从这里快速打开系统运行环境与渠道接入设置。"
          className="rounded-xl border border-border bg-card px-5"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <DataCard>
              <DataCardHeader>
                <div className="min-w-0">
                  <DataCardTitle>System Settings</DataCardTitle>
                  <DataCardDescription>集中管理运行环境、全局配置和系统策略。</DataCardDescription>
                </div>
                <StatusPill tone="info">Cross-link</StatusPill>
              </DataCardHeader>
              <DataCardActions>
                <Button variant="outline" size="sm" onClick={openSystemSettings}>
                  <ExternalLink className="mr-2 h-4 w-4" />打开
                </Button>
              </DataCardActions>
            </DataCard>
            <DataCard>
              <DataCardHeader>
                <div className="min-w-0">
                  <DataCardTitle>Channel Integrations</DataCardTitle>
                  <DataCardDescription>管理微信接入、Webhook 和渠道测试。</DataCardDescription>
                </div>
                <StatusPill tone="info">Cross-link</StatusPill>
              </DataCardHeader>
              <DataCardActions>
                <Button variant="outline" size="sm" onClick={openChannelIntegrations}>
                  <RadioTower className="mr-2 h-4 w-4" />打开
                </Button>
              </DataCardActions>
            </DataCard>
          </div>
        </FormSection>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border border-border bg-card px-4 py-3 shadow-none">
          <StatusPill tone={statusTone}>{statusLabel}</StatusPill>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetProfileDraft} disabled={!profileDirty || savingProfile}>
              <RotateCcw className="mr-2 h-4 w-4" />重置
            </Button>
            <Button size="sm" onClick={saveProfileChanges} disabled={!profileDirty || savingProfile}>
              <Save className="mr-2 h-4 w-4" />{savingProfile ? '保存中' : '保存更改'}
            </Button>
          </div>
        </div>
      </main>

      <ObjectEditDrawer
        open={pwdOpen}
        mode="edit"
        title="修改密码"
        subtitle="使用当前密码验证后设置新的登录密码。"
        dirty={passwordDrawerDirty}
        status={pwdError ? { label: '修改失败', tone: 'danger' } : pwdSuccess ? { label: '已修改', tone: 'success' } : undefined}
        onOpenChange={setPwdOpen}
        onRequestDiscard={() => requestDrawerDiscard('password')}
        saveAction={{ label: '确认修改', onClick: handleChangePassword, disabled: changePasswordMutation.isPending }}
      >
        <FormSection title="账户安全" description={PASSWORD_POLICY_DESCRIPTION}>
          <Input type="password" placeholder="当前密码" value={currentPwd} onChange={e => setCurrentPwd(e.target.value)} />
          <Input type="password" placeholder="新密码（至少 8 位，包含字母、数字和符号）" value={newPwd} onChange={e => setNewPwd(e.target.value)} minLength={8} />
          <Input type="password" placeholder="确认新密码" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} />
          {pwdError && <p className="text-sm text-destructive">{pwdError}</p>}
          {pwdSuccess && <p className="text-sm text-green-600">{pwdSuccess}</p>}
        </FormSection>
      </ObjectEditDrawer>

      <ObjectEditDrawer
        open={emailOpen}
        mode="edit"
        title="修改邮箱"
        subtitle="更新账户邮箱并完成确认。"
        dirty={emailDrawerDirty}
        status={emailError ? { label: '修改失败', tone: 'danger' } : emailSuccess ? { label: '已修改', tone: 'success' } : undefined}
        onOpenChange={setEmailOpen}
        onRequestDiscard={() => requestDrawerDiscard('email')}
        saveAction={{ label: '确认修改', onClick: handleChangeEmail, disabled: changeEmailMutation.isPending }}
      >
        <FormSection title="账户邮箱" description="输入新的账户邮箱后保存。">
          <Input type="email" placeholder="新邮箱" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
          {emailError && <p className="text-sm text-destructive">{emailError}</p>}
          {emailSuccess && <p className="text-sm text-green-600">{emailSuccess}</p>}
        </FormSection>
      </ObjectEditDrawer>

      <ObjectEditDrawer
        open={avatarOpen}
        mode="edit"
        title="选择头像"
        subtitle="头像更改会先进入账户页待保存状态。"
        dirty={avatarDrawerDirty}
        onOpenChange={setAvatarOpen}
        onRequestDiscard={() => requestDrawerDiscard('avatar')}
        saveAction={{ label: '确认', onClick: handleChangeAvatar, disabled: !selectedAvatar }}
        widthClassName="w-[min(520px,calc(100vw-1rem))]"
        bodyClassName="overflow-hidden"
      >
        <FormSection title="个人头像" description="选择一个头像后，通过账户页保存更改生效。">
          <AvatarPicker value={selectedAvatar} onChange={setSelectedAvatar} seed={user.username} className="h-[420px]" />
        </FormSection>
      </ObjectEditDrawer>

      <ObjectEditDrawer
        open={dirOpen}
        mode="edit"
        title="修改个人目录"
        subtitle="设置工作流与 Notebook 使用的个人目录。"
        dirty={directoryDrawerDirty}
        status={dirError ? { label: '目录错误', tone: 'danger' } : dirSuccess ? { label: '待保存', tone: 'warning' } : undefined}
        onOpenChange={setDirOpen}
        onRequestDiscard={() => requestDrawerDiscard('directory')}
        saveAction={{ label: '确认修改', onClick: handleChangeDir }}
      >
        <FormSection title="个人目录" description="选择后会加入账户页待保存更改。">
          <Input placeholder="个人目录路径，如 /data/users/alice" value={newDir} onChange={e => setNewDir(e.target.value)} />
          <WorkspaceDirectoryPicker workspaceRoot="/" value={newDir} onChange={setNewDir} />
          <p className="text-xs text-muted-foreground">工作流执行时将在此目录下创建隔离的运行环境</p>
          {dirError && <p className="text-sm text-destructive">{dirError}</p>}
          {dirSuccess && <p className="text-sm text-green-600">{dirSuccess}</p>}
        </FormSection>
      </ObjectEditDrawer>

      <ConfirmModal
        open={discardTarget !== null}
        variant="reset"
        title="丢弃未保存内容"
        objectName={discardTarget === 'password' ? '修改密码' : discardTarget === 'email' ? '修改邮箱' : discardTarget === 'avatar' ? '选择头像' : '修改个人目录'}
        consequence="确认后返回上一状态，账户页已保存内容保持完整。"
        confirmLabel="丢弃"
        onConfirm={confirmDrawerDiscard}
        onCancel={() => setDiscardTarget(null)}
        onOpenChange={(open) => {
          if (!open) setDiscardTarget(null);
        }}
      />

      {/* Workspace Editor */}
      {user.personalDir && wsEditorOpen && (
        <WorkspaceEditor
          open={wsEditorOpen}
          onOpenChange={setWsEditorOpen}
          workspacePath={user.personalDir}
        />
      )}
      {user.personalDir && notebookOpen && (
        <WorkspaceEditor
          open={notebookOpen}
          onOpenChange={setNotebookOpen}
          workspacePath={user.personalDir}
          mode="notebook"
          title="Cangjie Notebook"
          notebookScope={notebookScope}
          notebookShareToken={notebookShareToken}
          notebookPermission={notebookPermission}
        />
      )}

      {showUserEnvVars && (
        <EnvVarsDialog scope="user" onClose={() => setShowUserEnvVars(false)} />
      )}
    </div>
  );
}

export default function AccountPage(props: {
  embedded?: boolean;
  embeddedSearch?: string;
} = {}) {
  return <AuthGuard><AccountContent {...props} /></AuthGuard>;
}
