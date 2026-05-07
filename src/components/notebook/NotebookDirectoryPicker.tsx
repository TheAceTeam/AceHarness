'use client';

import { useCallback } from 'react';
import { workspaceApi, type NotebookScope, type TreeNode } from '@/lib/api';
import DirectoryTreePicker from '@/components/common/DirectoryTreePicker';

interface NotebookDirectoryPickerProps {
  scope: NotebookScope;
  value: string;
  onChange: (path: string) => void;
  shareToken?: string;
  disabled?: boolean;
  className?: string;
}

export default function NotebookDirectoryPicker({
  scope,
  value,
  onChange,
  shareToken,
  disabled = false,
  className,
}: NotebookDirectoryPickerProps) {
  const loadRoot = useCallback(async (): Promise<TreeNode[]> => {
    try {
      const result = await workspaceApi.getNotebookTree(2, { scope, shareToken });
      return result.tree || [];
    } catch (error: any) {
      if (scope === 'personal' && error?.message?.includes('用户未配置个人目录')) {
        throw new Error('未配置个人目录，请先在账号设置中配置个人目录');
      }
      throw error;
    }
  }, [scope, shareToken]);

  const loadChildren = useCallback(async (path: string): Promise<TreeNode[]> => {
    try {
      const result = await workspaceApi.getNotebookSubTree(path, 2, { scope, shareToken });
      return result.tree || [];
    } catch (error: any) {
      if (scope === 'personal' && error?.message?.includes('用户未配置个人目录')) {
        throw new Error('未配置个人目录，请先在账号设置中配置个人目录');
      }
      throw error;
    }
  }, [scope, shareToken]);

  return (
    <DirectoryTreePicker
      value={value}
      onChange={onChange}
      loadRoot={loadRoot}
      loadChildren={loadChildren}
      rootLabel="根目录 /"
      disabled={disabled}
      className={className}
    />
  );
}
