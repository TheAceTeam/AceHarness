'use client';

import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { workspaceApi, type NotebookScope, type TreeNode } from '@/lib/core/api';
import DirectoryTreePicker from '@/components/common/DirectoryTreePicker';
import { queryKeys } from '@/client/query/query-keys';

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
  const queryClient = useQueryClient();
  const queryParams = useMemo(() => ({
    depth: 2,
    scope,
    shareToken: shareToken || '',
  }), [scope, shareToken]);

  const loadRoot = useCallback(async (): Promise<TreeNode[]> => {
    try {
      const result = await queryClient.fetchQuery({
        queryKey: queryKeys.notebook.tree(queryParams),
        queryFn: () => workspaceApi.getNotebookTree(2, { scope, shareToken }),
        staleTime: 30_000,
      });
      return result.tree || [];
    } catch (error: any) {
      if (scope === 'personal' && error?.message?.includes('用户未配置个人目录')) {
        throw new Error('未配置个人目录，请先在账号设置中配置个人目录');
      }
      throw error;
    }
  }, [queryClient, queryParams, scope, shareToken]);

  const loadChildren = useCallback(async (path: string): Promise<TreeNode[]> => {
    try {
      const result = await queryClient.fetchQuery({
        queryKey: queryKeys.notebook.subtree(path, queryParams),
        queryFn: () => workspaceApi.getNotebookSubTree(path, 2, { scope, shareToken }),
        staleTime: 30_000,
      });
      return result.tree || [];
    } catch (error: any) {
      if (scope === 'personal' && error?.message?.includes('用户未配置个人目录')) {
        throw new Error('未配置个人目录，请先在账号设置中配置个人目录');
      }
      throw error;
    }
  }, [queryClient, queryParams, scope, shareToken]);

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
