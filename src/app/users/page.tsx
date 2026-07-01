'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AvatarPicker from '@/components/AvatarPicker';
import SpriteAvatar from '@/components/SpriteAvatar';
import AuthGuard from '@/components/AuthGuard';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';
import { ArrowLeft, Plus, Search, MoreHorizontal, Check, X } from 'lucide-react';

interface UserInfo {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  status: 'pending' | 'active' | 'rejected';
  personalDir: string;
  avatar?: string;
  createdAt: number;
  createdBy?: string;
  approvedAt?: number;
  approvedBy?: string;
  rejectedAt?: number;
  rejectedBy?: string;
  reviewNote?: string;
}

export function UsersContent({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
  useDocumentTitle('用户管理');
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'regular'>('regular');

  // Create/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserInfo | null>(null);
  const [form, setForm] = useState({ username: '', email: '', password: '', question: '', answer: '', role: 'user' as 'admin' | 'user', personalDir: '', avatar: '' });
  const [formError, setFormError] = useState('');

  // Reset password dialog
  const [resetOpen, setResetOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState('');
  const [resetPwd, setResetPwd] = useState('');
  const [resetError, setResetError] = useState('');
  const { confirm, dialogProps } = useConfirmDialog();

  const getAuthHeaders = useCallback((includeJson = false): Record<string, string> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
    const base: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    return includeJson ? { ...base, 'Content-Type': 'application/json' } : base;
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users', { headers: getAuthHeaders() });
      if (res.status === 403) { router.push('/'); return; }
      const data = await res.json();
      const nextUsers = data.users || [];
      setUsers(nextUsers);
      window.dispatchEvent(new CustomEvent('aceharness:pending-users-changed', {
        detail: nextUsers.filter((user: UserInfo) => user.status === 'pending').length,
      }));
    } catch {} finally { setLoading(false); }
  }, [getAuthHeaders, router]);

  useEffect(() => {
    void fetch('/api/auth/me', { headers: getAuthHeaders() }).then(r => r.json()).then(d => {
      setCurrentUser(d.user);
      if (d.user?.role !== 'admin') router.push('/');
    });
    void loadUsers();
  }, [getAuthHeaders, loadUsers, router]);

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
    setDialogOpen(true);
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
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setFormError('');
    if (editingUser) {
      // Update
      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: 'PUT', headers: getAuthHeaders(true),
        body: JSON.stringify({ username: form.username, email: form.email, role: form.role, personalDir: form.personalDir, avatar: form.avatar }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error); return; }
    } else {
      // Create
      if (!form.username || !form.email || !form.password || !form.question || !form.answer) {
        setFormError('所有字段不能为空'); return;
      }
      const res = await fetch('/api/users', {
        method: 'POST', headers: getAuthHeaders(true),
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error); return; }
    }
    setDialogOpen(false);
    void loadUsers();
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: '删除用户',
      description: '确定要删除该用户吗？',
      confirmLabel: '删除',
      variant: 'destructive',
    });
    if (!ok) return;
    await fetch(`/api/users/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
    void loadUsers();
  };

  const handleResetPassword = async () => {
    setResetError('');
    if (resetPwd.length < 6) { setResetError('密码至少6个字符'); return; }
    const res = await fetch(`/api/users/${resetUserId}`, {
      method: 'PUT', headers: getAuthHeaders(true),
      body: JSON.stringify({ resetPassword: resetPwd }),
    });
    const data = await res.json();
    if (!res.ok) { setResetError(data.error); return; }
    setResetOpen(false); setResetPwd('');
  };

  const handleReview = async (user: UserInfo, reviewAction: 'approve' | 'reject') => {
    const ok = await confirm({
      title: reviewAction === 'approve' ? '通过注册申请' : '拒绝注册申请',
      description: reviewAction === 'approve'
        ? `确定通过 ${user.username} 的注册申请吗？`
        : `确定拒绝 ${user.username} 的注册申请吗？`,
      confirmLabel: reviewAction === 'approve' ? '通过' : '拒绝',
      variant: reviewAction === 'approve' ? 'default' : 'destructive',
    });
    if (!ok) return;
    await fetch(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ reviewAction }),
    });
    void loadUsers();
  };

  const statusLabel = (status: UserInfo['status']) => {
    if (status === 'pending') return '待审核';
    if (status === 'rejected') return '已拒绝';
    return '已启用';
  };

  const statusVariant = (status: UserInfo['status']) => {
    if (status === 'pending') return 'outline' as const;
    if (status === 'rejected') return 'destructive' as const;
    return 'secondary' as const;
  };

  const renderUsersTable = (items: UserInfo[], emptyText: string, showReviewActions = false) => (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">头像</TableHead>
            <TableHead>用户名</TableHead>
            <TableHead>邮箱</TableHead>
            <TableHead>角色</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>个人目录</TableHead>
            <TableHead>创建时间</TableHead>
            <TableHead className={showReviewActions ? 'w-44' : 'w-12'}>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(user => (
            <TableRow key={user.id}>
              <TableCell>
                <SpriteAvatar
                  avatar={user.avatar}
                  seed={user.username}
                  category="user-default"
                  alt={user.username}
                  fallback={user.username.charAt(0).toUpperCase()}
                  className="h-8 w-8"
                  fallbackClassName="text-xs"
                />
              </TableCell>
              <TableCell className="font-medium">{user.username}</TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                  {user.role === 'admin' ? '管理员' : '用户'}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(user.status)}>
                  {statusLabel(user.status)}
                </Badge>
              </TableCell>
              <TableCell><code className="text-xs">{user.personalDir || '-'}</code></TableCell>
              <TableCell className="text-muted-foreground text-sm">{new Date(user.createdAt).toLocaleDateString()}</TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1.5">
                  {showReviewActions && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-900/70 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                        onClick={() => handleReview(user, 'approve')}
                      >
                        <Check className="h-3.5 w-3.5" />通过
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                        onClick={() => handleReview(user, 'reject')}
                      >
                        <X className="h-3.5 w-3.5" />拒绝
                      </Button>
                    </>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0"><MoreHorizontal className="w-4 h-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(user)}>编辑</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setResetUserId(user.id); setResetPwd(''); setResetError(''); setResetOpen(true); }}>重置密码</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(user.id)} disabled={user.id === currentUser?.id}>删除</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{emptyText}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );

  /* RENDER */
  return (
    <div className={embedded ? 'h-full overflow-auto bg-background' : 'min-h-screen bg-background'}>
      {!embedded && !isDashboardShell ? (
      <header data-tour-step-id="admin-users" className="border-b border-border/50 bg-card/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard"><ArrowLeft className="w-4 h-4 mr-2" />返回仪表盘</Link>
            </Button>
            <div className="h-6 w-px bg-border" />
            <div>
              <h1 className="text-2xl font-bold">用户管理</h1>
              <p className="text-xs text-muted-foreground">
                {users.length} 个用户
                {pendingUsers.length > 0 ? ` · ${pendingUsers.length} 个待审核` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />新建用户</Button>
          </div>
        </div>
      </header>
      ) : null}

      <div className="container mx-auto px-6 py-8">
        {embedded && !isDashboardShell ? (
          <div data-tour-step-id="admin-users" className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">用户管理</h1>
              <p className="text-xs text-muted-foreground">
                {users.length} 个用户
                {pendingUsers.length > 0 ? ` · ${pendingUsers.length} 个待审核` : ''}
              </p>
            </div>
            <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />新建用户</Button>
          </div>
        ) : null}
        <div className="mb-6 relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="搜索用户名或邮箱..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-10" />
        </div>

        {loading ? (
          <p className="text-muted-foreground text-center py-12">加载中...</p>
        ) : (
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'pending' | 'regular')} className="space-y-4">
            <TabsList>
              <TabsTrigger value="regular" className="gap-2">
                普通用户
                <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-[10px]">{regularUsers.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="pending" className="gap-2">
                待审核
                {pendingUsers.length > 0 ? (
                  <Badge variant="destructive" className="h-5 min-w-5 justify-center px-1.5 text-[10px]">{pendingUsers.length}</Badge>
                ) : (
                  <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-[10px]">0</Badge>
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

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingUser ? '编辑用户' : '新建用户'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="用户名" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
            <Input placeholder="邮箱" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            {!editingUser && (
              <>
                <Input placeholder="密码（至少6位）" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                <Input placeholder="密保问题" value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))} />
                <Input placeholder="密保答案" value={form.answer} onChange={e => setForm(f => ({ ...f, answer: e.target.value }))} />
              </>
            )}
            <div className="flex items-center gap-2">
              <label className="text-sm">角色：</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as 'admin' | 'user' }))} className="rounded-md border bg-background px-3 py-1.5 text-sm">
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <Input placeholder="个人目录（可选）" value={form.personalDir} onChange={e => setForm(f => ({ ...f, personalDir: e.target.value }))} />
            <WorkspaceDirectoryPicker
              workspaceRoot="/"
              value={form.personalDir}
              onChange={(path) => setForm((f) => ({ ...f, personalDir: path }))}
            />
            <div>
              <label className="text-sm mb-2 block">选择头像：</label>
              <AvatarPicker value={form.avatar} onChange={avatar => setForm(f => ({ ...f, avatar }))} seed={form.username} className="h-64" />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave}>{editingUser ? '保存' : '创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>重置密码</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input type="password" placeholder="新密码（至少6位）" value={resetPwd} onChange={e => setResetPwd(e.target.value)} />
            {resetError && <p className="text-sm text-destructive">{resetError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>取消</Button>
            <Button onClick={handleResetPassword}>确认重置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  );
}

export default function UsersPage() {
  return <AuthGuard><UsersContent /></AuthGuard>;
}
