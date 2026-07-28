'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { envApi } from '@/lib/core/api';
import { Plus, Trash2, X } from 'lucide-react';

interface EnvVar {
  key: string;
  value: string;
  enabled: boolean;
}

interface EnvVarError {
  key?: string;
}

const USER_ENV_GROUPS = [
  {
    id: 'claude',
    title: 'Claude',
    description: '当前用户自己的 Claude Code 变量。未设置时继续使用系统或宿主环境提供的值。',
    presets: [
      { key: 'ANTHROPIC_AUTH_TOKEN', label: 'Claude Code 使用的认证令牌' },
      { key: 'ANTHROPIC_BASE_URL', label: 'Claude Code 请求地址' },
      { key: 'CLAUDE_CODE_BASE_URL', label: 'Claude Code base URL 兼容变量' },
      { key: 'CLAUDE_CODE_API_BASE_URL', label: 'Claude Code API base URL 兼容变量' },
      { key: 'ACE_CLAUDE_CODE_EXECUTABLE', label: '指定 Claude Code 可执行文件' },
      { key: 'CLAUDE_CODE_EXECUTABLE', label: 'Claude Code 可执行文件备用变量' },
    ],
  },
  {
    id: 'codex',
    title: 'Codex',
    description: '当前用户自己的 Codex SDK 变量。未设置时继续使用系统或宿主环境提供的值。',
    presets: [
      { key: 'OPENAI_API_KEY', label: 'Codex SDK 使用的 API 密钥' },
      { key: 'OPENAI_BASE_URL', label: 'Codex SDK 使用的 base URL' },
    ],
  },
  {
    id: 'opencode',
    title: 'OpenCode',
    description: 'OpenCode 相关代码读取配置目录和 stream 超时变量；模型密钥通常由 OpenCode 自身配置或模型路由处理。',
    presets: [
      { key: 'OPENCODE_CONFIG_DIR', label: '指定 OpenCode 全局配置目录' },
      { key: 'ACE_OPENCODE_STREAM_TIMEOUT_MS', label: 'OpenCode stream 总超时，单位毫秒' },
      { key: 'ACE_OPENCODE_STREAM_IDLE_TIMEOUT_MS', label: 'OpenCode stream 空闲超时，单位毫秒' },
    ],
  },
  {
    id: 'kiro',
    title: 'Kiro',
    description: '当前项目的 Kiro wrapper 没有声明专属 Kiro 环境变量 schema。',
    presets: [],
  },
  {
    id: 'other-cli',
    title: '其他 CLI',
    description: '当前代码或配置中明确出现的其他 CLI 相关变量。',
    presets: [
      { key: 'GEMINI_MODEL', label: 'Gemini CLI 模型覆盖变量' },
      { key: 'MAGIC_CLI_PATH', label: '指定 Magic CLI 可执行文件路径' },
      { key: 'ACE_NGA_SDK_BASE_URL', label: 'NGA SDK 外部服务地址' },
      { key: 'ACE_NGA_SDK_COMMAND', label: '指定 NGA SDK 启动命令' },
      { key: 'ACE_NGA_BIN', label: 'NGA SDK 启动命令备用变量' },
      { key: 'ACE_CODEGENIE_SDK_BASE_URL', label: 'CodeGenie SDK 外部服务地址' },
      { key: 'ACE_CODEGENIE_SDK_COMMAND', label: '指定 CodeGenie SDK 启动命令' },
      { key: 'ACE_CODEGENIE_BIN', label: 'CodeGenie SDK 启动命令备用变量' },
    ],
  },
];

function validateEnvVars(vars: EnvVar[]) {
  const errors: EnvVarError[] = vars.map(() => ({}));
  const keyPattern = /^[A-Z_][A-Z0-9_]*$/;
  const keyMap = new Map<string, number[]>();

  vars.forEach((item, index) => {
    const trimmedKey = item.key.trim();
    const isEmptyRow = !trimmedKey && !item.value.trim() && item.enabled;

    if (!trimmedKey) {
      if (!isEmptyRow) {
        errors[index].key = '请输入变量名';
      }
      return;
    }

    if (!keyPattern.test(trimmedKey)) {
      errors[index].key = '仅支持大写字母、数字和下划线，且不能以数字开头';
      return;
    }

    const indexes = keyMap.get(trimmedKey) || [];
    indexes.push(index);
    keyMap.set(trimmedKey, indexes);
  });

  for (const indexes of keyMap.values()) {
    if (indexes.length > 1) {
      for (const index of indexes) {
        errors[index].key = '变量名不能重复';
      }
    }
  }

  return {
    errors,
    hasErrors: errors.some((item) => Boolean(item.key)),
  };
}

export default function EnvVarsDialog({ onClose, scope = 'user' }: { onClose: () => void; scope?: 'user' }) {
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [errors, setErrors] = useState<EnvVarError[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setSubmitError(null);
      try {
        const data = await envApi.get(scope);
        if (cancelled) return;
        const nextVars = data.vars || [];
        setVars(nextVars);
        setErrors(nextVars.map(() => ({})));
      } catch (error: any) {
        if (cancelled) return;
        setSubmitError(error?.message || '加载环境变量失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [scope]);

  const displayVars = useMemo(() => vars, [vars]);

  const updateVar = (index: number, patch: Partial<EnvVar>) => {
    setVars((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
    if (patch.key !== undefined) {
      setErrors((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, key: undefined } : item)));
    }
  };

  const addRow = () => {
    setVars((prev) => [...prev, { key: '', value: '', enabled: true }]);
    setErrors((prev) => [...prev, {}]);
  };

  const addPreset = (key: string) => {
    const exists = vars.some((item) => item.key.trim() === key);
    if (exists) return;
    setVars((prev) => {
      if (prev.some((item) => item.key.trim() === key)) return prev;
      return [...prev, { key, value: '', enabled: true }];
    });
    setErrors((prev) => [...prev, {}]);
  };

  const removeVar = (index: number) => {
    setVars((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    setErrors((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const save = async () => {
    const normalizedVars = vars.map((item) => ({ ...item, key: item.key.trim() }));
    const validation = validateEnvVars(normalizedVars);
    setErrors(validation.errors);
    if (validation.hasErrors) {
      setSubmitError('请先修正错误后再保存');
      return;
    }

    setSaving(true);
    setSubmitError(null);
    try {
      await envApi.save(scope, normalizedVars.filter((item) => item.key));
      onClose();
    } catch (error: any) {
      setSubmitError(error?.message || '保存环境变量失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background border rounded-xl shadow-2xl w-[720px] max-w-[calc(100vw-2rem)] max-h-[84vh] flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">key</span>
            <h2 className="text-base font-semibold">个人环境变量</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭个人环境变量">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="text-sm text-muted-foreground text-center py-8">加载中...</div>
          ) : (
            <div className="space-y-4">
              {submitError ? (
                <div className="text-xs text-destructive bg-destructive/10 rounded-md px-2 py-1.5">{submitError}</div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                {USER_ENV_GROUPS.map((group) => (
                  <div key={group.id} className="rounded-md border bg-muted/20 px-3 py-2">
                    <div className="text-sm font-medium">{group.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{group.description}</div>
                    {group.presets.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {group.presets.map((preset) => {
                        const exists = displayVars.some((item) => item.key.trim() === preset.key);
                        return (
                          <Button
                            key={`${group.id}-${preset.key}`}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => addPreset(preset.key)}
                            disabled={exists}
                            title={preset.label}
                            className="h-7 px-2 font-mono text-xs"
                          >
                            {exists ? '已添加 ' : '添加 '}{preset.key}
                          </Button>
                        );
                        })}
                      </div>
                    ) : (
                      <div className="mt-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                        没有可添加的固定变量；需要时可在下方添加自定义变量。
                      </div>
                    )}
                    {group.presets.length > 0 ? (
                      <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                        {group.presets.map((preset) => (
                          <div key={`${group.id}-${preset.key}-hint`} className="grid grid-cols-[auto_1fr] gap-2">
                            <code className="font-mono text-primary">{preset.key}</code>
                            <span>{preset.label}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-[1fr_1fr_48px_32px] gap-2 px-1 text-xs font-medium text-muted-foreground">
                <span>变量名</span>
                <span>变量值</span>
                <span className="text-center">启用</span>
                <span></span>
              </div>
              {displayVars.map((item, index) => (
                <div key={index} className="space-y-1">
                  <div className="grid grid-cols-[1fr_1fr_48px_32px] gap-2 items-center">
                    <Input
                      value={item.key}
                      onChange={(event) => updateVar(index, { key: event.target.value })}
                      placeholder="例如 OPENAI_API_KEY"
                      className={`h-8 text-xs font-mono ${errors[index]?.key ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                    />
                    <Input
                      value={item.value}
                      onChange={(event) => updateVar(index, { value: event.target.value })}
                      placeholder="只保存当前用户的值"
                      className="h-8 text-xs font-mono"
                    />
                    <div className="flex justify-center">
                      <Switch
                        checked={item.enabled}
                        onCheckedChange={(checked) => updateVar(index, { enabled: checked })}
                        className="scale-75"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeVar(index)}
                      className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`删除环境变量 ${item.key || index + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {errors[index]?.key ? (
                    <div className="px-1 text-xs text-destructive">{errors[index].key}</div>
                  ) : null}
                </div>
              ))}
              {displayVars.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">暂无环境变量</div>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t">
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-2 h-4 w-4" />
            添加自定义变量
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? '保存中...' : '保存个人环境变量'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
