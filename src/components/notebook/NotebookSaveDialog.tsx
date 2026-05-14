'use client';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import type { ReactNode } from 'react';
import type { NotebookScope } from '@/lib/core/api';
import NotebookDirectoryPicker from '@/components/notebook/NotebookDirectoryPicker';
import { cn } from '@/lib/core/utils';

export interface NotebookDirectoryOption {
  path: string;
  label: string;
  name?: string;
  depth?: number;
}

interface NotebookSaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: NotebookScope;
  onScopeChange: (scope: NotebookScope) => void;
  directory: string;
  onDirectoryChange: (directory: string) => void;
  directories: NotebookDirectoryOption[];
  loadingDirectories?: boolean;
  saving?: boolean;
  previewText?: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  showScopeSelect?: boolean;
  scopeLabel?: string;
  directoryLabel?: string;
  scopeOptions?: Array<{ value: NotebookScope; label: string }>;
  shareToken?: string;
  extraContent?: ReactNode;
  contentClassName?: string;
  onConfirm: () => void;
}

export default function NotebookSaveDialog({
  open,
  onOpenChange,
  scope,
  onScopeChange,
  directory,
  onDirectoryChange,
  directories: _directories,
  loadingDirectories = false,
  saving = false,
  previewText,
  title = '保存到 Notebook',
  confirmLabel = '保存',
  cancelLabel = '取消',
  showScopeSelect = true,
  scopeLabel = '保存范围',
  directoryLabel = '目标目录',
  scopeOptions = [
    { value: 'personal', label: '个人' },
    { value: 'global', label: '团队' },
  ],
  shareToken,
  extraContent,
  contentClassName,
  onConfirm,
}: NotebookSaveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-2xl max-h-[90vh] overflow-y-auto", contentClassName)}>
        <DialogTitle>{title}</DialogTitle>
        <div className="mt-3 space-y-3">
          {extraContent}
          {showScopeSelect && (
            <div>
              <div className="mb-1 text-xs text-muted-foreground">{scopeLabel}</div>
              <Select
                value={scope}
                onValueChange={(value) => onScopeChange(value as NotebookScope)}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="选择范围" />
                </SelectTrigger>
                <SelectContent className="z-[150]">
                  {scopeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <div className="mb-1 text-xs text-muted-foreground">{directoryLabel}</div>
            <NotebookDirectoryPicker
              scope={scope}
              shareToken={shareToken}
              value={directory}
              onChange={onDirectoryChange}
              disabled={loadingDirectories}
              className="h-80"
            />
          </div>
          {previewText && (
            <div className="break-all rounded border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
              {previewText}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
            <Button size="sm" disabled={loadingDirectories || saving} onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
