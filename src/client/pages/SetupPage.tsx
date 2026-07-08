'use client';

import { useState, useEffect } from 'react';
import { useRouter } from '@/lib/navigation/client';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField, FormSection } from '@/components/ui/form-section';
import { DataCard, DataCardDescription, DataCardHeader, DataCardMeta, DataCardTitle } from '@/components/ui/data-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { EngineSelect } from '@/components/EngineSelect';
import { ModelSelect } from '@/components/ModelSelect';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { RobotLogo } from '@/components/brand/RobotLogo';
import AvatarPicker from '@/components/AvatarPicker';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';
import { getConcreteEngines } from '@/lib/core/engine-metadata';
import type { ModelOption } from '@/lib/core/models';
import { modelEnginesSupportEngine } from '@/lib/models/engine-compatibility';
import { useAuthSetupStatusQuery, useInitialSetupMutation, useLoginMutation } from '@/client/query/auth';
import { useSaveEngineConfigMutation } from '@/client/query/engines';
import { PASSWORD_POLICY_DESCRIPTION, getLoginPasswordError } from '@/lib/auth/password-policy';
import { CheckCircle2, FolderCog, Puzzle } from 'lucide-react';

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

const SETUP_STEPS = [
  { id: 'admin', label: '管理员', description: '账号与密保' },
  { id: 'workspace', label: '工作区', description: '目录与头像' },
  { id: 'engine', label: '引擎模型', description: '默认执行配置' },
  { id: 'skills', label: 'Skills', description: '首页能力' },
  { id: 'complete', label: '验证完成', description: '进入系统' },
] as const;

function SetupStepper({ current }: { current: 'admin' | 'skills' | 'complete' }) {
  const activeIndex = current === 'admin' ? 2 : current === 'skills' ? 3 : 4;
  return (
    <div className="grid gap-2 sm:grid-cols-5" aria-label="初始化步骤">
      {SETUP_STEPS.map((item, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <div
            key={item.id}
            className={`rounded-lg border px-3 py-2 text-xs ${
              done || active ? 'border-primary/25 bg-accent text-accent-foreground' : 'border-[#E3E3DF] bg-white text-muted-foreground'
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px]">{index + 1}</span>
              {item.label}
            </div>
            <div className="mt-1 truncate text-[11px] opacity-75">{item.description}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function SetupPage() {
  const router = useRouter();
  useDocumentTitle('初始化设置');
  const setupStatusQuery = useAuthSetupStatusQuery();
  const initialSetupMutation = useInitialSetupMutation();
  const loginMutation = useLoginMutation();
  const saveEngineConfigMutation = useSaveEngineConfigMutation();
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
    const loadInitial = async () => {
      if (setupStatusQuery.isLoading) {
        setLoading(true);
        return;
      }
      if (setupStatusQuery.isError) {
        setError('检查状态失败');
        setLoading(false);
        setCloning(false);
        return;
      }
      const data = setupStatusQuery.data;
      if (!data) return;
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
      setLoading(false);
      setCloning(false);
    };
    void loadInitial();
  }, [router, setupStatusQuery.data, setupStatusQuery.isError, setupStatusQuery.isLoading]);

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

      let available = true;
      try {
        const availRes = await fetch(`/api/engine/availability?engine=${encodeURIComponent(engine)}`);
        const availData = await availRes.json();
        if (cancelled) return;
        available = Boolean(availData.available);
        setEngineAvailability((prev) => ({ ...prev, [engine]: available }));
      } catch {
        if (cancelled) return;
      }

      if (!available) {
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
          .filter((model) => modelEnginesSupportEngine(model.engines, engine))
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

    const passwordError = getLoginPasswordError(password, { username, email });
    if (passwordError) {
      setError(passwordError);
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
      await saveEngineConfigMutation.mutateAsync({ engine, defaultModel });

      await initialSetupMutation.mutateAsync({ username, email, password, question, answer, personalDir, avatar });

      const skillsRecord: Record<string, boolean> = {};
      skills.forEach(s => {
        skillsRecord[s.name] = selectedSkills.has(s.name);
      });

      await fetch('/api/chat/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: skillsRecord }),
      });

      try {
        await loginMutation.mutateAsync({ email, password });
        setStep('complete');
      } catch {
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
      <div className="min-h-screen flex items-center justify-center bg-[#F4F4F1]">
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
      <div className="min-h-screen bg-[#F4F4F1] px-4 py-8 sm:px-6">
        <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-4xl items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="w-full"
          >
            <div className="rounded-xl border border-[#E3E3DF] bg-white p-8 shadow-none sm:p-10">
              <div className="flex flex-col items-center text-center">
                <RobotLogo size={64} className="animate-robotPulse" />
                <div className="mt-8 w-full">
                  <SetupStepper current="complete" />
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
                  {'初始化已完成，可以进入 ACEHarness。'}
                </motion.p>

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: showContinue ? 1 : 0, y: showContinue ? 0 : 12 }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className="mt-8"
                >
                  <Button size="lg" variant="outline" className="min-w-40 bg-white" disabled={!showContinue} onClick={() => router.push('/?tour=1')}>
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
      <div className="min-h-screen bg-[#F4F4F1] px-4 py-8 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-4xl">
          <div className="mb-5 flex items-center gap-3">
            <RobotLogo size={48} />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold">ACEHarness 初始化</h1>
                <StatusPill tone="accent">Standalone setup</StatusPill>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">创建管理员、工作区、默认引擎和模型。</p>
            </div>
          </div>

          <div className="mb-5">
            <SetupStepper current="admin" />
          </div>

          <div className="rounded-xl border border-[#E3E3DF] bg-white p-6 shadow-none sm:p-8">
            <form onSubmit={handleAdminSubmit}>
              <FormSection title="管理员账户" description="首个用户会成为系统管理员。">
                <FormField label="用户名" required control={<Input type="text" placeholder="请输入用户名" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={2} className="h-10 bg-white" />} />
                <FormField label="邮箱" required control={<Input type="email" placeholder="请输入邮箱" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-10 bg-white" />} />
                <FormField label="密码" required description={PASSWORD_POLICY_DESCRIPTION} control={<Input type="password" placeholder="至少 8 位，包含字母和数字" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="h-10 bg-white" />} />
                <FormField label="确认密码" required control={<Input type="password" placeholder="再次输入密码" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} className="h-10 bg-white" />} />
              </FormSection>

              <FormSection title="密保验证" description="用于找回密码，请妥善保管。">
                <FormField label="密保问题" required control={<Input type="text" placeholder="例如：我的第一台电脑型号？" value={question} onChange={(e) => setQuestion(e.target.value)} required className="h-10 bg-white" />} />
                <FormField label="密保答案" required control={<Input type="text" placeholder="请输入密保答案" value={answer} onChange={(e) => setAnswer(e.target.value)} required className="h-10 bg-white" />} />
              </FormSection>

              <FormSection title="默认引擎和模型" description="首次进入和 Agent 跟随系统时都会使用这里的默认模型。">
                <FormField
                  label="默认引擎"
                  required
                  error={!checkingEngine && engine && engineAvailability[engine] === false ? '该引擎不可用，请确保已安装对应的命令行工具' : undefined}
                  control={(
                    <>
                      <EngineSelect
                        value={engine}
                        onChange={(v) => {
                          setEngine(v);
                          setEngineAvailability((prev) => ({ ...prev, [v]: null }));
                        }}
                        className="h-10"
                      />
                      {checkingEngine && <p className="mt-1 text-xs text-muted-foreground animate-pulse">正在检测引擎可用性...</p>}
                    </>
                  )}
                />
                <FormField label="默认模型" required control={<ModelSelect value={defaultModel} onChange={setDefaultModel} engine={engine} className="h-10" />} />
              </FormSection>

              <FormSection title="工作区" description="系统目录只展示，个人目录可选。">
                <FormField
                  label="系统数据保存目录"
                  control={<div className="rounded-md border border-[#E3E3DF] bg-[#F7F7F4] px-3 py-2 font-mono text-xs break-all text-muted-foreground">{runtimeRoot || '加载中...'}</div>}
                />
                <FormField
                  label="个人目录"
                  description="工作流执行时的隔离目录。"
                  control={(
                    <>
                      <Input type="text" placeholder={personalDirPlaceholder} value={personalDir} onChange={(e) => setPersonalDir(e.target.value)} className="h-10 bg-white" />
                      <div className="mt-2">
                        <WorkspaceDirectoryPicker workspaceRoot={personalDirPickerRoot} value={personalDir} onChange={setPersonalDir} />
                      </div>
                    </>
                  )}
                />
                <FormField label="选择头像" control={<AvatarPicker value={avatar} onChange={setAvatar} seed={username} />} />
              </FormSection>

              {error && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </motion.div>
              )}

              <Button type="submit" variant="outline" className="mt-5 h-10 w-full bg-white">
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  下一步：选择首页对话的 Skill
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
      <div className="min-h-screen bg-[#F4F4F1] px-4 py-8 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-5xl">
          <div className="mb-5 flex items-center gap-3">
            <RobotLogo size={48} />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold">选择首页对话的 Skill</h1>
                <StatusPill tone="accent">{selectedSkills.size} / {skills.length}</StatusPill>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">选择首页对话默认启用哪些能力。</p>
            </div>
          </div>

          <div className="mb-5">
            <SetupStepper current="skills" />
          </div>

          <div className="rounded-xl border border-[#E3E3DF] bg-white p-6 shadow-none sm:p-8">
            {skills.length === 0 ? (
              <EmptyState
                icon={<Puzzle className="h-5 w-5" />}
                title="未发现任何 Skill"
                description="请将 Skill 放入 skills/ 目录。"
              />
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">已选择 {selectedSkills.size} / {skills.length}</p>
                  <Button type="button" variant="outline" size="sm" onClick={toggleAllSkills}>
                    {selectedSkills.size === skills.length ? '取消全选' : '全选'}
                  </Button>
                </div>
                <div className="mb-6 grid max-h-[440px] gap-3 overflow-y-auto pr-1 md:grid-cols-2">
                  {skills.map((skill) => {
                    const isRequiredSkill = REQUIRED_SKILL_NAMES.has(skill.name);
                    const isSelected = selectedSkills.has(skill.name);
                    return (
                      <DataCard
                        key={skill.name}
                        selected={isSelected}
                        disabled={isRequiredSkill}
                        onClick={() => toggleSkill(skill.name)}
                        className={isRequiredSkill ? 'cursor-default' : 'cursor-pointer'}
                      >
                        <DataCardHeader>
                          <div className="min-w-0">
                            <DataCardTitle>{skill.label}</DataCardTitle>
                            <DataCardDescription className="line-clamp-2">{skill.description || '\u6682\u65e0\u63cf\u8ff0'}</DataCardDescription>
                          </div>
                          {isSelected ? <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" /> : null}
                        </DataCardHeader>
                        <DataCardMeta>
                          {isRequiredSkill ? <StatusPill tone="accent" className="text-[10px]">必选</StatusPill> : null}
                          {skill.source === 'anthropics' ? <StatusPill tone="warning" className="text-[10px]">Anthropics</StatusPill> : null}
                          <code className="truncate text-xs text-muted-foreground">{skill.name}</code>
                        </DataCardMeta>
                      </DataCard>
                    );
                  })}
                </div>
              </>
            )}

            <DataCard className="mb-6 bg-[#F7F7F4]">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <FolderCog className="h-4 w-4" />
                如何添加更多 Skill？
              </h3>
              <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
                <li>将 Skill 文件夹放入 <code className="bg-muted px-1 rounded">skills/</code> 目录</li>
                <li>每个 Skill 需要包含带 frontmatter 的 <code className="bg-muted px-1 rounded">SKILL.md</code> 文件</li>
                <li>刷新页面后 Skill 将自动被发现</li>
              </ol>
            </DataCard>

            {error && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </motion.div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep('admin')} className="flex-1 bg-white">
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">arrow_back</span>
                  返回
                </span>
              </Button>
              <Button variant="outline" onClick={handleFinalSubmit} disabled={submitting} className="flex-1 bg-white">
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <RobotLogo size={18} className="animate-robotPulse" />
                    设置中...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm">check</span>
                    完成选择 ({selectedSkills.size} 个 Skill)
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
