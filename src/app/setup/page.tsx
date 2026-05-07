'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SingleCombobox } from '@/components/ui/combobox';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { RobotLogo } from '@/components/chat/ChatMessage';
import AvatarPicker from '@/components/AvatarPicker';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';
import { getConcreteEngines } from '@/lib/engine-metadata';
import type { ModelOption } from '@/lib/models';

interface DiscoveredSkill {
  name: string;
  label: string;
  description: string;
  source?: string;
  tags?: string[];
}

const REQUIRED_SKILL_NAMES = new Set([
  'aceharness-chat-card',
  'aceharness-workflow-creator',
]);

function getDefaultSelectedSkills(skills: DiscoveredSkill[]): Set<string> {
  return new Set(
    skills
      .filter((skill) => REQUIRED_SKILL_NAMES.has(skill.name))
      .map((skill) => skill.name),
  );
}

function normalizePortablePath(input: string): string {
  return (input || '').replace(/\\/g, '/').trim();
}

function isWindowsAbsolutePath(input: string): boolean {
  return /^[a-zA-Z]:([/\\]|$)/.test(input);
}

function getInitialPersonalDirectoryRoot(platform: string, personalDir: string, userHome: string, runtimeRoot: string): string {
  const candidates = [personalDir, userHome, runtimeRoot].map(normalizePortablePath).filter(Boolean);
  if (platform === 'win32') {
    return candidates.find(isWindowsAbsolutePath) || '';
  }
  return candidates.find((item) => item.startsWith('/')) || candidates[0] || '';
}

export default function SetupPage() {
  const router = useRouter();
  useDocumentTitle('初始化设置');
  const [step, setStep] = useState<'check' | 'admin' | 'skills' | 'complete'>('check');
  const [loading, setLoading] = useState(true);
  const [cloning, setCloning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [typedWelcome, setTypedWelcome] = useState('');
  const [showContinue, setShowContinue] = useState(false);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [personalDir, setPersonalDir] = useState('');
  const [platform, setPlatform] = useState('');
  const [runtimeRoot, setRuntimeRoot] = useState('');
  const [userHome, setUserHome] = useState('');
  const [avatar, setAvatar] = useState('');
  const [engine, setEngine] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [availableModels, setAvailableModels] = useState<Array<{ value: string; label: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [engineAvailability, setEngineAvailability] = useState<Record<string, boolean | null>>({});
  const [checkingEngine, setCheckingEngine] = useState(false);

  const [skills, setSkills] = useState<DiscoveredSkill[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (step !== 'complete') {
      setTypedWelcome('');
      setShowContinue(false);
      return;
    }

    const welcomeMessage = '\u6b22\u8fce\u4f7f\u7528 ACEHarness';
    setTypedWelcome('');
    setShowContinue(false);

    let index = 0;
    let revealTimer: number | undefined;
    const typingTimer = window.setInterval(() => {
      index += 1;
      setTypedWelcome(welcomeMessage.slice(0, index));
      if (index >= welcomeMessage.length) {
        window.clearInterval(typingTimer);
        revealTimer = window.setTimeout(() => setShowContinue(true), 320);
      }
    }, 90);

    return () => {
      window.clearInterval(typingTimer);
      if (revealTimer) window.clearTimeout(revealTimer);
    };
  }, [step]);

  useEffect(() => {
    fetch('/api/auth/setup')
      .then(res => res.json())
      .then(async (data) => {
        setPlatform(data.platform || '');
        setRuntimeRoot(data.runtimeRoot || '');
        setUserHome(data.userHome || '');
        setPersonalDir(data.userHome || '');
        if (data.isSetup) {
          router.push('/login');
        } else {
          try {
            const settingsRes = await fetch('/api/chat/settings');
            const settingsData = await settingsRes.json();
            const discoveredSkills = settingsData.discoveredSkills || [];
            setSkills(discoveredSkills);
            setSelectedSkills(getDefaultSelectedSkills(discoveredSkills));
          } catch {
          }
          setStep('admin');
        }
      })
      .catch(() => {
        setError('检查状态失败');
      })
      .finally(() => {
        setLoading(false);
        setCloning(false);
      });
  }, [router]);

  useEffect(() => {
    if (!engine) {
      setAvailableModels([]);
      setDefaultModel('');
      return;
    }

    let cancelled = false;
    const checkAndLoadModels = async () => {
      setLoadingModels(true);
      setError('');
      setCheckingEngine(true);

      if (engineAvailability[engine] == null) {
        try {
          const availRes = await fetch(`/api/engine/availability?engine=${encodeURIComponent(engine)}`);
          const availData = await availRes.json();
          if (cancelled) return;
          setEngineAvailability((prev) => ({ ...prev, [engine]: availData.available }));
          if (!availData.available) {
            setAvailableModels([]);
            setDefaultModel('');
            setError(`引擎 ${engine} 不可用，请确保已安装对应的命令行工具`);
            setLoadingModels(false);
            setCheckingEngine(false);
            return;
          }
        } catch {
          if (cancelled) return;
        }
      } else if (engineAvailability[engine] === false) {
        setAvailableModels([]);
        setDefaultModel('');
        setError(`引擎 ${engine} 不可用，请确保已安装对应的命令行工具`);
        setLoadingModels(false);
        setCheckingEngine(false);
        return;
      }
      setCheckingEngine(false);

      try {
        if (['opencode', 'nga', 'codegenie', 'kiro-cli', 'cursor', 'trae-cli'].includes(engine)) {
          const res = await fetch(`/api/engine/models?engine=${encodeURIComponent(engine)}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || '模型探测失败');
          if (cancelled) return;
          const options = (data.models || []).map((item: { modelId: string; name?: string }) => ({
            value: item.modelId,
            label: item.name || item.modelId,
          }));
          setAvailableModels(options);
          setDefaultModel((current) => options.some((item: { value: string }) => item.value === current) ? current : (options[0]?.value || ''));
          return;
        }

        const res = await fetch('/api/models');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '模型加载失败');
        if (cancelled) return;
        const options = ((data.models || []) as ModelOption[])
          .filter((model) => !model.engines || model.engines.length === 0 || model.engines.includes(engine))
          .map((model) => ({
            value: model.value,
            label: `${model.label} (${model.costMultiplier}x)`,
          }));
        setAvailableModels(options);
        setDefaultModel((current) => options.some((item: { value: string }) => item.value === current) ? current : (options[0]?.value || ''));
      } catch (err: any) {
        if (cancelled) return;
        setAvailableModels([]);
        setDefaultModel('');
        setError(err.message || '模型加载失败');
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    };

    checkAndLoadModels();
    return () => {
      cancelled = true;
    };
  }, [engine]);

  const handleAdminSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('两次密码输入不一致');
      return;
    }

    if (password.length < 6) {
      setError('密码至少6个字符');
      return;
    }

    if (!question || !answer) {
      setError('请设置密保问题和答案');
      return;
    }

    if (!engine) {
      setError('请先选择默认引擎');
      return;
    }

    if (!defaultModel) {
      setError('请先选择默认模型');
      return;
    }

    setStep('skills');
  };

  const handleFinalSubmit = async () => {
    setSubmitting(true);
    setError('');

    try {
      const engineRes = await fetch('/api/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine, defaultModel }),
      });
      const engineData = await engineRes.json();
      if (!engineRes.ok) {
        setError(engineData.error || '保存默认引擎失败');
        return;
      }

      const setupRes = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, question, answer, personalDir, avatar }),
      });

      const setupData = await setupRes.json();

      if (!setupRes.ok) {
        setError(setupData.error || '设置失败');
        return;
      }

      const skillsRecord: Record<string, boolean> = {};
      skills.forEach(s => {
        skillsRecord[s.name] = selectedSkills.has(s.name);
      });

      await fetch('/api/chat/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: skillsRecord }),
      });

      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const loginData = await loginRes.json();

      if (loginRes.ok) {
        localStorage.setItem('auth-token', loginData.token);
        localStorage.setItem('auth-user', JSON.stringify(loginData.user || { username, email }));
        setStep('complete');
      } else {
        setError('设置成功，请登录');
        router.push('/login');
      }
    } catch (err: any) {
      setError(err.message || '设置失败');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSkill = (name: string) => {
    if (REQUIRED_SKILL_NAMES.has(name)) {
      return;
    }
    const newSelected = new Set(selectedSkills);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelectedSkills(newSelected);
  };

  const toggleAllSkills = () => {
    if (selectedSkills.size === skills.length) {
      setSelectedSkills(getDefaultSelectedSkills(skills));
      return;
    }
    setSelectedSkills(new Set(skills.map((skill) => skill.name)));
  };

  const isWindows = platform === 'win32';
  const personalDirPlaceholder = isWindows ? 'C:/Users/admin/workspace' : '/home/admin/workspace';
  const personalDirPickerRoot = getInitialPersonalDirectoryRoot(platform, personalDir, userHome, runtimeRoot);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <RobotLogo size={48} className="animate-robotPulse" />
          <p className="text-sm text-muted-foreground">
            {cloning ? '加载 Skills...' : '检查系统状态...'}
          </p>
        </div>
      </div>
    );
  }

  if (step === 'complete') {
    return (
      <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.16),transparent_34%),radial-gradient(circle_at_bottom,rgba(239,68,68,0.16),transparent_34%),hsl(var(--background))]">
        <div className="absolute inset-0 overflow-hidden">
          <motion.div
            className="absolute left-[10%] top-[22%] h-3 w-3 rounded-full bg-blue-500 shadow-[0_0_24px_rgba(59,130,246,0.8)]"
            animate={{ x: [0, 180, 360], y: [0, 44, 0], opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute right-[12%] top-[28%] h-3 w-3 rounded-full bg-red-500 shadow-[0_0_24px_rgba(239,68,68,0.8)]"
            animate={{ x: [0, -200, -360], y: [0, -40, 0], opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 5.1, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute left-[18%] bottom-[24%] h-2.5 w-2.5 rounded-full bg-blue-400 shadow-[0_0_18px_rgba(96,165,250,0.75)]"
            animate={{ x: [0, 140, 280], y: [0, -30, 0], opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }}
          />
          <motion.div
            className="absolute right-[20%] bottom-[20%] h-2.5 w-2.5 rounded-full bg-red-400 shadow-[0_0_18px_rgba(248,113,113,0.75)]"
            animate={{ x: [0, -160, -300], y: [0, 24, 0], opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 4.6, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
          />
          <div className="absolute left-[14%] right-[14%] top-[32%] h-px bg-gradient-to-r from-blue-500/20 via-blue-400/70 to-red-500/25" />
          <div className="absolute left-[10%] right-[10%] bottom-[30%] h-px bg-gradient-to-r from-red-500/20 via-red-400/70 to-blue-500/25" />
          <motion.div
            className="absolute left-[24%] top-[31.5%] h-2 w-24 rounded-full bg-gradient-to-r from-blue-500 via-sky-400 to-transparent"
            animate={{ x: [0, 520], opacity: [0, 1, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute right-[24%] bottom-[29.5%] h-2 w-24 rounded-full bg-gradient-to-l from-red-500 via-orange-400 to-transparent"
            animate={{ x: [0, -520], opacity: [0, 1, 0] }}
            transition={{ duration: 2.9, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
          />
        </div>

        <div className="relative z-10 flex min-h-screen items-center justify-center px-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="w-full max-w-3xl"
          >
            <div className="rounded-2xl border bg-card/72 p-10 shadow-2xl backdrop-blur-md">
              <div className="flex flex-col items-center text-center">
                <motion.div
                  animate={{ rotate: [0, 4, -4, 0], scale: [1, 1.05, 1] }}
                  transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <RobotLogo size={72} className="animate-robotPulse" />
                </motion.div>

                <div className="mt-8 grid w-full max-w-2xl grid-cols-3 items-center gap-4 text-xs text-muted-foreground">
                  <motion.div
                    className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-blue-700 dark:text-blue-300"
                    animate={{ y: [0, -5, 0] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <div className="font-medium">{'\u84dd\u65b9\u653b\u51fb'}</div>
                    <div className="mt-1 opacity-80">{'\u538b\u6d4b\u3001\u8d28\u7591\u3001\u7a81\u7834'}</div>
                  </motion.div>
                  <motion.div
                    className="rounded-lg border border-border bg-background/80 px-4 py-3"
                    animate={{ scale: [1, 1.04, 1] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
                  >
                    <div className="font-medium text-foreground">{'\u5de5\u4f5c\u6d41\u6d41\u8f6c'}</div>
                    <div className="mt-1">{'\u5206\u6790 \u2192 \u5bf9\u6297 \u2192 \u88c1\u51b3 \u2192 \u4ea4\u4ed8'}</div>
                  </motion.div>
                  <motion.div
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-700 dark:text-red-300"
                    animate={{ y: [0, 5, 0] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
                  >
                    <div className="font-medium">{'\u7ea2\u65b9\u9632\u5b88'}</div>
                    <div className="mt-1 opacity-80">{'\u5efa\u6a21\u3001\u62e6\u622a\u3001\u6536\u675f'}</div>
                  </motion.div>
                </div>

                <div className="mt-10 min-h-[3.5rem] text-center">
                  <h2 className="text-3xl font-semibold text-foreground sm:text-4xl">
                    {typedWelcome}
                    <motion.span
                      className="ml-1 inline-block h-[1.1em] w-[2px] bg-primary align-[-0.1em]"
                      animate={{ opacity: [1, 0, 1] }}
                      transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                    />
                  </h2>
                </div>

                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: typedWelcome.length === '\u6b22\u8fce\u4f7f\u7528 ACEHarness'.length ? 1 : 0.35 }}
                  transition={{ duration: 0.3 }}
                  className="mt-4 text-sm text-muted-foreground"
                >
                  {'\u4f60\u7684\u5de5\u4f5c\u6d41\u5df2\u5c31\u4f4d\uff0c\u5bf9\u6297\u4e0e\u534f\u4f5c\u73b0\u5728\u5f00\u59cb\u3002'}
                </motion.p>

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: showContinue ? 1 : 0, y: showContinue ? 0 : 12 }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className="mt-8"
                >
                  <Button size="lg" className="min-w-40" disabled={!showContinue} onClick={() => router.push('/')}>
                    {'\u7ee7\u7eed'}
                  </Button>
                </motion.div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  if (step === 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-blue-500/10 p-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <div className="flex items-center justify-center gap-3 mb-8">
            <RobotLogo size={56} className="animate-robotPulse" />
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">
                ACEHarness
              </h1>
              <p className="text-xs text-muted-foreground">Your team of AIs, collaborating to get work done.</p>
            </div>
          </div>

          <div className="bg-card rounded-2xl border p-8 shadow-xl">
            <div className="text-center mb-6">
              <h2 className="text-xl font-semibold">初始化设置</h2>
              <p className="text-sm text-muted-foreground mt-1">创建管理员账户</p>
            </div>

            <form onSubmit={handleAdminSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">用户名</label>
                <Input type="text" placeholder="请输入用户名" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={2} className="h-10" />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">邮箱</label>
                <Input type="email" placeholder="请输入邮箱" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-10" />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">密码</label>
                <Input type="password" placeholder="至少6个字符" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="h-10" />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">确认密码</label>
                <Input type="password" placeholder="再次输入密码" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} className="h-10" />
              </div>

              <div className="border-t pt-4">
                <label className="text-sm font-medium mb-1.5 block">密保问题</label>
                <Input type="text" placeholder="例如：我的宠物叫什么名字" value={question} onChange={(e) => setQuestion(e.target.value)} required className="h-10" />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">密保答案</label>
                <Input type="text" placeholder="请输入密保答案" value={answer} onChange={(e) => setAnswer(e.target.value)} required className="h-10" />
                <p className="text-xs text-muted-foreground mt-1">用于找回密码，请妥善保管</p>
              </div>

              <div className="border-t pt-4">
                <label className="text-sm font-medium mb-1.5 block">默认引擎</label>
                <SingleCombobox
                  value={engine}
                  onValueChange={(v) => {
                    setEngine(v);
                    setEngineAvailability((prev) => ({ ...prev, [v]: null }));
                  }}
                  options={getConcreteEngines().map((item) => ({ value: item.id, label: item.name }))}
                  placeholder="请选择默认引擎"
                />
                {checkingEngine && <p className="text-xs text-muted-foreground mt-1 animate-pulse">正在检测引擎可用性...</p>}
                {!checkingEngine && engine && engineAvailability[engine] === false && (
                  <p className="text-xs text-destructive mt-1">该引擎不可用，请确保已安装对应的命令行工具</p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">默认模型</label>
                <SingleCombobox
                  value={defaultModel}
                  onValueChange={setDefaultModel}
                  options={availableModels}
                  placeholder={checkingEngine ? '正在检测引擎...' : loadingModels ? '正在加载模型...' : '请选择默认模型'}
                  disabled={!engine || checkingEngine || loadingModels || availableModels.length === 0}
                />
                <p className="text-xs text-muted-foreground mt-1">首次进入和 Agent 跟随系统时都会使用这里的默认模型</p>
              </div>

              <div className="border-t pt-4">
                <label className="text-sm font-medium mb-1.5 block">系统数据保存目录</label>
                <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs break-all text-muted-foreground">
                  {runtimeRoot || '加载中...'}
                </div>
                <p className="text-xs text-muted-foreground mt-1">该目录为 ACEHarness 系统数据保存目录（skill、工作流和对话的历史记录、agent配置、Notebook），仅展示不可修改</p>
              </div>

              <div className="border-t pt-4">
                <label className="text-sm font-medium mb-1.5 block">个人目录（可选）</label>
                <Input type="text" placeholder={personalDirPlaceholder} value={personalDir} onChange={(e) => setPersonalDir(e.target.value)} className="h-10" />
                <div className="mt-2">
                  <WorkspaceDirectoryPicker workspaceRoot={personalDirPickerRoot} value={personalDir} onChange={setPersonalDir} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">工作流执行时的隔离目录</p>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">选择头像</label>
                <AvatarPicker value={avatar} onChange={setAvatar} />
              </div>

              {error && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  {error}
                </motion.div>
              )}

              <Button type="submit" className="w-full h-10">
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  下一步：选择技能
                </span>
              </Button>
            </form>
          </div>
        </motion.div>
      </div>
    );
  }

  if (step === 'skills') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-blue-500/10 p-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-2xl">
          <div className="flex items-center justify-center gap-3 mb-8">
            <RobotLogo size={56} className="animate-robotPulse" />
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">
                ACEHarness
              </h1>
              <p className="text-xs text-muted-foreground">Your team of AIs, collaborating to get work done.</p>
            </div>
          </div>

          <div className="bg-card rounded-2xl border p-8 shadow-xl">
            <div className="text-center mb-6">
              <h2 className="text-xl font-semibold">选择要安装的技能</h2>
              <p className="text-sm text-muted-foreground mt-1">已发现 {skills.length} 个技能，可根据需要选择启用</p>
            </div>

            {skills.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <span className="material-symbols-outlined text-4xl mb-2">extension</span>
                <p>未发现任何技能</p>
                <p className="text-xs mt-1">请将技能放入 skills/ 目录</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-muted-foreground">已选择 {selectedSkills.size} / {skills.length}</p>
                  <Button type="button" variant="outline" size="sm" onClick={toggleAllSkills}>
                    {selectedSkills.size === skills.length ? '取消全选' : '全选'}
                  </Button>
                </div>
                <div className="space-y-3 max-h-[400px] overflow-y-auto mb-6">
                  {skills.map((skill) => {
                    const isRequiredSkill = REQUIRED_SKILL_NAMES.has(skill.name);
                    const isSelected = selectedSkills.has(skill.name);
                    return (
                    <div
                      key={skill.name}
                      onClick={() => toggleSkill(skill.name)}
                      className={`p-4 rounded-xl border transition-colors ${
                        isRequiredSkill ? 'cursor-default ' : 'cursor-pointer '
                      }${
                        isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center ${
                            isSelected ? 'border-primary bg-primary' : 'border-muted-foreground'
                          }`}>
                            {isSelected && (
                              <span className="material-symbols-outlined text-xs text-white">check</span>
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{skill.label}</span>
                              {isRequiredSkill && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{'\u5fc5\u9009'}</span>
                              )}
                              {skill.source === 'anthropics' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500">Anthropics</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{skill.description || '\u6682\u65e0\u63cf\u8ff0'}</p>
                          </div>
                        </div>
                        <code className="text-xs text-muted-foreground">{skill.name}</code>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </>
            )}

            <div className="bg-muted/50 rounded-lg p-4 mb-6">
              <h3 className="text-sm font-medium mb-2 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">info</span>
                如何安装更多技能？
              </h3>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>将技能文件夹放入 <code className="bg-muted px-1 rounded">skills/</code> 目录</li>
                <li>每个技能需要包含带 frontmatter 的 <code className="bg-muted px-1 rounded">SKILL.md</code> 文件</li>
                <li>刷新页面后技能将自动被发现</li>
              </ol>
            </div>

            {error && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm mb-4">
                {error}
              </motion.div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep('admin')} className="flex-1">
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">arrow_back</span>
                  返回
                </span>
              </Button>
              <Button onClick={handleFinalSubmit} disabled={submitting} className="flex-1">
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <RobotLogo size={18} className="animate-robotPulse" />
                    设置中...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm">check</span>
                    完成设置 ({selectedSkills.size} 个技能)
                  </span>
                )}
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return null;
}
