'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { RobotLogo } from '@/components/brand/RobotLogo';
import { PRODUCT_DISPLAY_NAME } from '@/lib/core/branding';
import AvatarPicker from '@/components/AvatarPicker';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';

function normalizePortablePath(input: string): string {
  return (input || '').replace(/\\/g, '/').trim();
}

function isWindowsAbsolutePath(input: string): boolean {
  return /^[a-zA-Z]:([/\\]|$)/.test(input);
}

function getInitialPersonalDirectoryRoot(platform: string, personalDir: string, userHome: string, runtimeRoot: string): string {
  const candidates = [personalDir, userHome, runtimeRoot].map(normalizePortablePath).filter(Boolean);
  if (platform === 'win32') return candidates.find(isWindowsAbsolutePath) || '';
  return candidates.find((item) => item.startsWith('/')) || candidates[0] || '';
}

export default function RegisterPage() {
  const router = useRouter();
  useDocumentTitle('用户注册');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [platform, setPlatform] = useState('');
  const [runtimeRoot, setRuntimeRoot] = useState('');
  const [userHome, setUserHome] = useState('');
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    question: '',
    answer: '',
    personalDir: '',
    avatar: '',
  });

  useEffect(() => {
    fetch('/api/auth/setup')
      .then((res) => res.json())
      .then((data) => {
        setPlatform(data.platform || '');
        setRuntimeRoot(data.runtimeRoot || '');
        setUserHome(data.userHome || '');
        setForm((current) => ({ ...current, personalDir: data.userHome || '' }));
        if (!data.isSetup) router.push('/setup');
      })
      .catch(() => setError('检查系统状态失败'))
      .finally(() => setLoading(false));
  }, [router]);

  const updateForm = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('两次密码输入不一致');
      return;
    }
    if (form.password.length < 6) {
      setError('密码至少6个字符');
      return;
    }
    if (!form.question.trim() || !form.answer.trim()) {
      setError('请设置密保问题和答案');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.username,
          email: form.email,
          password: form.password,
          question: form.question,
          answer: form.answer,
          personalDir: form.personalDir,
          avatar: form.avatar,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '注册失败');
        return;
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || '注册失败');
    } finally {
      setSubmitting(false);
    }
  };

  const personalDirPlaceholder = platform === 'win32' ? 'C:/Users/your-name/workspace' : '/home/your-name/workspace';
  const personalDirPickerRoot = getInitialPersonalDirectoryRoot(platform, form.personalDir, userHome, runtimeRoot);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <RobotLogo size={48} className="animate-robotPulse" />
          <p className="text-sm text-muted-foreground">检查系统状态...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 via-background to-blue-500/10 p-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <RobotLogo size={56} className="animate-robotPulse" />
          <div>
            <h1 className="bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-3xl font-bold text-transparent">
              {PRODUCT_DISPLAY_NAME}
            </h1>
            <p className="text-xs text-muted-foreground">Your team of AIs, collaborating to get work done.</p>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-8 shadow-xl">
          {submitted ? (
            <div className="space-y-5 text-center">
              <span className="material-symbols-outlined text-5xl text-primary">pending_actions</span>
              <div>
                <h2 className="text-xl font-semibold">注册申请已提交</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  管理员审核通过后，你就可以使用邮箱和密码登录。
                </p>
              </div>
              <Button className="w-full" onClick={() => router.push('/login')}>返回登录</Button>
            </div>
          ) : (
            <>
              <div className="mb-6 text-center">
                <h2 className="text-xl font-semibold">用户注册</h2>
                <p className="mt-1 text-sm text-muted-foreground">提交申请后等待管理员审核</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">用户名</label>
                  <Input value={form.username} onChange={(e) => updateForm('username', e.target.value)} required minLength={2} className="h-10" placeholder="请输入用户名" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">邮箱</label>
                  <Input type="email" value={form.email} onChange={(e) => updateForm('email', e.target.value)} required className="h-10" placeholder="请输入邮箱" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">密码</label>
                  <Input type="password" value={form.password} onChange={(e) => updateForm('password', e.target.value)} required minLength={6} className="h-10" placeholder="至少6个字符" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">确认密码</label>
                  <Input type="password" value={form.confirmPassword} onChange={(e) => updateForm('confirmPassword', e.target.value)} required minLength={6} className="h-10" placeholder="再次输入密码" />
                </div>
                <div className="border-t pt-4">
                  <label className="mb-1.5 block text-sm font-medium">密保问题</label>
                  <Input value={form.question} onChange={(e) => updateForm('question', e.target.value)} required className="h-10" placeholder="例如：我的第一台电脑型号？" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">密保答案</label>
                  <Input value={form.answer} onChange={(e) => updateForm('answer', e.target.value)} required className="h-10" placeholder="请输入密保答案" />
                </div>
                <div className="border-t pt-4">
                  <label className="mb-1.5 block text-sm font-medium">个人目录（可选）</label>
                  <Input value={form.personalDir} onChange={(e) => updateForm('personalDir', e.target.value)} className="h-10" placeholder={personalDirPlaceholder} />
                  <div className="mt-2">
                    <WorkspaceDirectoryPicker workspaceRoot={personalDirPickerRoot} value={form.personalDir} onChange={(path) => updateForm('personalDir', path)} />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium">选择头像</label>
                  <AvatarPicker value={form.avatar} onChange={(avatar) => updateForm('avatar', avatar)} seed={form.username} />
                </div>

                {error && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                  </motion.div>
                )}

                <Button type="submit" className="h-10 w-full" disabled={submitting}>
                  {submitting ? '提交中...' : '提交注册申请'}
                </Button>
              </form>
            </>
          )}
        </div>

        <div className="mt-5 text-center">
          <Button variant="link" className="text-xs text-muted-foreground" onClick={() => router.push('/login')}>
            已有账号？返回登录
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
