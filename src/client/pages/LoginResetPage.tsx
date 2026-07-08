'use client';

import { useMemo, useState } from 'react';
import { useRouter } from '@/lib/navigation/client';
import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, KeyRound, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField, FormSection } from '@/components/ui/form-section';
import { DataCard, DataCardDescription, DataCardHeader, DataCardTitle } from '@/components/ui/data-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { RobotLogo } from '@/components/brand/RobotLogo';
import { PASSWORD_POLICY_DESCRIPTION, getLoginPasswordError } from '@/lib/auth/password-policy';

export default function ResetPasswordPage() {
  const router = useRouter();
  useDocumentTitle('找回密码');
  const [step, setStep] = useState<'email' | 'answer' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const normalizedEmail = useMemo(() => email.trim(), [email]);
  const steps = [
    { index: '1', label: '确认邮箱', done: step !== 'email' },
    { index: '2', label: '回答密保', done: step === 'done' },
    { index: '3', label: '完成重置', done: step === 'done' },
  ];

  const handleGetQuestion = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setError('');
    if (!normalizedEmail) {
      setError('请输入注册邮箱');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, step: 'question' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '未找到密保问题');
        return;
      }
      setQuestion(data.question || '');
      setStep('answer');
    } catch {
      setError('请求失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setError('');
    if (!answer.trim()) {
      setError('请输入密保答案');
      return;
    }
    const passwordError = getLoginPasswordError(newPassword, { email: normalizedEmail });
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次密码输入不一致');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, answer, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '重置密码失败');
        return;
      }
      setStep('done');
    } catch {
      setError('请求失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const resetToEmailStep = () => {
    setStep('email');
    setQuestion('');
    setAnswer('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
  };

  return (
    <div className="min-h-screen bg-[#F4F4F1] px-4 py-8 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full gap-5 md:grid-cols-[0.85fr_1.15fr]">
          <div className="hidden rounded-xl border border-[#E3E3DF] bg-[#EDEDE9] p-6 md:flex md:flex-col md:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <RobotLogo size={42} />
                <div>
                  <h1 className="text-xl font-semibold">ACEHarness</h1>
                  <p className="text-xs text-muted-foreground">Account Recovery</p>
                </div>
              </div>
              <div className="mt-8 grid gap-3">
                <DataCard>
                  <DataCardHeader>
                    <DataCardTitle>密保校验</DataCardTitle>
                    <ShieldQuestion className="h-4 w-4 text-muted-foreground" />
                  </DataCardHeader>
                  <DataCardDescription>通过注册时设置的安全问题确认身份，然后设置新密码。</DataCardDescription>
                </DataCard>
                <DataCard>
                  <DataCardHeader>
                    <DataCardTitle>本地账号体系</DataCardTitle>
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                  </DataCardHeader>
                  <DataCardDescription>重置成功后旧密码立即失效，可直接返回登录页使用新密码登录。</DataCardDescription>
                </DataCard>
              </div>
            </div>
            <Button variant="ghost" className="w-fit gap-2 px-0 text-muted-foreground hover:bg-transparent" onClick={() => router.push('/login')}>
              <ArrowLeft className="h-4 w-4" />
              返回登录
            </Button>
          </div>

          <div className="rounded-xl border border-[#E3E3DF] bg-white p-6 shadow-none sm:p-8">
            <Button variant="ghost" className="mb-6 gap-2 px-0 md:hidden" onClick={() => router.push('/login')}>
              <ArrowLeft className="h-4 w-4" />
              返回登录
            </Button>

            <div className="mb-8">
              <StatusPill tone="accent" className="mb-3">密保问题重置密码</StatusPill>
              <h2 className="text-2xl font-semibold">找回账号访问权限</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                输入注册邮箱获取密保问题，回答正确后即可设置新密码。
              </p>
            </div>

            <div className="mb-8 grid grid-cols-3 gap-2 text-xs" aria-label="重置密码步骤">
              {steps.map(({ index, label, done }) => (
                <div key={index} className={`rounded-lg border px-3 py-2 ${done ? 'border-primary/30 bg-accent text-accent-foreground' : 'border-[#E3E3DF] bg-white text-muted-foreground'}`}>
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px]">{index}</span>
                  {label}
                </div>
              ))}
            </div>

            {step === 'email' && (
              <motion.form initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onSubmit={handleGetQuestion}>
                <FormSection title="确认邮箱" description="系统会返回该邮箱对应的密保问题。">
                  <FormField
                    label="注册邮箱"
                    required
                    control={<Input placeholder="name@example.com" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="h-11 bg-white" />}
                  />
                </FormSection>
                {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
                <Button type="submit" variant="outline" className="mt-5 h-11 w-full bg-white" disabled={loading}>
                  {loading ? '查询中...' : '获取密保问题'}
                </Button>
              </motion.form>
            )}

            {step === 'answer' && (
              <motion.form initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onSubmit={handleReset}>
                <DataCard className="mb-5">
                  <div className="text-xs text-muted-foreground">密保问题</div>
                  <div className="mt-1 text-sm font-medium">{question || '该账号未设置密保问题'}</div>
                  <Button type="button" variant="link" className="mt-2 h-auto p-0 text-xs" onClick={resetToEmailStep}>
                    换一个邮箱
                  </Button>
                </DataCard>
                <FormSection title="设置新密码" description="密保答案正确后，新密码立即生效。">
                  <FormField label="密保答案" required control={<Input value={answer} onChange={(event) => setAnswer(event.target.value)} required className="h-11 bg-white" placeholder="请输入密保答案" />} />
                  <FormField label="新密码" required description={PASSWORD_POLICY_DESCRIPTION} control={<Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={8} className="h-11 bg-white" placeholder="至少 8 位，包含字母和数字" />} />
                  <FormField label="确认新密码" required control={<Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} className="h-11 bg-white" placeholder="再次输入新密码" />} />
                </FormSection>
                {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
                <Button type="submit" variant="outline" className="mt-5 h-11 w-full bg-white" disabled={loading}>
                  {loading ? '重置中...' : '重置密码'}
                </Button>
              </motion.form>
            )}

            {step === 'done' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <EmptyState
                  icon={<CheckCircle2 className="h-5 w-5" />}
                  title="密码已重置"
                  description="现在可以使用新密码登录 ACEHarness。"
                  primaryAction={<Button variant="outline" className="bg-white" onClick={() => router.push('/login')}>返回登录</Button>}
                />
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
