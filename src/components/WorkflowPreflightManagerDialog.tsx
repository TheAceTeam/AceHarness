'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getUnsafePreflightCommandReason } from '@/lib/workflow/preflight-policy';

type WorkflowStepLike = { preCommands?: string[] };
type WorkflowConfigLike = {
  context?: { preflight?: { commands?: string[] } };
  workflow?: { states?: Array<{ steps?: WorkflowStepLike[] }> };
};

interface WorkflowPreflightManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: WorkflowConfigLike | null | undefined;
  onSave: (config: WorkflowConfigLike) => void;
}

function linesToList(value: string): string[] {
  return value.split('\n').map((item) => item.trim()).filter(Boolean);
}

export default function WorkflowPreflightManagerDialog({
  open,
  onOpenChange,
  config,
  onSave,
}: WorkflowPreflightManagerDialogProps) {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft((config?.context?.preflight?.commands || []).join('\n'));
  }, [config, open]);

  const commands = useMemo(() => linesToList(draft), [draft]);
  const rejected = useMemo(() => commands.map((command) => ({ command, reason: getUnsafePreflightCommandReason(command) }))
    .filter((item): item is { command: string; reason: string } => Boolean(item.reason)), [commands]);
  const stepCommandCount = useMemo(() => (config?.workflow?.states || [])
    .flatMap((state) => state.steps || [])
    .reduce((count, step) => count + (Array.isArray(step.preCommands) ? step.preCommands.filter((item) => item.trim()).length : 0), 0), [config]);

  const handleSave = () => {
    if (!config || rejected.length > 0) return;
    const nextConfig = JSON.parse(JSON.stringify(config)) as WorkflowConfigLike;
    nextConfig.context = nextConfig.context || {};
    if (commands.length > 0) nextConfig.context.preflight = { commands };
    else delete nextConfig.context.preflight;
    onSave(nextConfig);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[94vw] p-0">
        <DialogTitle className="sr-only">启动前只读检查</DialogTitle>
        <div className="flex flex-col">
          <div className="border-b px-6 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold">启动前只读检查</div>
                <div className="mt-1 text-xs text-muted-foreground">仅执行此处明确配置的工作流级只读检查；不会收集或提前执行任何步骤命令。</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-[10px]">契约命令 {commands.length}</Badge>
                <Badge variant="outline" className="text-[10px]">步骤命令 {stepCommandCount}（运行时执行）</Badge>
              </div>
            </div>
          </div>

          <div className="space-y-4 px-6 py-5">
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-xs leading-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
              <div className="font-medium">步骤 preCommands 不再属于启动前检查</div>
              <div className="mt-1 text-amber-900/80 dark:text-amber-100/80">它们只会在状态机到达对应步骤后、且运行工作区已准备好时执行。空契约是允许的，尤其适用于 Issue-first 或隔离副本工作流。</div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">工作流级只读检查（每行一条，可留空）</Label>
              <Textarea rows={7} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={'git status --porcelain\ngit diff --check\nnpm run lint'} className="font-mono text-xs leading-5" />
              <div className="text-[11px] text-muted-foreground">会拦截重定向、管道、Git 写操作、构建/测试/安装等可能写入的命令。建议只使用状态、差异和静态校验。</div>
            </div>
            {rejected.length > 0 && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
                <div className="font-medium">以下命令不能作为启动前检查保存</div>
                <ul className="mt-2 space-y-1 font-mono">{rejected.map((item) => <li key={item.command}>{item.command} — {item.reason}</li>)}</ul>
              </div>
            )}
          </div>

          <div className="border-t px-6 py-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="button" onClick={handleSave} disabled={rejected.length > 0}>保存只读检查</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
