'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { workspaceApi, type TreeNode, type WorkspaceTreeResponse } from '@/lib/api';
import DirectoryTreePicker from '@/components/common/DirectoryTreePicker';

interface WorkspaceDirectoryPickerProps {
  workspaceRoot?: string;
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
  className?: string;
}

function normalizeSlashes(input: string): string {
  return (input || '').replace(/\\/g, '/');
}

function isWindowsAbsolutePath(input: string): boolean {
  return /^[a-zA-Z]:([/\\]|$)/.test(input);
}

function isPosixAbsolutePath(input: string): boolean {
  return input.startsWith('/');
}

function normalizeRoot(root: string): string {
  const normalized = normalizeSlashes((root || '').trim());
  if (!normalized) return '';
  if (isWindowsAbsolutePath(normalized)) {
    const drive = normalized.slice(0, 2).toUpperCase();
    const rest = normalized.slice(2).replace(/\/+$/, '');
    return rest ? `${drive}${rest}` : `${drive}/`;
  }
  if (normalized === '/') return '/';
  return normalized.replace(/\/+$/, '');
}

function isAbsolutePath(input: string): boolean {
  const normalized = normalizeSlashes((input || '').trim());
  return isWindowsAbsolutePath(normalized) || isPosixAbsolutePath(normalized);
}

function getDefaultRoot(root: string, value: string): string {
  const normalizedRoot = normalizeRoot(root);
  if (normalizedRoot) return normalizedRoot;
  const normalizedValue = normalizeRoot(value);
  if (isAbsolutePath(normalizedValue)) return normalizedValue;
  return '/';
}

function getParentAbsolutePath(input: string): string {
  const normalized = normalizeRoot(input);
  if (isWindowsAbsolutePath(normalized)) {
    if (/^[A-Z]:\/$/i.test(normalized)) return normalized;
    const withoutTrailing = normalized.replace(/\/+$/, '');
    const idx = withoutTrailing.lastIndexOf('/');
    if (idx <= 2) return `${withoutTrailing.slice(0, 2)}/`;
    return withoutTrailing.slice(0, idx);
  }
  if (normalized === '/') return '/';
  const idx = normalized.lastIndexOf('/');
  return idx <= 0 ? '/' : normalized.slice(0, idx);
}

function isFilesystemRoot(input: string): boolean {
  const normalized = normalizeRoot(input);
  if (!normalized) return false;
  if (normalized === '/') return true;
  return /^[A-Z]:\/$/i.test(normalized);
}

function toAbsolute(root: string, relative: string): string {
  const normalizedRoot = normalizeRoot(root);
  const normalizedRelative = normalizeSlashes(relative || '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalizedRelative) return normalizedRoot;
  if (isAbsolutePath(normalizedRelative)) {
    return normalizeRoot(normalizedRelative);
  }
  if (normalizedRoot === '/') return `/${normalizedRelative}`;
  return `${normalizedRoot}/${normalizedRelative}`;
}

function toRelative(root: string, absolute: string): string {
  const normalizedRoot = normalizeRoot(root);
  const normalizedAbsolute = normalizeRoot(absolute || '');
  if (!normalizedAbsolute || normalizedAbsolute === normalizedRoot) return '';

  if (isWindowsAbsolutePath(normalizedRoot)) {
    const rootLower = normalizedRoot.toLowerCase();
    const absoluteLower = normalizedAbsolute.toLowerCase();
    if (absoluteLower.startsWith(`${rootLower}/`)) {
      return normalizedAbsolute.slice(normalizedRoot.length + 1);
    }
    return '';
  }

  if (normalizedRoot === '/') return normalizedAbsolute.replace(/^\/+/, '');
  if (normalizedAbsolute.startsWith(`${normalizedRoot}/`)) return normalizedAbsolute.slice(normalizedRoot.length + 1);
  return '';
}

function getPathSegments(pathValue: string): string[] {
  return normalizeSlashes(pathValue).split('/').filter(Boolean);
}

function deriveRootFromValue(defaultRoot: string, value: string): string {
  const normalizedValue = normalizeRoot(value || '');
  if (!normalizedValue) return defaultRoot;
  if (isWindowsAbsolutePath(normalizedValue)) {
    if (isFilesystemRoot(defaultRoot) && normalizedValue !== defaultRoot) {
      return normalizedValue;
    }
    const relativeToDefault = toRelative(defaultRoot, normalizedValue);
    return relativeToDefault || normalizedValue === defaultRoot ? defaultRoot : normalizedValue;
  }
  if (isPosixAbsolutePath(normalizedValue)) {
    if (isFilesystemRoot(defaultRoot) && normalizedValue !== defaultRoot) {
      return normalizedValue;
    }
    const relativeToDefault = toRelative(defaultRoot, normalizedValue);
    return relativeToDefault || normalizedValue === defaultRoot ? defaultRoot : '/';
  }
  return defaultRoot;
}

export default function WorkspaceDirectoryPicker({
  workspaceRoot = '',
  value,
  onChange,
  disabled = false,
  className,
}: WorkspaceDirectoryPickerProps) {
  const defaultRoot = useMemo(() => getDefaultRoot(workspaceRoot, value), [value, workspaceRoot]);
  const [currentRoot, setCurrentRoot] = useState(() => deriveRootFromValue(defaultRoot, value));
  const [quickAccessRoots, setQuickAccessRoots] = useState<string[]>([]);
  const currentRootRef = useRef(currentRoot);

  useEffect(() => {
    const nextRoot = deriveRootFromValue(defaultRoot, value);
    currentRootRef.current = nextRoot;
    setCurrentRoot(nextRoot);
  }, [defaultRoot, value]);

  const relativeValue = useMemo(() => {
    if (!value) return '';
    const normalizedValue = normalizeRoot(value);
    const derived = toRelative(currentRoot, normalizedValue);
    if (derived) return derived;
    if (normalizedValue === currentRoot) return '';
    return isAbsolutePath(normalizedValue) ? '' : normalizedValue;
  }, [currentRoot, value]);

  const updateRootFromResponse = useCallback((result: WorkspaceTreeResponse) => {
    if (Array.isArray(result.availableRoots)) {
      setQuickAccessRoots(result.availableRoots.map(normalizeRoot).filter(Boolean));
    }
    if (!result.workspaceRoot) return;
    const normalized = normalizeRoot(result.workspaceRoot);
    if (normalized && normalized !== currentRootRef.current) {
      currentRootRef.current = normalized;
      setCurrentRoot(normalized);
    }
  }, []);

  const loadRoot = useCallback(async (): Promise<TreeNode[]> => {
    const result = await workspaceApi.getTree(currentRootRef.current, 2);
    updateRootFromResponse(result);
    return result.tree || [];
  }, [updateRootFromResponse]);

  const loadChildren = useCallback(async (path: string): Promise<TreeNode[]> => {
    const result = await workspaceApi.getSubTree(currentRootRef.current, path, 2);
    updateRootFromResponse(result);
    return result.tree || [];
  }, [updateRootFromResponse]);

  const resolveInputPath = useCallback((input: string) => {
    const normalizedInput = normalizeRoot(input);
    if (!normalizedInput) {
      return { root: currentRootRef.current, path: '' };
    }

    if (isAbsolutePath(normalizedInput)) {
      if (isWindowsAbsolutePath(normalizedInput)) {
        currentRootRef.current = normalizedInput;
        setCurrentRoot(normalizedInput);
        return { root: normalizedInput, path: '' };
      }
      currentRootRef.current = '/';
      setCurrentRoot('/');
      return { root: '/', path: toRelative('/', normalizedInput) };
    }

    return { root: currentRootRef.current, path: normalizeSlashes(normalizedInput).replace(/^\/+|\/+$/g, '') };
  }, []);

  const navigateUp = useCallback((currentPath: string) => {
    if (currentPath) {
      const parts = getPathSegments(currentPath);
      if (parts.length > 1) return { root: currentRootRef.current, path: parts.slice(0, -1).join('/') };
      if (parts.length === 1) return { root: currentRootRef.current, path: '' };
    }

    const parentRoot = getParentAbsolutePath(currentRootRef.current);
    if (parentRoot === currentRootRef.current) {
      return { root: currentRootRef.current, path: '' };
    }
    const previousName = getPathSegments(currentRootRef.current).slice(-1)[0] || '';
    currentRootRef.current = parentRoot;
    setCurrentRoot(parentRoot);
    return { root: parentRoot, path: previousName };
  }, []);

  const navigateHome = useCallback(() => {
    currentRootRef.current = defaultRoot;
    setCurrentRoot(defaultRoot);
    return { root: defaultRoot, path: toRelative(defaultRoot, value || defaultRoot) };
  }, [defaultRoot, value]);

  const handleChange = useCallback((relativePath: string) => {
    onChange(toAbsolute(currentRootRef.current, relativePath));
  }, [onChange]);

  return (
    <DirectoryTreePicker
      value={relativeValue}
      onChange={handleChange}
      loadRoot={loadRoot}
      loadChildren={loadChildren}
      rootLabel={currentRoot}
      quickAccessRoots={quickAccessRoots}
      disabled={disabled}
      className={className}
      onResolvePath={resolveInputPath}
      onNavigateUp={navigateUp}
      onNavigateHome={navigateHome}
    />
  );
}
