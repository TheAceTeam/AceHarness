'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '@/lib/navigation/client';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField, FormSection } from '@/components/ui/form-section';
import { DataCard, DataCardDescription, DataCardHeader, DataCardTitle } from '@/components/ui/data-card';
import { StatusPill } from '@/components/ui/status-pill';
import { EmptyState } from '@/components/ui/empty-state';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { RobotLogo } from '@/components/brand/RobotLogo';
import AvatarPicker from '@/components/AvatarPicker';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';
import { useAuthSetupStatusQuery, useRegisterUserMutation } from '@/client/query/auth';
import { PASSWORD_POLICY_DESCRIPTION, getLoginPasswordError } from '@/lib/auth/password-policy';
import { CheckCircle2, UserPlus } from 'lucide-react';

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
  const setupStatusQuery = useAuthSetupStatusQuery();
  const registerUserMutation = useRegisterUserMutation();
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
    setLoading(setupStatusQuery.isLoading);
    if (setupStatusQuery.data) {
      const data = setupStatusQuery.data;
      setPlatform(data.platform || '');
      setRuntimeRoot(data.runtimeRoot || '');
      setUserHome(data.userHome || '');
      setForm((current) => ({ ...current, personalDir: data.userHome || '' }));
      if (!data.isSetup) router.push('/setup');
    }
    if (setupStatusQuery.isError) setError('检查系统状态失败');
  }, [router, setupStatusQuery.data, setupStatusQuery.isError, setupStatusQuery.isLoading]);

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
    const passwordError = getLoginPasswordError(form.password, {
      username: form.username,
      email: form.email,
    });
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (!form.question.trim() || !form.answer.trim()) {
      setError('请设置密保问题和答案');
      return;
    }

    setSubmitting(true);
    try {
      await registerUserMutation.mutateAsync({
          username: form.username,
          email: form.email,
          password: form.password,
          question: form.question,
          answer: form.answer,
          personalDir: form.personalDir,
          avatar: form.avatar,
      });
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
      <div className="flex min-h-screen items-center justify-center bg-[#F4F4F1]">
        <div className="flex flex-col items-center gap-4">
          <RobotLogo size={48} className="animate-robotPulse" />
          <p className="text-sm text-muted-foreground">检查系统状态...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F4F1] px-4 py-8 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-5xl items-center justify-center">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="grid w-full gap-5 lg:grid-cols-[0.8fr_1.2fr]">
          <aside className="hidden rounded-xl border border-[#E3E3DF] bg-[#EDEDE9] p-6 lg:block">
            <div className="flex items-center gap-3">
              <RobotLogo size={42} />
              <div>
                <h1 className="text-xl font-semibold">ACEHarness</h1>
                <p className="text-xs text-muted-foreground">Registration request</p>
              </div>
            </div>
            <div className="mt-8 grid gap-3">
              <DataCard>
                <DataCardHeader>
                  <DataCardTitle>注册申请</DataCardTitle>
                  <StatusPill tone="warning">待审核</StatusPill>
                </DataCardHeader>
                <DataCardDescription>提交后由管理员审核，通过后即可用邮箱和密码登录。</DataCardDescription>
              </DataCard>
              <DataCard>
                <DataCardHeader>
                  <DataCardTitle>个人目录</DataCardTitle>
                </DataCardHeader>
                <DataCardDescription>可为用户设置独立工作目录；不填写时沿用系统默认策略。</DataCardDescription>
              </DataCard>
            </div>
          </aside>

          <main className="rounded-xl border border-[#E3E3DF] bg-white p-6 shadow-none sm:p-8">
            <div className="mb-7 flex items-center gap-3">
              <RobotLogo size={44} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold">用户注册</h1>
                  <StatusPill tone="neutral">独立入口</StatusPill>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">提交申请后等待管理员审核。</p>
              </div>
            </div>

          {submitted ? (
            <EmptyState
              icon={<CheckCircle2 className="h-5 w-5" />}
              title="注册申请已提交"
              description="管理员审核通过后，你就可以使用邮箱和密码登录。"
              primaryAction={<Button variant="outline" onClick={() => router.push('/login')}>返回登录</Button>}
            />
          ) : (
            <>
              <form onSubmit={handleSubmit}>
                <FormSection title="基本信息" description="用于管理员审核和后续登录。">
                  <FormField label="用户名" required control={<Input value={form.username} onChange={(e) => updateForm('username', e.target.value)} required minLength={2} className="h-10 bg-white" placeholder="请输入用户名" />} />
                  <FormField label="邮箱" required control={<Input type="email" value={form.email} onChange={(e) => updateForm('email', e.target.value)} required className="h-10 bg-white" placeholder="请输入邮箱" />} />
                  <FormField label="密码" required description={PASSWORD_POLICY_DESCRIPTION} control={<Input type="password" value={form.password} onChange={(e) => updateForm('password', e.target.value)} required minLength={8} className="h-10 bg-white" placeholder="至少 8 位，包含字母和数字" />} />
                  <FormField label="确认密码" required control={<Input type="password" value={form.confirmPassword} onChange={(e) => updateForm('confirmPassword', e.target.value)} required minLength={8} className="h-10 bg-white" placeholder="再次输入密码" />} />
                </FormSection>

                <FormSection title="密保问题" description="用于找回密码，错误会在表单内持续显示。">
                  <FormField label="密保问题" required control={<Input value={form.question} onChange={(e) => updateForm('question', e.target.value)} required className="h-10 bg-white" placeholder="例如：我的第一台电脑型号？" />} />
                  <FormField label="密保答案" required control={<Input value={form.answer} onChange={(e) => updateForm('answer', e.target.value)} required className="h-10 bg-white" placeholder="请输入密保答案" />} />
                </FormSection>

                <FormSection title="个人工作区" description="可选目录和头像设置。">
                  <FormField
                    label="个人目录"
                    description="工作流执行时的隔离目录。"
                    control={(
                      <>
                        <Input value={form.personalDir} onChange={(e) => updateForm('personalDir', e.target.value)} className="h-10 bg-white" placeholder={personalDirPlaceholder} />
                        <div className="mt-2">
                          <WorkspaceDirectoryPicker workspaceRoot={personalDirPickerRoot} value={form.personalDir} onChange={(path) => updateForm('personalDir', path)} />
                        </div>
                      </>
                    )}
                  />
                  <FormField label="选择头像" control={<AvatarPicker value={form.avatar} onChange={(avatar) => updateForm('avatar', avatar)} seed={form.username} />} />
                </FormSection>

                {error && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {error}
                  </motion.div>
                )}

                <Button type="submit" variant="outline" className="mt-5 h-10 w-full bg-white" disabled={submitting}>
                  <UserPlus className="h-4 w-4" />
                  {submitting ? '提交中...' : '提交注册申请'}
                </Button>
              </form>
            </>
          )}

            <div className="mt-5 text-center">
              <Button variant="link" className="text-xs text-muted-foreground" onClick={() => router.push('/login')}>
            已有账号？返回登录
              </Button>
            </div>
          </main>
        </motion.div>
      </div>
    </div>
  );
}
