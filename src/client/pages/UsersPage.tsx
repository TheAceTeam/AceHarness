'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from '@/lib/navigation/client';
import Link from '@/lib/navigation/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { StatusPill } from '@/components/ui/status-pill';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ObjectEditDrawer } from '@/components/ui/object-edit-drawer';
import { FormField } from '@/components/ui/form-section';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AvatarPicker from '@/components/AvatarPicker';
import SpriteAvatar from '@/components/SpriteAvatar';
import AuthGuard from '@/components/AuthGuard';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';
import { ArrowLeft, Plus, Search, Check, X, RefreshCw, Users, Edit, KeyRound, Trash2 } from 'lucide-react';
import { useCurrentUserQuery } from '@/client/query/auth';
import {
  useCreateUserMutation,
  useDeleteUserMutation,
  useUpdateUserMutation,
  useUsersQuery,
  type UserInfo,
} from '@/client/query/users';
import { PASSWORD_POLICY_DESCRIPTION, getLoginPasswordError } from '@/lib/auth/password-policy';

export function UsersContent({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
  useDocumentTitle('用户管理');
  const usersQuery = useUsersQuery();
  const currentUserQuery = useCurrentUserQuery();
  const createUserMutation = useCreateUserMutation();
  const updateUserMutation = useUpdateUserMutation();
  const deleteUserMutation = useDeleteUserMutation();
  const users = usersQuery.data?.users || [];
  const loading = usersQuery.isLoading || currentUserQuery.isLoading;
  const [searchQuery, setSearchQuery] = useState('');
  const currentUser = currentUserQuery.data;
  const [activeTab, setActiveTab] = useState<'pending' | 'regular'>('regular');

  // Create/Edit drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserInfo | null>(null);
  const [form, setForm] = useState({ username: '', email: '', password: '', question: '', answer: '', role: 'user' as 'admin' | 'user', personalDir: '', avatar: '' });
  const [formError, setFormError] = useState('');

  // Reset password dialog
  const [resetOpen, setResetOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState('');
  const [resetPwd, setResetPwd] = useState('');
  const [resetError, setResetError] = useState('');
  const [confirmAction, setConfirmAction] = useState<{
    type: 'approve' | 'reject' | 'delete';
    user: UserInfo;
  } | null>(null);

  useEffect(() => {
    if (currentUserQuery.isSuccess && currentUser?.role !== 'admin') router.push('/');
  }, [currentUser?.role, currentUserQuery.isSuccess, router]);

  useEffect(() => {
    if ((usersQuery.error as { status?: number } | null)?.status === 403) router.push('/');
  }, [router, usersQuery.error]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('aceharness:pending-users-changed', {
      detail: users.filter((user) => user.status === 'pending').length,
    }));
  }, [users]);

  const filteredUsers = useMemo(() => {
    if (!searchQuery) return users;
    const q = searchQuery.toLowerCase();
    return users.filter(u => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, searchQuery]);

  const pendingUsers = useMemo(() => users.filter((user) => user.status === 'pending'), [users]);
  const regularUsers = useMemo(() => users.filter((user) => user.status !== 'pending'), [users]);
  const filteredPendingUsers = useMemo(() => filteredUsers.filter((user) => user.status === 'pending'), [filteredUsers]);
  const filteredRegularUsers = useMemo(() => filteredUsers.filter((user) => user.status !== 'pending'), [filteredUsers]);

  const openCreate = () => {
    setEditingUser(null);
    setForm({ username: '', email: '', password: '', question: '', answer: '', role: 'user', personalDir: '', avatar: '' });
    setFormError('');
    setDrawerOpen(true);
  };

  const pendingUserCount = users.filter((user) => user.status === 'pending').length;
  const { isDashboardShell } = useDashboardShellHeader({
    title: '用户管理',
    subtitle: `${users.length} 个用户${pendingUserCount > 0 ? ` · ${pendingUserCount} 个待审核` : ''}`,
    actions: (
      <Button size="sm" onClick={openCreate}>
        <Plus className="w-4 h-4 mr-2" />
        新建用户
      </Button>
    ),
  }, [users.length, pendingUserCount]);

  const openEdit = (user: UserInfo) => {
    setEditingUser(user);
    setForm({ username: user.username, email: user.email, password: '', question: '', answer: '', role: user.role, personalDir: user.personalDir, avatar: user.avatar || '' });
    setFormError('');
    setDrawerOpen(true);
  };

  const handleSave = async () => {
    setFormError('');
    if (editingUser) {
      // Update
      try {
        await updateUserMutation.mutateAsync({
          id: editingUser.id,
          payload: { username: form.username, email: form.email, role: form.role, personalDir: form.personalDir, avatar: form.avatar },
        });
      } catch (error: any) {
        setFormError(error?.message || '保存失败');
        return;
      }
    } else {
      // Create
      if (!form.username || !form.email || !form.password || !form.question || !form.answer) {
        setFormError('所有字段不能为空'); return;
      }
      const passwordError = getLoginPasswordError(form.password, {
        username: form.username,
        email: form.email,
      });
      if (passwordError) {
        setFormError(passwordError);
        return;
      }
      try {
        await createUserMutation.mutateAsync(form);
      } catch (error: any) {
        setFormError(error?.message || '创建失败');
        return;
      }
    }
    setDrawerOpen(false);
  };

  const handleDelete = async (user: UserInfo) => {
    await deleteUserMutation.mutateAsync(user.id);
    setConfirmAction(null);
  };

  const handleResetPassword = async () => {
    setResetError('');
    const resetUser = users.find((user) => user.id === resetUserId);
    const passwordError = getLoginPasswordError(resetPwd, {
      username: resetUser?.username,
      email: resetUser?.email,
    });
    if (passwordError) { setResetError(passwordError); return; }
    try {
      await updateUserMutation.mutateAsync({ id: resetUserId, payload: { resetPassword: resetPwd } });
    } catch (error: any) {
      setResetError(error?.message || '重置失败');
      return;
    }
    setResetOpen(false); setResetPwd('');
  };

  const handleReview = async (user: UserInfo, reviewAction: 'approve' | 'reject') => {
    await updateUserMutation.mutateAsync({ id: user.id, payload: { reviewAction } });
    setConfirmAction(null);
  };
  const formDirty = useMemo(() => {
    if (!drawerOpen) return false;
    if (!editingUser) {
      return Boolean(
        form.username
        || form.email
        || form.password
        || form.question
        || form.answer
        || form.role !== 'user'
        || form.personalDir
        || form.avatar
      );
    }
    return (
      form.username !== editingUser.username
      || form.email !== editingUser.email
      || form.role !== editingUser.role
      || form.personalDir !== editingUser.personalDir
      || form.avatar !== (editingUser.avatar || '')
    );
  }, [drawerOpen, editingUser, form]);

  const statusLabel = (status: UserInfo['status']) => {
    if (status === 'pending') return '待审核';
    if (status === 'rejected') return '已拒绝';
    return '已启用';
  };

  const statusTone = (status: UserInfo['status']) => {
    if (status === 'pending') return 'warning' as const;
    if (status === 'rejected') return 'danger' as const;
    return 'success' as const;
  };

  const roleTone = (role: UserInfo['role']) => {
    return role === 'admin' ? 'accent' as const : 'neutral' as const;
  };

  const userColumns = useMemo<DataTableColumn<UserInfo>[]>(() => [
    {
      id: 'avatar',
      header: '头像',
      width: 56,
      render: (user) => (
        <SpriteAvatar
          avatar={user.avatar}
          seed={user.username}
          category="user-default"
          alt={user.username}
          fallback={user.username.charAt(0).toUpperCase()}
          className="h-8 w-8"
          fallbackClassName="text-xs"
        />
      ),
    },
    {
      id: 'username',
      header: '用户名',
      render: (user) => <span className="font-medium">{user.username}</span>,
    },
    {
      id: 'email',
      header: '邮箱',
      accessor: 'email',
    },
    {
      id: 'role',
      header: '角色',
      render: (user) => (
        <StatusPill tone={roleTone(user.role)}>
          {user.role === 'admin' ? '管理员' : '用户'}
        </StatusPill>
      ),
      priority: 2,
    },
    {
      id: 'status',
      header: '状态',
      render: (user) => (
        <StatusPill tone={statusTone(user.status)}>
          {statusLabel(user.status)}
        </StatusPill>
      ),
      priority: 2,
    },
    {
      id: 'personalDir',
      header: '个人目录',
      render: (user) => <code className="text-xs">{user.personalDir || '-'}</code>,
      priority: 3,
    },
    {
      id: 'createdAt',
      header: '创建时间',
      render: (user) => <span className="text-sm text-muted-foreground">{new Date(user.createdAt).toLocaleDateString()}</span>,
      priority: 3,
    },
  ], []);

  const renderUsersTable = (items: UserInfo[], emptyText: string, showReviewActions = false) => (
    <DataTable
      aria-label={showReviewActions ? '待审核用户' : '普通用户'}
      columns={userColumns}
      rows={items}
      rowKey="id"
      emptyState={{
        icon: <Users className="h-5 w-5" />,
        title: emptyText,
        description: '调整搜索条件，或在页面右上角创建新用户。',
      }}
      rowActions={(user) => [
        ...(showReviewActions ? [{
          id: 'review',
          label: '审核',
          actions: [
            {
              id: 'approve',
              label: '通过',
              icon: <Check className="h-4 w-4" />,
              primary: true,
              onSelect: () => setConfirmAction({ type: 'approve', user }),
            },
            {
              id: 'reject',
              label: '拒绝',
              icon: <X className="h-4 w-4" />,
              destructive: true,
              onSelect: () => setConfirmAction({ type: 'reject', user }),
            },
          ],
        }] : []),
        {
          id: 'manage',
          actions: [
            {
              id: 'edit',
              label: '编辑',
              icon: <Edit className="h-4 w-4" />,
              primary: true,
              onSelect: () => openEdit(user),
            },
            {
              id: 'reset-password',
              label: '重置密码',
              icon: <KeyRound className="h-4 w-4" />,
              onSelect: () => { setResetUserId(user.id); setResetPwd(''); setResetError(''); setResetOpen(true); },
            },
          ],
        },
        {
          id: 'danger',
          actions: [
            {
              id: 'delete',
              label: '删除',
              icon: <Trash2 className="h-4 w-4" />,
              destructive: true,
              disabled: user.id === currentUser?.id,
              disabledReason: '不能删除当前登录用户',
              onSelect: () => setConfirmAction({ type: 'delete', user }),
            },
          ],
        },
      ]}
    />
  );

  const confirmTitle = confirmAction?.type === 'approve'
    ? '通过注册申请'
    : confirmAction?.type === 'reject'
      ? '拒绝注册申请'
      : '删除用户';
  const confirmConsequence = confirmAction?.type === 'approve'
    ? `确定通过 ${confirmAction.user.username} 的注册申请吗？`
    : confirmAction?.type === 'reject'
      ? `确定拒绝 ${confirmAction.user.username} 的注册申请吗？`
      : '删除后该用户将无法继续登录，相关账号配置会被移除。';
  const confirmLabel = confirmAction?.type === 'approve'
    ? '通过'
    : confirmAction?.type === 'reject'
      ? '拒绝'
      : '删除';

  /* RENDER */
  return (
    <div className={embedded ? 'h-full overflow-auto bg-background' : 'min-h-screen bg-background'}>
      {!embedded && !isDashboardShell ? (
        <PageHeader
          data-tour-step-id="admin-users"
          title="用户管理"
          subtitle={`${users.length} 个用户${pendingUsers.length > 0 ? ` · ${pendingUsers.length} 个待审核` : ''}`}
          status={<StatusPill tone={pendingUsers.length > 0 ? 'warning' : 'success'}>{pendingUsers.length > 0 ? `${pendingUsers.length} 待审核` : '无待审核'}</StatusPill>}
          leading={(
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard"><ArrowLeft className="w-4 h-4 mr-2" />返回仪表盘</Link>
            </Button>
          )}
          primaryAction={<Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-2" />新建用户</Button>}
        />
      ) : null}

      <div className="container mx-auto space-y-4 px-6 py-6">
        {embedded && !isDashboardShell ? (
          <PageHeader
            data-tour-step-id="admin-users"
            title="用户管理"
            subtitle={`${users.length} 个用户${pendingUsers.length > 0 ? ` · ${pendingUsers.length} 个待审核` : ''}`}
            status={<StatusPill tone={pendingUsers.length > 0 ? 'warning' : 'success'}>{pendingUsers.length > 0 ? `${pendingUsers.length} 待审核` : '无待审核'}</StatusPill>}
            primaryAction={<Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-2" />新建用户</Button>}
            className="rounded-xl border"
          />
        ) : null}
        <PageToolbar
          search={(
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="搜索用户名或邮箱..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-10" />
            </div>
          )}
          refresh={(
            <Button variant="outline" size="sm" onClick={() => { usersQuery.refetch(); currentUserQuery.refetch(); }}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              刷新
            </Button>
          )}
          activeFilters={<span className="text-xs text-muted-foreground">显示 {activeTab === 'pending' ? filteredPendingUsers.length : filteredRegularUsers.length} / {activeTab === 'pending' ? pendingUsers.length : regularUsers.length} 个用户</span>}
        />

        {loading ? (
          <p className="text-muted-foreground text-center py-12">加载中...</p>
        ) : (
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'pending' | 'regular')} className="space-y-4">
            <TabsList>
              <TabsTrigger value="regular" className="gap-2">
                普通用户
                <StatusPill tone="neutral" dot={false} className="h-5 min-w-5 justify-center px-1.5 py-0 text-[10px]">{regularUsers.length}</StatusPill>
              </TabsTrigger>
              <TabsTrigger value="pending" className="gap-2">
                待审核
                {pendingUsers.length > 0 ? (
                  <StatusPill tone="warning" dot={false} className="h-5 min-w-5 justify-center px-1.5 py-0 text-[10px]">{pendingUsers.length}</StatusPill>
                ) : (
                  <StatusPill tone="neutral" dot={false} className="h-5 min-w-5 justify-center px-1.5 py-0 text-[10px]">0</StatusPill>
                )}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="regular" className="mt-0">
              {renderUsersTable(filteredRegularUsers, searchQuery ? '没有匹配的普通用户' : '暂无普通用户')}
            </TabsContent>
            <TabsContent value="pending" className="mt-0">
              {renderUsersTable(filteredPendingUsers, searchQuery ? '没有匹配的待审核用户' : '暂无待审核用户', true)}
            </TabsContent>
          </Tabs>
        )}
      </div>

      <ObjectEditDrawer
        open={drawerOpen}
        mode={editingUser ? 'edit' : 'create'}
        title={editingUser ? '编辑用户' : '新建用户'}
        subtitle={editingUser ? editingUser.email : '创建可登录 CSIHarness 的账号'}
        status={editingUser ? { label: statusLabel(editingUser.status), tone: statusTone(editingUser.status) } : undefined}
        dirty={formDirty}
        saving={createUserMutation.isPending || updateUserMutation.isPending}
        onOpenChange={setDrawerOpen}
        onRequestDiscard={() => window.confirm('放弃未保存的用户更改？')}
        saveAction={{
          label: editingUser ? '保存' : '创建',
          onClick: handleSave,
        }}
        cancelAction={{
          label: '取消',
          onClick: () => {
            if (!formDirty || window.confirm('放弃未保存的用户更改？')) setDrawerOpen(false);
          },
        }}
        secondaryActions={editingUser ? [{
          label: '重置密码',
          onClick: () => { setResetUserId(editingUser.id); setResetPwd(''); setResetError(''); setResetOpen(true); },
        }] : undefined}
        dangerActions={editingUser ? [{
          label: '删除用户',
          variant: 'destructive',
          disabled: editingUser.id === currentUser?.id,
          onClick: () => setConfirmAction({ type: 'delete', user: editingUser }),
        }] : undefined}
        sections={[
          {
            id: 'profile',
            title: '账号资料',
            description: '维护用户身份、邮箱和权限角色。',
            content: (
              <>
                <FormField
                  label="用户名"
                  required
                  control={<Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />}
                />
                <FormField
                  label="邮箱"
                  required
                  control={<Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />}
                />
                <FormField
                  label="角色"
                  control={(
                    <select
                      value={form.role}
                      onChange={e => setForm(f => ({ ...f, role: e.target.value as 'admin' | 'user' }))}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                    >
                      <option value="user">普通用户</option>
                      <option value="admin">管理员</option>
                    </select>
                  )}
                />
              </>
            ),
          },
          ...(!editingUser ? [{
            id: 'credentials',
            title: '创建凭据',
            description: '新建用户需要初始密码和密保信息。',
            content: (
              <>
                <FormField
                  label="密码"
                  required
                  description={PASSWORD_POLICY_DESCRIPTION}
                  control={<Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} minLength={8} placeholder="至少 8 位，包含字母、数字和符号" />}
                />
                <FormField
                  label="密保问题"
                  required
                  control={<Input value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))} />}
                />
                <FormField
                  label="密保答案"
                  required
                  control={<Input value={form.answer} onChange={e => setForm(f => ({ ...f, answer: e.target.value }))} />}
                />
              </>
            ),
          }] : []),
          {
            id: 'workspace',
            title: '工作目录',
            description: '可指定该用户默认使用的个人目录。',
            content: (
              <>
                <FormField
                  label="个人目录"
                  control={<Input value={form.personalDir} onChange={e => setForm(f => ({ ...f, personalDir: e.target.value }))} placeholder="个人目录（可选）" />}
                />
                <WorkspaceDirectoryPicker
                  workspaceRoot="/"
                  value={form.personalDir}
                  onChange={(path) => setForm((f) => ({ ...f, personalDir: path }))}
                />
              </>
            ),
          },
          {
            id: 'avatar',
            title: '头像',
            description: '选择用户在列表和会话中的头像。',
            content: (
              <AvatarPicker value={form.avatar} onChange={avatar => setForm(f => ({ ...f, avatar }))} seed={form.username} className="h-64" />
            ),
          },
          ...(formError ? [{
            id: 'errors',
            title: '保存失败',
            content: <p className="text-sm text-destructive">{formError}</p>,
          }] : []),
        ]}
      />

      {/* Reset Password Dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>重置密码</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input type="password" placeholder="新密码（至少 8 位，包含字母、数字和符号）" value={resetPwd} onChange={e => setResetPwd(e.target.value)} minLength={8} />
            {resetError && <p className="text-sm text-destructive">{resetError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>取消</Button>
            <Button onClick={handleResetPassword}>确认重置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmModal
        open={Boolean(confirmAction)}
        variant={confirmAction?.type === 'approve' ? 'default' : 'delete'}
        title={confirmTitle}
        objectName={confirmAction?.user.username}
        consequence={confirmConsequence}
        confirmLabel={confirmLabel}
        loading={deleteUserMutation.isPending || updateUserMutation.isPending}
        onCancel={() => setConfirmAction(null)}
        onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
        onConfirm={() => {
          if (!confirmAction) return;
          if (confirmAction.type === 'delete') return handleDelete(confirmAction.user);
          return handleReview(confirmAction.user, confirmAction.type);
        }}
      />
    </div>
  );
}

export default function UsersPage() {
  return <AuthGuard><UsersContent /></AuthGuard>;
}
