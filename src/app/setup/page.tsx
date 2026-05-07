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

export default function SetupPage() {
  const router = useRouter();
  useDocumentTitle('初始化设置');
  const [step, setStep] = useState<'check' | 'admin' | 'skills'>('check');
  const [loading, setLoading] = useState(true);
  const [cloning, setCloning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Admin form
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [personalDir, setPersonalDir] = useState('');
  const [avatar, setAvatar] = useState('');
  const [engine, setEngine] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [availableModels, setAvailableModels] = useState<Array<{ value: string; label: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Skills
  const [skills, setSkills] = useState<DiscoveredSkill[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/auth/setup')
      .then(res => res.json())
      .then(async (data) => {
        if (data.isSetup) {
          router.push('/login');
        } else {
          // Load skills directly (no clone needed)
          try {
            const settingsRes = await fetch('/api/chat/settings');
            const settingsData = await settingsRes.json();
            const discoveredSkills = settingsData.discoveredSkills || [];
            setSkills(discoveredSkills);
            setSelectedSkills(new Set(discoveredSkills.map((skill: DiscoveredSkill) => skill.name)));
          } catch {
            // skills 加载失败仍可继续
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
    const loadModels = async () => {
      setLoadingModels(true);
      setError('');
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

    loadModels();
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

      // First setup admin
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

      // Then save skill settings
      const skillsRecord: Record<string, boolean> = {};
      skills.forEach(s => {
        skillsRecord[s.name] = selectedSkills.has(s.name);
      });

      await fetch('/api/chat/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: skillsRecord }),
      });

      // Auto login
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const loginData = await loginRes.json();

      if (loginRes.ok) {
        localStorage.setItem('auth-token', loginData.token);
        localStorage.setItem('auth-user', JSON.stringify(loginData.user || { username, email }));
        router.push('/');
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
      setSelectedSkills(new Set());
      return;
    }
    setSelectedSkills(new Set(skills.map((skill) => skill.name)));
  };

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

  if (step === 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-blue-500/10 p-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <RobotLogo size={56} className="animate-robotPulse" />
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">
                ACEHarness
              </h1>
              <p className="text-xs text-muted-foreground">Your team of AIs, collaborating to get work done.</p>
            </div>
          </div>

          {/* Admin Form */}
          <div className="bg-card rounded-2xl border p-8 shadow-xl">
            <div className="text-center mb-6">
              <h2 className="text-xl font-semibold">初始化设置</h2>
              <p className="text-sm text-muted-foreground mt-1">创建管理员账户</p>
            </div>

            <form onSubmit={handleAdminSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">用户名</label>
                <Input
                  type="text"
                  placeholder="请输入用户名"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={2}
                  className="h-10"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">邮箱</label>
                <Input
                  type="email"
                  placeholder="请输入邮箱"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-10"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">密码</label>
                <Input
                  type="password"
                  placeholder="至少6个字符"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="h-10"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">确认密码</label>
                <Input
                  type="password"
                  placeholder="再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  className="h-10"
                />
              </div>

              <div className="border-t pt-4">
                <label className="text-sm font-medium mb-1.5 block">密保问题</label>
                <Input
                  type="text"
                  placeholder="例如：我的宠物叫什么名字"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  required
                  className="h-10"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">密保答案</label>
                <Input
                  type="text"
                  placeholder="请输入密保答案"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  required
                  className="h-10"
                />
                <p className="text-xs text-muted-foreground mt-1">用于找回密码，请妥善保管</p>
              </div>

              <div className="border-t pt-4">
                <label className="text-sm font-medium mb-1.5 block">默认引擎</label>
                <SingleCombobox
                  value={engine}
                  onValueChange={setEngine}
                  options={getConcreteEngines().map((item) => ({ value: item.id, label: item.name }))}
                  placeholder="请选择默认引擎"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">默认模型</label>
                <SingleCombobox
                  value={defaultModel}
                  onValueChange={setDefaultModel}
                  options={availableModels}
                  placeholder={loadingModels ? '正在加载模型...' : '请选择默认模型'}
                  disabled={!engine || loadingModels || availableModels.length === 0}
                />
                <p className="text-xs text-muted-foreground mt-1">首次进入和 Agent 跟随系统时都会使用这里的默认模型</p>
              </div>

              <div className="border-t pt-4">
                <label className="text-sm font-medium mb-1.5 block">个人目录（可选）</label>
                <Input
                  type="text"
                  placeholder="例如：/data/users/admin"
                  value={personalDir}
                  onChange={(e) => setPersonalDir(e.target.value)}
                  className="h-10"
                />
                <div className="mt-2">
                  <WorkspaceDirectoryPicker
                    workspaceRoot="/"
                    value={personalDir}
                    onChange={setPersonalDir}
                    className="h-64"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">工作流执行时的隔离目录</p>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">选择头像</label>
                <AvatarPicker value={avatar} onChange={setAvatar} />
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm"
                >
                  {error}
                </motion.div>
              )}

              <Button
                type="submit"
                className="w-full h-10"
              >
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
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-2xl"
        >
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <RobotLogo size={56} className="animate-robotPulse" />
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">
                ACEHarness
              </h1>
              <p className="text-xs text-muted-foreground">Your team of AIs, collaborating to get work done.</p>
            </div>
          </div>

          {/* Skills Selection */}
          <div className="bg-card rounded-2xl border p-8 shadow-xl">
            <div className="text-center mb-6">
              <h2 className="text-xl font-semibold">选择要安装的技能</h2>
              <p className="text-sm text-muted-foreground mt-1">
                已发现 {skills.length} 个技能，可根据需要选择启用
              </p>
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
                  <p className="text-xs text-muted-foreground">
                    已选择 {selectedSkills.size} / {skills.length}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={toggleAllSkills}
                  >
                    {selectedSkills.size === skills.length ? '取消全选' : '全选'}
                  </Button>
                </div>
                <div className="space-y-3 max-h-[400px] overflow-y-auto mb-6">
                  {skills.map((skill) => (
                    <div
                      key={skill.name}
                      onClick={() => toggleSkill(skill.name)}
                      className={`p-4 rounded-xl border cursor-pointer transition-colors ${
                        selectedSkills.has(skill.name)
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                            selectedSkills.has(skill.name)
                              ? 'border-primary bg-primary'
                              : 'border-muted-foreground'
                          }`}>
                            {selectedSkills.has(skill.name) && (
                              <span className="material-symbols-outlined text-xs text-white">check</span>
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{skill.label}</span>
                              {skill.source === 'anthropics' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500">Anthropics</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{skill.description || '暂无描述'}</p>
                          </div>
                        </div>
                        <code className="text-xs text-muted-foreground">{skill.name}</code>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Help text */}
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
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm mb-4"
              >
                {error}
              </motion.div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setStep('admin')}
                className="flex-1"
              >
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">arrow_back</span>
                  返回
                </span>
              </Button>
              <Button
                onClick={handleFinalSubmit}
                disabled={submitting}
                className="flex-1"
              >
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
