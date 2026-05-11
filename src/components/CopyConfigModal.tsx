'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { copyConfigFormSchema, type CopyConfigForm } from '@/lib/schemas';
import { useToast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CopyConfigModalProps {
  isOpen: boolean;
  sourceFilename: string;
  onClose: () => void;
  onSuccess: (newFilename: string) => void;
}

export default function CopyConfigModal({
  isOpen,
  sourceFilename,
  onClose,
  onSuccess,
}: CopyConfigModalProps) {
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
    reset,
    getValues,
  } = useForm<CopyConfigForm>({
    resolver: zodResolver(copyConfigFormSchema),
  });

  const normalizeFilenameField = () => {
    const raw = (getValues('newFilename') || '').trim();
    if (!raw) return;

    let normalized = raw;
    if (/\.yml$/i.test(normalized)) {
      normalized = normalized.replace(/\.yml$/i, '.yaml');
    } else if (!/\.yaml$/i.test(normalized)) {
      normalized = `${normalized}.yaml`;
    }

    if (normalized !== getValues('newFilename')) {
      setValue('newFilename', normalized, { shouldDirty: true, shouldValidate: true });
    }
  };

  const onSubmit = async (data: CopyConfigForm) => {
    try {
      const response = await fetch(`/api/configs/${encodeURIComponent(sourceFilename)}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newFilename: data.newFilename, workflowName: data.workflowName }),
      });
      const result = await response.json();
      if (!response.ok) {
        const details = Array.isArray(result.details)
          ? result.details
          : Array.isArray(result.details?.issues)
            ? result.details.issues
            : [];
        if (details.length > 0) {
          for (const issue of details) {
            const field = issue?.path?.[0];
            if (field === 'newFilename' || field === 'workflowName') {
              setError(field, { type: 'server', message: issue.message });
            }
          }
          toast('error', '表单验证失败:\n' + details.map((e: any) => e?.message || '未知校验错误').join('\n'));
        } else {
          toast('error', result.message || result.error);
        }
        return;
      }
      toast('success', '配置文件复制成功！');
      reset();
      onSuccess(data.newFilename);
      onClose();
    } catch (error: any) {
      toast('error', '复制失败: ' + error.message);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg flex flex-col p-0">
        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
          <DialogTitle>复制配置</DialogTitle>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </Button>
        </div>
        <form id="copy-config-form" onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-auto px-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workflowName">
              工作流名称 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="workflowName"
              placeholder="我的工作流副本"
              {...register('workflowName')}
              className={errors.workflowName ? 'border-destructive' : ''}
            />
            {errors.workflowName && (
              <p className="text-sm text-destructive">{errors.workflowName.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              新工作流的显示名称
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="newFilename">
              新文件名 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="newFilename"
              placeholder="my-workflow-copy.yaml"
              {...register('newFilename', {
                onBlur: normalizeFilenameField,
              })}
              className={errors.newFilename ? 'border-destructive' : ''}
            />
            {errors.newFilename && (
              <p className="text-sm text-destructive">{errors.newFilename.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              文件名必须以 .yaml 结尾，只能包含字母、数字、下划线和连字符
            </p>
          </div>
        </form>

        <div className="flex gap-2 justify-end p-6 pt-4 border-t flex-shrink-0">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="copy-config-form" disabled={isSubmitting}>
            {isSubmitting ? '复制中...' : '复制'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
